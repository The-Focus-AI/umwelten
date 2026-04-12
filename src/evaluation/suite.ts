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
  verify: (response: string) => VerifyResult;
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
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_JUDGE: ModelDetails = { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' };

function modelLabel(m: ModelDetails): string {
  const effort = m.reasoningEffort ? `[${m.reasoningEffort}]` : '';
  return `${m.provider}:${m.name}${effort}`;
}

function modelKey(m: ModelDetails): string {
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

export class EvalSuite {
  private config: EvalSuiteConfig;

  constructor(config: EvalSuiteConfig) {
    this.config = config;
  }

  async run(): Promise<TaskResultRecord[]> {
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
      console.log(`\n📝 ${task.name ?? task.id}`);

      // Build stimulus
      const stimOpts = typeof this.config.stimulus === 'function'
        ? this.config.stimulus(task)
        : this.config.stimulus;
      const stimulus = new Stimulus({ ...stimOpts, runnerType: 'base' });

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
      }, (p) => {
        if (p.status === 'completed') console.log(`  ✅ ${p.modelName}`);
        else if (p.status === 'error') console.log(`  ❌ ${p.modelName}: ${p.error}`);
      });

      const evalResults = await evaluation.run();

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
            // Re-run if previous result was an error or judge failed
            if (!cached.error && (cached.score > 0 || !isJudgeTask(task))) {
              allResults.push(cached);
              const icon = cached.score >= cached.maxScore * 0.8 ? '✅' : cached.score > 0 ? '⚠️' : '❌';
              console.log(`  ${icon} ${modelLabel(result.model)} → ${cached.score}/${cached.maxScore} (cached)`);
              continue;
            }
            // Error or zero-score judge result — retry
          } catch { /* corrupt file — re-score */ }
        }

        const responseText = typeof result.response.content === 'string'
          ? result.response.content
          : JSON.stringify(result.response.content);

        let score = 0;
        let details = 'empty response';
        let judge: any = undefined;

        if (responseText && !result.metadata.error) {
          if (isJudgeTask(task)) {
            // LLM judge
            try {
              const judgeResult = await this.runJudge(
                judgeModel, task.judge.instructions, responseText, task.judge.schema,
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
            // Deterministic verify
            const v = task.verify(responseText);
            score = v.score;
            details = v.details;
          }
        }

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
        };
        allResults.push(record);
        fs.writeFileSync(resultPath, JSON.stringify(record, null, 2));

        const icon = score >= task.maxScore * 0.8 ? '✅' : score > 0 ? '⚠️' : '❌';
        console.log(`  ${icon} ${modelLabel(result.model)} → ${score}/${task.maxScore} ${details.slice(0, 60)}`);
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

    const resp = await interaction.generateText();
    const raw = parseJudgeJSON(resp.content as string);

    const r1 = schema.safeParse(raw);
    if (r1.success) return r1.data;

    const r2 = schema.safeParse(coerceTypes(raw));
    if (r2.success) return r2.data;

    // Last resort — return raw with best-effort coercion
    return coerceTypes(raw);
  }
}
