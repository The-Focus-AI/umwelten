#!/usr/bin/env node
/**
 * Isolated Git-Checkout Coding-Session Benchmark CLI (`pnpm run bench:code`).
 *
 * Uses Pi Durable's `Harness` + `CodingTools` (`read`, `write`, `edit`, `bash`)
 * scoped to an isolated temporary git checkout per task, with pluggable built-in
 * and custom extensions, held-out hidden test grading, and full token/cost/turn Pareto output.
 *
 * Usage:
 *   pnpm run bench:code -- --mock --fresh
 *   pnpm run bench:code -- --live --models anthropic:claude-fable-5-2@high --tasks 01-ledger-rounding,02-cron-dst-scheduler
 *   pnpm run bench:code -- --live --merge --models ollama:inkling-2-mini:latest@low --extensions pi-default,verify-on-yield
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  BUILTIN_CODING_EXTENSIONS,
  runCodingBenchmark,
  type CodingDifficulty,
  type CodingSessionRecord,
  type CodingTaskSpec,
} from "@umwelten/evaluation";
import {
  canonicalizeThinkingEffort,
  formatModelSpecString,
  listMycelModels,
  parseModelSpecString,
  runPiTurn,
  type ThinkingEffort,
} from "@umwelten/pi";
import {
  discoverLocalOllamaModels,
  inferModelWeights,
  isLocalProviderName,
  loadModelMatrix,
  selectMatrixModels,
  type MatrixModelEntry,
} from "../_shared/model-matrix.js";
import { runInteractiveCodingCli } from "./interactive.js";
import {
  createMockTargetMap,
  MOCK_CODING_MODELS,
} from "./mock-solutions.js";
import {
  codingRowKey,
  recomputeModelRow,
  sortCodingRows,
  toSavedTaskResult,
} from "./report-store.js";
import { loadCodingFixtures } from "./tasks.js";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "reports", "data");

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    interactive: { type: "boolean", short: "i", default: false },
    live: { type: "boolean", default: false },
    mock: { type: "boolean", default: false },
    fresh: { type: "boolean", default: false },
    merge: { type: "boolean", default: false },
    group: { type: "string" },
    models: { type: "string" },
    add: { type: "string" },
    exclude: { type: "string" },
    effort: { type: "string" },
    "discover-local": { type: "boolean", default: false },
    "lab-dir": { type: "string" },
    tasks: { type: "string" },
    difficulty: { type: "string" },
    extensions: { type: "string", default: "pi-default" },
    extension: { type: "string", multiple: true },
    "max-turns": { type: "string" },
    "timeout-sec": { type: "string" },
    concurrency: { type: "string" },
    "keep-workspaces": { type: "boolean", default: false },
  },
});

function splitCsv(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function modelEffortKey(m: {
  provider: string;
  id?: string;
  name?: string;
  reasoningEffort?: string;
}): string {
  const name = m.id ?? m.name ?? "";
  const eff = canonicalizeThinkingEffort(
    m.reasoningEffort as ThinkingEffort | undefined,
  );
  return `${m.provider}::${name}::${eff ?? "default"}`;
}

const ENV_PROVIDER_MAP: Record<string, string[]> = {
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  xai: ["XAI_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  groq: ["GROQ_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
};

function hasProviderCredentials(provider: string): boolean {
  const keys = ENV_PROVIDER_MAP[provider] ?? [];
  return keys.some((k) => Boolean(process.env[k]));
}

async function resolveModels(isLive: boolean): Promise<{
  active: MatrixModelEntry[];
  unavailable: Array<{ provider: string; name: string; error: string }>;
}> {
  const unavailable: Array<{ provider: string; name: string; error: string }> = [];
  const requestedGroups = splitCsv(values.group);
  const explicitModels = splitCsv(values.models);
  const addSpecs = splitCsv(values.add);
  const excludeTokens = splitCsv(values.exclude);
  const rawEffort = values.effort?.trim().toLowerCase();
  const disableGroupEfforts = rawEffort === "default";
  const efforts =
    rawEffort && !disableGroupEfforts
      ? (splitCsv(values.effort) as ThinkingEffort[] | undefined)
      : undefined;

  if (!isLive && !requestedGroups && !explicitModels && !addSpecs) {
    let list = [...MOCK_CODING_MODELS];
    if (efforts?.length) {
      list = list.flatMap((m) =>
        efforts.map((eff) => ({
          ...m,
          reasoningEffort: canonicalizeThinkingEffort(eff),
        })),
      );
    }
    return { active: list, unavailable };
  }

  const manifest = loadModelMatrix();
  const baseGroups = requestedGroups ?? manifest.defaultGroups;
  let selectedEntries = selectMatrixModels(manifest, {
    groups: explicitModels ? undefined : baseGroups,
    models: explicitModels,
    add: addSpecs,
    labDir: values["lab-dir"],
  });

  if (isLive && values["discover-local"]) {
    try {
      const localModels = await discoverLocalOllamaModels();
      selectedEntries.push(...localModels);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ollama discovery skipped (${msg.slice(0, 80)})`);
    }
  }

  if (excludeTokens?.length) {
    selectedEntries = selectedEntries.filter((entry) => {
      const formatted = formatModelSpecString(entry);
      return !excludeTokens.some((tok) => {
        if (tok.endsWith(":*")) return entry.provider === tok.slice(0, -2);
        return (
          tok === entry.name ||
          tok === formatted ||
          (!tok.includes("@") && tok === `${entry.provider}:${entry.name}`)
        );
      });
    });
  }

  if (efforts?.length) {
    const expanded: MatrixModelEntry[] = [];
    for (const entry of selectedEntries) {
      for (const eff of efforts) {
        const norm = canonicalizeThinkingEffort(eff);
        expanded.push({
          ...entry,
          ...(norm ? { reasoningEffort: norm } : {}),
        });
      }
    }
    selectedEntries = expanded;
  } else if (!disableGroupEfforts) {
    const expanded: MatrixModelEntry[] = [];
    for (const entry of selectedEntries) {
      if (entry.reasoningEffort) {
        expanded.push(entry);
        continue;
      }
      const groupEfforts = entry.group
        ? manifest.groups[entry.group]?.defaultEfforts
        : undefined;
      if (groupEfforts && groupEfforts.length > 0) {
        for (const eff of groupEfforts) {
          const norm = canonicalizeThinkingEffort(eff);
          expanded.push({
            ...entry,
            ...(norm ? { reasoningEffort: norm } : {}),
          });
        }
      } else {
        expanded.push(entry);
      }
    }
    selectedEntries = expanded;
  }

  const deduped: MatrixModelEntry[] = [];
  const seenKeys = new Set<string>();
  for (const e of selectedEntries) {
    const k = `${modelEffortKey(e)}::${e.baseUrl ?? ""}`;
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    deduped.push(e);
  }

  if (!isLive || explicitModels) {
    return { active: deduped, unavailable };
  }

  const candidates: MatrixModelEntry[] = [];
  for (const entry of deduped) {
    if (entry.tier === "local" || isLocalProviderName(entry.provider)) {
      candidates.push(entry);
      continue;
    }
    if (hasProviderCredentials(entry.provider)) {
      candidates.push(entry);
    }
  }

  if (process.env.MYCEL_API_KEY) {
    process.env.MYCEL_URL ??= "https://mycel.thefocus.ai";
    process.env.MYCEL_END_USER ??= "umwelten-coding-bench";
    try {
      const cat = await listMycelModels(
        process.env.MYCEL_API_KEY,
        process.env.MYCEL_URL,
      );
      for (const m of cat) {
        if (m.name === "default" || m.name.startsWith("typesafe/jev")) continue;
        const targetEfforts = efforts?.length ? efforts : [undefined];
        for (const eff of targetEfforts) {
          candidates.push({
            ...m,
            weights: inferModelWeights(m.name, m.provider),
            tier: "cloud",
            enabled: true,
            ...(eff ? { reasoningEffort: canonicalizeThinkingEffort(eff) } : {}),
          });
        }
      }
    } catch {
      // Ignore Mycel catalog failure during probing
    }
  }

  const uniqueProbes = new Map<string, MatrixModelEntry>();
  for (const c of candidates) {
    const pk = `${c.provider}::${c.name}::${c.baseUrl ?? ""}`;
    if (!uniqueProbes.has(pk)) uniqueProbes.set(pk, c);
  }

  console.log(`Probing ${uniqueProbes.size} unique live/local model(s)...`);
  const reachableKeys = new Set<string>();
  const explicitLocalRequested = Boolean(
    values["discover-local"] ||
      values["lab-dir"] ||
      requestedGroups?.some((g) => g.startsWith("local-")) ||
      addSpecs?.some((s) => isLocalProviderName(parseModelSpecString(s).provider)),
  );

  for (const [pk, m] of uniqueProbes.entries()) {
    try {
      await runPiTurn({
        model: {
          provider: m.provider,
          name: m.name,
          ...(m.baseUrl ? { baseUrl: m.baseUrl } : {}),
        },
        prompt: "Reply with OK.",
        temperature: 0,
        maxTokens: 64,
      });
      reachableKeys.add(pk);
      console.log(`  ✓ ${m.provider}:${m.name} reachable`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isLocal = m.tier === "local" || isLocalProviderName(m.provider);
      if (!isLocal || explicitLocalRequested) {
        unavailable.push({ provider: m.provider, name: m.name, error: msg });
      }
      console.log(`  ✗ ${m.provider}:${m.name} skipped (${msg.slice(0, 80)})`);
    }
  }

  const active = candidates.filter((c) =>
    reachableKeys.has(`${c.provider}::${c.name}::${c.baseUrl ?? ""}`),
  );
  if (active.length === 0) {
    throw new Error(
      "No live or local models reachable. Start Ollama/local lab servers or pass --models, or omit --live to run in mock mode.",
    );
  }

  return { active, unavailable };
}

function selectTasks(): CodingTaskSpec[] {
  const all = loadCodingFixtures();
  const idFilter = splitCsv(values.tasks);
  const diffFilter = splitCsv(values.difficulty) as CodingDifficulty[] | undefined;

  const filtered = all.filter((t) => {
    if (idFilter && !idFilter.includes(t.id)) return false;
    if (diffFilter && !diffFilter.includes(t.difficulty)) return false;
    return true;
  });

  if (filtered.length === 0) {
    throw new Error(
      `No coding fixtures matched filters (tasks=${values.tasks ?? "*"}, difficulty=${values.difficulty ?? "*"}).`,
    );
  }
  return filtered;
}

function buildModelRow(
  m: MatrixModelEntry,
  records: CodingSessionRecord[],
  extensionProfileFallback: string,
) {
  const normEff = canonicalizeThinkingEffort(m.reasoningEffort) ?? "default";
  return recomputeModelRow(
    {
      id: m.name,
      provider: m.provider,
      tier: m.tier,
      weights: m.weights ?? inferModelWeights(m.name, m.provider),
      reasoningEffort: normEff,
      effectiveThinkingLevel: records[0]?.effectiveThinkingLevel ?? normEff,
      extensionProfile: records[0]?.extensionProfile ?? extensionProfileFallback,
      costs: m.costs,
    },
    records.map(toSavedTaskResult),
  );
}

async function main() {
  if (values.interactive) {
    await runInteractiveCodingCli({ argv: process.argv.slice(2) });
    return;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const isLive = Boolean(values.live) && !values.mock;
  const tasks = selectTasks();
  const { active, unavailable } = await resolveModels(isLive);

  const extensionNames = splitCsv(values.extensions) ?? ["pi-default"];
  for (const name of extensionNames) {
    if (!BUILTIN_CODING_EXTENSIONS.includes(name as (typeof BUILTIN_CODING_EXTENSIONS)[number])) {
      throw new Error(
        `Unknown --extensions member "${name}". Built-ins: ${BUILTIN_CODING_EXTENSIONS.join(", ")}`,
      );
    }
  }
  const customExtensionPaths = (values.extension ?? []).flatMap((item) =>
    item
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const maxTurns = values["max-turns"]
    ? parseInt(values["max-turns"], 10)
    : undefined;
  const timeoutMs = values["timeout-sec"]
    ? parseInt(values["timeout-sec"], 10) * 1000
    : undefined;
  const concurrency = values.concurrency
    ? parseInt(values.concurrency, 10)
    : isLive
      ? 2
      : 3;

  const evalSubdir = isLive ? "evaluations" : "mock-evaluations";
  const outputDir = path.join(ROOT, "output", evalSubdir, "coding-bench", "runs", "001");
  const targetOverrides = isLive ? undefined : createMockTargetMap(active);

  console.log(
    `\nRunning Isolated Coding-Session Benchmark [${isLive ? "LIVE" : "MOCK"}]` +
      ` · ${active.length} model(s) × ${tasks.length} task(s)` +
      ` · extensions=[${[...extensionNames, ...customExtensionPaths].join(",")}]`,
  );

  const records = await runCodingBenchmark({
    tasks,
    models: active,
    extensionNames,
    customExtensionPaths,
    maxTurns,
    timeoutMs,
    concurrency,
    outputDir,
    fresh: values.fresh,
    keepWorkspace: values["keep-workspaces"],
    targetOverrides,
    onProgress(rec, idx, total) {
      const icon = rec.passed ? "✅" : rec.score > 0 ? "🟡" : "❌";
      const cacheTag = rec.cached ? " (cached)" : "";
      const effTag = rec.reasoningEffort ? `[${rec.reasoningEffort}]` : "";
      console.log(
        `  [${String(idx).padStart(String(total).length)}/${total}] ${icon} ` +
          `${rec.provider}:${rec.model}${effTag} · ${rec.taskId} → ` +
          `${rec.score}/${rec.maxScore} (${rec.hiddenTests.passed}/${rec.hiddenTests.total} hidden) ` +
          `· ${rec.turns}t ${rec.toolCallsTotal}calls ($${rec.costUsd.toFixed(4)}, ${(rec.durationMs / 1000).toFixed(1)}s)${cacheTag}`,
      );
    },
  });

  const profileFallback =
    records[0]?.extensionProfile ??
    ["pi-default", ...extensionNames.filter((n) => n !== "pi-default")].join("+");

  const rows = active.map((m) => {
    const key = modelEffortKey(m);
    const mine = records.filter(
      (r) =>
        modelEffortKey({
          provider: r.provider,
          name: r.model,
          reasoningEffort: r.reasoningEffort,
        }) === key,
    );
    return buildModelRow(m, mine, profileFallback);
  });

  const outFilename = isLive ? "coding-bench-live.json" : "coding-bench-mock.json";
  const outPath = path.join(DATA_DIR, outFilename);
  let finalRows = rows;

  if (values.merge && fs.existsSync(outPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outPath, "utf8")) as {
        models?: typeof rows;
      };
      if (Array.isArray(prev.models)) {
        const merged = new Map<string, (typeof rows)[number]>();
        for (const r of prev.models) merged.set(codingRowKey(r), r);
        for (const r of rows) merged.set(codingRowKey(r), r);
        finalRows = Array.from(merged.values());
      }
    } catch {
      // Ignore malformed previous artifact
    }
  }

  finalRows = sortCodingRows(finalRows);

  const totalRunCostUsd = Number(
    finalRows.reduce((s, r) => s + r.totalCostUsd, 0).toFixed(5),
  );

  const payload = {
    mode: isLive ? ("live" as const) : ("mock" as const),
    generatedAt: new Date().toISOString(),
    reproduceCommand: isLive
      ? "pnpm run bench:code -- --live"
      : "pnpm run bench:code -- --mock",
    freshCommand: isLive
      ? "pnpm run bench:code -- --live --fresh"
      : "pnpm run bench:code -- --mock --fresh",
    extensionProfile: finalRows[0]?.extensionProfile ?? profileFallback,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      difficulty: t.difficulty,
      language: t.language,
      tags: t.tags ?? [],
    })),
    totalRunCostUsd,
    models: finalRows,
    unavailableModels: unavailable,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log("\nCoding-Session Benchmark Summary:");
  console.log(
    "Model".padEnd(38),
    "Effort".padEnd(8),
    "Pass@1".padEnd(10),
    "Score".padEnd(7),
    "Turns".padEnd(6),
    "Cost".padEnd(9),
    "Time",
  );
  console.log("-".repeat(90));
  for (const r of finalRows) {
    console.log(
      `${r.provider}:${r.id}`.slice(0, 37).padEnd(38),
      r.reasoningEffort.padEnd(8),
      `${r.passedTasks}/${r.totalTasks} (${r.passRate}%)`.padEnd(10),
      `${r.avgScore}/10`.padEnd(7),
      String(r.avgTurns).padEnd(6),
      `$${r.totalCostUsd.toFixed(4)}`.padEnd(9),
      `${r.totalTimeSec}s`,
    );
  }
  console.log(`\n✅ Wrote ${outFilename} -> ${outPath}`);
}

main().catch((err) => {
  console.error("Coding benchmark failed:", err);
  process.exit(1);
});
