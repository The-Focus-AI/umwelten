/**
 * EvalSuite — Tight, declarative evaluation runner.
 *
 * Write ONLY the interesting parts: tasks, stimulus, scoring.
 * The suite handles: CLI flags, run dirs, caching, execution,
 * judging, aggregation, and console/JSON output.
 *
 * Two scoring modes:
 *   1. `verify(response) → { score, details }` — deterministic, no LLM
 *   2. `judge: { schema, instructions }` — automatic LLM judge call
 *
 * Example:
 *   const suite = new EvalSuite({
 *     name: 'my-eval',
 *     stimulus: { role: 'helpful assistant', temperature: 0.3 },
 *     tasks: [
 *       { id: 'q1', prompt: 'What is 2+2?', maxScore: 1,
 *         verify: (r) => ({ score: r.trim() === '4' ? 1 : 0, details: r.trim() }) },
 *     ],
 *   });
 *   await suite.run();
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { CoreMessage } from 'ai';
import { Stimulus, type StimulusOptions } from '../stimulus/stimulus.js';
import { SimpleEvaluation } from './strategies/simple-evaluation.js';
import { EvaluationCache } from './caching/cache-service.js';
import { clearAllRateLimitStates } from '../rate-limit/rate-limit.js';
import type { ModelDetails, ModelResponse } from '../cognition/types.js';
import { Interaction } from '../interaction/core/interaction.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface VerifyResult {
  score: number;
  details: string;
}

/** Deterministic task — you supply the scoring function */
export interface VerifyTask {
  id: string;
  name?: string;
  prompt: string;
  maxScore: number;
  /**
   * Score the response. The full ModelResponse is passed as a second arg
   * so tool-calling tasks can inspect `response.metadata.toolCalls`
   * without needing a separate code path. Most tasks ignore the second
   * arg and just use the text.
   */
  verify: (response: string, fullResponse?: ModelResponse) => VerifyResult;
  /**
   * Optional grouping label. Used by the llm-eval composite suites to
   * tag each task with its origin sub-suite (e.g. `instruction` vs
   * `reasoning`) so reports can show sub-scores. Has no effect on the
   * runner.
   */
  section?: string;
}

/** LLM-judged task — you supply judge schema + instructions */
export interface JudgeTask {
  id: string;
  name?: string;
  prompt: string;
  maxScore: number;
  judge: {
    schema: z.ZodObject<any>;
    instructions: string[];
    /** Extract numeric score from parsed judge output (default: result.reasoning_quality ?? result.score ?? 0) */
    extractScore?: (judgeResult: any) => number;
  };
  /** Optional grouping label — see VerifyTask.section. */
  section?: string;
}

export type EvalTask = VerifyTask | JudgeTask;

export function isJudgeTask(task: EvalTask): task is JudgeTask {
  return 'judge' in task;
}

export interface EvalSuiteConfig {
  /** Evaluation name — used for output directory */
  name: string;
  /** Stimulus config (or a factory per task) */
  stimulus: Omit<StimulusOptions, 'runnerType'> | ((task: EvalTask) => Omit<StimulusOptions, 'runnerType'>);
  /** Tasks to run */
  tasks: EvalTask[];
  /** Models (override with --all at runtime) */
  models?: ModelDetails[];
  /** Full model list used when --all is passed (default: models) */
  allModels?: ModelDetails[];
  /** Judge model for JudgeTasks (default: claude-haiku-4.5 via openrouter) */
  judgeModel?: ModelDetails;
  /** Max concurrency for model calls (default: 5) */
  concurrency?: number;
  /** Delay between judge calls in ms (default: 500) */
  judgeDelayMs?: number;
  /** Per-task timeout in ms. A single hung task won't kill the whole suite (default: 5 min) */
  perTaskTimeoutMs?: number;
}

export interface TaskResultRecord {
  taskId: string;
  model: string;
  provider: string;
  reasoningEffort?: string;
  responseText: string;
  score: number;
  maxScore: number;
  details: string;
  durationMs: number;
  cost: number;
  judge?: any;
  error?: string;
  /** Sub-suite label, copied from EvalTask.section. */
  section?: string;
  /** True if generation was aborted mid-stream (watchdog timeout). The
   *  responseText is whatever was accumulated before the abort fired. */
  partial?: boolean;
  /** Reasoning/thinking tokens (e.g. from Gemma <think> blocks). Captured
   *  for partial responses so we can see what the model was doing when
   *  the watchdog fired — often a giant reasoning loop with no answer. */
  reasoning?: string;
  /** Token usage from the runtime, for partials especially — shows how
   *  many tokens were burned before the abort. */
  tokenUsage?: { promptTokens?: number; completionTokens?: number; total?: number };
  /**
   * The exact user prompt sent to the model. Stored alongside the
   * stimulus snapshot so we can rebuild the conversation without
   * re-deriving from task definitions (which may change between runs).
   */
  prompt?: string;
  /**
   * Snapshot of the resolved Stimulus options (role / objective /
   * instructions / temperature / etc.). Tools are stripped — they're
   * functions and not safely serializable; replay logic reattaches the
   * task's tool set on demand.
   */
  stimulusOptions?: Omit<StimulusOptions, 'tools' | 'runnerType'>;
  /**
   * Full message transcript: system + user + assistant (+ tool turns).
   * Replay rebuilds an Interaction from this; 2-pass evals append to
   * it. Untruncated. Sidecar transcript file is written next to the
   * task result so the main JSON stays small for report consumers.
   */
  messages?: CoreMessage[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_JUDGE: ModelDetails = { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' };

function modelLabel(m: ModelDetails): string {
  const effort = m.reasoningEffort ? `[${m.reasoningEffort}]` : '';
  return `${m.provider}:${m.name}${effort}`;
}

export function modelKey(m: ModelDetails): string {
  const effort = m.reasoningEffort ? `-effort-${m.reasoningEffort}` : '';
  return `${m.name.replace(/[\/:]/g, '-')}-${m.provider}${effort}`;
}

function parseRunFlag(): number | null {
  const idx = process.argv.indexOf('--run');
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  const n = parseInt(process.argv[idx + 1], 10);
  return Number.isNaN(n) ? null : n;
}

function resolveRun(evalName: string): { runId: string; runDir: string; isResume: boolean } {
  const baseDir = path.join(process.cwd(), 'output', 'evaluations', evalName, 'runs');
  fs.mkdirSync(baseDir, { recursive: true });

  const existing = fs.readdirSync(baseDir)
    .filter(d => /^\d+$/.test(d))
    .map(d => parseInt(d, 10))
    .sort((a, b) => a - b);

  const requested = parseRunFlag();
  const forceNew = process.argv.includes('--new');
  const latest = existing.length > 0 ? existing[existing.length - 1] : 1;
  const runNumber = forceNew ? (latest + 1) : (requested ?? latest);
  const runId = String(runNumber).padStart(3, '0');
  const runDir = path.join(baseDir, runId);

  return { runId, runDir, isResume: existing.includes(runNumber) };
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** Parse JSON from LLM response (handles markdown fences) */
function parseJudgeJSON(response: string): any {
  let s = response.trim();
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/) || s.match(/(\{[\s\S]*\})/);
  if (m) s = m[1].trim();
  return JSON.parse(s);
}

/** Coerce common LLM type mismatches */
function coerceTypes(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      if (value === 'true') { result[key] = true; continue; }
      if (value === 'false') { result[key] = false; continue; }
      const num = Number(value);
      if (!isNaN(num) && value.trim() !== '' &&
          (key.includes('score') || key.includes('quality') || key.includes('answer'))) {
        result[key] = num; continue;
      }
    }
    result[key] = value;
  }
  return result;
}

// ── EvalSuite ────────────────────────────────────────────────────────────────

export interface EvalSuiteRunOptions {
  /**
   * Optional AbortSignal. When aborted (e.g. by a harness watchdog),
   * in-flight generation is cancelled by forwarding the signal through
   * SimpleEvaluation → Interaction → BaseModelRunner → AI SDK. Without
   * this, a watchdog only rejects its `await` while the generation
   * continues in the background — the original bug that led to phantom
   * traffic re-loading evicted models.
   */
  signal?: AbortSignal;
}

export class EvalSuite {
  private config: EvalSuiteConfig;

  constructor(config: EvalSuiteConfig) {
    this.config = config;
  }

  async run(opts: EvalSuiteRunOptions = {}): Promise<TaskResultRecord[]> {
    const { signal } = opts;
    const isAll = process.argv.includes('--all');
    const models = isAll
      ? (this.config.allModels ?? this.config.models ?? [])
      : (this.config.models ?? []);

    if (models.length === 0) {
      console.error('No models configured. Pass models in config or use --all.');
      process.exit(1);
    }

    const { runId, runDir, isResume } = resolveRun(this.config.name);
    const judgeModel = this.config.judgeModel ?? DEFAULT_JUDGE;
    const concurrency = this.config.concurrency ?? 5;
    const judgeDelayMs = this.config.judgeDelayMs ?? 500;
    const perTaskTimeoutMs = this.config.perTaskTimeoutMs ?? 300_000;
    const tasks = this.config.tasks;
    const totalMaxPerModel = tasks.reduce((s, t) => s + t.maxScore, 0);

    // Header
    console.log(`\n🧪 ${this.config.name}`);
    console.log('═'.repeat(70));
    console.log(`Tasks:   ${tasks.length} (${tasks.map(t => t.name ?? t.id).join(', ')})`);
    console.log(`Models:  ${models.length}`);
    console.log(`Max:     ${totalMaxPerModel} per model`);
    console.log(`Run:     #${runId}${isResume ? ' (resuming)' : ''}`);
    console.log('═'.repeat(70));

    const allResults: TaskResultRecord[] = [];

    for (const task of tasks) {
      // Bail out cleanly between tasks when aborted. Prevents wasting
      // judge calls or model spin-up on a suite the harness has decided
      // to cancel.
      if (signal?.aborted) {
        throw new Error(
          signal.reason instanceof Error
            ? signal.reason.message
            : 'EvalSuite aborted',
        );
      }
      console.log(`\n📝 ${task.name ?? task.id}`);

      // Build stimulus
      const stimOpts = typeof this.config.stimulus === 'function'
        ? this.config.stimulus(task)
        : this.config.stimulus;
      const stimulus = new Stimulus({ ...stimOpts, runnerType: 'base' });
      // Snapshot for replay: drop tools (functions, not safely
      // serializable). runnerType is already excluded by EvalSuiteConfig
      // type. Everything else round-trips through JSON.
      const { tools: _tools, ...stimulusSnapshot } = stimOpts;

      // Get model responses
      const cache = new EvaluationCache(
        `${this.config.name}/runs/${runId}/${task.id}`,
        { verbose: false },
      );

      const evaluation = new SimpleEvaluation(stimulus, models, task.prompt, cache, {
        evaluationId: `${this.config.name}-${task.id}-${runId}`,
        useCache: true,
        concurrent: true,
        maxConcurrency: concurrency,
        showProgress: true,
        signal,
      }, (p) => {
        if (p.status === 'completed') console.log(`  ✅ ${p.modelName}`);
        else if (p.status === 'error') console.log(`  ❌ ${p.modelName}: ${p.error}`);
      });

      // Per-task timeout: a single hung task won't kill the whole suite.
      // This is critical for local models that can get stuck in thinking loops.
      //
      // On timeout, we fire the abort signal but await evaluation.run()
      // anyway so the runner can return whatever partial content the
      // model emitted before being interrupted. SimpleEvaluation forwards
      // the signal to streamText, which has been wired to salvage the
      // accumulated `fullText`/`reasoningText` on AbortError.
      //
      // A secondary hard-deadline race protects against a runtime that
      // ignores the abort signal — if evaluation.run() doesn't settle
      // within HARD_DEADLINE_GRACE_MS after we fire the abort, we throw
      // and treat all models as zero-score timeouts (legacy behavior).
      const HARD_DEADLINE_GRACE_MS = 30_000;
      const taskController = new AbortController();
      let timedOut = false;
      const taskTimer = setTimeout(() => {
        timedOut = true;
        taskController.abort(new Error(`per-task timeout: exceeded ${perTaskTimeoutMs / 1000}s`));
      }, perTaskTimeoutMs);

      // Re-wire signal forwarding: pass taskController.signal to the
      // strategy (via config.signal, set above on `evaluation`).
      (evaluation as any).config.signal = taskController.signal;

      let evalResults;
      try {
        evalResults = await Promise.race([
          evaluation.run(),
          new Promise<never>((_, reject) => {
            // Hard deadline: fire perTaskTimeout + grace AFTER abort signal.
            // Used only as a safety net — normally evaluation.run() settles
            // promptly after abort because streamText respects the signal.
            const hardTimer = setTimeout(
              () => reject(new Error(`hard timeout: exceeded ${(perTaskTimeoutMs + HARD_DEADLINE_GRACE_MS) / 1000}s`)),
              perTaskTimeoutMs + HARD_DEADLINE_GRACE_MS,
            );
            // Allow GC if the race resolves first
            (hardTimer as any).unref?.();
          }),
        ]);
      } catch (err: any) {
        // Hard deadline hit — runtime ignored abort signal. Fall back to
        // zero-score timeout records (legacy behavior).
        console.log(`  ⏱  hard timeout after ${(perTaskTimeoutMs + HARD_DEADLINE_GRACE_MS) / 1000}s — skipping`);
        for (const model of models) {
          const record: TaskResultRecord = {
            taskId: task.id,
            model: model.name,
            provider: model.provider,
            responseText: '',
            score: 0,
            maxScore: task.maxScore,
            details: `hard timeout: ${err?.message ?? 'unknown'}`,
            durationMs: perTaskTimeoutMs + HARD_DEADLINE_GRACE_MS,
            cost: 0,
            error: err?.message ?? 'hard timeout',
            partial: true,
          };
          allResults.push(record);
          console.log(`  ❌ ${modelLabel(model)} → 0/${task.maxScore} (hard timeout)`);
        }
        clearTimeout(taskTimer);
        continue;
      }
      clearTimeout(taskTimer);

      if (timedOut) {
        console.log(`  ⏱  task aborted after ${perTaskTimeoutMs / 1000}s — scoring partial output`);
      }

      // Score each response
      const resultsDir = path.join(runDir, task.id);
      fs.mkdirSync(resultsDir, { recursive: true });

      if (isJudgeTask(task)) {
        clearAllRateLimitStates();
        console.log(`  ⚖️  Judging with ${modelLabel(judgeModel)}...`);
      }

      for (const result of evalResults) {
        const mk = modelKey(result.model);
        const resultPath = path.join(resultsDir, `${mk}.json`);

        // Cache hit — skip if we have a non-error result (unless --new)
        if (fs.existsSync(resultPath) && !process.argv.includes('--new')) {
          try {
            const cached = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as TaskResultRecord;
            // Re-run if previous result was an error, partial (watchdog
            // abort), or a zero-score judge result. Partials are retried
            // because the model may produce a complete answer next time
            // — but we keep the partial record on disk as evidence of
            // the timeout pattern.
            if (!cached.error && !cached.partial && (cached.score > 0 || !isJudgeTask(task))) {
              allResults.push(cached);
              const icon = cached.score >= cached.maxScore * 0.8 ? '✅' : cached.score > 0 ? '⚠️' : '❌';
              console.log(`  ${icon} ${modelLabel(result.model)} → ${cached.score}/${cached.maxScore} (cached)`);
              continue;
            }
            // Error, partial, or zero-score judge — retry
          } catch { /* corrupt file — re-score */ }
        }

        const responseText = typeof result.response.content === 'string'
          ? result.response.content
          : JSON.stringify(result.response.content);

        // True if streamText was aborted mid-generation (watchdog timeout)
        // and salvaged the accumulated text. The response is still scored
        // — the model may have produced enough before the abort to score
        // points — but we flag it so reports can distinguish complete
        // answers from truncated ones.
        const isPartial = (result.response.metadata as any)?.partial === true;

        let score = 0;
        let details = isPartial ? 'partial response (watchdog abort)' : 'empty response';
        let judge: any = undefined;

        if (responseText && !result.metadata.error) {
          if (isJudgeTask(task)) {
            // LLM judge
            try {
              const judgeResult = await this.runJudge(
                judgeModel, task.judge.instructions, responseText, task.judge.schema, signal,
              );
              judge = judgeResult;
              const extract = task.judge.extractScore
                ?? ((r: any) => r.reasoning_quality ?? r.score ?? 0);
              score = extract(judgeResult);
              details = judgeResult.explanation ?? JSON.stringify(judgeResult).slice(0, 100);
            } catch (err) {
              details = `judge error: ${err instanceof Error ? err.message : String(err)}`;
            }
            await delay(judgeDelayMs);
          } else {
            // Deterministic verify. Pass the full response as well so
            // tool-calling tasks can inspect metadata.toolCalls.
            const v = task.verify(responseText, result.response);
            score = v.score;
            details = v.details;
          }
        }

        const reasoningText =
          typeof (result.response as any).reasoning === 'string'
            ? (result.response as any).reasoning
            : undefined;
        const usage = (result.response.metadata as any)?.tokenUsage;

        const record: TaskResultRecord = {
          taskId: task.id,
          model: result.model.name,
          provider: result.model.provider,
          reasoningEffort: result.model.reasoningEffort,
          responseText: responseText.slice(0, 2000),
          score,
          maxScore: task.maxScore,
          details,
          durationMs: result.metadata.duration,
          cost: result.response.metadata.cost?.totalCost || 0,
          judge,
          error: result.metadata.error,
          ...(task.section && { section: task.section }),
          ...(isPartial && { partial: true }),
          // Capture reasoning + usage for partials especially. For
          // non-partials, only save reasoning when present and shortish
          // — full <think> blocks for completed runs are noise.
          ...(reasoningText && (isPartial || reasoningText.length < 4000) && {
            reasoning: reasoningText.slice(0, isPartial ? 8000 : 4000),
          }),
          ...(usage && { tokenUsage: {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            total: usage.total,
          }}),
          prompt: task.prompt,
          stimulusOptions: stimulusSnapshot,
        };
        allResults.push(record);
        fs.writeFileSync(resultPath, JSON.stringify(record, null, 2));

        // Sidecar transcript file: full untruncated message history,
        // suitable for replay or multi-turn follow-up. Written separately
        // so the main result file stays small for report consumers that
        // never need the transcript.
        const messages = (result.response as ModelResponse).messages;
        if (messages && messages.length > 0) {
          const transcriptPath = path.join(resultsDir, `${mk}.transcript.json`);
          fs.writeFileSync(
            transcriptPath,
            JSON.stringify(
              {
                taskId: task.id,
                model: result.model.name,
                provider: result.model.provider,
                prompt: task.prompt,
                stimulusOptions: stimulusSnapshot,
                messages,
              },
              null,
              2,
            ),
          );
        }

        const icon = score >= task.maxScore * 0.8 ? '✅' : score > 0 ? '⚠️' : '❌';
        const partialMark = isPartial ? ' ⏱[partial]' : '';
        console.log(`  ${icon} ${modelLabel(result.model)} → ${score}/${task.maxScore}${partialMark} ${details.slice(0, 60)}`);
      }
    }

    // ── Leaderboard ────────────────────────────────────────────────────────

    this.printLeaderboard(allResults, tasks, totalMaxPerModel);
    return allResults;
  }

  private printLeaderboard(
    allResults: TaskResultRecord[],
    tasks: EvalTask[],
    totalMaxPerModel: number,
  ) {
    const modelScores = new Map<string, {
      total: number; max: number; cost: number; time: number;
      byTask: Map<string, { score: number; max: number }>;
    }>();

    for (const r of allResults) {
      const key = `${r.provider}:${r.model}${r.reasoningEffort ? `[${r.reasoningEffort}]` : ''}`;
      const s = modelScores.get(key) ?? { total: 0, max: 0, cost: 0, time: 0, byTask: new Map() };
      s.total += r.score;
      s.max += r.maxScore;
      s.cost += r.cost;
      s.time += r.durationMs;
      s.byTask.set(r.taskId, { score: r.score, max: r.maxScore });
      modelScores.set(key, s);
    }

    const ranked = [...modelScores.entries()]
      .map(([label, s]) => ({ label, ...s }))
      .sort((a, b) => b.total - a.total || a.cost - b.cost);

    const mw = Math.max(45, ...ranked.map(r => r.label.length + 2));

    console.log(`\n\n🏁 ${this.config.name.toUpperCase()} — FINAL RANKINGS`);
    console.log('═'.repeat(110));

    const taskHeaders = tasks.map(t => (t.name ?? t.id).slice(0, 8).padEnd(9)).join(' ');
    console.log(`${'Model'.padEnd(mw)} ${'Score'.padEnd(12)} ${taskHeaders} ${'Cost'.padEnd(10)} ${'Time'.padEnd(8)}`);
    console.log('─'.repeat(110));

    for (const r of ranked) {
      const pct = Math.round((r.total / r.max) * 100);
      const icon = pct >= 90 ? '🥇' : pct >= 75 ? '🥈' : pct >= 60 ? '🥉' : '💀';

      const taskScores = tasks.map(t => {
        const s = r.byTask.get(t.id);
        return s ? `${s.score}/${s.max}`.padEnd(9) : '—'.padEnd(9);
      }).join(' ');

      console.log(
        `${icon} ${r.label.padEnd(mw - 2)} ${`${r.total}/${r.max} (${pct}%)`.padEnd(12)} ${taskScores} ${`$${r.cost.toFixed(4)}`.padEnd(10)} ${`${(r.time / 1000).toFixed(1)}s`.padEnd(8)}`,
      );
    }

    const totalCost = allResults.reduce((s, r) => s + r.cost, 0);
    console.log(`\n💰 Total cost: $${totalCost.toFixed(4)}`);
    console.log('🎉 Done!');
  }

  /** Run a judge call with coercion fallback */
  private async runJudge(
    judgeModel: ModelDetails,
    instructions: string[],
    content: string,
    schema: z.ZodObject<any>,
    signal?: AbortSignal,
  ): Promise<any> {
    const fields = Object.entries(schema.shape)
      .map(([key, val]: [string, any]) => `  "${key}": ${val.description ? `(${val.description})` : 'value'}`)
      .join('\n');

    const stimulus = new Stimulus({
      role: 'evaluation judge',
      objective: 'assess AI model responses accurately and consistently',
      instructions: [
        ...instructions,
        'Reply with ONLY a valid JSON object:',
        `{\n${fields}\n}`,
      ],
      temperature: 0.0,
      maxTokens: 500,
    });

    const interaction = new Interaction(judgeModel, stimulus);
    interaction.addMessage({
      role: 'user',
      content: `Here is the model response to judge:\n\n---\n${content}\n---\n\nScore this response. Reply with ONLY a JSON object.`,
    });

    const resp = await interaction.generateText(signal);
    const raw = parseJudgeJSON(resp.content as string);

    const r1 = schema.safeParse(raw);
    if (r1.success) return r1.data;

    const r2 = schema.safeParse(coerceTypes(raw));
    if (r2.success) return r2.data;

    // Last resort — return raw with best-effort coercion
    return coerceTypes(raw);
  }
}
