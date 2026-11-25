/**
 * Pi-Durable isolated coding-session benchmark runner.
 *
 * For every `(model, effort, task, extensionProfile)` tuple:
 *   1. Checks deterministic file cache (`<outputDir>/<taskId>/<cacheKey>.json`).
 *   2. Materializes a fresh isolated git checkout (`prepareIsolatedGitCheckout`).
 *   3. Runs a full multi-turn `Harness` coding session with default `CodingTools`
 *      (`read`, `write`, `edit`, `bash`), repo-scope enforcement, thinking-effort
 *      payload hooks, and optional/custom extensions.
 *   4. Closes the harness, restores any tampered protected paths, overlays
 *      held-out tests, grades deterministically (`0`–`10`), and saves full
 *      transcript + git diff artifacts.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  clampThinkingLevel,
  type Api as PiApi,
  type Model as PiModel,
  type ModelThinkingLevel,
  type Models,
} from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  createRegistry,
  Harness,
  MemoryStorage,
  ToolResultEntry,
  type Cursor,
  type EntryRecord,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
  canonicalizeThinkingEffort,
  extractStepCostUsd,
  formatModelSpecString,
  resolvePiModel,
  resolveThinkingStreamOptions,
  type ModelSpec,
} from "@umwelten/pi";
import { resolveCodingExtensionStack } from "./extensions.js";
import type {
  CodingDifficulty,
  CodingSessionRecord,
  CodingSessionTokens,
  CodingTaskSpec,
  RunCodingBenchmarkOptions,
  RunCodingTaskOptions,
} from "./types.js";
import {
  computeTaskHash,
  gradeIsolatedCheckout,
  prepareIsolatedGitCheckout,
} from "./workspace.js";

const DEFAULT_OUTPUT_DIR = path.join("output", "evaluations", "coding-bench", "runs", "001");

const LOCAL_PROVIDER_NAMES = new Set([
  "ollama",
  "mlx",
  "mlx-nothink",
  "llamacpp",
  "llama-swap",
]);

export function isLocalSpec(spec: ModelSpec, piModel: PiModel<PiApi>): boolean {
  if (LOCAL_PROVIDER_NAMES.has(spec.provider)) return true;
  const url = spec.baseUrl ?? piModel.baseUrl ?? "";
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(
    url,
  );
}

export function defaultMaxTurns(difficulty: CodingDifficulty): number {
  if (difficulty === "easy") return 15;
  if (difficulty === "medium") return 20;
  return 25;
}

export function defaultTimeoutMs(difficulty: CodingDifficulty): number {
  return difficulty === "hard" ? 300_000 : 180_000;
}

export function sanitizeCacheSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function buildCodingCacheKey(
  spec: ModelSpec,
  profileId: string,
): string {
  const effort = canonicalizeThinkingEffort(spec.reasoningEffort) ?? "default";
  return sanitizeCacheSegment(
    `${spec.name}-${spec.provider}-effort-${effort}-ext-${profileId}`,
  );
}

/**
 * Ensure `models.getModel(piModel.provider, piModel.id)` resolves inside
 * `pi-durable`'s `GenerationTask`, even when `resolvePiModel` synthesized a
 * `:variant` model or callers supplied an in-memory target.
 */
export function ensureModelRegistered(
  models: Models,
  piModel: PiModel<PiApi>,
): Models {
  if (models.getModel(piModel.provider, piModel.id)) {
    return models;
  }
  return new Proxy(models, {
    get(target, prop, _receiver) {
      if (prop === "getModel") {
        return (provider: string, modelId: string) =>
          target.getModel(provider, modelId) ??
          (provider === piModel.provider && modelId === piModel.id
            ? piModel
            : undefined);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function buildAgentInstructions(
  task: CodingTaskSpec,
  extensionAddendum: string,
): string {
  return [
    "You are debugging and fixing a software repository inside an isolated git checkout.",
    "Work autonomously using your tools: read files, trace root causes, apply clean minimal fixes with edit/write, and verify with bash.",
    `You can run the visible test suite at any time via \`${task.visibleTestCommand}\`.`,
    "Do NOT delete, weaken, or modify existing tests unless the task explicitly asks you to fix a test bug; protected test files are restored before grading.",
    "Fix every root cause cleanly and run tests after your final edit before summarizing your solution.",
    extensionAddendum,
  ]
    .filter(Boolean)
    .join(" ");
}

export function aggregateSessionMetrics(
  entries: readonly EntryRecord[],
  piModel: PiModel<PiApi>,
): {
  turns: number;
  toolCallsTotal: number;
  toolCallsByName: Record<string, number>;
  toolErrors: number;
  costUsd: number;
  tokenUsage: CodingSessionTokens;
  finalAssistantText: string;
} {
  let turns = 0;
  let toolCallsTotal = 0;
  const toolCallsByName: Record<string, number> = {};
  let toolErrors = 0;
  let costUsd = 0;
  const tokenUsage: CodingSessionTokens = {
    prompt: 0,
    completion: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    total: 0,
  };
  let finalAssistantText = "";

  for (const entry of entries) {
    if (AssistantEntry.is(entry) && entry.model?.[0]?.role === "assistant") {
      turns++;
      const asst = entry.model[0];
      if (asst.usage) {
        tokenUsage.prompt += asst.usage.input ?? 0;
        tokenUsage.completion += asst.usage.output ?? 0;
        tokenUsage.cacheRead += asst.usage.cacheRead ?? 0;
        tokenUsage.cacheWrite += asst.usage.cacheWrite ?? 0;
        tokenUsage.reasoning += asst.usage.reasoning ?? 0;
        tokenUsage.total += asst.usage.totalTokens ?? 0;
        costUsd += extractStepCostUsd(piModel, asst.usage);
      }

      const textParts: string[] = [];
      for (const block of asst.content) {
        if (block.type === "toolCall") {
          toolCallsTotal++;
          toolCallsByName[block.name] = (toolCallsByName[block.name] ?? 0) + 1;
        } else if (block.type === "text" && block.text.trim()) {
          textParts.push(block.text);
        }
      }
      if (textParts.length > 0) {
        finalAssistantText = textParts.join("\n").trim();
      }
    } else if (
      ToolResultEntry.is(entry) &&
      entry.model?.[0]?.role === "toolResult" &&
      entry.model[0].isError
    ) {
      toolErrors++;
    }
  }

  return {
    turns,
    toolCallsTotal,
    toolCallsByName,
    toolErrors,
    costUsd: Number(costUsd.toFixed(6)),
    tokenUsage,
    finalAssistantText,
  };
}

/**
 * Execute (or load from cache) a single isolated coding-session benchmark task
 * for one model × effort × extension profile.
 */
export async function runCodingTaskSession(
  options: RunCodingTaskOptions,
): Promise<CodingSessionRecord> {
  const { task, spec } = options;
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const taskOutputDir = path.join(outputDir, task.id);
  const maxTurns = options.maxTurns ?? task.maxTurns ?? defaultMaxTurns(task.difficulty);
  const timeoutMs =
    options.timeoutMs ?? task.timeoutMs ?? defaultTimeoutMs(task.difficulty);

  const taskHash = await computeTaskHash(task);
  const target = options.overrideTarget ?? (await resolvePiModel(spec));
  const localTarget = isLocalSpec(spec, target.piModel);
  const canonicalEffort = canonicalizeThinkingEffort(spec.reasoningEffort);
  const thinking = resolveThinkingStreamOptions(
    target.piModel,
    spec.provider,
    spec.reasoningEffort,
  );

  // Build tentative profileId for cache check cleanly using a temporary dry run or checkout
  // Wait — custom extensions only load once we have workspaceDir, EXCEPT we can compute expected
  // profileId deterministically for cache lookup before spawning git checkout when no extra/custom
  // paths alter it, OR inspect profileId cleanly. Computing tentative profileId handles 99% cache hits
  // without creating/deleting temp git repos!
  const tentativeParts = ["pi-default"];
  const requestedSet = new Set(
    (options.extensionNames ?? []).map((n) => n.trim()).filter(Boolean),
  );
  for (const optName of ["search-tools", "tool-search", "codemode", "verify-on-yield"]) {
    if (requestedSet.has(optName)) tentativeParts.push(optName);
  }
  for (const cp of options.customExtensionPaths ?? []) {
    const t = cp.trim();
    if (t) {
      tentativeParts.push(
        path.basename(t).replace(/\.(ts|mts|cts|js|mjs|cjs)$/i, ""),
      );
    }
  }
  for (const extra of options.extraExtensions ?? []) {
    if (extra.name) tentativeParts.push(extra.name);
  }
  const expectedProfileId = tentativeParts.join("+");
  const expectedCacheKey = buildCodingCacheKey(spec, expectedProfileId);
  const cacheJsonPath = path.join(taskOutputDir, `${expectedCacheKey}.json`);

  if (!options.fresh) {
    try {
      const cached = JSON.parse(
        await fs.readFile(cacheJsonPath, "utf8"),
      ) as CodingSessionRecord;
      if (
        cached.taskHash === taskHash &&
        cached.extensionProfile === expectedProfileId &&
        !cached.error
      ) {
        return { ...cached, cached: true };
      }
    } catch {
      // Cache miss
    }
  }

  const checkout = await prepareIsolatedGitCheckout(task.repoDir);
  const startedAt = Date.now();
  let extensionCleanup: (() => Promise<void>) | undefined;
  let harness: Harness | undefined;
  let timedOut = false;
  let stopReason: CodingSessionRecord["stopReason"] = "completed";
  let fatalError: string | undefined;
  let entries: EntryRecord[] = [];
  let resolvedProfileId = expectedProfileId;

  try {
    const stack = await resolveCodingExtensionStack({
      names: options.extensionNames,
      customPaths: options.customExtensionPaths,
      extraExtensions: options.extraExtensions,
      workspaceDir: checkout.dir,
      task,
      spec,
      target,
    });
    extensionCleanup = stack.cleanup;
    resolvedProfileId = stack.profileId;

    const registry = createRegistry();
    for (const ext of stack.extensions) {
      registry.install(ext);
    }

    const models = ensureModelRegistered(target.models, target.piModel);
    const executionEnv = new NodeExecutionEnv({ cwd: checkout.dir });

    harness = await Harness.open(
      new MemoryStorage(),
      {
        models,
        registry,
        env: () => executionEnv,
        settings: {
          retry: { maxRetries: 2 },
        },
      },
      BACKGROUND_CONTEXT,
    );

    let agentThinkingLevel: ModelThinkingLevel | undefined;
    if (canonicalEffort !== undefined) {
      agentThinkingLevel = localTarget
        ? canonicalEffort
        : clampThinkingLevel(target.piModel, canonicalEffort);
    }

    const conv = await harness.root(BACKGROUND_CONTEXT, {
      agent: {
        model: {
          provider: target.piModel.provider,
          modelId: target.piModel.id,
        },
        ...(agentThinkingLevel !== undefined
          ? { thinkingLevel: agentThinkingLevel }
          : {}),
        maxTurns,
        instructions: buildAgentInstructions(task, stack.systemPromptAddendum),
      },
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      void conv.abort(BACKGROUND_CONTEXT);
    }, timeoutMs);

    try {
      const sub = await conv.submit(
        {
          type: "input",
          content: task.prompt,
          whenBusy: "followUp",
        },
        BACKGROUND_CONTEXT,
      );
      const settled = await sub.wait(BACKGROUND_CONTEXT);
      await conv.waitForIdle(BACKGROUND_CONTEXT);

      if (timedOut) {
        stopReason = "timeout";
        fatalError = `Timed out after ${Math.round(timeoutMs / 1000)}s`;
      } else if (settled.status === "unanswered") {
        if (settled.reason === "turn_limit") {
          stopReason = "turn_limit";
        } else if (settled.reason === "aborted") {
          stopReason = "error";
          fatalError = "Conversation aborted unexpectedly";
        } else {
          stopReason = "error";
          fatalError = `${settled.reason}${settled.detail !== undefined ? `: ${JSON.stringify(settled.detail)}` : ""}`;
        }
      }
    } finally {
      clearTimeout(timeoutHandle);
    }

    let cursor: Cursor | undefined;
    for (let pageIdx = 0; pageIdx < 20; pageIdx++) {
      const page = await conv.entries(
        { order: "ascending" },
        500,
        cursor,
        BACKGROUND_CONTEXT,
      );
      entries.push(...page.items);
      if (!page.next || page.items.length === 0) break;
      cursor = page.next;
    }

    await harness.close(BACKGROUND_CONTEXT);
    harness = undefined;

    const durationMs = Date.now() - startedAt;
    const metrics = aggregateSessionMetrics(entries, target.piModel);
    const grade = await gradeIsolatedCheckout(checkout.dir, task);

    const cacheKey = buildCodingCacheKey(spec, resolvedProfileId);
    const jsonOutPath = path.join(taskOutputDir, `${cacheKey}.json`);
    const transcriptPath = path.join(taskOutputDir, `${cacheKey}.transcript.json`);
    await fs.mkdir(taskOutputDir, { recursive: true });

    const tokPerSec =
      durationMs > 0 && metrics.tokenUsage.completion > 0
        ? Number((metrics.tokenUsage.completion / (durationMs / 1000)).toFixed(1))
        : null;

    const record: CodingSessionRecord = {
      taskId: task.id,
      title: task.title,
      difficulty: task.difficulty,
      language: task.language,
      model: spec.name,
      provider: spec.provider,
      ...(canonicalEffort ? { reasoningEffort: canonicalEffort } : {}),
      effectiveThinkingLevel: thinking.effectiveEffort,
      extensionProfile: resolvedProfileId,
      taskHash,
      cacheKey,
      generatedAt: new Date().toISOString(),
      passed: fatalError ? false : grade.passed,
      score: fatalError ? 0 : grade.score,
      maxScore: grade.maxScore,
      details: fatalError ? `${fatalError} | ${grade.details}` : grade.details,
      visibleTests: {
        passed: grade.visibleTests.passed,
        failed: grade.visibleTests.failed,
        total: grade.visibleTests.total,
      },
      hiddenTests: {
        passed: grade.hiddenTests.passed,
        failed: grade.hiddenTests.failed,
        total: grade.hiddenTests.total,
      },
      cheatedProtectedFiles: grade.cheatedProtectedFiles,
      stopReason,
      durationMs,
      turns: metrics.turns,
      toolCallsTotal: metrics.toolCallsTotal,
      toolCallsByName: metrics.toolCallsByName,
      toolErrors: metrics.toolErrors,
      costUsd: metrics.costUsd,
      tokenUsage: metrics.tokenUsage,
      tokPerSec,
      changedFiles: grade.changedFiles,
      gitDiffStat: grade.gitDiffStat,
      gitDiff: grade.gitDiff,
      gradingOutput: grade.gradingOutput,
      finalAssistantText: metrics.finalAssistantText,
      transcriptPath: path.relative(process.cwd(), transcriptPath),
      ...(fatalError ? { error: fatalError } : {}),
      cached: false,
    };

    await fs.writeFile(jsonOutPath, JSON.stringify(record, null, 2));
    await fs.writeFile(
      transcriptPath,
      JSON.stringify(
        {
          taskId: task.id,
          modelSpec: formatModelSpecString(spec),
          extensionProfile: resolvedProfileId,
          baselineCommit: checkout.baselineCommit,
          stopReason,
          error: fatalError,
          entries,
          gitDiff: grade.gitDiff,
          gradingOutput: grade.gradingOutput,
        },
        null,
        2,
      ),
    );

    return record;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      taskId: task.id,
      title: task.title,
      difficulty: task.difficulty,
      language: task.language,
      model: spec.name,
      provider: spec.provider,
      ...(canonicalEffort ? { reasoningEffort: canonicalEffort } : {}),
      effectiveThinkingLevel: thinking.effectiveEffort,
      extensionProfile: resolvedProfileId,
      taskHash,
      cacheKey: buildCodingCacheKey(spec, resolvedProfileId),
      generatedAt: new Date().toISOString(),
      passed: false,
      score: 0,
      maxScore: 10,
      details: `Session error: ${msg}`,
      visibleTests: { passed: 0, failed: 1, total: 1 },
      hiddenTests: { passed: 0, failed: 1, total: 1 },
      cheatedProtectedFiles: false,
      stopReason: "error",
      durationMs,
      turns: 0,
      toolCallsTotal: 0,
      toolCallsByName: {},
      toolErrors: 0,
      costUsd: 0,
      tokenUsage: {
        prompt: 0,
        completion: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        total: 0,
      },
      tokPerSec: null,
      changedFiles: [],
      gitDiffStat: "",
      gitDiff: "",
      gradingOutput: msg,
      finalAssistantText: "",
      error: msg,
      cached: false,
    };
  } finally {
    if (harness) {
      await harness.close(BACKGROUND_CONTEXT).catch(() => undefined);
    }
    if (extensionCleanup) {
      await extensionCleanup().catch(() => undefined);
    }
    if (!options.keepWorkspace) {
      await checkout.cleanup().catch(() => undefined);
    }
  }
}

/**
 * Run the coding benchmark across all `models × tasks` in model-first order
 * (keeping local GPU weights warm in RAM and serializing local providers).
 */
export async function runCodingBenchmark(
  options: RunCodingBenchmarkOptions,
): Promise<CodingSessionRecord[]> {
  const results: CodingSessionRecord[] = [];
  const total = options.models.length * options.tasks.length;
  const requestedConcurrency = Math.max(1, options.concurrency ?? 2);
  let completed = 0;

  for (const spec of options.models) {
    const isLocal = LOCAL_PROVIDER_NAMES.has(spec.provider) || Boolean(spec.baseUrl);
    const workerCount = isLocal
      ? 1
      : Math.min(requestedConcurrency, options.tasks.length);
    const overrideKey = formatModelSpecString(spec);
    const overrideTarget = options.targetOverrides?.get(overrideKey);

    let nextIdx = 0;
    const modelResults = new Array<CodingSessionRecord>(options.tasks.length);

    const workers = Array.from({ length: Math.max(1, workerCount) }, async () => {
      while (true) {
        const i = nextIdx++;
        if (i >= options.tasks.length) break;
        const task = options.tasks[i];
        const rec = await runCodingTaskSession({
          task,
          spec,
          extensionNames: options.extensionNames,
          customExtensionPaths: options.customExtensionPaths,
          extraExtensions: options.extraExtensions,
          maxTurns: options.maxTurns,
          timeoutMs: options.timeoutMs,
          outputDir: options.outputDir,
          fresh: options.fresh,
          keepWorkspace: options.keepWorkspace,
          overrideTarget,
        });
        modelResults[i] = rec;
        completed++;
        options.onProgress?.(rec, completed, total);
      }
    });

    await Promise.all(workers);
    results.push(...modelResults);
  }

  return results;
}
