#!/usr/bin/env node
/**
 * Local-Providers Soul.md Test
 *
 * Simulates a multi-turn conversation where the user reveals facts about
 * themselves. The model has file tools (read/write/list/grep) scoped to a
 * temp directory. Its job: maintain a `soul.md` file that captures the
 * current, deduplicated, up-to-date set of facts.
 *
 * After all turns, an LLM judge scores the final soul.md against the
 * ground-truth fact list.
 *
 * This doubles as the autoresearch/artifact-builder substrate: same tools,
 * same sandbox, different task.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/soul-md.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/soul-md.ts --frontier --new
 */

import '../../model-showdown/shared/env.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { z } from 'zod';
import { tool } from 'ai';
import { Interaction } from '../../../src/interaction/core/interaction.js';
import { Stimulus } from '../../../src/stimulus/stimulus.js';
import { clearAllRateLimitStates } from '../../../src/rate-limit/rate-limit.js';
import type { ModelDetails } from '../../../src/cognition/types.js';
import { LOCAL_MODELS, ALL_MODELS, includeFrontier, modelLabel, modelKey } from '../shared/models.js';
import { JUDGE_MODEL, judgeResponse } from '../../model-showdown/shared/judge.js';

// ── Sandboxed file tools ─────────────────────────────────────────────────────

function createSandboxTools(sandboxDir: string) {
  function resolveSandboxPath(p: string): string {
    const normalized = path.normalize(p.startsWith('/') ? p.slice(1) : p);
    const full = path.resolve(sandboxDir, normalized);
    const rel = path.relative(sandboxDir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`path escapes sandbox: ${p}`);
    }
    return full;
  }

  const read_file = tool({
    description: 'Read a text file from the workspace',
    inputSchema: z.object({ path: z.string().describe('File path relative to workspace') }),
    execute: async ({ path: p }) => {
      const full = resolveSandboxPath(p);
      try {
        return { content: fs.readFileSync(full, 'utf8') };
      } catch (err: any) {
        if (err.code === 'ENOENT') return { content: '', note: 'file does not exist yet' };
        throw err;
      }
    },
  });

  const write_file = tool({
    description: 'Write (or overwrite) a text file in the workspace',
    inputSchema: z.object({
      path: z.string().describe('File path relative to workspace'),
      content: z.string().describe('Full file content'),
    }),
    execute: async ({ path: p, content }) => {
      const full = resolveSandboxPath(p);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      return { ok: true, bytes: content.length };
    },
  });

  const list_directory = tool({
    description: 'List files in a workspace directory',
    inputSchema: z.object({ path: z.string().default('.').describe('Directory path') }),
    execute: async ({ path: p }) => {
      const full = resolveSandboxPath(p);
      try {
        return { entries: fs.readdirSync(full) };
      } catch {
        return { entries: [] };
      }
    },
  });

  return { read_file, write_file, list_directory };
}

// ── Scenario ─────────────────────────────────────────────────────────────────

interface Turn {
  user: string;
  /** Facts that should exist in soul.md after this turn (and all prior turns). */
  expectedFacts: string[];
  /** Facts that should NOT be present (e.g. things the user retracted). */
  shouldNotContain?: string[];
}

const SCENARIO: Turn[] = [
  {
    user: "Hey. My name is Sam, I'm 34, and I live in Brooklyn.",
    expectedFacts: ['name: Sam', 'age: 34', 'location: Brooklyn'],
  },
  {
    user: "I'm a software engineer. Been doing Python mostly, for about 10 years now.",
    expectedFacts: ['occupation: software engineer', 'primary language: Python', 'years of experience: ~10'],
  },
  {
    user: "I have a cat named Luna. She's 7 years old. I'm allergic to shellfish.",
    expectedFacts: ['pet: cat named Luna, age 7', 'allergy: shellfish'],
  },
  {
    user: "Actually I'm 35 now, had my birthday last week.",
    expectedFacts: ['age: 35'],
    shouldNotContain: ['age: 34'],
  },
  {
    user: "I've been learning Rust on the side. Also thinking about moving to Portugal next year.",
    expectedFacts: ['learning: Rust', 'plan: move to Portugal next year'],
  },
  {
    user: "Scratch the Portugal thing, decided to stay in Brooklyn.",
    expectedFacts: ['location: Brooklyn (stayed)'],
    shouldNotContain: ['move to Portugal', 'moving to Portugal'],
  },
  {
    user: "My partner Alex is a graphic designer. We've been together 5 years.",
    expectedFacts: ['partner: Alex, graphic designer', 'relationship length: 5 years'],
  },
  {
    user: "I play chess competitively, rated around 1800 on lichess.",
    expectedFacts: ['hobby: competitive chess', 'lichess rating: ~1800'],
  },
];

const FULL_GROUND_TRUTH = [
  'Name: Sam',
  'Age: 35 (had a birthday recently; was 34 at the start of the conversation)',
  'Location: Brooklyn (considered moving to Portugal but decided to stay)',
  'Occupation: software engineer',
  'Primary language: Python (~10 years experience)',
  'Currently learning: Rust',
  'Pet: cat named Luna, 7 years old',
  'Allergy: shellfish',
  'Partner: Alex, graphic designer, together 5 years',
  'Hobby: competitive chess, ~1800 rated on lichess',
];

// ── Judge schema ─────────────────────────────────────────────────────────────

const SoulJudgeSchema = z.object({
  captured_facts: z.coerce.number().min(0).max(10).describe('How many of the 10 ground-truth facts are clearly captured (0-10)'),
  has_stale_data: z.coerce.boolean().describe('Does the file still contain retracted facts (age 34, moving to Portugal)?'),
  well_structured: z.coerce.boolean().describe('Is the file organized / readable markdown (not just a dump)?'),
  quality_score: z.coerce.number().min(0).max(10).describe('Overall quality score 0-10'),
  explanation: z.string().describe('Brief explanation of the score'),
});

const JUDGE_INSTRUCTIONS = [
  "Score a soul.md file maintained by an AI assistant during a conversation.",
  "Ground-truth facts (10 total):",
  ...FULL_GROUND_TRUTH.map((f, i) => `${i + 1}. ${f}`),
  "",
  "Count how many of these 10 facts are CLEARLY and CURRENTLY captured in the file.",
  "Check if the file still contains stale/retracted data: 'age 34' (now 35) or 'moving to Portugal' (decided to stay).",
  "Assess whether the file is well-structured markdown (headings, lists) rather than a raw dump.",
  "Return a JSON object matching the schema.",
];

// ── Run scenario on one model ────────────────────────────────────────────────

async function runScenario(model: ModelDetails, sandboxDir: string): Promise<{ turnsCompleted: number; finalSoul: string; transcript: string[] }> {
  fs.mkdirSync(sandboxDir, { recursive: true });
  const tools = createSandboxTools(sandboxDir);

  const stimulus = new Stimulus({
    role: 'diligent personal assistant',
    objective: "maintain a soul.md file in the workspace that captures what you know about the user",
    instructions: [
      'You have file tools: read_file, write_file, list_directory.',
      'Every turn: after reading the user message, update /soul.md to reflect the current set of facts you know about them.',
      'Read the existing /soul.md first (it may be empty) before writing.',
      'If the user retracts or updates something, REMOVE the old info — do not leave stale data.',
      'Organize the file with clear headings and bullet points.',
      'After updating the file, briefly acknowledge the user (1-2 sentences).',
    ],
    temperature: 0.1,
    maxTokens: 2000,
    maxToolSteps: 8,
    runnerType: 'base',
  });
  stimulus.setTools(tools);

  const interaction = new Interaction(model, stimulus);
  const transcript: string[] = [];

  let turnsCompleted = 0;
  for (const turn of SCENARIO) {
    interaction.addMessage({ role: 'user', content: turn.user });
    try {
      const response = await interaction.generateText();
      const text = response?.content ?? '';
      transcript.push(`USER: ${turn.user}\nASSISTANT: ${text.slice(0, 300)}`);
      turnsCompleted++;
    } catch (err: any) {
      transcript.push(`USER: ${turn.user}\nERROR: ${err.message}`);
      break;
    }
  }

  let finalSoul = '';
  const soulPath = path.join(sandboxDir, 'soul.md');
  try {
    finalSoul = fs.readFileSync(soulPath, 'utf8');
  } catch {}

  return { turnsCompleted, finalSoul, transcript };
}

// ── Main ─────────────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'evaluations', 'local-providers-soul-md');
const forceNew = process.argv.includes('--new');

function nextRunId(): string {
  const baseDir = path.join(OUTPUT_DIR, 'runs');
  fs.mkdirSync(baseDir, { recursive: true });
  const existing = fs.readdirSync(baseDir).filter(d => /^\d+$/.test(d)).map(Number).sort((a, b) => a - b);
  const latest = existing.length > 0 ? existing[existing.length - 1] : 1;
  const n = forceNew ? latest + 1 : latest;
  return String(n).padStart(3, '0');
}

async function main() {
  const models = includeFrontier() ? ALL_MODELS : LOCAL_MODELS;
  const runId = nextRunId();

  console.log('🧠 Local-Providers Soul.md Test');
  console.log('═'.repeat(70));
  console.log(`Scenario:  ${SCENARIO.length} turns`);
  console.log(`Models:    ${models.length}`);
  console.log(`Judge:     ${JUDGE_MODEL.provider}:${JUDGE_MODEL.name}`);
  console.log(`Run:       #${runId}`);
  console.log('═'.repeat(70));
  console.log();

  const results: any[] = [];
  const runDir = path.join(OUTPUT_DIR, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });

  for (const model of models) {
    const mk = modelKey(model);
    const fp = path.join(runDir, `${mk}.json`);
    if (!forceNew && fs.existsSync(fp)) {
      const cached = JSON.parse(fs.readFileSync(fp, 'utf8'));
      results.push(cached);
      console.log(`✓ ${modelLabel(model)} → ${cached.quality_score}/10 (cached)`);
      continue;
    }

    console.log(`\n▶ ${modelLabel(model)}`);
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), `soul-${mk}-`));

    const start = Date.now();
    let scenarioResult: { turnsCompleted: number; finalSoul: string; transcript: string[] };
    try {
      scenarioResult = await runScenario(model, sandboxDir);
    } catch (err: any) {
      console.log(`  ❌ scenario error: ${err.message.slice(0, 80)}`);
      const r = {
        model: model.name, provider: model.provider,
        error: err.message, turnsCompleted: 0, finalSoul: '',
        captured_facts: 0, has_stale_data: true, well_structured: false, quality_score: 0,
        durationMs: Date.now() - start,
      };
      results.push(r);
      fs.writeFileSync(fp, JSON.stringify(r, null, 2));
      continue;
    }

    console.log(`  scenario complete: ${scenarioResult.turnsCompleted}/${SCENARIO.length} turns, ${scenarioResult.finalSoul.length} chars in soul.md`);

    let judgeResult: any;
    try {
      judgeResult = await judgeResponse(
        JUDGE_MODEL,
        JUDGE_INSTRUCTIONS,
        scenarioResult.finalSoul || '(empty)',
        SoulJudgeSchema,
      );
    } catch (err: any) {
      console.log(`  ⚠️ judge error: ${err.message.slice(0, 80)}`);
      judgeResult = { captured_facts: 0, has_stale_data: true, well_structured: false, quality_score: 0, explanation: 'judge failed' };
    }

    const r = {
      model: model.name,
      provider: model.provider,
      turnsCompleted: scenarioResult.turnsCompleted,
      finalSoul: scenarioResult.finalSoul,
      transcript: scenarioResult.transcript,
      ...judgeResult,
      durationMs: Date.now() - start,
    };
    results.push(r);
    fs.writeFileSync(fp, JSON.stringify(r, null, 2));

    const icon = r.quality_score >= 7 ? '✅' : r.quality_score >= 4 ? '⚠️' : '❌';
    console.log(`  ${icon} ${r.quality_score}/10  facts=${r.captured_facts}/10  stale=${r.has_stale_data}  structured=${r.well_structured}`);
    console.log(`     ${judgeResult.explanation?.slice(0, 120) || ''}`);

    clearAllRateLimitStates();
  }

  // ── Aggregate ─────────────────────────────────────────────────────────────
  console.log('\n\n🏁 SOUL.MD RANKINGS');
  console.log('─'.repeat(80));
  const ranked = [...results].sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0));
  console.log(`${'Model'.padEnd(50)} ${'Score'.padEnd(8)} ${'Facts'.padEnd(8)} ${'Clean'.padEnd(8)}`);
  for (const r of ranked) {
    const label = `${r.provider}:${r.model}`;
    const clean = r.has_stale_data === false && r.well_structured === true ? 'Y' : 'N';
    console.log(`${label.padEnd(50)} ${`${r.quality_score}/10`.padEnd(8)} ${`${r.captured_facts}/10`.padEnd(8)} ${clean.padEnd(8)}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
