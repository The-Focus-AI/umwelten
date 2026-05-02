#!/usr/bin/env node
/**
 * Coding 2-pass — give models one shot at fixing their own mistakes.
 *
 * Reads round-1 results from `output/evaluations/llm-eval-coding/runs/NNN/`,
 * for each non-perfect generation task replays the conversation, re-runs the
 * code to capture the exact error, appends a user message asking the model
 * to fix it, and re-scores the round-2 response. Writes results to
 * `output/evaluations/llm-eval-coding-2pass/runs/NNN/` so the original
 * round-1 numbers stay intact and the combine report can show both
 * dimensions side-by-side.
 *
 * Tasks that already scored full in round-1 are copied through as-is —
 * no need to spend tokens re-trying perfect answers.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/run-coding-2pass.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/run-coding-2pass.ts --model nemotron
 *   dotenvx run -- pnpm tsx examples/local-providers/run-coding-2pass.ts --lang go
 *   dotenvx run -- pnpm tsx examples/local-providers/run-coding-2pass.ts --new
 */

import '../model-showdown/shared/env.js';
import fs from 'node:fs';
import path from 'node:path';

// AI SDK can fire NoOutputGeneratedError from a stream finalizer
// promise that isn't on the caller's await path. The primary
// streamText() promise never settles in that case, so suppressing the
// unhandled rejection alone leaves the caller hanging. We track the
// most recent AbortController and trigger it when this fires, which
// unblocks the await with a clean error the driver can handle.
let activeAbortController: AbortController | null = null;
process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message ?? String(reason);
  if (/AI_NoOutputGeneratedError|No output generated/i.test(msg)) {
    console.error(`  ⚠ NoOutputGeneratedError → aborting current task`);
    activeAbortController?.abort(new Error('empty model output'));
    return;
  }
  throw reason;
});

import { Interaction } from '../../src/interaction/core/interaction.js';
import { Stimulus } from '../../src/stimulus/stimulus.js';
import { modelKey } from '../../src/evaluation/suite.js';
import {
  loadTranscript,
  type TranscriptFile,
} from '../../src/evaluation/replay.js';
import {
  lookupGenerationTask,
  verifyGenerationResponse,
  executeLocal,
} from '../../src/evaluation/llm-eval/coding.js';
import type { ModelDetails } from '../../src/cognition/types.js';

const ROUND1_EVAL = 'llm-eval-coding';
const ROUND2_EVAL = 'llm-eval-coding-2pass';
const PER_TASK_TIMEOUT_MS = 5 * 60_000;

// ── CLI ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function readArg(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1 || i + 1 >= argv.length) return undefined;
  return argv[i + 1];
}
const modelFilter = readArg('--model');
const langFilter = readArg('--lang') as 'typescript' | 'python' | 'go' | undefined;
const forceNew = argv.includes('--new');

// ── Run dirs ────────────────────────────────────────────────────────────────

function findLatestRun(evalName: string): string | null {
  const base = path.join(process.cwd(), 'output', 'evaluations', evalName, 'runs');
  if (!fs.existsSync(base)) return null;
  const dirs = fs
    .readdirSync(base)
    .filter((d) => /^\d+$/.test(d))
    .sort();
  return dirs.length === 0 ? null : path.join(base, dirs[dirs.length - 1]);
}

function resolve2PassRun(): { runId: string; runDir: string } {
  const base = path.join(process.cwd(), 'output', 'evaluations', ROUND2_EVAL, 'runs');
  fs.mkdirSync(base, { recursive: true });
  const existing = fs
    .readdirSync(base)
    .filter((d) => /^\d+$/.test(d))
    .map((d) => parseInt(d, 10))
    .sort((a, b) => a - b);
  const latest = existing.length > 0 ? existing[existing.length - 1] : 0;
  const n = forceNew || existing.length === 0 ? latest + 1 : latest;
  const runId = String(n).padStart(3, '0');
  return { runId, runDir: path.join(base, runId) };
}

// ── Round-2 prompt ──────────────────────────────────────────────────────────

/**
 * Round-2 message: paste the raw error verbatim, no scaffolding. Tests
 * whether the model can reason from "here's what went wrong" alone,
 * without instructions about what to do with it.
 */
function buildFeedbackMessage(
  details: string,
  exec?: { stdout: string; stderr: string; exitCode: number },
): string {
  if (exec?.stderr && exec.exitCode !== 0) {
    return exec.stderr.slice(0, 1500).trim();
  }
  if (exec?.stdout) {
    return exec.stdout.slice(0, 1500).trim();
  }
  return details;
}

// ── Main per-task logic ─────────────────────────────────────────────────────

interface Round1Record {
  taskId: string;
  model: string;
  provider: string;
  responseText: string;
  score: number;
  maxScore: number;
  details: string;
  partial?: boolean;
  section?: string;
}

async function processTask(
  round1Dir: string,
  round2Dir: string,
  taskId: string,
  modelFile: string,
): Promise<{ status: 'skipped' | 'cached-perfect' | 'retried' | 'no-transcript' | 'no-task'; before: number; after: number; max: number }> {
  const round1Path = path.join(round1Dir, taskId, modelFile);
  const transcriptPath = path.join(
    round1Dir,
    taskId,
    modelFile.replace(/\.json$/, '.transcript.json'),
  );
  const r1 = JSON.parse(fs.readFileSync(round1Path, 'utf8')) as Round1Record;

  const taskInfo = lookupGenerationTask(taskId);
  if (!taskInfo) return { status: 'no-task', before: 0, after: 0, max: 0 };

  const round2TaskDir = path.join(round2Dir, taskId);
  fs.mkdirSync(round2TaskDir, { recursive: true });
  const round2Path = path.join(round2TaskDir, modelFile);

  // Cache hit: already done in this 2-pass run
  if (fs.existsSync(round2Path)) {
    const cached = JSON.parse(fs.readFileSync(round2Path, 'utf8'));
    return {
      status: 'retried',
      before: cached.round1Score ?? r1.score,
      after: cached.score,
      max: r1.maxScore,
    };
  }

  // Perfect round-1 — pass through
  if (r1.score === r1.maxScore) {
    const passthrough = {
      ...r1,
      round1Score: r1.score,
      round1Details: r1.details,
      round2Skipped: 'round-1 already perfect',
    };
    fs.writeFileSync(round2Path, JSON.stringify(passthrough, null, 2));
    return {
      status: 'cached-perfect',
      before: r1.score,
      after: r1.score,
      max: r1.maxScore,
    };
  }

  // No transcript means we can't do 2-pass — emit pass-through with note
  if (!fs.existsSync(transcriptPath)) {
    const passthrough = {
      ...r1,
      round1Score: r1.score,
      round1Details: r1.details,
      round2Skipped: 'no transcript saved (run pre-dates transcript capture)',
    };
    fs.writeFileSync(round2Path, JSON.stringify(passthrough, null, 2));
    return { status: 'no-transcript', before: r1.score, after: r1.score, max: r1.maxScore };
  }

  // Replay + 2nd pass
  const transcript = loadTranscript(transcriptPath);

  // Re-run round-1 code to get the actual exec error to feed back.
  // Use the stored response (full, untruncated) from the transcript's
  // last assistant message rather than the 2KB-clipped responseText.
  const lastAssistant = [...transcript.messages]
    .reverse()
    .find((m) => m.role === 'assistant');
  const round1Response =
    typeof lastAssistant?.content === 'string'
      ? lastAssistant.content
      : r1.responseText;

  const r1Verify = verifyGenerationResponse(
    taskInfo.challenge,
    taskInfo.lang,
    round1Response,
  );

  // Build feedback + replayed Interaction
  const stimulus = new Stimulus({
    ...transcript.stimulusOptions,
    runnerType: 'base',
  });
  const model: ModelDetails = {
    name: transcript.model,
    provider: transcript.provider,
  };
  const interaction = new Interaction(model, stimulus);
  interaction.messages = transcript.messages.slice();

  const feedback = buildFeedbackMessage(r1Verify.details, r1Verify.exec);
  interaction.addMessage({ role: 'user', content: feedback });

  // Round-2 generation with watchdog. Register the AbortController
  // globally so the unhandled-rejection handler can trip it on
  // NoOutputGeneratedError (otherwise the streamText promise hangs).
  const ctrl = new AbortController();
  activeAbortController = ctrl;
  const watchdog = setTimeout(() => ctrl.abort(), PER_TASK_TIMEOUT_MS);
  let round2Response: string;
  let round2DurationMs: number;
  let round2Error: string | undefined;
  const t0 = Date.now();
  try {
    const resp = await interaction.streamText(ctrl.signal);
    round2Response = resp.content;
    round2DurationMs = Date.now() - t0;
  } catch (err: any) {
    round2Response = '';
    round2DurationMs = Date.now() - t0;
    round2Error = err?.message ?? String(err);
  } finally {
    clearTimeout(watchdog);
    activeAbortController = null;
  }

  const r2Verify = round2Response
    ? verifyGenerationResponse(taskInfo.challenge, taskInfo.lang, round2Response)
    : { score: 0, details: round2Error ?? 'empty round-2 response', code: null };

  const record = {
    taskId,
    model: r1.model,
    provider: r1.provider,
    section: r1.section,
    round1Score: r1.score,
    round1Details: r1.details,
    score: r2Verify.score,
    maxScore: r1.maxScore,
    details: r2Verify.details,
    durationMs: round2DurationMs,
    cost: 0,
    responseText: round2Response.slice(0, 2000),
    feedbackPrompt: feedback,
    ...(round2Error && { error: round2Error }),
  };
  fs.writeFileSync(round2Path, JSON.stringify(record, null, 2));

  // Sidecar transcript: full round-1+round-2 conversation
  const allMessages = interaction.getMessages().slice();
  fs.writeFileSync(
    path.join(round2TaskDir, modelFile.replace(/\.json$/, '.transcript.json')),
    JSON.stringify(
      {
        taskId,
        model: r1.model,
        provider: r1.provider,
        prompt: transcript.prompt,
        stimulusOptions: transcript.stimulusOptions,
        messages: allMessages,
      },
      null,
      2,
    ),
  );

  return {
    status: 'retried',
    before: r1.score,
    after: r2Verify.score,
    max: r1.maxScore,
  };
}

// ── Main loop ───────────────────────────────────────────────────────────────

async function main() {
  const round1Dir = findLatestRun(ROUND1_EVAL);
  if (!round1Dir) {
    console.error(`No runs found for ${ROUND1_EVAL}.`);
    process.exit(1);
  }
  const { runId, runDir: round2Dir } = resolve2PassRun();
  fs.mkdirSync(round2Dir, { recursive: true });

  console.log('🔁 Coding 2-pass');
  console.log(`   round-1: ${path.relative(process.cwd(), round1Dir)}`);
  console.log(`   round-2: ${path.relative(process.cwd(), round2Dir)} (run ${runId})`);
  if (modelFilter) console.log(`   model filter: ${modelFilter}`);
  if (langFilter) console.log(`   lang filter:  ${langFilter}`);
  console.log();

  // Find every (task, model) cell in round-1 generation tasks
  const taskDirs = fs
    .readdirSync(round1Dir)
    .filter((d) => d.startsWith('gen-'))
    .filter((d) => !langFilter || d.endsWith(`-${langFilter}`))
    .sort();

  let total = 0;
  let retried = 0;
  let improved = 0;
  let regressed = 0;
  let scoreBefore = 0;
  let scoreAfter = 0;
  let maxTotal = 0;

  for (const taskId of taskDirs) {
    const taskDir = path.join(round1Dir, taskId);
    const modelFiles = fs
      .readdirSync(taskDir)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.transcript.json'))
      .filter((f) => !modelFilter || f.includes(modelFilter));

    if (modelFiles.length === 0) continue;

    console.log(`📝 ${taskId}`);
    for (const modelFile of modelFiles) {
      total++;
      try {
        const r = await processTask(round1Dir, round2Dir, taskId, modelFile);
        scoreBefore += r.before;
        scoreAfter += r.after;
        maxTotal += r.max;
        const tag = modelFile.replace(/\.json$/, '');
        if (r.status === 'retried') {
          retried++;
          if (r.after > r.before) improved++;
          else if (r.after < r.before) regressed++;
          const arrow =
            r.after > r.before
              ? `\x1b[32m↑\x1b[0m`
              : r.after < r.before
                ? `\x1b[31m↓\x1b[0m`
                : '→';
          console.log(`  ${arrow} ${tag}: ${r.before}/${r.max} → ${r.after}/${r.max}`);
        } else if (r.status === 'cached-perfect') {
          console.log(`  ✓ ${tag}: ${r.before}/${r.max} (perfect, passthrough)`);
        } else if (r.status === 'no-transcript') {
          console.log(`  ⚠ ${tag}: no transcript saved (skipped)`);
        }
      } catch (err: any) {
        console.error(`  ✗ ${modelFile}: ${err?.message ?? err}`);
      }
    }
  }

  console.log();
  console.log('━'.repeat(70));
  console.log(`Total cells:   ${total}`);
  console.log(`Retried:       ${retried}`);
  console.log(`  ↑ improved:  ${improved}`);
  console.log(`  ↓ regressed: ${regressed}`);
  console.log(`Score before:  ${scoreBefore}/${maxTotal} (${((scoreBefore / Math.max(1, maxTotal)) * 100).toFixed(1)}%)`);
  console.log(`Score after:   ${scoreAfter}/${maxTotal} (${((scoreAfter / Math.max(1, maxTotal)) * 100).toFixed(1)}%)`);
  console.log(`Δ:             ${scoreAfter - scoreBefore >= 0 ? '+' : ''}${scoreAfter - scoreBefore} pts`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
