/**
 * EvalSuite — Declarative multi-model evaluation runner directly over
 * `@earendil-works/pi-ai` (`runPiTurn`).
 *
 * Calls `models.stream()` directly (never `streamSimple()`), leaving `maxTokens`
 * `undefined` unless a task explicitly sets one (`uncapped-benchmark-generation`).
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  runPiTurn,
  type ExecutableTool,
  type ModelSpec,
  type PiTurnResult,
} from "@umwelten/pi";
import { EvaluationCache } from "./caching/cache-service.js";

export interface VerifyResult {
  score: number;
  details: string;
}

export interface VerifyTask {
  id: string;
  name?: string;
  prompt: string;
  maxScore: number;
  verify: (response: string, turn?: PiTurnResult) => VerifyResult;
  section?: string;
}

export interface JudgeTask {
  id: string;
  name?: string;
  prompt: string;
  maxScore: number;
  judge: {
    schema: z.ZodObject<any>;
    instructions: string[];
    extractScore?: (judgeResult: any) => number;
  };
  section?: string;
}

export type EvalTask = VerifyTask | JudgeTask;

export function isJudgeTask(task: EvalTask): task is JudgeTask {
  return "judge" in task;
}

export interface TaskTurnOptions {
  systemPrompt?: string;
  role?: string;
  objective?: string;
  instructions?: string[];
  temperature?: number;
  /** Omit on benchmarks so generation stays uncapped (`uncapped-benchmark-generation`). */
  maxTokens?: number;
  tools?: Record<string, ExecutableTool>;
  maxToolSteps?: number;
}

export interface EvalSuiteConfig {
  name: string;
  /** Direct system prompt string or per-task builder. */
  systemPrompt?: string | ((task: EvalTask) => string);
  temperature?: number;
  maxTokens?: number;
  tools?: Record<string, ExecutableTool>;
  maxToolSteps?: number;
  /** Optional structured prompt options (`role`/`objective`/`instructions`/`tools`). */
  stimulus?: TaskTurnOptions | ((task: EvalTask) => TaskTurnOptions);
  tasks: EvalTask[];
  models?: ModelSpec[];
  allModels?: ModelSpec[];
  judgeModel?: ModelSpec;
  concurrency?: number;
  judgeDelayMs?: number;
  perTaskTimeoutMs?: number;
  /** `"task-first"` (default) or `"model-first"` (keeps local model weights hot in RAM). */
  executionOrder?: "task-first" | "model-first";
}

export interface EvalSuiteRunStats {
  judgeCostUsd: number;
  judgeTokens: number;
  cachedRecords: number;
  executedRecords: number;
}

export interface TaskResultRecord {
  taskId: string;
  model: string;
  provider: string;
  reasoningEffort?: string;
  effectiveThinkingLevel?: string;
  promptHash?: string;
  responseText: string;
  score: number;
  maxScore: number;
  details: string;
  durationMs: number;
  cost: number;
  judgeCostUsd?: number;
  judge?: any;
  error?: string;
  section?: string;
  partial?: boolean;
  reasoning?: string;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    total?: number;
  };
  prompt?: string;
}

const DEFAULT_JUDGE: ModelSpec = {
  name: "gemini-4-hydrogen",
  provider: "google",
};

function normalizeEffort(
  effort?: ModelSpec["reasoningEffort"],
): string | undefined {
  if (!effort) return undefined;
  return effort === "none" ? "off" : effort;
}

function modelLabel(m: ModelSpec): string {
  const norm = normalizeEffort(m.reasoningEffort);
  const effort = norm ? `[${norm}]` : "";
  return `${m.provider}:${m.name}${effort}`;
}

export function modelKey(m: ModelSpec): string {
  const norm = normalizeEffort(m.reasoningEffort);
  const effort = norm ? `-effort-${norm}` : "";
  return `${m.name.replace(/[/:]/g, "-")}-${m.provider}${effort}`;
}

function formatSystemPrompt(opts: TaskTurnOptions): string | undefined {
  if (opts.systemPrompt) return opts.systemPrompt;
  const lines: string[] = [];
  if (opts.role) lines.push(`You are a ${opts.role}.`);
  if (opts.objective) lines.push(`Objective: ${opts.objective}.`);
  if (opts.instructions?.length) {
    lines.push("Instructions:\n" + opts.instructions.map((i) => `- ${i}`).join("\n"));
  }
  return lines.length > 0 ? lines.join("\n\n") : undefined;
}

function resolveTurnOptions(
  config: EvalSuiteConfig,
  task: EvalTask,
): TaskTurnOptions {
  const fromStimulus =
    typeof config.stimulus === "function"
      ? config.stimulus(task)
      : (config.stimulus ?? {});
  const explicitSys =
    typeof config.systemPrompt === "function"
      ? config.systemPrompt(task)
      : config.systemPrompt;
  return {
    ...fromStimulus,
    systemPrompt: explicitSys ?? formatSystemPrompt(fromStimulus),
    temperature: config.temperature ?? fromStimulus.temperature,
    maxTokens: config.maxTokens ?? fromStimulus.maxTokens,
    tools: config.tools ?? fromStimulus.tools,
    maxToolSteps: config.maxToolSteps ?? fromStimulus.maxToolSteps,
  };
}

function resolveRun(evalName: string): {
  runId: string;
  runDir: string;
  isResume: boolean;
} {
  const evalRoot =
    process.env.UMWELTEN_EVAL_DIR || path.join(process.cwd(), "output", "evaluations");
  const baseDir = path.join(evalRoot, evalName, "runs");
  fs.mkdirSync(baseDir, { recursive: true });

  const existing = fs
    .readdirSync(baseDir)
    .filter((d) => /^\d+$/.test(d))
    .map((d) => parseInt(d, 10))
    .sort((a, b) => a - b);

  const runIdx = process.argv.indexOf("--run");
  const requested =
    runIdx !== -1 && runIdx + 1 < process.argv.length
      ? parseInt(process.argv[runIdx + 1], 10)
      : null;
  const forceNew = process.argv.includes("--new");
  const latest = existing.length > 0 ? existing[existing.length - 1] : 1;
  const runNumber = forceNew ? latest + 1 : (requested || latest);
  const runId = String(runNumber).padStart(3, "0");
  const runDir = path.join(baseDir, runId);

  return { runId, runDir, isResume: existing.includes(runNumber) };
}

function parseJudgeJSON(response: string): any {
  let s = response.trim();
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/) || s.match(/(\{[\s\S]*\})/);
  if (m) s = m[1].trim();
  return JSON.parse(s);
}

function coerceTypes(obj: any): any {
  if (typeof obj !== "object" || obj === null) return obj;
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      if (value === "true") {
        result[key] = true;
        continue;
      }
      if (value === "false") {
        result[key] = false;
        continue;
      }
      const num = Number(value);
      if (
        !Number.isNaN(num) &&
        value.trim() !== "" &&
        (key.includes("score") || key.includes("quality") || key.includes("answer"))
      ) {
        result[key] = num;
        continue;
      }
    }
    result[key] = value;
  }
  return result;
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface EvalSuiteRunOptions {
  signal?: AbortSignal;
}

type ModelOutcome =
  | { status: "cached"; model: ModelSpec; cachedRecord: TaskResultRecord }
  | { status: "error"; model: ModelSpec; error: string; durationMs: number }
  | { status: "ok"; model: ModelSpec; turn: PiTurnResult };

export class EvalSuite {
  private readonly config: EvalSuiteConfig;
  private lastRunStats: EvalSuiteRunStats = {
    judgeCostUsd: 0,
    judgeTokens: 0,
    cachedRecords: 0,
    executedRecords: 0,
  };

  constructor(config: EvalSuiteConfig) {
    this.config = config;
  }

  getLastRunStats(): EvalSuiteRunStats {
    return { ...this.lastRunStats };
  }

  private computeTaskHashes(
    task: EvalTask,
    turnOpts: TaskTurnOptions,
    judgeModel: ModelSpec,
  ): { generationHash: string; evalHash: string } {
    const generationHash = EvaluationCache.hashKey({
      prompt: task.prompt,
      systemPrompt: turnOpts.systemPrompt,
      temperature: turnOpts.temperature,
      maxTokens: turnOpts.maxTokens,
      tools: turnOpts.tools ? Object.keys(turnOpts.tools) : [],
    });
    const evalHash = EvaluationCache.hashKey({
      generationHash,
      judgeModel: isJudgeTask(task) ? modelLabel(judgeModel) : undefined,
      judgeInstructions: isJudgeTask(task) ? task.judge.instructions : undefined,
    });
    return { generationHash, evalHash };
  }

  private async fetchModelOutcome(params: {
    task: EvalTask;
    turnOpts: TaskTurnOptions;
    model: ModelSpec;
    resultsDir: string;
    cache: EvaluationCache;
    generationHash: string;
    evalHash: string;
    forceNew: boolean;
    perTaskTimeoutMs: number;
    signal?: AbortSignal;
  }): Promise<ModelOutcome> {
    const {
      task,
      turnOpts,
      model,
      resultsDir,
      cache,
      generationHash,
      evalHash,
      forceNew,
      perTaskTimeoutMs,
      signal,
    } = params;

    const mk = modelKey(model);
    const resultPath = path.join(resultsDir, `${mk}.json`);

    if (fs.existsSync(resultPath) && !forceNew) {
      try {
        const cached = JSON.parse(
          fs.readFileSync(resultPath, "utf8"),
        ) as TaskResultRecord;
        if (
          !cached.error &&
          !cached.partial &&
          (cached.score > 0 || !isJudgeTask(task)) &&
          (!cached.promptHash || cached.promptHash === evalHash)
        ) {
          return { status: "cached", model, cachedRecord: cached };
        }
      } catch {
        // Re-run corrupt cache
      }
    }

    const taskAbort = new AbortController();
    const onOuterAbort = () => taskAbort.abort(signal?.reason);
    signal?.addEventListener("abort", onOuterAbort, { once: true });
    const timer = setTimeout(
      () => taskAbort.abort(new Error(`per-task timeout (${perTaskTimeoutMs / 1000}s)`)),
      perTaskTimeoutMs,
    );
    const attemptStarted = Date.now();

    try {
      const { turn } = await cache.getCachedTurn(model, generationHash, () =>
        runPiTurn({
          model,
          systemPrompt: turnOpts.systemPrompt,
          prompt: task.prompt,
          temperature: turnOpts.temperature,
          maxTokens: turnOpts.maxTokens,
          tools: turnOpts.tools,
          maxToolSteps: turnOpts.maxToolSteps,
          signal: taskAbort.signal,
        }),
      );
      console.log(`  ✅ ${modelLabel(model)}`);
      return { status: "ok", model, turn };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ❌ ${modelLabel(model)}: ${msg}`);
      return {
        status: "error",
        model,
        error: msg,
        durationMs: Math.max(1, Date.now() - attemptStarted),
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onOuterAbort);
    }
  }

  private async scoreAndPersistOutcome(params: {
    task: EvalTask;
    outcome: ModelOutcome;
    resultsDir: string;
    evalHash: string;
    judgeModel: ModelSpec;
    judgeDelayMs: number;
    signal?: AbortSignal;
    stats: EvalSuiteRunStats;
  }): Promise<TaskResultRecord> {
    const {
      task,
      outcome,
      resultsDir,
      evalHash,
      judgeModel,
      judgeDelayMs,
      signal,
      stats,
    } = params;

    if (outcome.status === "cached") {
      stats.cachedRecords += 1;
      const c = outcome.cachedRecord;
      const icon = c.score >= c.maxScore * 0.8 ? "✅" : c.score > 0 ? "⚠️" : "❌";
      console.log(`  ${icon} ${modelLabel(outcome.model)} → ${c.score}/${c.maxScore} (cached)`);
      return c;
    }

    stats.executedRecords += 1;
    const mk = modelKey(outcome.model);
    const resultPath = path.join(resultsDir, `${mk}.json`);
    const normEffort = normalizeEffort(outcome.model.reasoningEffort);

    if (outcome.status === "error") {
      const rec: TaskResultRecord = {
        taskId: task.id,
        model: outcome.model.name,
        provider: outcome.model.provider,
        ...(normEffort ? { reasoningEffort: normEffort } : {}),
        promptHash: evalHash,
        responseText: "",
        score: 0,
        maxScore: task.maxScore,
        details: outcome.error,
        durationMs: outcome.durationMs,
        cost: 0,
        error: outcome.error,
        ...(task.section ? { section: task.section } : {}),
      };
      fs.writeFileSync(resultPath, JSON.stringify(rec, null, 2));
      return rec;
    }

    const turn = outcome.turn;
    const responseText = turn.content;
    let score = 0;
    let details = "empty response";
    let judge: any = undefined;
    let judgeCostUsd: number | undefined = undefined;

    if (responseText) {
      if (isJudgeTask(task)) {
        try {
          const judged = await this.runJudge(
            judgeModel,
            task.judge.instructions,
            responseText,
            task.judge.schema,
            signal,
          );
          judge = judged.data;
          judgeCostUsd = judged.costUsd;
          stats.judgeCostUsd += judged.costUsd;
          stats.judgeTokens += judged.totalTokens;
          const extract =
            task.judge.extractScore ??
            ((r: any) => r.reasoning_quality ?? r.score ?? 0);
          score = extract(judge);
          details = judge.explanation ?? JSON.stringify(judge).slice(0, 100);
        } catch (err) {
          details = `judge error: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (judgeDelayMs > 0) {
          await new Promise((r) => setTimeout(r, judgeDelayMs));
        }
      } else {
        const v = task.verify(responseText, turn);
        score = v.score;
        details = v.details;
      }
    }

    const turnUsage = turn.usage as {
      promptTokens?: number;
      completionTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      reasoningTokens?: number;
      total?: number;
    };

    const record: TaskResultRecord = {
      taskId: task.id,
      model: outcome.model.name,
      provider: outcome.model.provider,
      ...(normEffort ? { reasoningEffort: normEffort } : {}),
      ...(turn.effectiveThinkingLevel
        ? { effectiveThinkingLevel: turn.effectiveThinkingLevel }
        : {}),
      promptHash: evalHash,
      responseText: responseText.slice(0, 2000),
      score,
      maxScore: task.maxScore,
      details,
      durationMs: turn.durationMs,
      cost: turn.costUsd,
      ...(judgeCostUsd !== undefined ? { judgeCostUsd } : {}),
      judge,
      ...(task.section ? { section: task.section } : {}),
      ...(turn.reasoning && turn.reasoning.length < 4000
        ? { reasoning: turn.reasoning }
        : {}),
      tokenUsage: {
        promptTokens: turnUsage.promptTokens ?? 0,
        completionTokens: turnUsage.completionTokens ?? 0,
        cacheReadTokens: turnUsage.cacheReadTokens ?? 0,
        cacheWriteTokens: turnUsage.cacheWriteTokens ?? 0,
        reasoningTokens: turnUsage.reasoningTokens ?? 0,
        total: turnUsage.total ?? 0,
      },
      prompt: task.prompt,
    };
    fs.writeFileSync(resultPath, JSON.stringify(record, null, 2));

    if (turn.messages.length > 0) {
      fs.writeFileSync(
        path.join(resultsDir, `${mk}.transcript.json`),
        JSON.stringify(
          {
            taskId: task.id,
            model: outcome.model.name,
            provider: outcome.model.provider,
            ...(normEffort ? { reasoningEffort: normEffort } : {}),
            prompt: task.prompt,
            messages: turn.messages,
          },
          null,
          2,
        ),
      );
    }

    const icon = score >= task.maxScore * 0.8 ? "✅" : score > 0 ? "⚠️" : "❌";
    console.log(
      `  ${icon} ${modelLabel(outcome.model)} → ${score}/${task.maxScore} ${details.slice(0, 60)}`,
    );
    return record;
  }

  async run(opts: EvalSuiteRunOptions = {}): Promise<TaskResultRecord[]> {
    const { signal } = opts;
    const isAll = process.argv.includes("--all");
    const models = isAll
      ? (this.config.allModels ?? this.config.models ?? [])
      : (this.config.models ?? []);

    if (models.length === 0) {
      throw new Error("No models configured. Pass models in config or use --all.");
    }

    const { runId, runDir, isResume } = resolveRun(this.config.name);
    const judgeModel = this.config.judgeModel ?? DEFAULT_JUDGE;
    const concurrency = this.config.concurrency ?? 5;
    const judgeDelayMs = this.config.judgeDelayMs ?? 250;
    const perTaskTimeoutMs = this.config.perTaskTimeoutMs ?? 300_000;
    const executionOrder = this.config.executionOrder ?? "task-first";
    const tasks = this.config.tasks;
    const totalMaxPerModel = tasks.reduce((s, t) => s + t.maxScore, 0);

    const stats: EvalSuiteRunStats = {
      judgeCostUsd: 0,
      judgeTokens: 0,
      cachedRecords: 0,
      executedRecords: 0,
    };
    this.lastRunStats = stats;

    console.log(`\n🧪 ${this.config.name}`);
    console.log("═".repeat(70));
    console.log(`Tasks:   ${tasks.length} (${tasks.map((t) => t.name ?? t.id).join(", ")})`);
    console.log(`Models:  ${models.length}`);
    console.log(`Max:     ${totalMaxPerModel} per model`);
    console.log(`Run:     #${runId}${isResume ? " (resuming)" : ""}`);
    console.log("═".repeat(70));

    const allResults: TaskResultRecord[] = [];
    const forceNew = process.argv.includes("--new");

    if (executionOrder === "model-first") {
      const prepared = tasks.map((task) => {
        const turnOpts = resolveTurnOptions(this.config, task);
        const resultsDir = path.join(runDir, task.id);
        fs.mkdirSync(resultsDir, { recursive: true });
        const cache = new EvaluationCache(
          `${this.config.name}/runs/${runId}/${task.id}`,
          { enabled: !forceNew },
        );
        const { generationHash, evalHash } = this.computeTaskHashes(
          task,
          turnOpts,
          judgeModel,
        );
        return { task, turnOpts, resultsDir, cache, generationHash, evalHash };
      });

      const perModelResults = await mapConcurrent(models, concurrency, async (model) => {
        const modelRecords: TaskResultRecord[] = [];
        for (const item of prepared) {
          if (signal?.aborted) {
            throw new Error(
              signal.reason instanceof Error ? signal.reason.message : "EvalSuite aborted",
            );
          }
          const outcome = await this.fetchModelOutcome({
            task: item.task,
            turnOpts: item.turnOpts,
            model,
            resultsDir: item.resultsDir,
            cache: item.cache,
            generationHash: item.generationHash,
            evalHash: item.evalHash,
            forceNew,
            perTaskTimeoutMs,
            signal,
          });
          const rec = await this.scoreAndPersistOutcome({
            task: item.task,
            outcome,
            resultsDir: item.resultsDir,
            evalHash: item.evalHash,
            judgeModel,
            judgeDelayMs,
            signal,
            stats,
          });
          modelRecords.push(rec);
        }
        return modelRecords;
      });
      for (const list of perModelResults) {
        allResults.push(...list);
      }
    } else {
      for (const task of tasks) {
        if (signal?.aborted) {
          throw new Error(
            signal.reason instanceof Error ? signal.reason.message : "EvalSuite aborted",
          );
        }
        console.log(`\n📝 ${task.name ?? task.id}`);

        const turnOpts = resolveTurnOptions(this.config, task);
        const resultsDir = path.join(runDir, task.id);
        fs.mkdirSync(resultsDir, { recursive: true });

        const cache = new EvaluationCache(
          `${this.config.name}/runs/${runId}/${task.id}`,
          { enabled: !forceNew },
        );
        const { generationHash, evalHash } = this.computeTaskHashes(
          task,
          turnOpts,
          judgeModel,
        );

        const modelOutcomes = await mapConcurrent(models, concurrency, (model) =>
          this.fetchModelOutcome({
            task,
            turnOpts,
            model,
            resultsDir,
            cache,
            generationHash,
            evalHash,
            forceNew,
            perTaskTimeoutMs,
            signal,
          }),
        );

        if (isJudgeTask(task)) {
          console.log(`  ⚖️  Judging with ${modelLabel(judgeModel)}...`);
        }

        for (const outcome of modelOutcomes) {
          const rec = await this.scoreAndPersistOutcome({
            task,
            outcome,
            resultsDir,
            evalHash,
            judgeModel,
            judgeDelayMs,
            signal,
            stats,
          });
          allResults.push(rec);
        }
      }
    }

    this.printLeaderboard(allResults, tasks);
    return allResults;
  }

  private printLeaderboard(allResults: TaskResultRecord[], tasks: EvalTask[]) {
    const modelScores = new Map<
      string,
      {
        total: number;
        max: number;
        cost: number;
        time: number;
        byTask: Map<string, { score: number; max: number }>;
      }
    >();

    for (const r of allResults) {
      const key = `${r.provider}:${r.model}${r.reasoningEffort ? `[${r.reasoningEffort}]` : ""}`;
      const s = modelScores.get(key) ?? {
        total: 0,
        max: 0,
        cost: 0,
        time: 0,
        byTask: new Map(),
      };
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

    const mw = Math.max(45, ...ranked.map((r) => r.label.length + 2));

    console.log(`\n\n🏁 ${this.config.name.toUpperCase()} — FINAL RANKINGS`);
    console.log("═".repeat(110));
    const taskHeaders = tasks
      .map((t) => (t.name ?? t.id).slice(0, 8).padEnd(9))
      .join(" ");
    console.log(
      `${"Model".padEnd(mw)} ${"Score".padEnd(12)} ${taskHeaders} ${"Cost".padEnd(10)} ${"Time".padEnd(8)}`,
    );
    console.log("─".repeat(110));

    for (const r of ranked) {
      const pct = r.max > 0 ? Math.round((r.total / r.max) * 100) : 0;
      const icon = pct >= 90 ? "🥇" : pct >= 75 ? "🥈" : pct >= 60 ? "🥉" : "💀";
      const taskScores = tasks
        .map((t) => {
          const s = r.byTask.get(t.id);
          return s ? `${s.score}/${s.max}`.padEnd(9) : "—".padEnd(9);
        })
        .join(" ");
      console.log(
        `${icon} ${r.label.padEnd(mw - 2)} ${`${r.total}/${r.max} (${pct}%)`.padEnd(12)} ${taskScores} ${`$${r.cost.toFixed(4)}`.padEnd(10)} ${`${(r.time / 1000).toFixed(1)}s`.padEnd(8)}`,
      );
    }

    const totalCost = allResults.reduce((s, r) => s + r.cost, 0);
    const judgeNote =
      this.lastRunStats.judgeCostUsd > 0
        ? ` (judge: $${this.lastRunStats.judgeCostUsd.toFixed(4)})`
        : "";
    console.log(`\n💰 Total cost: $${totalCost.toFixed(4)}${judgeNote}`);
  }

  private async runJudge(
    judgeModel: ModelSpec,
    instructions: string[],
    content: string,
    schema: z.ZodObject<any>,
    signal?: AbortSignal,
  ): Promise<{ data: any; costUsd: number; totalTokens: number }> {
    const fields = Object.entries(schema.shape)
      .map(
        ([key, val]: [string, any]) =>
          `  "${key}": ${val.description ? `(${val.description})` : "value"}`,
      )
      .join("\n");

    const systemPrompt = [
      "You are an impartial evaluation judge.",
      ...instructions,
      "Reply with ONLY a valid JSON object:",
      `{\n${fields}\n}`,
    ].join("\n");

    const turn = await runPiTurn({
      model: judgeModel,
      systemPrompt,
      prompt: `Here is the model response to judge:\n\n---\n${content}\n---\n\nScore this response. Reply with ONLY a JSON object.`,
      temperature: 0.0,
      signal,
    });

    const raw = parseJudgeJSON(turn.content);
    const r1 = schema.safeParse(raw);
    const data = r1.success
      ? r1.data
      : (() => {
          const r2 = schema.safeParse(coerceTypes(raw));
          return r2.success ? r2.data : coerceTypes(raw);
        })();
    return {
      data,
      costUsd: turn.costUsd,
      totalTokens: turn.usage.total,
    };
  }
}
