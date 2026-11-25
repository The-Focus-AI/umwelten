import fs from "node:fs";
import path from "node:path";
import type { CodingSessionRecord, CodingTaskSpec } from "@umwelten/evaluation";
import {
  canonicalizeThinkingEffort,
  getCatalogModelInfo,
  type ModelSpec,
  type ThinkingEffort,
} from "@umwelten/pi";
import { inferModelWeights, isLocalProviderName } from "../_shared/model-matrix.js";
import { loadCodingFixtures } from "./tasks.js";

export interface SavedCodingTaskResult {
  taskId: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  language: "typescript" | "python";
  passed: boolean;
  score: number;
  maxScore: number;
  details: string;
  visibleTests: { passed: number; failed: number; total: number };
  hiddenTests: { passed: number; failed: number; total: number };
  cheatedProtectedFiles: boolean;
  stopReason: "completed" | "turn_limit" | "timeout" | "error";
  durationMs: number;
  turns: number;
  toolCallsTotal: number;
  toolCallsByName: Record<string, number>;
  toolErrors: number;
  costUsd: number;
  tokenUsage: {
    prompt: number;
    completion: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
    total: number;
  };
  changedFiles: string[];
  gitDiffStat: string;
  error?: string;
}

export interface SavedCodingModelRow {
  id: string;
  provider: string;
  tier: "cloud" | "local";
  weights: "open" | "closed";
  reasoningEffort: string;
  effectiveThinkingLevel: string;
  extensionProfile: string;
  pricingPerMillion: { promptTokens: number; completionTokens: number } | null;
  passedTasks: number;
  totalTasks: number;
  passRate: number;
  avgScore: number;
  totalCostUsd: number;
  totalTimeSec: number;
  avgTurns: number;
  totalToolCalls: number;
  toolErrors: number;
  toolErrorRate: number;
  tokens: {
    prompt: number;
    completion: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
    total: number;
  };
  tokPerSec: number | null;
  taskResults: SavedCodingTaskResult[];
}

export interface CodingBenchReportPayload {
  mode: "live" | "mock";
  generatedAt: string;
  reproduceCommand: string;
  freshCommand: string;
  extensionProfile: string;
  tasks: Array<{
    id: string;
    title: string;
    difficulty: "easy" | "medium" | "hard";
    language: "typescript" | "python";
    tags: string[];
  }>;
  totalRunCostUsd: number;
  models: SavedCodingModelRow[];
  unavailableModels: Array<{ provider: string; name: string; error: string }>;
}

export function codingRowKey(row: {
  provider: string;
  id?: string;
  name?: string;
  reasoningEffort?: string;
  extensionProfile?: string;
}): string {
  const id = row.id ?? row.name ?? "";
  const effort =
    canonicalizeThinkingEffort(row.reasoningEffort as ThinkingEffort | undefined) ??
    "default";
  const ext = row.extensionProfile || "pi-default";
  return `${row.provider}::${id}::${effort}::${ext}`;
}

export function toSavedTaskResult(r: CodingSessionRecord): SavedCodingTaskResult {
  return {
    taskId: r.taskId,
    title: r.title,
    difficulty: r.difficulty,
    language: r.language,
    passed: r.passed,
    score: r.score,
    maxScore: r.maxScore,
    details: r.details,
    visibleTests: r.visibleTests,
    hiddenTests: r.hiddenTests,
    cheatedProtectedFiles: r.cheatedProtectedFiles,
    stopReason: r.stopReason,
    durationMs: r.durationMs,
    turns: r.turns,
    toolCallsTotal: r.toolCallsTotal,
    toolCallsByName: r.toolCallsByName,
    toolErrors: r.toolErrors,
    costUsd: r.costUsd,
    tokenUsage: r.tokenUsage,
    changedFiles: r.changedFiles,
    gitDiffStat: r.gitDiffStat,
    ...(r.error ? { error: r.error } : {}),
  };
}

export function recomputeModelRow(
  base: {
    id: string;
    provider: string;
    tier?: "cloud" | "local";
    weights?: "open" | "closed";
    reasoningEffort?: string;
    effectiveThinkingLevel?: string;
    extensionProfile?: string;
    pricingPerMillion?: { promptTokens: number; completionTokens: number } | null;
    costs?: ModelSpec["costs"];
  },
  taskResults: SavedCodingTaskResult[],
): SavedCodingModelRow {
  const sortedResults = [...taskResults].sort((a, b) =>
    a.taskId.localeCompare(b.taskId),
  );
  const normEff =
    canonicalizeThinkingEffort(base.reasoningEffort as ThinkingEffort | undefined) ??
    "default";
  const isLocal =
    base.tier === "local" || isLocalProviderName(base.provider);

  let pricingPerMillion = base.pricingPerMillion ?? null;
  if (pricingPerMillion === null) {
    if (isLocal) {
      pricingPerMillion = { promptTokens: 0, completionTokens: 0 };
    } else {
      const cat = getCatalogModelInfo({ provider: base.provider, name: base.id }).cost;
      if (cat) {
        pricingPerMillion = {
          promptTokens: cat.promptTokens,
          completionTokens: cat.completionTokens,
        };
      } else if (base.costs) {
        pricingPerMillion = {
          promptTokens: base.costs.promptTokens,
          completionTokens: base.costs.completionTokens,
        };
      }
    }
  }

  const totalTasks = sortedResults.length;
  const passedTasks = sortedResults.filter((r) => r.passed).length;
  const passRate =
    totalTasks > 0 ? Number(((passedTasks / totalTasks) * 100).toFixed(1)) : 0;
  const avgScore =
    totalTasks > 0
      ? Number(
          (sortedResults.reduce((s, r) => s + r.score, 0) / totalTasks).toFixed(2),
        )
      : 0;
  const totalCostUsd = Number(
    sortedResults.reduce((s, r) => s + r.costUsd, 0).toFixed(5),
  );
  const totalDurationMs = sortedResults.reduce((s, r) => s + r.durationMs, 0);
  const totalTimeSec = Number((totalDurationMs / 1000).toFixed(1));
  const avgTurns =
    totalTasks > 0
      ? Number(
          (sortedResults.reduce((s, r) => s + r.turns, 0) / totalTasks).toFixed(1),
        )
      : 0;
  const totalToolCalls = sortedResults.reduce((s, r) => s + r.toolCallsTotal, 0);
  const toolErrors = sortedResults.reduce((s, r) => s + r.toolErrors, 0);
  const toolErrorRate =
    totalToolCalls > 0
      ? Number(((toolErrors / totalToolCalls) * 100).toFixed(1))
      : 0;

  const tokens = {
    prompt: sortedResults.reduce((s, r) => s + r.tokenUsage.prompt, 0),
    completion: sortedResults.reduce((s, r) => s + r.tokenUsage.completion, 0),
    cacheRead: sortedResults.reduce((s, r) => s + r.tokenUsage.cacheRead, 0),
    cacheWrite: sortedResults.reduce((s, r) => s + r.tokenUsage.cacheWrite, 0),
    reasoning: sortedResults.reduce((s, r) => s + r.tokenUsage.reasoning, 0),
    total: sortedResults.reduce((s, r) => s + r.tokenUsage.total, 0),
  };

  const tokPerSec =
    totalTimeSec > 0 && tokens.completion > 0
      ? Number((tokens.completion / totalTimeSec).toFixed(1))
      : null;

  return {
    id: base.id,
    provider: base.provider,
    tier: isLocal ? "local" : "cloud",
    weights: base.weights ?? inferModelWeights(base.id, base.provider),
    reasoningEffort: normEff,
    effectiveThinkingLevel: base.effectiveThinkingLevel ?? normEff,
    extensionProfile: base.extensionProfile || "pi-default",
    pricingPerMillion,
    passedTasks,
    totalTasks,
    passRate,
    avgScore,
    totalCostUsd,
    totalTimeSec,
    avgTurns,
    totalToolCalls,
    toolErrors,
    toolErrorRate,
    tokens,
    tokPerSec,
    taskResults: sortedResults,
  };
}

export function sortCodingRows(rows: SavedCodingModelRow[]): SavedCodingModelRow[] {
  return [...rows].sort(
    (a, b) =>
      b.passRate - a.passRate ||
      b.avgScore - a.avgScore ||
      a.totalCostUsd - b.totalCostUsd ||
      a.totalTimeSec - b.totalTimeSec,
  );
}

/**
 * Merge a single session's autonomous `CodingSessionRecord` cleanly into
 * `reports/data/coding-bench-{live|mock}.json`, preserving any other task
 * results already recorded for that `(provider, model, effort, extensionProfile)`.
 */
export function saveSingleRecordToCodingReport(options: {
  record: CodingSessionRecord;
  mode: "live" | "mock";
  rootDir?: string;
  specCosts?: ModelSpec["costs"];
  allTasks?: CodingTaskSpec[];
}): { outPath: string; payload: CodingBenchReportPayload } {
  const rootDir = options.rootDir ?? process.cwd();
  const dataDir = path.join(rootDir, "reports", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const filename =
    options.mode === "live" ? "coding-bench-live.json" : "coding-bench-mock.json";
  const outPath = path.join(dataDir, filename);

  let prevModels: SavedCodingModelRow[] = [];
  let prevUnavailable: Array<{ provider: string; name: string; error: string }> = [];
  if (fs.existsSync(outPath)) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(outPath, "utf8"),
      ) as Partial<CodingBenchReportPayload>;
      if (Array.isArray(parsed.models)) prevModels = parsed.models;
      if (Array.isArray(parsed.unavailableModels)) {
        prevUnavailable = parsed.unavailableModels;
      }
    } catch {
      // Ignore corrupt previous file
    }
  }

  const r = options.record;
  const targetKey = codingRowKey({
    provider: r.provider,
    id: r.model,
    reasoningEffort: r.reasoningEffort,
    extensionProfile: r.extensionProfile,
  });

  const existingIdx = prevModels.findIndex(
    (row) => codingRowKey(row) === targetKey,
  );
  const savedResult = toSavedTaskResult(r);

  if (existingIdx >= 0) {
    const existing = prevModels[existingIdx];
    const otherTasks = (existing.taskResults ?? []).filter(
      (t) => t.taskId !== r.taskId,
    );
    const updatedRow = recomputeModelRow(existing, [...otherTasks, savedResult]);
    prevModels = [
      ...prevModels.slice(0, existingIdx),
      updatedRow,
      ...prevModels.slice(existingIdx + 1),
    ];
  } else {
    const newRow = recomputeModelRow(
      {
        id: r.model,
        provider: r.provider,
        reasoningEffort: r.reasoningEffort,
        effectiveThinkingLevel: r.effectiveThinkingLevel,
        extensionProfile: r.extensionProfile,
        costs: options.specCosts,
      },
      [savedResult],
    );
    prevModels = [...prevModels, newRow];
  }

  const sorted = sortCodingRows(prevModels);
  const fixtures = options.allTasks ?? loadCodingFixtures(path.join(rootDir, "benchmarks", "coding-fixtures"));
  const totalRunCostUsd = Number(
    sorted.reduce((s, m) => s + m.totalCostUsd, 0).toFixed(5),
  );

  const payload: CodingBenchReportPayload = {
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    reproduceCommand:
      options.mode === "live"
        ? "pnpm run bench:code -- --live"
        : "pnpm run bench:code -- --mock",
    freshCommand:
      options.mode === "live"
        ? "pnpm run bench:code -- --live --fresh"
        : "pnpm run bench:code -- --mock --fresh",
    extensionProfile: sorted[0]?.extensionProfile ?? r.extensionProfile,
    tasks: fixtures.map((t) => ({
      id: t.id,
      title: t.title,
      difficulty: t.difficulty,
      language: t.language,
      tags: t.tags ?? [],
    })),
    totalRunCostUsd,
    models: sorted,
    unavailableModels: prevUnavailable,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return { outPath, payload };
}
