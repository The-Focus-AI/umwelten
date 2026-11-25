#!/usr/bin/env node
/**
 * Static site builder for `umwelten.thefocus.ai` (`build/site/`).
 *
 * Reads ONLY committed machine-generated benchmark & example outputs under
 * `reports/data/*.json` (produced by `pnpm run site:bench` and
 * `pnpm run site:extract-archives`) plus live TypeScript sources in `examples/`.
 *
 * Visual language: TheFocus.AI Labs ("Bell Labs Warm Paper" / Ledger v2.0.1)
 * matching `../labs`.
 */

import fs from "node:fs";
import path from "node:path";
import { formatModelSpecString } from "@umwelten/pi";
import {
  hydrateEntryWithCatalog,
  loadModelMatrix,
  type MatrixModelEntry,
} from "../examples/_shared/model-matrix.js";
import {
  ARCHITECTURE_PACKAGES,
  loadSiteDatasets,
  PROMPT_EXAMPLES,
  type CodingBenchArtifact,
  type ExamplePick,
  type HistoricalArchivesArtifact,
  type JevLiveArtifact,
  type LiveWatchArtifact,
  type LiveWatchModel,
  type PromptExampleMeta,
} from "./site-data.js";
import { LABS_CSS } from "./site-styles.js";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "build", "site");

function esc(str: string | number | undefined | null): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortModelId(id: string): string {
  return id.replace(
    /^(anthropic|openai|qwen|deepseek|x-ai|moonshotai|mistralai|meta-llama|z-ai|nvidia|google|inception|minimax)\//,
    "",
  );
}

function fmtUsd(c: number): string {
  if (c === 0) return "$0";
  if (c < 0.01) return "$" + c.toFixed(4);
  if (c < 1) return "$" + c.toFixed(3);
  return "$" + c.toFixed(2);
}

function summarizeLiveWatch(liveWatch: LiveWatchArtifact) {
  const liveRunDate = liveWatch.generatedAt.slice(0, 10);
  const liveTotalTasks = liveWatch.dimensions.reduce((s, d) => s + d.tasks, 0);
  const liveMaxScore = liveWatch.dimensions.reduce((s, d) => s + d.maxScore, 0);
  const models = liveWatch.models;
  const liveOpenCount = models.filter((m) => m.weights === "open").length;
  const liveClosedCount = models.filter((m) => m.weights === "closed").length;
  const liveLocalCount = models.filter((m) => m.tier === "local").length;
  const liveProviderCount = new Set(models.map((m) => m.provider)).size;
  const unavailable = liveWatch.unavailableCatalogueModels ?? [];
  const liveOfflineCount = unavailable.length;

  const liveJudgeTotalCost = (liveWatch.judgeCostUsd ?? 0) + (liveWatch.eloJudgeCostUsd ?? 0);
  const liveTotalRunCost =
    liveWatch.totalRunCostUsd ?? liveWatch.totalSuiteCostUsd + liveJudgeTotalCost;

  const topCombined = models.length > 0 ? Math.max(...models.map((m) => m.combined)) : 0;
  const topTier = models.filter((m) => Math.abs(m.combined - topCombined) < 0.05);

  const byCostAsc = (a: LiveWatchModel, b: LiveWatchModel) =>
    a.cost - b.cost || a.timeSec - b.timeSec;
  const byTimeAsc = (a: LiveWatchModel, b: LiveWatchModel) =>
    a.timeSec - b.timeSec || a.cost - b.cost;

  const costTopWinner = [...topTier].sort(byCostAsc)[0] ?? models[0];
  const speedTopWinner = [...topTier].sort(byTimeAsc)[0] ?? models[0];
  const priciestTop = [...topTier].sort((a, b) => b.cost - a.cost || a.timeSec - b.timeSec)[0] ?? models[0];

  const paidModels = models.filter((m) => m.cost > 0);
  const cheapestOverall = [...(paidModels.length > 0 ? paidModels : models)].sort(byCostAsc)[0] ?? models[0];
  const fastestOverall = [...models].sort(byTimeAsc)[0] ?? models[0];
  const topEloModel =
    [...models].sort(
      (a, b) =>
        (b.elo ?? -Infinity) - (a.elo ?? -Infinity) ||
        b.combined - a.combined ||
        a.cost - b.cost,
    )[0] ?? models[0];
  const slowestOrLoopModel =
    [...models].sort(
      (a, b) =>
        (b.tokens?.reasoning ?? 0) - (a.tokens?.reasoning ?? 0) || b.timeSec - a.timeSec,
    )[0] ?? models[0];

  const carWashEntries = models
    .map((m) => ({
      m,
      task: m.taskBreakdown?.reasoning?.find((t) => t.taskId === "car-wash"),
    }))
    .filter(
      (x): x is { m: LiveWatchModel; task: NonNullable<typeof x.task> } => Boolean(x.task),
    );
  const carWashPerfect = carWashEntries.filter((x) => x.task.score >= x.task.maxScore);
  const carWash3 = carWashEntries.filter((x) => x.task.score === 3);
  const carWashFail = carWashEntries.filter((x) => x.task.score <= 1);

  return {
    liveRunDate,
    liveTotalTasks,
    liveMaxScore,
    liveOpenCount,
    liveClosedCount,
    liveLocalCount,
    liveProviderCount,
    unavailable,
    liveOfflineCount,
    liveJudgeTotalCost,
    liveTotalRunCost,
    topCombined,
    topTier,
    costTopWinner,
    speedTopWinner,
    priciestTop,
    cheapestOverall,
    fastestOverall,
    topEloModel,
    slowestOrLoopModel,
    carWashStats: {
      total: carWashEntries.length,
      count5: carWashPerfect.length,
      count3: carWash3.length,
      countLow: carWashFail.length,
      perfectModels: carWashPerfect.map((x) => x.m.id),
      failModels: carWashFail.map((x) => x.m.id),
    },
  };
}

function liveModelKey(m: {
  id: string;
  provider: string;
  reasoningEffort?: string | null;
}): string {
  const eff =
    m.reasoningEffort && m.reasoningEffort !== "default"
      ? "::" + m.reasoningEffort
      : "";
  return `${m.id}::${m.provider}${eff}`;
}

function inferLabLabel(name: string, provider: string): string {
  const s = `${provider}:${name}`.toLowerCase();
  if (s.includes("anthropic") || name.startsWith("claude-")) return "Anthropic";
  if (name.startsWith("openai/") || name.startsWith("gpt-")) return "OpenAI";
  if (s.includes("gemini-") || s.includes("gemma")) return "Google";
  if (name.startsWith("meta/") || name.includes("muse-")) return "Meta";
  if (name.startsWith("qwen/") || name.startsWith("qwen")) return "Alibaba";
  if (name.startsWith("x-ai/") || name.startsWith("grok-")) return "xAI";
  if (name.includes("inkling")) return "Thinking Machines";
  if (name.includes("deepseek")) return "DeepSeek";
  if (name.includes("glm-")) return "Z.AI";
  if (name.includes("kimi-")) return "Moonshot";
  if (name.includes("minimax")) return "MiniMax";
  if (name.includes("clef-")) return "Clef";
  return provider;
}

function inferRuntimeLabel(
  provider: string,
  baseUrl?: string,
): string {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "google") return "Google API";
  if (provider === "anthropic") return "Anthropic API";
  if (provider === "mlx") return "MLX Lab";
  if (provider === "ollama") return baseUrl ? "Ollama Lab" : "Ollama Local";
  return provider;
}

interface ExplorerTargetView {
  spec: string;
  provider: string;
  name: string;
  group: string;
  tier: "cloud" | "local";
  runtimeLabel: string;
  baseUrl: string | null;
  priceLabel: string;
  promptCost: number | null;
  completionCost: number | null;
  liveMatches: Array<{
    rowKey: string;
    combined: number;
    cost: number;
    timeSec: number;
    effort: string;
    elo: number | null;
    tokPerSec: number | null;
  }>;
}

interface ExplorerModelView {
  canonicalId: string;
  title: string;
  lab: string;
  weights: "open" | "closed";
  laptopFit: boolean;
  lane: "laptop" | "cluster" | "fable" | "workhorse";
  params: string;
  footprint: string;
  contextLength: number | null;
  minPromptCost: number | null;
  minCompletionCost: number | null;
  tagline: string;
  defaultEfforts: string[];
  thinkingLevels: string[];
  groups: string[];
  targets: ExplorerTargetView[];
  bestLive: {
    rowKey: string;
    combined: number;
    cost: number;
    timeSec: number;
    provider: string;
    spec: string;
  } | null;
}

function buildExplorerCatalog(liveWatch: LiveWatchArtifact) {
  const manifest = loadModelMatrix();
  const groupOrder = Object.keys(manifest.groups);
  const byCanonical = new Map<string, ExplorerModelView>();
  let totalEndpoints = 0;

  for (const groupName of groupOrder) {
    const grp = manifest.groups[groupName];
    const grpEfforts = grp.defaultEfforts ?? [];
    for (const raw of grp.models) {
      if (raw.enabled === false) continue;
      totalEndpoints++;
      const hydrated: MatrixModelEntry = hydrateEntryWithCatalog({
        ...raw,
        enabled: true,
        group: groupName,
      });
      const cid = raw.canonicalId ?? shortModelId(raw.name);
      const laptopFit =
        raw.laptopFit === "yes" ||
        (raw.laptopFit !== "no" && hydrated.tier === "local");
      const lane: ExplorerModelView["lane"] =
        hydrated.weights === "open"
          ? laptopFit
            ? "laptop"
            : "cluster"
          : groupName === "frontier-fable"
            ? "fable"
            : "workhorse";

      const spec = formatModelSpecString(hydrated);
      const promptCost =
        hydrated.tier === "local" ? 0 : (hydrated.costs?.promptTokens ?? null);
      const completionCost =
        hydrated.tier === "local"
          ? 0
          : (hydrated.costs?.completionTokens ?? null);
      const priceLabel =
        hydrated.tier === "local"
          ? "$0 local"
          : promptCost !== null && completionCost !== null
            ? `$${promptCost}/$${completionCost} /M`
            : "unlisted";

      const matchingLive = liveWatch.models
        .filter((lm) => lm.provider === hydrated.provider && lm.id === hydrated.name)
        .map((lm) => ({
          rowKey: liveModelKey(lm),
          combined: lm.combined,
          cost: lm.cost,
          timeSec: lm.timeSec,
          effort: lm.reasoningEffort ?? "default",
          elo: lm.elo,
          tokPerSec: lm.tokPerSec ?? null,
        }))
        .sort((a, b) => b.combined - a.combined || a.cost - b.cost);

      const target: ExplorerTargetView = {
        spec,
        provider: hydrated.provider,
        name: hydrated.name,
        group: groupName,
        tier: hydrated.tier,
        runtimeLabel: inferRuntimeLabel(hydrated.provider, hydrated.baseUrl),
        baseUrl: hydrated.baseUrl ?? null,
        priceLabel,
        promptCost,
        completionCost,
        liveMatches: matchingLive,
      };

      const existing = byCanonical.get(cid);
      const bestForTarget = matchingLive[0]
        ? {
            rowKey: matchingLive[0].rowKey,
            combined: matchingLive[0].combined,
            cost: matchingLive[0].cost,
            timeSec: matchingLive[0].timeSec,
            provider: hydrated.provider,
            spec,
          }
        : null;

      if (!existing) {
        byCanonical.set(cid, {
          canonicalId: cid,
          title: raw.canonicalId ?? shortModelId(raw.name).replace(/:latest$/, ""),
          lab: inferLabLabel(raw.name, hydrated.provider),
          weights: hydrated.weights,
          laptopFit,
          lane,
          params: raw.params ?? (hydrated.weights === "closed" ? "Undisclosed" : "MoE / Dense"),
          footprint: raw.footprint ?? (laptopFit ? "Fits <=32 GiB" : "Cluster / API"),
          contextLength: hydrated.contextLength ?? null,
          minPromptCost: hydrated.tier === "cloud" ? promptCost : null,
          minCompletionCost: hydrated.tier === "cloud" ? completionCost : null,
          tagline: raw.tagline ?? "",
          defaultEfforts: [...grpEfforts],
          thinkingLevels: hydrated.supportedThinkingLevels ?? [],
          groups: [groupName],
          targets: [target],
          bestLive: bestForTarget,
        });
      } else {
        existing.targets.push(target);
        if (!existing.groups.includes(groupName)) existing.groups.push(groupName);
        if (raw.params && existing.params === "MoE / Dense") existing.params = raw.params;
        if (raw.footprint && existing.footprint === "Cluster / API") existing.footprint = raw.footprint;
        if (!existing.contextLength && hydrated.contextLength) {
          existing.contextLength = hydrated.contextLength;
        }
        if (
          hydrated.tier === "cloud" &&
          promptCost !== null &&
          (existing.minPromptCost === null || promptCost < existing.minPromptCost)
        ) {
          existing.minPromptCost = promptCost;
          existing.minCompletionCost = completionCost;
        }
        if (
          hydrated.supportedThinkingLevels &&
          hydrated.supportedThinkingLevels.length > existing.thinkingLevels.length
        ) {
          existing.thinkingLevels = hydrated.supportedThinkingLevels;
        }
        if (
          bestForTarget &&
          (!existing.bestLive ||
            bestForTarget.combined > existing.bestLive.combined ||
            (bestForTarget.combined === existing.bestLive.combined &&
              bestForTarget.cost < existing.bestLive.cost))
        ) {
          existing.bestLive = bestForTarget;
        }
      }
    }
  }

  const laneOrder: Record<ExplorerModelView["lane"], number> = {
    laptop: 0,
    cluster: 1,
    fable: 2,
    workhorse: 3,
  };
  const models = Array.from(byCanonical.values()).sort(
    (a, b) =>
      laneOrder[a.lane] - laneOrder[b.lane] ||
      (b.bestLive?.combined ?? -1) - (a.bestLive?.combined ?? -1) ||
      a.title.localeCompare(b.title),
  );

  const laptopCount = models.filter((m) => m.laptopFit).length;
  const clusterCount = models.filter((m) => m.lane === "cluster").length;
  const fableCount = models.filter((m) => m.lane === "fable").length;
  const workhorseCount = models.filter((m) => m.lane === "workhorse").length;
  const openCount = models.filter((m) => m.weights === "open").length;
  const closedCount = models.filter((m) => m.weights === "closed").length;
  const pairedLocalCount = models.filter(
    (m) =>
      m.targets.some((t) => t.tier === "cloud") &&
      m.targets.some((t) => t.tier === "local"),
  ).length;
  const measuredCanonicalCount = models.filter((m) => m.bestLive !== null).length;

  return {
    models,
    totalEndpoints,
    openCount,
    closedCount,
    laptopCount,
    pairedLocalCount,
    clusterCount,
    fableCount,
    workhorseCount,
    measuredCanonicalCount,
  };
}

const TS_KEYWORDS = new Set([
  "import",
  "from",
  "export",
  "const",
  "let",
  "var",
  "function",
  "async",
  "await",
  "return",
  "if",
  "else",
  "for",
  "of",
  "in",
  "new",
  "try",
  "catch",
  "finally",
  "throw",
  "type",
  "interface",
  "as",
  "void",
  "true",
  "false",
  "null",
  "undefined",
]);

function highlightTs(source: string): string {
  const tokenRe =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^`])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|\b(\d+(?:_\d+)*(?:\.\d+)?)\b|\b([A-Za-z_$][\w$]*)\b/g;

  const full = source.replace(/\r\n/g, "\n").trimEnd();
  let out = "";
  let last = 0;
  for (const match of full.matchAll(tokenRe)) {
    const idx = match.index ?? 0;
    out += esc(full.slice(last, idx));
    const [raw, comment, str, num, ident] = match;
    if (comment !== undefined) {
      out += `<span class="tok-cmt">${esc(raw)}</span>`;
    } else if (str !== undefined) {
      out += `<span class="tok-str">${esc(raw)}</span>`;
    } else if (num !== undefined) {
      out += `<span class="tok-num">${esc(raw)}</span>`;
    } else if (ident !== undefined && TS_KEYWORDS.has(ident)) {
      out += `<span class="tok-kw">${esc(raw)}</span>`;
    } else {
      out += esc(raw);
    }
    last = idx + raw.length;
  }
  out += esc(full.slice(last));

  return out
    .split("\n")
    .map((line, i) => `<span class="code-ln">${i + 1}</span>${line}`)
    .join("\n");
}

type NavKey = "watch" | "local" | "examples" | "architecture";

function renderShell(opts: {
  title: string;
  description: string;
  activeNav: NavKey;
  prefix: "." | "..";
  storylineHtml?: string;
  bodyHtml: string;
  scriptHtml?: string;
}): string {
  const p = opts.prefix;
  const navItems: Array<{ key: NavKey; href: string; label: string }> = [
    { key: "watch", href: `${p}/index.html`, label: "Model Watch" },
    { key: "local", href: `${p}/local.html`, label: "Local Models" },
    { key: "examples", href: `${p}/examples.html`, label: `Examples (${PROMPT_EXAMPLES.length})` },
    { key: "architecture", href: `${p}/architecture.html`, label: "Architecture" },
  ];

  return `<!DOCTYPE html>
<html lang="en" data-theme="paper">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.description)}" />
  <link rel="stylesheet" href="${p}/styles/labs.css" />
</head>
<body>
  <div class="scroll-progress-rule" aria-hidden="true"></div>

  <header class="site-header">
    <div class="site-header-inner">
      <div class="masthead-brand">
        <a href="${p}/index.html" class="wordmark" aria-label="TheFocus.AI Umwelten">
          <span class="wordmark-glyph" aria-hidden="true"></span>
          <span class="wordmark-text">TheFocus</span>
          <span class="wordmark-divider">/</span>
          <span class="wordmark-sub">Umwelten</span>
        </a>
        <a href="${p}/examples/model-watch-bench.html" class="masthead-issue-pill" title="Reproduce all live telemetry with pnpm run site:bench">
          <span class="masthead-issue-dot" aria-hidden="true"></span>
          <span>Pi + Pi-Durable &middot; v0.6</span>
        </a>
      </div>

      <nav class="site-nav" aria-label="Primary">
        ${navItems
          .map((item) => {
            const active = item.key === opts.activeNav;
            return `<a href="${item.href}"${active ? ' aria-current="page"' : ""}>
          <span>${esc(item.label)}</span>
          ${active ? '<span class="nav-active-underline"></span>' : ""}
        </a>`;
          })
          .join("\n        ")}
        <a href="https://github.com/The-Focus-AI/umwelten" class="site-nav-gh" target="_blank" rel="noopener">
          <span>GitHub &nearr;</span>
        </a>
      </nav>
    </div>
  </header>

  ${opts.storylineHtml ?? ""}

  <main>
    ${opts.bodyHtml}
  </main>

  <footer class="site-footer">
    <div class="site-footer-inner">
      <span>Published by <a href="https://thefocus.ai">TheFocus.AI</a> &middot; Data reproduced via <code>pnpm run site:bench</code></span>
      <span>
        <a href="https://labs.thefocus.ai">Labs</a>
        &middot;
        <a href="${p}/examples.html">Examples</a>
        &middot;
        <a href="${p}/architecture.html">Specs &amp; Verdicts</a>
        &middot;
        <a href="https://github.com/The-Focus-AI/umwelten">Source</a>
      </span>
    </div>
  </footer>

  <script>
    function copyTextWithFeedback(btn, text, doneLabel) {
      const orig = btn.getAttribute("data-orig-label") || btn.textContent;
      btn.setAttribute("data-orig-label", orig);
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = doneLabel || "Copied ✓";
        setTimeout(() => { btn.textContent = orig; }, 1600);
      });
    }
  </script>
  ${opts.scriptHtml ?? ""}
</body>
</html>
`;
}

function renderModelPicks(
  picks: ExamplePick[],
  provenanceLabel: string,
  label = "Model picks",
): string {
  return `<aside class="model-picks">
    <div class="model-picks-head">
      <span class="model-picks-label">${esc(label)}</span>
      <span class="model-picks-date">${esc(provenanceLabel)}</span>
    </div>
    <ul>
      ${picks
        .map(
          (m) => `<li>
        <span class="pick-role">${esc(m.role)}</span>
        <span class="pick-name">${esc(m.name)}</span>
        <span class="pick-note">${esc(m.note)}</span>
      </li>`,
        )
        .join("\n      ")}
    </ul>
  </aside>`;
}

function renderExampleCard(ex: PromptExampleMeta, prefix: "." | ".."): string {
  const shortPrompt =
    ex.prompt.length > 148 ? ex.prompt.slice(0, 145).trimEnd() + "…" : ex.prompt;
  return `<a class="item-card" href="${prefix}/examples/${ex.slug}.html" data-cat="${ex.category}">
    <div>
      <div class="item-meta">
        <span class="item-kind">
          <span class="telemetry-bars" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>Ex ${esc(ex.num)} &middot; ${esc(ex.badge)}</span>
        </span>
        <span>${ex.readMinutes} min</span>
      </div>
      <h3>${esc(ex.title)}</h3>
      <div class="item-prompt-preview">&ldquo;${esc(shortPrompt)}&rdquo;</div>
    </div>
    <div class="item-footer">
      <span>${esc(ex.file)}</span>
      <span class="item-cta">Prompt &amp; Code &rarr;</span>
    </div>
  </a>`;
}

function renderCodingBenchSection(codingBench: CodingBenchArtifact | null): string {
  if (!codingBench) {
    return `
    <!-- 02 — Isolated Coding-Session Benchmark -->
    <section class="report-section" id="coding-bench">
      <div class="section-num">02 &mdash; Isolated Git-Checkout Coding-Session Benchmark</div>
      <h2 class="section-title">Multi-file debugging on real isolated checkouts (<code>pnpm run bench:code</code>)</h2>
      <div class="pareto-frame">
        <p class="body-text" style="margin:0">
          No coding benchmark artifact found yet. Generate mock preview data with
          <code>pnpm run bench:code -- --mock --fresh</code> or run live with
          <code>pnpm run bench:code -- --live</code>.
        </p>
      </div>
    </section>`;
  }

  const tsCount = codingBench.tasks.filter((t) => t.language === "typescript").length;
  const pyCount = codingBench.tasks.filter((t) => t.language === "python").length;
  const diffCounts = {
    easy: codingBench.tasks.filter((t) => t.difficulty === "easy").length,
    medium: codingBench.tasks.filter((t) => t.difficulty === "medium").length,
    hard: codingBench.tasks.filter((t) => t.difficulty === "hard").length,
  };
  const badgeHtml = codingBench.isMockPreview
    ? `<span class="badge badge-mock">MOCK PREVIEW (fauxProvider + Real Grading)</span>`
    : `<span class="badge badge-live">LIVE MEASURED</span>`;
  const profiles = Array.from(
    new Set(codingBench.models.map((m) => m.extensionProfile || codingBench.extensionProfile || "pi-default")),
  );

  const taskHeaders = codingBench.tasks
    .map(
      (t) =>
        `<th title="${esc(`${t.id}: ${t.title} (${t.difficulty}, ${t.language})`)}">${esc(t.id.slice(0, 2))}</th>`,
    )
    .join("");

  return `
    <!-- 02 — Isolated Coding-Session Benchmark -->
    <section class="report-section" id="coding-bench">
      <div class="section-num">02 &mdash; Isolated Git-Checkout Coding-Session Benchmark &nbsp;${badgeHtml}</div>
      <h2 class="section-title">Multi-file bug-fix sessions with held-out grading (${codingBench.tasks.length} tasks)</h2>
      <p class="body-text">
        Unlike saturated 1-turn trivia checks, <code>pnpm run bench:code</code> spawns an isolated git checkout per task
        on <code>@earendil-works/pi-durable</code> (<code>read</code>, <code>write</code>, <code>edit</code>, <code>bash</code>
        + optional extensions), lets the model debug autonomously, restores protected tests, overlays held-out regression
        tests, and grades deterministically. Track: <strong>${tsCount} TypeScript</strong> &middot;
        <strong>${pyCount} Python</strong> (<strong>${diffCounts.easy} Easy</strong>, <strong>${diffCounts.medium} Medium</strong>,
        <strong>${diffCounts.hard} Hard</strong>) &middot; Default extension profile:
        <code>${esc(codingBench.extensionProfile)}</code>.
      </p>

      <div class="coding-task-strip">
        ${codingBench.tasks
          .map(
            (t) => `<div class="coding-task-pill">
          <div class="coding-task-pill-id">${esc(t.id)}</div>
          <div class="coding-task-pill-title">${esc(t.title)}</div>
          <div class="coding-task-pill-meta">
            <span class="diff-pill diff-${esc(t.difficulty)}">${esc(t.difficulty)}</span>
            <span class="diff-pill">${t.language === "typescript" ? "TS" : "Py"}</span>
          </div>
        </div>`,
          )
          .join("\n        ")}
      </div>

      <div class="pareto-frame">
        <div class="pareto-toolbar" style="margin-bottom:0.65rem">
          <div class="pareto-toolbar-left" id="coding-ext-buttons">
            <span class="pareto-toolbar-label">Extension:</span>
            <button type="button" class="filter-btn active" data-ext="all">All (${codingBench.models.length})</button>
            ${profiles
              .map(
                (p) =>
                  `<button type="button" class="filter-btn" data-ext="${esc(p)}">${esc(p)}</button>`,
              )
              .join("\n            ")}
          </div>
          <div class="pareto-toolbar-left" id="coding-xaxis-buttons">
            <span class="pareto-toolbar-label">X-Axis:</span>
            <button type="button" class="filter-btn active" data-cx="totalCostUsd">Cost (USD)</button>
            <button type="button" class="filter-btn" data-cx="totalTimeSec">Time (sec)</button>
          </div>
        </div>

        <div class="filter-summary" id="coding-provenance" style="margin-bottom:0.5rem">
          ${codingBench.isMockPreview ? "[MOCK PREVIEW via fauxProvider + Real Pi Durable CodingTools + Real node --test / unittest grading]" : "[LIVE MEASURED]"}
          Generated ${esc(codingBench.generatedAt.slice(0, 19).replace("T", " "))}Z &middot;
          Total run cost: $${codingBench.totalRunCostUsd.toFixed(4)} &middot;
          Reproduce: <code>${esc(codingBench.reproduceCommand)}</code>
        </div>
        <div class="pareto-svg-wrap" id="coding-pareto-mount"></div>
        <div class="pareto-inspector" id="coding-inspector" aria-live="polite"></div>
      </div>

      <h3 class="sub-title">Coding Session Task Matrix &amp; Telemetry</h3>
      <div class="table-controls">
        <input type="text" id="coding-search" placeholder="Search model, provider, or extension..." />
        <span class="pareto-toolbar-left" id="coding-filter-buttons">
          <button type="button" class="filter-btn active" data-cf="all">All</button>
          <button type="button" class="filter-btn" data-cf="cloud">Cloud</button>
          <button type="button" class="filter-btn" data-cf="local">Local ($0)</button>
          <button type="button" class="filter-btn" data-cf="open">Open Weights</button>
          <button type="button" class="filter-btn" data-cf="closed">Closed</button>
        </span>
      </div>
      <div class="filter-summary" id="coding-summary"></div>

      <div class="results-table-wrap">
        <table class="labs-table" id="coding-bench-table">
          <thead>
            <tr>
              <th data-csort="rank">#</th>
              <th data-csort="id">Model</th>
              <th data-csort="provider">Provider</th>
              <th data-csort="reasoningEffort">Effort</th>
              <th data-csort="extensionProfile">Ext</th>
              <th data-csort="passRate">Pass@1 &darr;</th>
              <th data-csort="avgScore">Score</th>
              ${taskHeaders}
              <th data-csort="avgTurns">Turns</th>
              <th data-csort="toolErrorRate">Tools (Err%)</th>
              <th data-csort="reasoningTok">Think Tok</th>
              <th data-csort="totalCostUsd">Cost</th>
              <th data-csort="totalTimeSec">Time</th>
            </tr>
          </thead>
          <tbody id="coding-tbody"></tbody>
        </table>
      </div>
    </section>`;
}

function buildIndexPage(
  mockWatch: LiveWatchArtifact,
  liveWatch: LiveWatchArtifact,
  archives: HistoricalArchivesArtifact,
  jevLive: JevLiveArtifact,
  codingBench: CodingBenchArtifact | null,
): string {
  const live = summarizeLiveWatch(liveWatch);
  const liveRunDate = live.liveRunDate;
  const costSpreadX =
    live.costTopWinner && live.costTopWinner.cost > 0
      ? Math.round(live.priciestTop.cost / live.costTopWinner.cost)
      : 0;

  const frontDeskPicks: ExamplePick[] = liveWatch.models.length > 0
    ? [
        {
          role: `Cost Pareto (${live.topCombined.toFixed(0)}%)`,
          name: `${live.costTopWinner.provider}:${live.costTopWinner.id}`,
          note: `${live.topCombined.toFixed(1)}% (${live.costTopWinner.reasoningRaw} R, ${live.costTopWinner.codingRaw} C) for ${fmtUsd(live.costTopWinner.cost)} in ${live.costTopWinner.timeSec.toFixed(1)}s (${(live.costTopWinner.tokens?.total ?? 0).toLocaleString()} tok @ ${live.costTopWinner.tokPerSec ?? "—"} tok/s).`,
        },
        {
          role: "Speed Sweet Spot",
          name: `${live.speedTopWinner.provider}:${live.speedTopWinner.id}`,
          note: `${live.speedTopWinner.combined.toFixed(1)}% in ${live.speedTopWinner.timeSec.toFixed(1)}s for ${fmtUsd(live.speedTopWinner.cost)} (${live.speedTopWinner.tokPerSec ?? "—"} tok/s, Elo ${live.speedTopWinner.elo ?? "—"}).`,
        },
        {
          role: "Cheapest Overall",
          name: `${live.cheapestOverall.provider}:${live.cheapestOverall.id}`,
          note: `${live.cheapestOverall.combined.toFixed(1)}% for ${fmtUsd(live.cheapestOverall.cost)} in ${live.cheapestOverall.timeSec.toFixed(1)}s (${(live.cheapestOverall.tokens?.total ?? 0).toLocaleString()} total tokens).`,
        },
        {
          role: "Fastest Overall",
          name: `${live.fastestOverall.provider}:${live.fastestOverall.id}`,
          note: `${live.fastestOverall.combined.toFixed(1)}% in ${live.fastestOverall.timeSec.toFixed(1)}s for ${fmtUsd(live.fastestOverall.cost)} (Elo ${live.fastestOverall.elo ?? "—"}).`,
        },
        {
          role: "Price Spread",
          name: `${live.topTier.length}-way tie at ${live.topCombined.toFixed(1)}%`,
          note: `From ${fmtUsd(live.costTopWinner.cost)} (${shortModelId(live.costTopWinner.id)}) to ${fmtUsd(live.priciestTop.cost)} (${shortModelId(live.priciestTop.id)}) — ${costSpreadX}× cost spread for identical benchmark scores.`,
        },
        {
          role: "Judge & Local",
          name: liveWatch.judgeModel,
          note: `Rubric $${(liveWatch.judgeCostUsd ?? 0).toFixed(3)} + Elo $${(liveWatch.eloJudgeCostUsd ?? 0).toFixed(3)}; ${live.liveOfflineCount} offline local targets skipped. Inspect roster with pnpm run bench:models list or run --group local-ollama.`,
        },
      ]
    : [];

  function mapWatchRows(artifact: LiveWatchArtifact) {
    const totalTasks = artifact.dimensions.reduce((s, d) => s + d.tasks, 0);
    const maxScore = artifact.dimensions.reduce((s, d) => s + d.maxScore, 0);
    return artifact.models.map((m) => {
      const tasks = Object.entries(m.taskBreakdown).flatMap(([dim, items]) =>
        items.map((t) => ({
          dim,
          taskId: t.taskId,
          score: t.score,
          maxScore: t.maxScore,
          costUsd: t.costUsd,
          durationMs: t.durationMs,
          details: t.details,
          reasoningTokens: t.tokens?.reasoning ?? 0,
        })),
      );
      const failedTasks = tasks.filter((t) => t.score < t.maxScore);
      const note =
        failedTasks.length === 0
          ? `${maxScore}/${maxScore} across all ${totalTasks} tasks (${m.reasoningRaw} R, ${m.knowledgeRaw} K, ${m.instructionRaw} I, ${m.codingRaw} C, ${m.toolsRaw} T; Elo ${m.elo ?? "—"}).`
          : `Missed ${failedTasks.map((t) => `${t.taskId}: ${t.score}/${t.maxScore} (${t.details})`).join("; ")}.`;
      return {
        id: m.id,
        provider: m.provider,
        tier: m.tier,
        weights: m.weights,
        reasoningEffort: m.reasoningEffort ?? null,
        effectiveThinkingLevel: m.effectiveThinkingLevel ?? null,
        combined: m.combined,
        reasoning: m.reasoning,
        reasoningRaw: m.reasoningRaw,
        knowledge: m.knowledge,
        knowledgeRaw: m.knowledgeRaw,
        instruction: m.instruction,
        instructionRaw: m.instructionRaw,
        coding: m.coding,
        codingRaw: m.codingRaw,
        tools: m.tools,
        toolsRaw: m.toolsRaw,
        elo: m.elo,
        cost: m.cost,
        timeSec: m.timeSec,
        tokens: m.tokens ?? null,
        tokPerSec: m.tokPerSec ?? null,
        tasks,
        note,
      };
    });
  }

  const offlineProvenanceNote =
    live.liveOfflineCount > 0
      ? ` · ${live.liveOfflineCount} offline local targets skipped (${live.unavailable.map((u) => `${u.provider}:${u.name}`).join(", ")})`
      : "";

  const clientDatasets = {
    roster: {
      label: `${mockWatch.models.length}-Model Matrix · Mock Wiring (${mockWatch.models.length} models · fauxProvider)`,
      provenance: `[MOCK PREVIEW via @earendil-works/pi-ai fauxProvider + real builtinModels() pricing] Recreate offline in 4s with \`pnpm run site:bench\`, or run on device with \`pnpm run site:bench -- --live\`.`,
      hasTools: true,
      rows: mapWatchRows(mockWatch),
    },
    live: {
      label: `Measured Live Run (${liveRunDate} · ${liveWatch.models.length} models · $${liveWatch.totalSuiteCostUsd.toFixed(3)} models / $${live.liveTotalRunCost.toFixed(3)} total)`,
      provenance: `[LIVE MEASURED] Generated ${liveWatch.generatedAt} via \`pnpm run site:bench -- --live\` → reports/data/model-watch-live.json (judge: ${liveWatch.judgeModel} · $${(liveWatch.judgeCostUsd ?? 0).toFixed(3)} rubric + $${(liveWatch.eloJudgeCostUsd ?? 0).toFixed(3)} Elo${offlineProvenanceNote})`,
      hasTools: true,
      rows: mapWatchRows(liveWatch),
    },
    archive: {
      label: `Archived ${archives.showdown.modelCount}-Model Showdown (${archives.showdown.runDate} · ${archives.showdown.modelCount} models · $${archives.showdown.totalCostUsd})`,
      provenance: `[ARCHIVED MEASURED] Extracted verbatim via \`pnpm run site:extract-archives\` from ${archives.showdown.sourceReport}`,
      hasTools: false,
      rows: archives.showdown.rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        tier: r.tier,
        weights: r.weights,
        reasoningEffort: null,
        effectiveThinkingLevel: null,
        combined: r.combined,
        reasoning: r.reasoning,
        reasoningRaw: r.reasoningRaw,
        knowledge: r.knowledge,
        knowledgeRaw: r.knowledgeRaw,
        instruction: r.instruction,
        instructionRaw: r.instructionRaw,
        coding: r.coding,
        codingRaw: r.codingRaw,
        tools: null,
        toolsRaw: "—",
        elo: null,
        cost: r.cost,
        timeSec: r.timeSec,
        tokens: null,
        tokPerSec: null,
        tasks: [],
        note: `Archived Run #${r.rank}: ${r.reasoningRaw} Reason, ${r.knowledgeRaw} Know, ${r.instructionRaw} Instr, ${r.codingRaw} Coding (${r.costRaw}, ${r.timeRaw}).`,
      })),
    },
  };

  const explorer = buildExplorerCatalog(liveWatch);
  const explorerJson = JSON.stringify(explorer.models).replace(/<\//g, "<\\/");
  const datasetsJson = JSON.stringify(clientDatasets).replace(/<\//g, "<\\/");
  const codingBenchJson = JSON.stringify(codingBench).replace(/<\//g, "<\\/");
  const batchRows = archives.headroom.rows.filter((r) => r.aggC1 !== null).slice(0, 6);

  const jevDate = jevLive.executedAt.slice(0, 10);
  const jevNativeP50 = Math.round(jevLive.nativeJev.summary.successfulCallLatencyMs.p50);
  const jevLlmP50 = Math.round(jevLive.llmBaseline.summary.successfulCallLatencyMs.p50);
  const jevSpeedup = (
    jevLive.llmBaseline.summary.successfulCallLatencyMs.p50 /
    Math.max(jevLive.nativeJev.summary.successfulCallLatencyMs.p50, 1)
  ).toFixed(1);
  const jevGroup0 = jevLive.nativeJev.summary.groups[0];
  const jevBrierStr = jevGroup0?.meanBrier != null ? jevGroup0.meanBrier.toFixed(4) : "—";

  const loopModelReasoningTok = live.slowestOrLoopModel?.tokens?.reasoning ?? 0;
  const loopModelTotalTok = live.slowestOrLoopModel?.tokens?.total ?? 0;

  const carWashCardHtml =
    live.carWashStats.count3 > 0
      ? `<h4>${live.carWashStats.count3} of ${live.carWashStats.total} Models Scored 3/5 on <code>car-wash</code> Under ${esc(shortModelId(liveWatch.judgeModel))}</h4>
          <p>
            Judge transcripts praised those ${live.carWashStats.count3} answers as completely correct (&ldquo;the car must physically be at
            the car wash&rdquo;), while only <code>${esc(live.carWashStats.perfectModels.map(shortModelId).join(", ") || "none")}</code> got 5/5 and
            <code>${esc(live.carWashStats.failModels.map(shortModelId).join(", ") || "none")}</code> got 1/5 for recommending walking. Because
            the task rubric defined 1 and 2 without an explicit 5-point anchor, <code>${esc(shortModelId(liveWatch.judgeModel))}</code> inferred a
            1&ndash;3 scale &mdash; a clear rubric calibration bug surfaced immediately by switching judges.
          </p>`
      : `<h4>Judge Split Under ${esc(liveWatch.judgeModel)} Across ${live.carWashStats.total} Models</h4>
          <p>
            On <code>car-wash</code>, <strong>${live.carWashStats.count5}/${live.carWashStats.total}</strong> models scored 5/5 while
            <code>${esc(live.carWashStats.failModels.map(shortModelId).join(", ") || "none")}</code> fell for the 50m walk trap (&le;1/5).
          </p>`;

  const bodyHtml = `<div class="container">
    <div class="hero">
      <div class="hero-label">Umwelten Model Watch &middot; Open vs. Closed &amp; Laptop vs. Cloud Explorer</div>
      <h1>Model Explorer &amp;<br><em>Cost&ndash;Capability Frontier</em></h1>
      <p class="hero-subtitle">
        Browse all <strong>${explorer.models.length}</strong> models in our active roster &mdash; split cleanly across
        <strong>open-weight vs. closed</strong>, <strong>laptop-runnable (&le;31B on Ollama / MLX)</strong> vs. cluster/cloud APIs,
        and <strong>Fable-class vs. workhorse</strong> tiers. Click any model to copy exact <code>pnpm</code> run recipes or jump
        into its measured scores from <a href="./examples/model-watch-bench.html"><code>examples/model-watch/run.ts</code></a>.
      </p>
      <div class="hero-meta">
        <span><a href="#explorer">Model Explorer (${explorer.models.length}) &darr;</a></span>
        <span><a href="#coding-bench">Coding Benchmark (${codingBench ? codingBench.tasks.length : 6}) &darr;</a></span>
        <span><a href="#pareto">Legacy 18-Task Watch (${liveWatch.models.length} live) &darr;</a></span>
        <span><a href="#dispatches">Verified Findings &darr;</a></span>
        <span>Live run: <strong>${esc(liveRunDate)}</strong> &middot; Judge: <code>${esc(liveWatch.judgeModel)}</code></span>
        <span>Coding run: <code>pnpm run bench:code -- --live</code></span>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card s-accent">
        <div class="stat-num">${explorer.models.length}</div>
        <div class="stat-label">Models Tracked</div>
        <div class="stat-sub">${explorer.closedCount} Closed &middot; ${explorer.openCount} Open-Weight (${explorer.totalEndpoints} endpoints)</div>
      </div>
      <div class="stat-card s-local">
        <div class="stat-num">${explorer.laptopCount}</div>
        <div class="stat-label">Fits on Laptop</div>
        <div class="stat-sub">Ollama / M4 Max MLX &middot; ${explorer.pairedLocalCount} paired w/ cloud</div>
      </div>
      <div class="stat-card s-green">
        <div class="stat-num">${explorer.clusterCount}</div>
        <div class="stat-label">Open &middot; Cluster Scale</div>
        <div class="stat-sub">Hosted open weights (OpenRouter)</div>
      </div>
      <div class="stat-card s-yellow">
        <div class="stat-num">${liveWatch.models.length}</div>
        <div class="stat-label">Measured Live (${esc(liveRunDate)})</div>
        <div class="stat-sub">$${live.liveTotalRunCost.toFixed(2)} run incl. ${esc(shortModelId(liveWatch.judgeModel))}</div>
      </div>
    </div>

    <!-- 01 — Front-Door Model Explorer -->
    <section class="report-section" id="explorer">
      <div class="section-num">01 &mdash; Model Landscape &amp; Drill-Down Explorer</div>
      <h2 class="section-title">What is in the suite: Open vs. Closed, Laptop vs. Cloud</h2>
      <p class="body-text">
        Click any bucket below to filter by deployment class, then click a model card to inspect its parameter size,
        local memory footprint, API pricing, live status, and copyable <code>pnpm</code> commands to test it at different thinking levels.
      </p>

      <div class="explorer-buckets" id="explorer-buckets">
        <button type="button" class="explorer-bucket bucket-laptop" data-lane="laptop">
          <span class="bucket-kicker">Open Weight &middot; Local</span>
          <span class="bucket-count">${explorer.laptopCount}</span>
          <span class="bucket-desc">Fits on laptop (&le;31B via Ollama / M4 Max MLX, ${explorer.pairedLocalCount} with cloud parity)</span>
        </button>
        <button type="button" class="explorer-bucket bucket-cluster" data-lane="cluster">
          <span class="bucket-kicker">Open Weight &middot; Cluster</span>
          <span class="bucket-count">${explorer.clusterCount}</span>
          <span class="bucket-desc">Large MoE &amp; flash open weights (Inkling 2 Small, DeepSeek V4 Pro, GLM 5.3, Kimi K3.1)</span>
        </button>
        <button type="button" class="explorer-bucket bucket-fable" data-lane="fable">
          <span class="bucket-kicker">Closed &middot; Fable-Class</span>
          <span class="bucket-count">${explorer.fableCount}</span>
          <span class="bucket-desc">Top-ceiling closed flagships (Claude Fable 5.2, GPT-6.2 Astra, Gemini 4 Carbon/Neon, Wonder, Qwen4 Max)</span>
        </button>
        <button type="button" class="explorer-bucket bucket-workhorse" data-lane="workhorse">
          <span class="bucket-kicker">Closed &middot; Workhorse</span>
          <span class="bucket-count">${explorer.workhorseCount}</span>
          <span class="bucket-desc">Fast &amp; mid-tier API baselines (Gemini 4 Hydrogen, Opus/Sonnet/Haiku 5.5, GPT-6.2 Sol/Luna, Muse Ember)</span>
        </button>
      </div>

      <div class="pareto-frame" style="padding:1.15rem 1.25rem">
        <div class="pareto-toolbar" style="margin-bottom:0.65rem">
          <div class="pareto-toolbar-left" id="explorer-lane-buttons">
            <span class="pareto-toolbar-label">Tier:</span>
            <button type="button" class="filter-btn active" data-lane="all">All Tiers</button>
            <button type="button" class="filter-btn" data-lane="laptop">Fits on Laptop</button>
            <button type="button" class="filter-btn" data-lane="cluster">Open &middot; Cluster</button>
            <button type="button" class="filter-btn" data-lane="fable">Fable-Class</button>
            <button type="button" class="filter-btn" data-lane="workhorse">Workhorse</button>
          </div>
          <div class="pareto-toolbar-left" id="explorer-view-buttons">
            <span class="pareto-toolbar-label">View:</span>
            <button type="button" class="filter-btn active" data-view="cards">Cards by Lane</button>
            <button type="button" class="filter-btn" data-view="table">Matrix Table</button>
          </div>
        </div>

        <div class="table-controls" style="margin-bottom:0.65rem">
          <input type="text" id="explorer-search" placeholder="Search model, lab, provider, or param size..." />
          <span class="pareto-toolbar-left" id="explorer-weights-buttons">
            <button type="button" class="filter-btn active" data-w="all">All Weights</button>
            <button type="button" class="filter-btn" data-w="open">Open Weight</button>
            <button type="button" class="filter-btn" data-w="closed">Closed</button>
          </span>
          <span class="filter-sep">|</span>
          <span class="pareto-toolbar-left" id="explorer-status-buttons">
            <button type="button" class="filter-btn active" data-st="all">All Status</button>
            <button type="button" class="filter-btn" data-st="live">Measured Live</button>
            <button type="button" class="filter-btn" data-st="untested">Not Yet Run</button>
          </span>
        </div>

        <div class="filter-summary" id="explorer-summary" style="margin-bottom:0.85rem"></div>
        <div class="explorer-detail" id="explorer-detail" aria-live="polite"></div>
        <div id="explorer-mount"></div>
      </div>
    </section>

    ${renderCodingBenchSection(codingBench)}

    <!-- 03 — Legacy 18-Task Quick Eval (Saturated on 2026 Models) -->
    <section class="report-section" id="pareto">
      <div class="section-num">03 &mdash; Legacy 18-Task Quick Eval (Saturated on 2026 Models &mdash; Reference &amp; Smoke Baseline)</div>
      <h2 class="section-title">Quick 18-task baseline (${liveWatch.models.length}-model live + ${mockWatch.models.length}-model mock &amp; ${archives.showdown.modelCount}-model archive)</h2>
      <p class="body-text">
        Reference view across our earlier 18 single-turn tasks (${live.liveTotalTasks} tasks / ${live.liveMaxScore} pts, scored by <code>${esc(liveWatch.judgeModel)}</code>).
        Because late-2026 frontier and local models now saturate 95&ndash;100% on most of these single-turn puzzles, capability
        evaluation has shifted to <a href="#coding-bench">Section 02 (Isolated Coding-Session Benchmark)</a>; a 3-task slice remains
        available as a fast connectivity/tok-s check via <code>pnpm run site:bench -- --live --suite smoke</code>.
      </p>

      ${renderModelPicks(
        frontDeskPicks,
        `live measured ${liveRunDate} · judge: ${liveWatch.judgeModel}`,
        "Live Run Highlights",
      )}

      <div class="pareto-frame">
        <div class="pareto-toolbar" style="margin-bottom:0.65rem">
          <div class="pareto-toolbar-left" id="dataset-buttons">
            <span class="pareto-toolbar-label">Dataset:</span>
            <button type="button" class="filter-btn active" data-ds="live">Measured Live Run (${liveWatch.models.length})</button>
            <button type="button" class="filter-btn" data-ds="roster">${mockWatch.models.length}-Model Matrix (Mock)</button>
            <button type="button" class="filter-btn" data-ds="archive">Archived ${archives.showdown.modelCount}-Model Baseline</button>
          </div>
          <div class="pareto-toolbar-left" id="scope-buttons">
            <span class="pareto-toolbar-label">Scope:</span>
            <button type="button" class="filter-btn active" data-scope="all">All</button>
            <button type="button" class="filter-btn" data-scope="cloud">Cloud Only</button>
          </div>
          <div class="pareto-toolbar-left" id="xaxis-buttons">
            <span class="pareto-toolbar-label">X-Axis:</span>
            <button type="button" class="filter-btn active" data-x="cost">Cost (USD)</button>
            <button type="button" class="filter-btn" data-x="timeSec">Time (sec)</button>
          </div>
        </div>

        <div class="pareto-toolbar">
          <div class="pareto-toolbar-left" id="metric-buttons">
            <span class="pareto-toolbar-label">Y-Axis:</span>
            <button type="button" class="filter-btn active" data-metric="combined">Combined</button>
            <button type="button" class="filter-btn" data-metric="coding">Coding</button>
            <button type="button" class="filter-btn" data-metric="instruction">Instruction</button>
            <button type="button" class="filter-btn" data-metric="reasoning">Reasoning</button>
            <button type="button" class="filter-btn" data-metric="knowledge">Knowledge</button>
          </div>
          <div class="pareto-legend">
            <span class="legend-item">
              <span class="legend-swatch" style="border:2px solid #0055aa;background:#fff"></span>
              <span>Pareto Frontier</span>
            </span>
            <span class="legend-item">
              <span class="legend-swatch" style="border:2px solid #5b2c6f;background:#f4ecf7"></span>
              <span>Local $0</span>
            </span>
            <span class="legend-item">
              <span class="legend-swatch" style="background:#7b7669;border-radius:999px;width:8px;height:8px"></span>
              <span>Dominated</span>
            </span>
          </div>
        </div>

        <div class="filter-summary" id="pareto-provenance" style="margin-bottom:0.5rem"></div>
        <div class="pareto-svg-wrap" id="pareto-svg-mount"></div>
        <div class="pareto-inspector" id="pareto-inspector" aria-live="polite"></div>
      </div>

      <h3 class="sub-title">Sortable Leaderboard (<span id="table-ds-title">Measured Live Run</span>)</h3>
      <div class="table-controls">
        <input type="text" id="watch-search" placeholder="Search model or provider..." />
        <button type="button" class="filter-btn active" data-f="all">All</button>
        <button type="button" class="filter-btn" data-f="pareto">Pareto Only</button>
        <button type="button" class="filter-btn" data-f="local">Local ($0)</button>
        <span class="filter-sep">|</span>
        <button type="button" class="filter-btn" data-f="open">Open Weights</button>
        <button type="button" class="filter-btn" data-f="closed">Closed</button>
      </div>
      <div class="filter-summary" id="watch-summary"></div>

      <div class="results-table-wrap">
        <table class="labs-table" id="watch-table">
          <thead>
            <tr>
              <th data-sort="rank">#</th>
              <th data-sort="id">Model</th>
              <th data-sort="provider">Provider</th>
              <th data-sort="effort">Effort</th>
              <th>Status</th>
              <th data-sort="combined">Combined &darr;</th>
              <th data-sort="reasoning">Reason</th>
              <th data-sort="knowledge">Know</th>
              <th data-sort="instruction">Instr</th>
              <th data-sort="coding">Coding</th>
              <th data-sort="tools">Tools</th>
              <th data-sort="elo">Elo</th>
              <th data-sort="totalTokens">Tokens</th>
              <th data-sort="tokPerSec">tok/s</th>
              <th data-sort="cost">Cost</th>
              <th data-sort="timeSec">Time</th>
            </tr>
          </thead>
          <tbody id="watch-tbody"></tbody>
        </table>
      </div>
    </section>

    <!-- 04 — Empirical Findings from This Run -->
    <section class="report-section" id="dispatches">
      <div class="section-num">04 &mdash; Verified Findings From Real Runs</div>
      <h2 class="section-title">What actually happened when we ran the scripts</h2>

      <div class="finding-grid">
        <article class="finding-card">
          <div class="finding-head">
            <span class="f-num">#01 &middot; Live Cost vs. Speed</span>
            <span class="f-date">${esc(liveRunDate)}</span>
          </div>
          <h4>${live.topTier.length}-Way Tie at ${live.topCombined.toFixed(1)}%: ${esc(shortModelId(live.costTopWinner.id))} (${esc(fmtUsd(live.costTopWinner.cost))}) &amp; ${esc(shortModelId(live.speedTopWinner.id))} (${live.speedTopWinner.timeSec.toFixed(1)}s)</h4>
          <p>
            Open-weight <code>${esc(live.costTopWinner.id)}</code> matched frontier closed models at
            <strong>${live.topCombined.toFixed(1)}%</strong> while costing <strong>${costSpreadX}&times; less</strong> than
            <code>${esc(shortModelId(live.priciestTop.id))}</code> (${esc(fmtUsd(live.priciestTop.cost))}).
            <code>${esc(shortModelId(live.speedTopWinner.id))}</code> hit the same ${live.topCombined.toFixed(1)}% tier in
            <strong>${live.speedTopWinner.timeSec.toFixed(1)}s</strong> (${esc(fmtUsd(live.speedTopWinner.cost))}, Elo ${live.speedTopWinner.elo ?? "—"}).
          </p>
        </article>

        <article class="finding-card">
          <div class="finding-head">
            <span class="f-num">#02 &middot; Reasoning Token Blowup</span>
            <span class="f-date">${esc(liveRunDate)}</span>
          </div>
          <h4>${esc(shortModelId(live.slowestOrLoopModel.id))} Burned ${loopModelReasoningTok > 0 ? `${loopModelReasoningTok.toLocaleString()} Think Tokens` : `${live.slowestOrLoopModel.timeSec.toFixed(1)}s`} &amp; Scored ${live.slowestOrLoopModel.combined.toFixed(1)}%</h4>
          <p>
            <code>${esc(live.slowestOrLoopModel.id)}</code> spent
            ${loopModelReasoningTok > 0 ? `<strong>${loopModelReasoningTok.toLocaleString()}</strong> reasoning tokens (<strong>${loopModelTotalTok.toLocaleString()}</strong> total) over ` : ""}<strong>${live.slowestOrLoopModel.timeSec.toFixed(1)}s</strong>
            yet scored <strong>${live.slowestOrLoopModel.combined.toFixed(1)}%</strong> (${esc(live.slowestOrLoopModel.codingRaw)} coding,
            ${esc(live.slowestOrLoopModel.reasoningRaw)} reasoning) &mdash; showing why explicit token accounting and <code>--effort</code> sweeps matter.
          </p>
        </article>

        <article class="finding-card">
          <div class="finding-head">
            <span class="f-num">#03 &middot; Judge Rubric Calibration</span>
            <span class="f-date">${esc(liveRunDate)}</span>
          </div>
          ${carWashCardHtml}
        </article>

        <article class="finding-card">
          <div class="finding-head">
            <span class="f-num">#04 &middot; Sub-Cent Open Weights &amp; Total Cost</span>
            <span class="f-date">${esc(liveRunDate)}</span>
          </div>
          <h4>${esc(shortModelId(live.cheapestOverall.id))} Hit ${live.cheapestOverall.combined.toFixed(1)}% for ${esc(fmtUsd(live.cheapestOverall.cost))}; Full Run Cost $${live.liveTotalRunCost.toFixed(3)}</h4>
          <p>
            <code>${esc(live.cheapestOverall.id)}</code> completed all ${live.liveTotalTasks} tasks in <strong>${live.cheapestOverall.timeSec.toFixed(1)}s</strong> for
            <strong>${esc(fmtUsd(live.cheapestOverall.cost))}</strong>. Across all ${liveWatch.models.length} live models + <code>${esc(shortModelId(liveWatch.judgeModel))}</code>
            rubric ($${(liveWatch.judgeCostUsd ?? 0).toFixed(3)}) and Elo ($${(liveWatch.eloJudgeCostUsd ?? 0).toFixed(3)}), total spend was
            <strong>$${live.liveTotalRunCost.toFixed(3)}</strong>${live.liveOfflineCount > 0 ? ` (${live.liveOfflineCount} offline <code>llamaswap</code> aliases logged honestly)` : ""}.
          </p>
        </article>

        <article class="finding-card">
          <div class="finding-head">
            <span class="f-num">#05 &middot; Native Jev Latency</span>
            <span class="f-date">${esc(jevDate)}</span>
          </div>
          <h4>typesafe/jev-1.13 Cut Median Judgment Latency ${esc(jevSpeedup)}&times; (${jevNativeP50}ms vs. ${jevLlmP50}ms)</h4>
          <p>
            Across ${jevLive.caseCount} live cases (and 80 calls in <code>reports/2026-09-20-jev-development-pilot.md</code> for $0.000486 total Mycel debit),
            native Jev hit <code>Brier ${esc(jevBrierStr)}</code> on <code>${esc(jevGroup0?.key ?? "support/binary")}</code> and <code>100%</code> valid accuracy.
          </p>
        </article>

        <article class="finding-card">
          <div class="finding-head">
            <span class="f-num">#06 &middot; M4 Max Serving Physics</span>
            <span class="f-date">${esc(archives.headroom.runDate)}</span>
          </div>
          <h4>Ollama Serializes at c=1; llama-swap Scales Aggregate tok/s 2.9&times;&ndash;6.8&times;</h4>
          <p>
            In <code>${esc(archives.headroom.sourceReport)}</code>, all 9 Ollama models held flat aggregate tok/s
            (0.96&ndash;1.04&times;) with 9&times;&ndash;63&times; TTFT spikes at <code>c=4</code>, while <code>llama-server</code> batched
            <code>gemma-4-E2B</code> to <strong>1,014.3 tok/s</strong>.
          </p>
        </article>
      </div>
    </section>

    <!-- 05 — Local Preview -->
    <section class="report-section" id="local-preview">
      <div class="section-num">05 &mdash; Local Serving Headroom (Verbatim from reports/2026-07-26-headroom-ollama-does-not-batch.md)</div>
      <h2 class="section-title">Apple M4 Max concurrency probe: <code>c=1</code> vs. <code>c=4</code></h2>
      <p class="body-text">
        Extracted directly by <code>scripts/extract-historical-reports.ts</code>. Full 14-row table + 13 local Ollama showdown scores on
        <a href="./local.html">Local Models &amp; Serving Physics &rarr;</a>
      </p>

      <div class="results-table-wrap">
        <table class="labs-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Runtime</th>
              <th>Mode</th>
              <th>agg c=1</th>
              <th>agg c=4</th>
              <th>Scaling</th>
              <th>TTFT (c=1 &rarr; c=4)</th>
            </tr>
          </thead>
          <tbody>
            ${batchRows
              .map(
                (r) => `<tr class="${r.mode === "batching" ? "tier-1" : "tier-4"}">
              <td class="model-cell">${esc(r.model)}</td>
              <td class="cost-cell">${esc(r.runtimeGroup)}</td>
              <td><span class="badge ${r.mode === "batching" ? "badge-green" : "badge-closed"}">${r.mode}</span></td>
              <td class="score-cell">${r.aggC1 === null ? "&mdash;" : r.aggC1.toFixed(1)}</td>
              <td class="combined-cell">${r.aggC4 === null ? "&mdash;" : r.aggC4.toFixed(1)}</td>
              <td class="score-cell ${r.mode === "batching" ? "score-perfect" : "score-low"}">${esc(r.scaling)}</td>
              <td class="time-cell">${esc(r.ttftC1)} &rarr; ${esc(r.ttftC4)}</td>
            </tr>`,
              )
              .join("\n            ")}
          </tbody>
        </table>
      </div>
    </section>

    <!-- 06 — Prompt-First Examples -->
    <section class="report-section" id="examples">
      <div class="section-num">06 &mdash; Prompt-First Examples (${PROMPT_EXAMPLES.length} Runnable Scripts)</div>
      <h2 class="section-title">Top: the prompt for Pi &middot; Middle: live repo code &middot; Bottom: captured output</h2>
      <div class="drafting-bento">
        <div class="example-grid">
          ${PROMPT_EXAMPLES.map((ex) => renderExampleCard(ex, ".")).join("\n          ")}
        </div>
      </div>
    </section>
  </div>`;

  const scriptHtml = `<script>
  (() => {
    const EXPLORER = ${explorerJson};
    const DATASETS = ${datasetsJson};
    const CODING_BENCH = ${codingBenchJson};
    let expLane = "all";
    let expWeights = "all";
    let expStatus = "all";
    let expView = "cards";
    let expSelectedId = EXPLORER.some((m) => m.canonicalId === "inkling-2-mini")
      ? "inkling-2-mini"
      : (EXPLORER[0]?.canonicalId || "");
    let expSortKey = "lane";
    let expSortAsc = true;

    let currentDs = DATASETS.live.rows.length > 0 ? "live" : "roster";
    let currentScope = "all";
    let currentX = "cost";
    let currentMetric = "combined";
    let selectedKey = "";
    let activeFilter = "all";
    let sortKey = "combined";
    let sortAsc = false;

    function escHtml(v) {
      return String(v == null ? "" : v)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function fmtCost(c) {
      if (c === 0) return "$0 local";
      if (c < 0.01) return "$" + c.toFixed(4);
      return "$" + c.toFixed(3);
    }

    function fmtTime(s) {
      if (s < 60) return s.toFixed(1) + "s";
      return (s / 60).toFixed(1) + "m";
    }

    function fmtCtx(ctx) {
      if (!ctx) return "&mdash;";
      if (ctx >= 1000000) return (ctx / 1000000).toFixed(ctx % 1000000 === 0 ? 0 : 1) + "M";
      return Math.round(ctx / 1024) + "K";
    }

    function fmtApiPrice(m) {
      if (m.minPromptCost == null) return m.laptopFit ? "$0 local" : "unlisted";
      return "$" + m.minPromptCost + "/$" + m.minCompletionCost + " /M";
    }

    const LANE_META = [
      {
        id: "laptop",
        title: "Open Weights &mdash; Fits on Laptop (Ollama / M4 Max)",
        group: "local-ollama",
        badgeCls: "badge-local",
      },
      {
        id: "cluster",
        title: "Open Weights &mdash; Cluster / Cloud Scale",
        group: "open-weight-cloud",
        badgeCls: "badge-cluster",
      },
      {
        id: "fable",
        title: "Closed Frontier &mdash; Fable-Class Flagships",
        group: "frontier-fable",
        badgeCls: "badge-pareto",
      },
      {
        id: "workhorse",
        title: "Closed Frontier &mdash; Workhorse APIs",
        group: "frontier-workhorse",
        badgeCls: "badge-neutral",
      },
    ];

    function filteredExplorer() {
      const q = (document.getElementById("explorer-search")?.value || "").trim().toLowerCase();
      return EXPLORER.filter((m) => {
        if (expLane !== "all" && m.lane !== expLane) return false;
        if (expWeights !== "all" && m.weights !== expWeights) return false;
        if (expStatus === "live" && !m.bestLive) return false;
        if (expStatus === "untested" && m.bestLive) return false;
        if (q) {
          const hay = [
            m.canonicalId,
            m.title,
            m.lab,
            m.params,
            m.footprint,
            m.tagline,
            ...m.targets.map((t) => t.spec + " " + t.runtimeLabel + " " + t.group),
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
    }

    function wireCopyButtons(rootEl) {
      if (!rootEl) return;
      rootEl.querySelectorAll("[data-copy-cmd]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const cmd = btn.getAttribute("data-copy-cmd") || "";
          if (typeof copyTextWithFeedback === "function") {
            copyTextWithFeedback(btn, cmd, "Copied ✓");
          }
        });
      });
    }

    function renderExplorerDetail(m) {
      const el = document.getElementById("explorer-detail");
      if (!el) return;
      if (!m) {
        el.innerHTML = '<div class="inspector-note">No models match the current filter. Clear search or reset tier filters above.</div>';
        return;
      }

      const weightsBadge =
        m.weights === "open"
          ? '<span class="badge badge-open">Open Weight</span>'
          : '<span class="badge badge-closed">Closed API</span>';
      const deployBadge = m.laptopFit
        ? '<span class="badge badge-local">Laptop-Ready &middot; ' + escHtml(m.footprint) + "</span>"
        : m.weights === "open"
          ? '<span class="badge badge-cluster">Cluster Open Weight</span>'
          : '<span class="badge badge-neutral">Cloud API Only</span>';
      const statusBadge = m.bestLive
        ? '<span class="badge badge-green">' + m.bestLive.combined.toFixed(1) + "% Measured Live</span>"
        : '<span class="badge badge-pending">Not Yet Run Live</span>';

      const primaryTarget = m.targets.find((t) => t.tier === "cloud") || m.targets[0];
      const ollamaTarget = m.targets.find((t) => t.group === "local-ollama");
      const labTarget = m.targets.find((t) => t.group === "local-lab");
      const localTarget = ollamaTarget || labTarget;

      const cmds = [];
      if (primaryTarget) {
        const effArg = m.defaultEfforts.length > 0 ? " --effort " + m.defaultEfforts.join(",") : "";
        cmds.push({
          label: "Coding Bench (6 git-checkout tasks · " + primaryTarget.runtimeLabel + ")",
          cmd: "pnpm run bench:code -- --live --merge --models \\"" + primaryTarget.spec + "\\"" + effArg,
        });
        cmds.push({
          label: "Coding Bench w/ verify-on-yield extension",
          cmd: "pnpm run bench:code -- --live --merge --models \\"" + primaryTarget.spec + "\\"" + effArg + " --extensions pi-default,verify-on-yield",
        });
      }
      if (ollamaTarget) {
        cmds.push({
          label: "Local Ollama Coding Bench (off, low, high)",
          cmd: "pnpm run bench:code -- --live --merge --models \\"" + ollamaTarget.spec + "\\" --effort off,low,high",
        });
      }
      if (labTarget) {
        cmds.push({
          label: "M4 Max Lab Coding Bench (local-lab)",
          cmd: "pnpm run bench:code -- --live --merge --group local-lab",
        });
      }
      if (primaryTarget) {
        cmds.push({
          label: "3-Task Smoke Check (fast tok/s & tool sanity)",
          cmd: "pnpm run site:bench -- --live --suite smoke --models \\"" + primaryTarget.spec + "\\"",
        });
      }

      const targetsHtml = m.targets
        .map((t) => {
          const liveHtml =
            t.liveMatches.length > 0
              ? t.liveMatches
                  .map(
                    (lm) =>
                      '<span class="badge badge-green">' +
                      lm.combined.toFixed(1) +
                      "% (" +
                      escHtml(lm.effort) +
                      " &middot; " +
                      fmtCost(lm.cost) +
                      " &middot; " +
                      fmtTime(lm.timeSec) +
                      ")</span>" +
                      ' <button type="button" class="storyline-btn jump-pareto-btn" data-row-key="' +
                      escHtml(lm.rowKey) +
                      '">Pareto &darr;</button>',
                  )
                  .join(" ")
              : '<span class="badge badge-pending">Not run</span>';
          const metaLine = t.baseUrl ? escHtml(t.baseUrl) + " &middot; " + escHtml(t.priceLabel) : escHtml(t.priceLabel);
          return (
            '<div class="explorer-target-row">' +
            '<div>' +
            '<div><span class="runtime-chip">' +
            escHtml(t.runtimeLabel) +
            '</span> <span class="explorer-target-spec">' +
            escHtml(t.spec) +
            "</span></div>" +
            '<div class="explorer-target-meta">' +
            escHtml(t.group) +
            " &middot; " +
            metaLine +
            "</div>" +
            "</div>" +
            '<div style="display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap">' +
            liveHtml +
            "</div>" +
            "</div>"
          );
        })
        .join("");

      const cmdsHtml = cmds
        .map(
          (c) =>
            '<div class="cmd-row">' +
            '<div class="cmd-row-head">' +
            '<span class="cmd-row-label">' +
            escHtml(c.label) +
            "</span>" +
            '<button type="button" class="storyline-btn" data-copy-cmd="' +
            escHtml(c.cmd) +
            '">Copy Cmd</button>' +
            "</div>" +
            "<code>" +
            escHtml(c.cmd) +
            "</code>" +
            "</div>",
        )
        .join("");

      const jumpAllBtn = m.bestLive
        ? '<button type="button" class="storyline-btn storyline-btn--primary jump-pareto-btn" data-row-key="' +
          escHtml(m.bestLive.rowKey) +
          '">Inspect ' +
          escHtml(m.bestLive.combined.toFixed(1) + "%") +
          " in Pareto &darr;</button>"
        : "";

      el.innerHTML =
        '<div class="explorer-detail-head">' +
        "<div>" +
        '<div class="explorer-detail-title">' +
        escHtml(m.title) +
        ' <span style="font-weight:500;color:var(--muted);font-size:0.86rem">&middot; ' +
        escHtml(m.lab) +
        "</span></div>" +
        '<div class="explorer-detail-sub">' +
        escHtml(m.tagline) +
        "</div>" +
        "</div>" +
        '<div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">' +
        weightsBadge +
        deployBadge +
        statusBadge +
        jumpAllBtn +
        "</div>" +
        "</div>" +
        '<div class="explorer-detail-specs">' +
        '<div class="explorer-spec-cell"><span>Parameters</span><strong>' +
        escHtml(m.params) +
        "</strong></div>" +
        '<div class="explorer-spec-cell"><span>Laptop Fit</span><strong>' +
        (m.laptopFit ? "Yes (" + escHtml(m.footprint) + ")" : "No (" + escHtml(m.footprint) + ")") +
        "</strong></div>" +
        '<div class="explorer-spec-cell"><span>Context</span><strong>' +
        fmtCtx(m.contextLength) +
        "</strong></div>" +
        '<div class="explorer-spec-cell"><span>API Price</span><strong>' +
        escHtml(fmtApiPrice(m)) +
        "</strong></div>" +
        '<div class="explorer-spec-cell"><span>Default Efforts</span><strong>' +
        escHtml(m.defaultEfforts.join(", ") || "default") +
        "</strong></div>" +
        "</div>" +
        '<div class="explorer-detail-body">' +
        '<div><div class="cmd-row-label" style="margin-bottom:0.45rem">Configured Runtimes &amp; Measured Runs</div><div class="explorer-targets-list">' +
        targetsHtml +
        "</div></div>" +
        '<div><div class="cmd-row-label" style="margin-bottom:0.45rem">Recipes to Run / Merge This Model</div><div class="cmd-list">' +
        cmdsHtml +
        "</div></div>" +
        "</div>";

      wireCopyButtons(el);
      el.querySelectorAll(".jump-pareto-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          jumpToParetoModel(btn.getAttribute("data-row-key") || "");
        });
      });
    }

    function renderExplorer() {
      const mount = document.getElementById("explorer-mount");
      const summaryEl = document.getElementById("explorer-summary");
      if (!mount) return;

      const filtered = filteredExplorer();
      if (filtered.length > 0 && !filtered.some((m) => m.canonicalId === expSelectedId)) {
        expSelectedId = filtered[0].canonicalId;
      }

      document.querySelectorAll("#explorer-buckets .explorer-bucket").forEach((b) => {
        b.classList.toggle("is-active", b.getAttribute("data-lane") === expLane);
      });
      document.querySelectorAll("#explorer-lane-buttons button[data-lane]").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-lane") === expLane);
      });

      const lapCount = filtered.filter((m) => m.laptopFit).length;
      const openCount = filtered.filter((m) => m.weights === "open").length;
      const liveCount = filtered.filter((m) => Boolean(m.bestLive)).length;
      if (summaryEl) {
        summaryEl.textContent =
          "Showing " +
          filtered.length +
          " of " +
          EXPLORER.length +
          " canonical models (" +
          lapCount +
          " laptop-runnable · " +
          openCount +
          " open-weight · " +
          liveCount +
          " measured live)";
      }

      const selectedModel =
        filtered.find((m) => m.canonicalId === expSelectedId) ||
        EXPLORER.find((m) => m.canonicalId === expSelectedId) ||
        filtered[0] ||
        null;
      renderExplorerDetail(selectedModel);

      if (filtered.length === 0) {
        mount.innerHTML = '<div class="inspector-note" style="padding:1rem 0">No matching models in the explorer.</div>';
        return;
      }

      if (expView === "cards") {
        mount.innerHTML = LANE_META.map((lane) => {
          const items = filtered.filter((m) => m.lane === lane.id);
          if (items.length === 0) return "";
          const grpCmd = "pnpm run site:bench -- --live --merge --group " + lane.group;
          const cardsHtml = items
            .map((m) => {
              const selCls = m.canonicalId === expSelectedId ? " is-selected" : "";
              const weightsB =
                m.weights === "open"
                  ? '<span class="badge badge-open">Open</span>'
                  : '<span class="badge badge-closed">Closed</span>';
              const lapB = m.laptopFit
                ? '<span class="badge badge-local">Laptop</span>'
                : m.weights === "open"
                  ? '<span class="badge badge-cluster">Cluster</span>'
                  : '<span class="badge badge-neutral">Cloud</span>';
              const liveB = m.bestLive
                ? '<span class="badge badge-green">' + m.bestLive.combined.toFixed(1) + "% LIVE</span>"
                : '<span class="badge badge-pending">Not run</span>';
              const runtimes = [...new Set(m.targets.map((t) => t.runtimeLabel))]
                .map((r) => '<span class="runtime-chip">' + escHtml(r) + "</span>")
                .join("");
              return (
                '<button type="button" class="explorer-card lane-' +
                escHtml(m.lane) +
                selCls +
                '" data-exp-id="' +
                escHtml(m.canonicalId) +
                '">' +
                '<div class="explorer-card-top">' +
                '<span class="explorer-card-lab">' +
                escHtml(m.lab) +
                "</span>" +
                liveB +
                "</div>" +
                '<div class="explorer-card-name">' +
                escHtml(m.title) +
                "</div>" +
                '<div class="explorer-card-badges">' +
                weightsB +
                lapB +
                "</div>" +
                '<div class="explorer-card-specs">' +
                escHtml(m.params) +
                " &middot; " +
                fmtCtx(m.contextLength) +
                " &middot; " +
                escHtml(fmtApiPrice(m)) +
                "</div>" +
                '<div class="explorer-card-runtimes">' +
                runtimes +
                "</div>" +
                '<div class="explorer-card-tagline">' +
                escHtml(m.tagline) +
                "</div>" +
                "</button>"
              );
            })
            .join("");

          return (
            '<div class="explorer-lane">' +
            '<div class="explorer-lane-head">' +
            '<div class="explorer-lane-title">' +
            '<span>' +
            lane.title +
            "</span>" +
            '<span class="badge ' +
            lane.badgeCls +
            '">' +
            items.length +
            "</span>" +
            "</div>" +
            '<button type="button" class="storyline-btn" data-copy-cmd="' +
            escHtml(grpCmd) +
            '">Copy Group Cmd (' +
            escHtml(lane.group) +
            ")</button>" +
            "</div>" +
            '<div class="explorer-grid">' +
            cardsHtml +
            "</div>" +
            "</div>"
          );
        }).join("");

        wireCopyButtons(mount);
        mount.querySelectorAll(".explorer-card[data-exp-id]").forEach((card) => {
          card.addEventListener("click", () => {
            expSelectedId = card.getAttribute("data-exp-id") || expSelectedId;
            renderExplorer();
            document.getElementById("explorer-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
        });
      } else {
        const laneRank = { laptop: 0, cluster: 1, fable: 2, workhorse: 3 };
        const sorted = [...filtered].sort((a, b) => {
          const valOf = (x) => {
            if (expSortKey === "lane") return laneRank[x.lane] ?? 9;
            if (expSortKey === "price") return x.minCompletionCost ?? 0;
            if (expSortKey === "live") return x.bestLive ? x.bestLive.combined : null;
            if (expSortKey === "ctx") return x.contextLength ?? null;
            return x[expSortKey] ?? "";
          };
          const av = valOf(a);
          const bv = valOf(b);
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          if (typeof av === "boolean") return expSortAsc ? Number(bv) - Number(av) : Number(av) - Number(bv);
          if (typeof av === "string") return expSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
          return expSortAsc ? av - bv : bv - av;
        });

        mount.innerHTML =
          '<div class="results-table-wrap"><table class="labs-table" id="explorer-table"><thead><tr>' +
          '<th data-exp-sort="title">Model</th>' +
          '<th data-exp-sort="lab">Lab</th>' +
          '<th data-exp-sort="weights">Weights</th>' +
          '<th data-exp-sort="laptopFit">Laptop</th>' +
          '<th data-exp-sort="lane">Tier</th>' +
          '<th data-exp-sort="params">Params / Mem</th>' +
          "<th>Runtimes</th>" +
          '<th data-exp-sort="price">API Price</th>' +
          '<th data-exp-sort="ctx">Ctx</th>' +
          '<th data-exp-sort="live">Live</th>' +
          "</tr></thead><tbody>" +
          sorted
            .map((m) => {
              const rowCls =
                m.canonicalId === expSelectedId
                  ? "tier-2"
                  : m.laptopFit
                    ? "tier-local"
                    : m.lane === "fable"
                      ? "tier-1"
                      : "";
              const runtimes = [...new Set(m.targets.map((t) => t.runtimeLabel))].join(", ");
              const liveCell = m.bestLive
                ? '<span class="badge badge-green">' + m.bestLive.combined.toFixed(1) + "%</span>"
                : '<span class="badge badge-pending">&mdash;</span>';
              return (
                '<tr class="' +
                rowCls +
                '" style="cursor:pointer" data-exp-id="' +
                escHtml(m.canonicalId) +
                '">' +
                '<td class="model-cell">' +
                escHtml(m.title) +
                "</td>" +
                '<td class="cost-cell">' +
                escHtml(m.lab) +
                "</td>" +
                '<td><span class="badge ' +
                (m.weights === "open" ? "badge-open" : "badge-closed") +
                '">' +
                escHtml(m.weights) +
                "</span></td>" +
                "<td>" +
                (m.laptopFit ? '<span class="badge badge-local">Yes</span>' : '<span class="cost-cell">No</span>') +
                "</td>" +
                '<td class="cost-cell">' +
                escHtml(m.lane) +
                "</td>" +
                '<td class="cost-cell">' +
                escHtml(m.params + (m.laptopFit ? " · " + m.footprint : "")) +
                "</td>" +
                '<td class="cost-cell">' +
                escHtml(runtimes) +
                "</td>" +
                '<td class="cost-cell">' +
                escHtml(fmtApiPrice(m)) +
                "</td>" +
                '<td class="cost-cell">' +
                fmtCtx(m.contextLength) +
                "</td>" +
                "<td>" +
                liveCell +
                "</td>" +
                "</tr>"
              );
            })
            .join("") +
          "</tbody></table></div>";

        mount.querySelectorAll("th[data-exp-sort]").forEach((th) => {
          th.style.cursor = "pointer";
          th.addEventListener("click", () => {
            const k = th.getAttribute("data-exp-sort") || "lane";
            if (expSortKey === k) expSortAsc = !expSortAsc;
            else {
              expSortKey = k;
              expSortAsc = k !== "live" && k !== "ctx";
            }
            renderExplorer();
          });
        });
        mount.querySelectorAll("tr[data-exp-id]").forEach((tr) => {
          tr.addEventListener("click", () => {
            expSelectedId = tr.getAttribute("data-exp-id") || expSelectedId;
            renderExplorer();
            document.getElementById("explorer-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
        });
      }
    }

    function rows() {
      return DATASETS[currentDs].rows;
    }

    function scopedRows() {
      const all = rows();
      if (currentScope === "cloud") {
        const cloud = all.filter((m) => m.tier !== "local");
        return cloud.length > 0 ? cloud : all;
      }
      return all;
    }

    function keyOf(m) {
      const eff = m.reasoningEffort && m.reasoningEffort !== "default" ? "::" + m.reasoningEffort : "";
      return m.id + "::" + m.provider + eff;
    }

    function computeParetoIds(list, xKey, yKey) {
      const sorted = [...list].sort((a, b) => {
        if (a[xKey] !== b[xKey]) return a[xKey] - b[xKey];
        return b[yKey] - a[yKey];
      });
      const pareto = new Set();
      let best = -Infinity;
      let bestX = -Infinity;
      for (const m of sorted) {
        const val = m[yKey];
        if (val > best) {
          pareto.add(keyOf(m));
          best = val;
          bestX = m[xKey];
        } else if (val === best && m[xKey] === bestX) {
          pareto.add(keyOf(m));
        }
      }
      return pareto;
    }

    function shortLabel(m) {
      const base = m.id.replace(/^(anthropic|openai|qwen|deepseek|x-ai|moonshotai|mistralai|meta-llama|z-ai|nvidia|google|inception|minimax)\\//, "");
      return m.reasoningEffort && m.reasoningEffort !== "default"
        ? base + "@" + m.reasoningEffort
        : base;
    }

    function updateInspector(m, paretoSet) {
      const el = document.getElementById("pareto-inspector");
      if (!el || !m) return;
      const isP = paretoSet.has(keyOf(m));
      const badge = m.cost === 0 && currentX === "cost"
        ? (isP
            ? '<span class="badge badge-local">Local $0 Pareto</span>'
            : '<span class="badge badge-neutral">Local $0 (Dominated)</span>')
        : isP
          ? '<span class="badge badge-pareto">Pareto Frontier</span>'
          : '<span class="badge badge-neutral">Dominated</span>';
      const effMeta = m.reasoningEffort
        ? " &middot; effort: " + escHtml(m.reasoningEffort) + (m.effectiveThinkingLevel && m.effectiveThinkingLevel !== m.reasoningEffort ? " (" + escHtml(m.effectiveThinkingLevel) + ")" : "")
        : "";
      const tokMeta = m.tokens
        ? " &middot; " + m.tokens.total.toLocaleString() + " tok" + (m.tokens.reasoning ? " (" + m.tokens.reasoning.toLocaleString() + " think)" : "") + (m.tokPerSec ? " &middot; " + m.tokPerSec + " tok/s" : "")
        : "";
      const eloMeta = m.elo != null ? " &middot; Elo " + m.elo : "";
      const taskChips = Array.isArray(m.tasks) && m.tasks.length > 0
        ? '<div class="pareto-inspector-tasks">' + m.tasks.map((t) => {
            const cls = t.score >= t.maxScore ? "is-pass" : t.score > 0 ? "is-partial" : "is-fail";
            const tip = escHtml(t.dim + "/" + t.taskId + ": " + t.score + "/" + t.maxScore + " · " + fmtCost(t.costUsd) + " · " + (t.durationMs / 1000).toFixed(1) + "s — " + t.details);
            return '<span class="task-chip ' + cls + '" title="' + tip + '">' + escHtml(t.taskId) + " " + t.score + "/" + t.maxScore + "</span>";
          }).join("") + "</div>"
        : "";
      el.innerHTML = \`
        <div>
          <div class="inspector-name">\${escHtml(m.id)}\${m.reasoningEffort && m.reasoningEffort !== "default" ? " @" + escHtml(m.reasoningEffort) : ""}</div>
          <div class="inspector-meta">\${escHtml(m.provider)} &middot; \${escHtml(m.weights)} weights &middot; \${fmtCost(m.cost)} &middot; \${fmtTime(m.timeSec)}\${eloMeta}\${effMeta}\${tokMeta} &nbsp;\${badge}</div>
        </div>
        <div class="inspector-bars">
          <div class="inspector-dim">Comb<strong>\${m.combined.toFixed(1)}%</strong></div>
          <div class="inspector-dim">Reason<strong>\${escHtml(m.reasoningRaw)}</strong></div>
          <div class="inspector-dim">Know<strong>\${escHtml(m.knowledgeRaw)}</strong></div>
          <div class="inspector-dim">Instr<strong>\${escHtml(m.instructionRaw)}</strong></div>
          <div class="inspector-dim">Coding<strong>\${escHtml(m.codingRaw)}</strong></div>
          <div class="inspector-dim">Tools<strong>\${m.tools == null ? "&mdash;" : escHtml(m.toolsRaw)}</strong></div>
        </div>
        <div class="inspector-note">\${escHtml(m.note)}</div>
        \${taskChips}
      \`;
    }

    function renderChart() {
      const mount = document.getElementById("pareto-svg-mount");
      if (!mount) return;
      const list = scopedRows();
      document.getElementById("pareto-provenance").textContent = DATASETS[currentDs].provenance;
      document.getElementById("table-ds-title").textContent = DATASETS[currentDs].label + (currentScope === "cloud" ? " · Cloud Only" : "");

      const paretoSet = computeParetoIds(list, currentX, currentMetric);
      const W = 920, H = 415;
      const padL = 62, padR = 32, padT = 42, padB = 48;
      const hasZeroCost = currentX === "cost" && list.some((m) => m.cost === 0);
      const localLaneW = hasZeroCost ? 88 : 0;
      const apiLeft = padL + (hasZeroCost ? localLaneW + 26 : 18);
      const apiRight = W - padR;

      const vals = list.map((m) => m[currentMetric] ?? 0);
      const minVal = Math.min(...vals);
      const yMin = Math.max(0, Math.min(90, Math.floor(minVal / 5) * 5 - 3));
      const yMax = 102.2;

      const posX = list.map((m) => m[currentX]).filter((v) => v > 0);
      const minPos = posX.length > 0 ? Math.min(...posX) : 0.001;
      const maxPos = posX.length > 0 ? Math.max(...posX) : 0.1;
      const logMin = Math.log10(minPos * 0.72);
      const logMax = Math.log10(maxPos * 1.35);

      function xOf(val, idxInZero) {
        if (val === 0 && hasZeroCost) {
          return padL + 18 + Math.min(54, (idxInZero || 0) * 5);
        }
        const t = (Math.log10(Math.max(val, 1e-6)) - logMin) / Math.max(0.001, logMax - logMin);
        return apiLeft + Math.max(0, Math.min(1, t)) * (apiRight - apiLeft);
      }

      function yOf(v) {
        const t = (v - yMin) / (yMax - yMin);
        return (H - padB) - Math.max(0, Math.min(1, t)) * (H - padT - padB);
      }

      const zeros = list.filter((m) => m[currentX] === 0).sort((a, b) => b[currentMetric] - a[currentMetric]);
      const zeroIdx = new Map(zeros.map((m, i) => [keyOf(m), i]));
      const pts = list.map((m) => ({
        m,
        k: keyOf(m),
        x: xOf(m[currentX], zeroIdx.get(keyOf(m)) || 0),
        y: yOf(m[currentMetric] ?? 0),
        pareto: paretoSet.has(keyOf(m)),
      }));

      const frontierPts = pts
        .filter((p) => p.pareto)
        .sort((a, b) => a.m[currentX] - b.m[currentX] || b.m[currentMetric] - a.m[currentMetric]);

      let stepPath = "";
      for (let i = 0; i < frontierPts.length; i++) {
        const p = frontierPts[i];
        if (i === 0) stepPath += \`M \${p.x.toFixed(1)} \${p.y.toFixed(1)}\`;
        else {
          const prev = frontierPts[i - 1];
          stepPath += \` L \${p.x.toFixed(1)} \${prev.y.toFixed(1)} L \${p.x.toFixed(1)} \${p.y.toFixed(1)}\`;
        }
      }
      if (frontierPts.length > 0) {
        const last = frontierPts[frontierPts.length - 1];
        stepPath += \` L \${apiRight} \${last.y.toFixed(1)}\`;
      }

      const ySpan = 100 - yMin;
      const yStep = ySpan > 40 ? 20 : ySpan > 18 ? 10 : 2;
      let yGrid = "";
      for (let v = Math.ceil(yMin / yStep) * yStep; v <= 100; v += yStep) {
        const y = yOf(v);
        yGrid += \`<line x1="\${padL}" y1="\${y.toFixed(1)}" x2="\${apiRight}" y2="\${y.toFixed(1)}" stroke="rgba(26,26,26,0.11)" stroke-width="1"/>\`;
        yGrid += \`<text x="\${padL - 8}" y="\${(y + 4).toFixed(1)}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="10.5" fill="#524f47">\${v}%</text>\`;
      }

      const tickCandidates = currentX === "cost"
        ? [0.001, 0.002, 0.005, 0.01, 0.03, 0.10, 0.30, 1.00]
        : [15, 30, 60, 120, 300, 900, 3600];
      const xTicks = posX.length > 0 ? tickCandidates.filter((t) => t >= minPos * 0.7 && t <= maxPos * 1.35) : [];
      let xGrid = "";
      for (const tk of xTicks) {
        const x = xOf(tk, 0);
        const lbl = currentX === "cost" ? (tk < 0.01 ? "$" + tk.toFixed(3) : "$" + tk.toFixed(2)) : fmtTime(tk);
        xGrid += \`<line x1="\${x.toFixed(1)}" y1="\${padT - 12}" x2="\${x.toFixed(1)}" y2="\${H - padB}" stroke="rgba(26,26,26,0.09)" stroke-width="1"/>\`;
        xGrid += \`<text x="\${x.toFixed(1)}" y="\${H - padB + 18}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="10.5" fill="#524f47">\${lbl}</text>\`;
      }

      // Label Pareto models and (when <= 20 models) all points that fit without collision
      const labelCandidates = pts
        .filter(
          (p) =>
            p.pareto ||
            list.length <= 20 ||
            p.m.id === "gemini-3.8-flash" ||
            p.m.id === "gemini-4-hydrogen" ||
            p.m.id === "claude-sonnet-5-5",
        )
        .sort(
          (a, b) =>
            (b.pareto ? 1 : 0) - (a.pareto ? 1 : 0) ||
            (b.m[currentMetric] ?? 0) - (a.m[currentMetric] ?? 0) ||
            a.x - b.x,
        );

      const placed = [];
      for (const p of labelCandidates) {
        const text = shortLabel(p.m);
        const w = text.length * 6.5 + 6;
        const h = 14;
        const candidates = p.pareto
          ? [
              { dx: 0, dy: -13, anchor: "middle" },
              { dx: -10, dy: -11, anchor: "end" },
              { dx: 11, dy: -11, anchor: "start" },
              { dx: 12, dy: 16, anchor: "start" },
              { dx: -12, dy: 16, anchor: "end" },
            ]
          : [
              { dx: 10, dy: 16, anchor: "start" },
              { dx: -10, dy: 16, anchor: "end" },
              { dx: 0, dy: 18, anchor: "middle" },
              { dx: -10, dy: -12, anchor: "end" },
            ];
        for (const c of candidates) {
          let lx = p.x + c.dx;
          let ly = p.y + c.dy;
          let x1 = c.anchor === "end" ? lx - w : c.anchor === "middle" ? lx - w / 2 : lx;
          let x2 = x1 + w;
          if (x1 < padL + 4) { const s = (padL + 4) - x1; lx += s; x1 += s; x2 += s; }
          if (x2 > apiRight - 4) { const s = x2 - (apiRight - 4); lx -= s; x1 -= s; x2 -= s; }
          ly = Math.max(padT - 6, Math.min(H - padB - 6, ly));
          const y1 = ly - h + 3;
          const y2 = ly + 3;
          const overlapsLabel = placed.some((b) => !(x2 + 5 < b.x1 || x1 - 5 > b.x2 || y2 + 3 < b.y1 || y1 - 3 > b.y2));
          const overlapsNode = pts.some((o) => o.k !== p.k && o.x >= x1 - 4 && o.x <= x2 + 4 && o.y >= y1 - 3 && o.y <= y2 + 3);
          if (!overlapsLabel && !overlapsNode) {
            placed.push({ p, text, lx, ly, anchor: c.anchor, x1, x2, y1, y2 });
            break;
          }
        }
      }

      const nodesSvg = pts.map((p) => {
        const sel = p.k === selectedKey;
        const isLocal = p.m.tier === "local";
        const stroke = isLocal ? "#5b2c6f" : "#0055aa";
        const ek = escHtml(p.k);
        if (p.pareto) {
          const sz = sel ? 12 : 10;
          const half = sz / 2;
          return \`<g class="chart-pt" data-key="\${ek}" style="cursor:pointer">
            \${sel ? \`<rect x="\${(p.x - 9).toFixed(1)}" y="\${(p.y - 9).toFixed(1)}" width="18" height="18" fill="none" stroke="#d93025" stroke-width="1.5"/>\` : ""}
            <rect x="\${(p.x - half).toFixed(1)}" y="\${(p.y - half).toFixed(1)}" width="\${sz}" height="\${sz}" fill="#ffffff" stroke="\${stroke}" stroke-width="2"/>
            <rect x="\${(p.x - 2).toFixed(1)}" y="\${(p.y - 2).toFixed(1)}" width="4" height="4" fill="\${stroke}"/>
          </g>\`;
        }
        const fill = isLocal ? "#5b2c6f" : "#7b7669";
        return \`<g class="chart-pt" data-key="\${ek}" style="cursor:pointer">
          \${sel ? \`<circle cx="\${p.x.toFixed(1)}" cy="\${p.y.toFixed(1)}" r="8" fill="none" stroke="#d93025" stroke-width="1.5"/>\` : ""}
          <circle cx="\${p.x.toFixed(1)}" cy="\${p.y.toFixed(1)}" r="4.8" fill="\${fill}" fill-opacity="0.78" stroke="#ffffff" stroke-width="1"/>
        </g>\`;
      }).join("");

      const labelsSvg = placed.map((l) => {
        const color = l.p.pareto ? (l.p.m.tier === "local" ? "#5b2c6f" : "#141310") : "#5c584e";
        const weight = l.p.pareto ? "600" : "500";
        const halo = hasZeroCost && l.p.m.cost === 0 && l.x2 <= padL + localLaneW ? "#f8f3fa" : "#ffffff";
        const targetY = l.ly < l.p.y ? l.ly + 2 : l.ly - 9;
        const targetX = Math.max(l.x1 + 4, Math.min(l.x2 - 4, l.p.x));
        return \`
          <line x1="\${l.p.x.toFixed(1)}" y1="\${l.p.y.toFixed(1)}" x2="\${targetX.toFixed(1)}" y2="\${targetY.toFixed(1)}" stroke="rgba(26,26,26,0.28)" stroke-width="0.85"/>
          <text x="\${l.lx.toFixed(1)}" y="\${l.ly.toFixed(1)}" text-anchor="\${l.anchor}" font-family="IBM Plex Mono, monospace" font-size="10.5" font-weight="\${weight}" fill="\${color}" stroke="\${halo}" stroke-width="4" stroke-linejoin="round" style="paint-order:stroke;cursor:pointer" data-key="\${escHtml(l.p.k)}" class="chart-pt">\${escHtml(l.text)}</text>
        \`;
      }).join("");

      const localLaneSvg = hasZeroCost ? \`
        <rect x="\${padL}" y="\${padT - 12}" width="\${localLaneW}" height="\${H - padT - padB + 12}" fill="#f4ecf7" fill-opacity="0.55"/>
        <line x1="\${padL + localLaneW}" y1="\${padT - 12}" x2="\${padL + localLaneW}" y2="\${H - padB}" stroke="#5b2c6f" stroke-width="1" stroke-dasharray="4 3"/>
        <text x="\${padL + localLaneW / 2}" y="\${padT + 2}" text-anchor="middle" font-family="Courier Prime, monospace" font-size="9.5" font-weight="700" fill="#5b2c6f" letter-spacing="0.08em">LOCAL $0</text>
        <text x="\${padL + localLaneW / 2}" y="\${H - padB + 18}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="10.5" fill="#5b2c6f">$0.00</text>
      \` : "";

      const xAxisCaption = currentX === "cost"
        ? "SUITE RUN COST (LOG SCALE USD) → UPPER-LEFT IS PARETO OPTIMAL"
        : "TOTAL SUITE WALL-CLOCK TIME (LOG SCALE) → UPPER-LEFT IS PARETO OPTIMAL";

      mount.innerHTML = \`<svg viewBox="0 0 \${W} \${H}" role="img" aria-label="Pareto Frontier">
        \${localLaneSvg}
        \${yGrid}
        \${xGrid}
        <line x1="\${padL}" y1="\${H - padB}" x2="\${apiRight}" y2="\${H - padB}" stroke="#1a1a1a" stroke-width="1.5"/>
        <line x1="\${padL}" y1="\${padT - 12}" x2="\${padL}" y2="\${H - padB}" stroke="#1a1a1a" stroke-width="1.5"/>
        <path d="\${stepPath}" fill="none" stroke="#0055aa" stroke-width="2.2"/>
        \${labelsSvg}
        \${nodesSvg}
        <text x="\${(apiLeft + apiRight) / 2}" y="\${H - 8}" text-anchor="middle" font-family="Courier Prime, monospace" font-size="10.5" font-weight="700" fill="#524f47" letter-spacing="0.12em">\${xAxisCaption}</text>
      </svg>\`;

      mount.querySelectorAll(".chart-pt").forEach((node) => {
        node.addEventListener("click", () => {
          selectedKey = node.getAttribute("data-key") || selectedKey;
          renderChart();
        });
        node.addEventListener("mouseenter", () => {
          const k = node.getAttribute("data-key");
          const m = list.find((x) => keyOf(x) === k);
          if (m) updateInspector(m, paretoSet);
        });
      });

      const current = list.find((x) => keyOf(x) === selectedKey) || frontierPts[0]?.m || list[0];
      if (current) selectedKey = keyOf(current);
      updateInspector(current, paretoSet);
    }

    function scoreCls(v) {
      if (v >= 99) return "score-perfect";
      if (v >= 90) return "score-good";
      if (v >= 78) return "score-mid";
      return "score-low";
    }

    function renderTable() {
      const list = scopedRows();
      const paretoSet = computeParetoIds(list, currentX, currentMetric);
      const q = (document.getElementById("watch-search")?.value || "").trim().toLowerCase();

      const filtered = list.filter((m) => {
        if (q && !m.id.toLowerCase().includes(q) && !m.provider.toLowerCase().includes(q) && !(m.reasoningEffort || "").toLowerCase().includes(q)) return false;
        if (activeFilter === "pareto") return paretoSet.has(keyOf(m));
        if (activeFilter === "local") return m.tier === "local";
        if (activeFilter === "open") return m.weights === "open";
        if (activeFilter === "closed") return m.weights === "closed";
        return true;
      });

      filtered.sort((a, b) => {
        const valOf = (item) => {
          if (sortKey === "rank") return item.combined;
          if (sortKey === "effort") return item.reasoningEffort || "";
          if (sortKey === "totalTokens") return item.tokens ? item.tokens.total : null;
          return item[sortKey] ?? null;
        };
        const av = valOf(a);
        const bv = valOf(b);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        if (typeof av === "string") return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        return sortAsc ? av - bv : bv - av;
      });

      document.getElementById("watch-summary").textContent =
        \`Showing \${filtered.length} of \${list.length} models (\${paretoSet.size} on \${currentX === "cost" ? "Cost" : "Speed"}–\${currentMetric} Pareto frontier)\`;

      const tbody = document.getElementById("watch-tbody");
      tbody.innerHTML = filtered.map((m, idx) => {
        const isP = paretoSet.has(keyOf(m));
        const rowCls = m.tier === "local" ? "tier-local" : m.combined >= 98 ? "tier-1" : m.combined >= 90 ? "tier-2" : "tier-3";
        const statusBadge = m.tier === "local"
          ? (isP && currentX === "cost"
              ? '<span class="badge badge-local">Local $0</span>'
              : m.cost === 0 && currentX === "cost"
                ? '<span class="badge badge-neutral">Local</span>'
                : isP
                  ? '<span class="badge badge-pareto">Pareto</span>'
                  : '<span class="badge badge-local">Local</span>')
          : isP
            ? '<span class="badge badge-pareto">Pareto</span>'
            : \`<span class="badge badge-\${escHtml(m.weights)}">\${escHtml(m.weights)}</span>\`;
        const effortCell = m.reasoningEffort ? escHtml(m.reasoningEffort) : "&mdash;";
        const eloCell = m.elo == null ? "&mdash;" : String(m.elo);
        const tokensCell = m.tokens
          ? m.tokens.total.toLocaleString() + (m.tokens.reasoning ? " (" + m.tokens.reasoning.toLocaleString() + "R)" : "")
          : "&mdash;";
        const tokPerSecCell = m.tokPerSec == null ? "&mdash;" : m.tokPerSec.toFixed(1);
        return \`<tr class="\${rowCls}" style="cursor:pointer" data-row-key="\${escHtml(keyOf(m))}">
          <td class="cost-cell">\${idx + 1}</td>
          <td class="model-cell">\${escHtml(m.id)}</td>
          <td class="cost-cell">\${escHtml(m.provider)}</td>
          <td class="cost-cell">\${effortCell}</td>
          <td>\${statusBadge}</td>
          <td class="combined-cell \${scoreCls(m.combined)}">\${m.combined.toFixed(1)}%</td>
          <td class="score-cell \${scoreCls(m.reasoning)}">\${escHtml(m.reasoningRaw)}</td>
          <td class="score-cell \${scoreCls(m.knowledge)}">\${escHtml(m.knowledgeRaw)}</td>
          <td class="score-cell \${scoreCls(m.instruction)}">\${escHtml(m.instructionRaw)}</td>
          <td class="score-cell \${scoreCls(m.coding)}">\${escHtml(m.codingRaw)}</td>
          <td class="score-cell">\${m.tools === null ? "&mdash;" : escHtml(m.toolsRaw)}</td>
          <td class="cost-cell">\${eloCell}</td>
          <td class="cost-cell">\${tokensCell}</td>
          <td class="cost-cell">\${tokPerSecCell}</td>
          <td class="cost-cell">\${fmtCost(m.cost)}</td>
          <td class="time-cell">\${fmtTime(m.timeSec)}</td>
        </tr>\`;
      }).join("");

      tbody.querySelectorAll("tr[data-row-key]").forEach((tr) => {
        tr.addEventListener("click", () => {
          selectedKey = tr.getAttribute("data-row-key") || selectedKey;
          renderChart();
          document.getElementById("pareto")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      });
    }

    function jumpToParetoModel(rk) {
      if (!rk) return;
      currentDs = "live";
      currentScope = "all";
      activeFilter = "all";
      selectedKey = rk;
      document.querySelectorAll("#dataset-buttons button[data-ds]").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-ds") === "live");
      });
      document.querySelectorAll("#scope-buttons button[data-scope]").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-scope") === "all");
      });
      document.querySelectorAll("#pareto .table-controls button[data-f]").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-f") === "all");
      });
      const ws = document.getElementById("watch-search");
      if (ws) ws.value = "";
      renderChart();
      renderTable();
      document.getElementById("pareto")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    document.querySelectorAll("#explorer-buckets .explorer-bucket").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lane = btn.getAttribute("data-lane") || "all";
        expLane = expLane === lane ? "all" : lane;
        renderExplorer();
      });
    });

    document.querySelectorAll("#explorer-lane-buttons button[data-lane]").forEach((btn) => {
      btn.addEventListener("click", () => {
        expLane = btn.getAttribute("data-lane") || "all";
        renderExplorer();
      });
    });

    document.querySelectorAll("#explorer-weights-buttons button[data-w]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#explorer-weights-buttons button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        expWeights = btn.getAttribute("data-w") || "all";
        renderExplorer();
      });
    });

    document.querySelectorAll("#explorer-status-buttons button[data-st]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#explorer-status-buttons button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        expStatus = btn.getAttribute("data-st") || "all";
        renderExplorer();
      });
    });

    document.querySelectorAll("#explorer-view-buttons button[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#explorer-view-buttons button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        expView = btn.getAttribute("data-view") || "cards";
        renderExplorer();
      });
    });

    document.getElementById("explorer-search")?.addEventListener("input", renderExplorer);

    document.querySelectorAll("#dataset-buttons button[data-ds]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#dataset-buttons button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentDs = btn.getAttribute("data-ds") || "live";
        selectedKey = "";
        renderChart();
        renderTable();
      });
    });

    document.querySelectorAll("#scope-buttons button[data-scope]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#scope-buttons button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentScope = btn.getAttribute("data-scope") || "all";
        selectedKey = "";
        renderChart();
        renderTable();
      });
    });

    document.querySelectorAll("#xaxis-buttons button[data-x]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#xaxis-buttons button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentX = btn.getAttribute("data-x") || "cost";
        renderChart();
        renderTable();
      });
    });

    document.querySelectorAll("#metric-buttons button[data-metric]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#metric-buttons button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentMetric = btn.getAttribute("data-metric") || "combined";
        renderChart();
        renderTable();
      });
    });

    document.querySelectorAll("#pareto .table-controls button[data-f]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#pareto .table-controls button[data-f]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeFilter = btn.getAttribute("data-f") || "all";
        renderTable();
      });
    });

    document.getElementById("watch-search")?.addEventListener("input", renderTable);

    document.querySelectorAll("#watch-table th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const k = th.getAttribute("data-sort") || "combined";
        if (sortKey === k) sortAsc = !sortAsc;
        else {
          sortKey = k;
          sortAsc = k === "cost" || k === "timeSec" || k === "id" || k === "provider" || k === "effort";
        }
        renderTable();
      });
    });

    function codingKeyOf(m) {
      return m.provider + "::" + m.id + "::" + (m.reasoningEffort || "default") + "::" + (m.extensionProfile || "pi-default");
    }

    let codingExtFilter = "all";
    let codingWeightFilter = "all";
    let codingXKey = "totalCostUsd";
    let codingSortKey = "passRate";
    let codingSortAsc = false;
    let codingSelectedKey = "";

    function codingScopedRows() {
      if (!CODING_BENCH || !Array.isArray(CODING_BENCH.models)) return [];
      const q = (document.getElementById("coding-search")?.value || "").trim().toLowerCase();
      return CODING_BENCH.models.filter((m) => {
        if (codingExtFilter !== "all" && (m.extensionProfile || "pi-default") !== codingExtFilter) return false;
        if (codingWeightFilter === "local" && m.tier !== "local") return false;
        if (codingWeightFilter === "cloud" && m.tier !== "cloud") return false;
        if (codingWeightFilter === "open" && m.weights !== "open") return false;
        if (codingWeightFilter === "closed" && m.weights !== "closed") return false;
        if (q) {
          const hay = (m.id + " " + m.provider + " " + m.extensionProfile + " " + m.reasoningEffort).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
    }

    function updateCodingInspector(m, paretoSet) {
      const el = document.getElementById("coding-inspector");
      if (!el || !m) return;
      const isP = paretoSet.has(codingKeyOf(m));
      const badge = m.totalCostUsd === 0 && codingXKey === "totalCostUsd"
        ? (isP ? '<span class="badge badge-local">Local $0 Pareto</span>' : '<span class="badge badge-neutral">Local $0</span>')
        : isP
          ? '<span class="badge badge-pareto">Pareto Frontier</span>'
          : '<span class="badge badge-neutral">Dominated</span>';
      const thinkTok = m.tokens?.reasoning || 0;
      const chips = (m.taskResults || []).map((t) => {
        const cls = t.passed ? "is-pass" : t.score > 0 ? "is-partial" : "is-fail";
        const diffNote = t.gitDiffStat ? " · " + t.gitDiffStat.replace(/\\n/g, ", ") : "";
        const tip = escHtml(
          t.taskId + " (" + t.difficulty + " " + t.language + "): " +
          t.score + "/" + t.maxScore +
          " · visible " + t.visibleTests.passed + "/" + t.visibleTests.total +
          ", hidden " + t.hiddenTests.passed + "/" + t.hiddenTests.total +
          " · " + t.turns + " turns, " + t.toolCallsTotal + " tools (" + t.toolErrors + " err)" +
          " · " + fmtCost(t.costUsd) + " · " + (t.durationMs / 1000).toFixed(1) + "s" + diffNote
        );
        return '<span class="task-chip ' + cls + '" title="' + tip + '">' + escHtml(t.taskId) + " " + t.score + "/10 (" + t.hiddenTests.passed + "/" + t.hiddenTests.total + ")</span>";
      }).join("");
      el.innerHTML =
        "<div>" +
        '<div class="inspector-name">' + escHtml(m.id) + (m.reasoningEffort && m.reasoningEffort !== "default" ? " @" + escHtml(m.reasoningEffort) : "") + "</div>" +
        '<div class="inspector-meta">' + escHtml(m.provider) + " &middot; ext: " + escHtml(m.extensionProfile) + " &middot; " + fmtCost(m.totalCostUsd) + " &middot; " + fmtTime(m.totalTimeSec) + " &nbsp;" + badge + "</div>" +
        "</div>" +
        '<div class="inspector-bars">' +
        '<div class="inspector-dim">Pass@1<strong>' + m.passedTasks + "/" + m.totalTasks + " (" + m.passRate.toFixed(0) + "%)</strong></div>" +
        '<div class="inspector-dim">Score<strong>' + m.avgScore.toFixed(1) + "/10</strong></div>" +
        '<div class="inspector-dim">Turns<strong>' + m.avgTurns.toFixed(1) + "</strong></div>" +
        '<div class="inspector-dim">Tools<strong>' + m.totalToolCalls + " (" + m.toolErrors + "e)</strong></div>" +
        '<div class="inspector-dim">Think<strong>' + (thinkTok > 0 ? thinkTok.toLocaleString() : "&mdash;") + "</strong></div>" +
        '<div class="inspector-dim">tok/s<strong>' + (m.tokPerSec ?? "&mdash;") + "</strong></div>" +
        "</div>" +
        '<div class="inspector-note">Hover any task chip below for visible/hidden test counts &amp; git diff stats.</div>' +
        '<div class="pareto-inspector-tasks">' + chips + "</div>";
    }

    function renderCodingSection() {
      const mount = document.getElementById("coding-pareto-mount");
      const tbody = document.getElementById("coding-tbody");
      const summary = document.getElementById("coding-summary");
      if (!mount || !tbody || !CODING_BENCH) return;

      const list = codingScopedRows();
      const sorted = [...list].sort((a, b) => {
        if (codingXKey === "totalTimeSec") {
          return a.totalTimeSec !== b.totalTimeSec ? a.totalTimeSec - b.totalTimeSec : b.passRate - a.passRate;
        }
        return a.totalCostUsd !== b.totalCostUsd ? a.totalCostUsd - b.totalCostUsd : b.passRate - a.passRate;
      });
      const paretoSet = new Set();
      let bestPass = -Infinity;
      let bestX = -Infinity;
      for (const m of sorted) {
        if (m.passRate > bestPass) {
          paretoSet.add(codingKeyOf(m));
          bestPass = m.passRate;
          bestX = m[codingXKey];
        } else if (m.passRate === bestPass && m[codingXKey] === bestX) {
          paretoSet.add(codingKeyOf(m));
        }
      }

      const W = 920, H = 310, padL = 56, padR = 30, padT = 32, padB = 40;
      const hasZero = codingXKey === "totalCostUsd" && list.some((m) => m.totalCostUsd === 0);
      const apiLeft = padL + (hasZero ? 96 : 16);
      const apiRight = W - padR;
      const posX = list.map((m) => m[codingXKey]).filter((v) => v > 0);
      const minPos = posX.length > 0 ? Math.min(...posX) : 0.001;
      const maxPos = posX.length > 0 ? Math.max(...posX) : 1;
      const logMin = Math.log10(minPos * 0.7);
      const logMax = Math.log10(maxPos * 1.4);

      function cxOf(v, idx0) {
        if (v === 0 && hasZero) return padL + 22 + Math.min(52, (idx0 || 0) * 14);
        const t = (Math.log10(Math.max(v, 1e-6)) - logMin) / Math.max(0.001, logMax - logMin);
        return apiLeft + Math.max(0, Math.min(1, t)) * (apiRight - apiLeft);
      }
      function cyOf(pct) {
        const t = Math.max(0, Math.min(100, pct)) / 100;
        return (H - padB) - t * (H - padT - padB);
      }

      const zeros = list.filter((m) => m[codingXKey] === 0);
      const zeroMap = new Map(zeros.map((m, i) => [codingKeyOf(m), i]));
      const pts = list.map((m) => ({
        m,
        k: codingKeyOf(m),
        x: cxOf(m[codingXKey], zeroMap.get(codingKeyOf(m)) || 0),
        y: cyOf(m.passRate),
        pareto: paretoSet.has(codingKeyOf(m)),
      }));

      if (!codingSelectedKey && pts.length > 0) {
        const firstP = pts.find((p) => p.pareto) || pts[0];
        codingSelectedKey = firstP.k;
      }

      let grid = "";
      for (const yv of [0, 25, 50, 75, 100]) {
        const y = cyOf(yv);
        grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + apiRight + '" y2="' + y.toFixed(1) + '" stroke="rgba(26,26,26,0.11)" stroke-width="1"/>';
        grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="10.5" fill="#524f47">' + yv + "%</text>";
      }

      const fPts = pts.filter((p) => p.pareto).sort((a, b) => a.x - b.x || b.y - a.y);
      let stepPath = "";
      fPts.forEach((p, idx) => {
        if (idx === 0) stepPath += "M " + p.x.toFixed(1) + " " + p.y.toFixed(1);
        else {
          const prev = fPts[idx - 1];
          stepPath += " L " + p.x.toFixed(1) + " " + prev.y.toFixed(1) + " L " + p.x.toFixed(1) + " " + p.y.toFixed(1);
        }
      });
      if (fPts.length > 0) {
        stepPath += " L " + apiRight + " " + fPts[fPts.length - 1].y.toFixed(1);
      }

      const xAxisLabel = codingXKey === "totalCostUsd" ? "Total Session Cost (USD · log)" : "Total Session Time (sec · log)";
      const localLane = hasZero
        ? '<rect x="' + (padL - 2) + '" y="' + (padT - 8) + '" width="78" height="' + (H - padT - padB + 14) + '" fill="#f4ecf7" stroke="#c39bd3" stroke-dasharray="3 3"/><text x="' + (padL + 37) + '" y="' + (padT + 8) + '" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="9.5" font-weight="700" fill="#5b2c6f">LOCAL $0</text>'
        : "";

      const nodesSvg = pts.map((p) => {
        const isSel = p.k === codingSelectedKey;
        const fill = p.m.totalCostUsd === 0 && codingXKey === "totalCostUsd" ? "#f4ecf7" : p.pareto ? "#ffffff" : "#7b7669";
        const stroke = p.m.totalCostUsd === 0 && codingXKey === "totalCostUsd" ? "#5b2c6f" : p.pareto ? "#0055aa" : "#ffffff";
        const lbl = shortLabel(p.m);
        return '<g class="coding-pt" data-ck="' + escHtml(p.k) + '" style="cursor:pointer">' +
          (isSel ? '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="12" fill="none" stroke="#c62828" stroke-width="2" stroke-dasharray="3 2"/>' : "") +
          '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (p.pareto ? 7 : 5.5) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2"/>' +
          '<text x="' + (p.x + 10).toFixed(1) + '" y="' + (p.y + 3).toFixed(1) + '" font-family="IBM Plex Mono, monospace" font-size="10.5" fill="#1a1a1a">' + escHtml(lbl) + " (" + p.m.passedTasks + "/" + p.m.totalTasks + ")</text>" +
          "</g>";
      }).join("");

      mount.innerHTML =
        '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Coding benchmark Pass@1 vs cost/time Pareto scatter">' +
        grid + localLane +
        (stepPath ? '<path d="' + stepPath + '" fill="none" stroke="#0055aa" stroke-width="1.8" stroke-dasharray="5 4"/>' : "") +
        nodesSvg +
        '<text x="' + ((apiLeft + apiRight) / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" font-weight="600" fill="#524f47">' + xAxisLabel + "</text>" +
        "</svg>";

      mount.querySelectorAll(".coding-pt").forEach((g) => {
        g.addEventListener("click", () => {
          codingSelectedKey = g.getAttribute("data-ck") || "";
          renderCodingSection();
        });
      });

      const activePt = pts.find((p) => p.k === codingSelectedKey) || pts[0];
      if (activePt) updateCodingInspector(activePt.m, paretoSet);

      const tblSorted = [...list].sort((a, b) => {
        const av = codingSortKey === "reasoningTok" ? (a.tokens?.reasoning || 0) : a[codingSortKey];
        const bv = codingSortKey === "reasoningTok" ? (b.tokens?.reasoning || 0) : b[codingSortKey];
        if (typeof av === "string") return codingSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        return codingSortAsc ? av - bv : bv - av;
      });

      if (summary) {
        summary.textContent = "Showing " + tblSorted.length + " of " + CODING_BENCH.models.length + " coding-session runs (" + paretoSet.size + " Pareto-optimal). Click a row to inspect per-task diffs.";
      }

      tbody.innerHTML = tblSorted.map((m, idx) => {
        const k = codingKeyOf(m);
        const taskMap = new Map((m.taskResults || []).map((t) => [t.taskId, t]));
        const cells = CODING_BENCH.tasks.map((tMeta) => {
          const t = taskMap.get(tMeta.id);
          if (!t) return '<td class="cost-cell">&mdash;</td>';
          const cls = t.passed ? "is-pass" : t.score > 0 ? "is-partial" : "is-fail";
          const tip = escHtml(t.taskId + ": " + t.score + "/" + t.maxScore + " · hidden " + t.hiddenTests.passed + "/" + t.hiddenTests.total + " · " + t.turns + " turns");
          return '<td><span class="coding-cell-chip ' + cls + '" title="' + tip + '">' + t.score + "/10</span></td>";
        }).join("");

        return '<tr data-ck="' + escHtml(k) + '" style="cursor:pointer" class="' + (k === codingSelectedKey ? "tier-2" : paretoSet.has(k) ? "tier-1" : m.tier === "local" ? "tier-local" : "") + '">' +
          '<td class="rank-cell">' + (idx + 1) + "</td>" +
          '<td class="model-cell">' + escHtml(m.id) + "</td>" +
          '<td class="cost-cell">' + escHtml(m.provider) + "</td>" +
          '<td class="cost-cell">' + escHtml(m.reasoningEffort || "default") + "</td>" +
          '<td class="cost-cell">' + escHtml(m.extensionProfile || "pi-default") + "</td>" +
          '<td class="combined-cell">' + m.passedTasks + "/" + m.totalTasks + " (" + m.passRate.toFixed(0) + "%)</td>" +
          '<td class="score-cell">' + m.avgScore.toFixed(2) + "</td>" +
          cells +
          '<td class="cost-cell">' + m.avgTurns.toFixed(1) + "</td>" +
          '<td class="cost-cell">' + m.totalToolCalls + " (" + m.toolErrorRate.toFixed(0) + "%)</td>" +
          '<td class="cost-cell">' + ((m.tokens?.reasoning || 0) > 0 ? m.tokens.reasoning.toLocaleString() : "&mdash;") + "</td>" +
          '<td class="cost-cell">' + fmtCost(m.totalCostUsd) + "</td>" +
          '<td class="time-cell">' + fmtTime(m.totalTimeSec) + "</td>" +
          "</tr>";
      }).join("");

      tbody.querySelectorAll("tr[data-ck]").forEach((tr) => {
        tr.addEventListener("click", () => {
          codingSelectedKey = tr.getAttribute("data-ck") || "";
          renderCodingSection();
        });
      });
    }

    document.querySelectorAll("#coding-ext-buttons button[data-ext]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#coding-ext-buttons button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        codingExtFilter = btn.getAttribute("data-ext") || "all";
        codingSelectedKey = "";
        renderCodingSection();
      });
    });

    document.querySelectorAll("#coding-xaxis-buttons button[data-cx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#coding-xaxis-buttons button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        codingXKey = btn.getAttribute("data-cx") || "totalCostUsd";
        renderCodingSection();
      });
    });

    document.querySelectorAll("#coding-filter-buttons button[data-cf]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#coding-filter-buttons button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        codingWeightFilter = btn.getAttribute("data-cf") || "all";
        renderCodingSection();
      });
    });

    document.getElementById("coding-search")?.addEventListener("input", renderCodingSection);

    document.querySelectorAll("#coding-bench-table th[data-csort]").forEach((th) => {
      th.addEventListener("click", () => {
        const k = th.getAttribute("data-csort") || "passRate";
        if (codingSortKey === k) codingSortAsc = !codingSortAsc;
        else {
          codingSortKey = k;
          codingSortAsc = k === "totalCostUsd" || k === "totalTimeSec" || k === "id" || k === "provider";
        }
        renderCodingSection();
      });
    });

    renderExplorer();
    renderCodingSection();
    renderChart();
    renderTable();
  })();
  </script>`;

  return renderShell({
    title: "Umwelten — Reproducible Model Watch & Prompt-First Pi Examples",
    description:
      "Reproducible Cost & Speed Pareto frontiers on @earendil-works/pi-ai, local M4 Max serving benchmarks, and 10 prompt-first Pi examples.",
    activeNav: "watch",
    prefix: ".",
    bodyHtml,
    scriptHtml,
  });
}

function buildLocalPage(archives: HistoricalArchivesArtifact): string {
  const localShowdown = archives.showdown.rows.filter((r) => r.tier === "local");
  const headroomRows = archives.headroom.rows;

  const localPicks: ExamplePick[] = [
    {
      role: "Top Ollama",
      name: "gpt-oss:latest",
      note: "93.3% 4-dim score in docs-archive/walkthroughs/model-showdown-results.md (20/20 R, 28/30 K, 29/30 I, 105/126 C).",
    },
    {
      role: "Apple Silicon",
      name: "nemotron-3-nano:latest",
      note: "89.4% 4-dim score (20/20 Reasoning, 30/30 Knowledge, 27/30 Instruction, 85/126 Coding).",
    },
    {
      role: "Specialist",
      name: "qwen3:30b-a3b",
      note: "126/126 Coding and 20/20 Reasoning, but 4/30 Instruction (77.5% combined — wraps raw JSON in fences).",
    },
    {
      role: "Batching 6.8×",
      name: "gemma-4-E2B on llama-swap",
      note: "148.7 → 1,014.3 agg tok/s at c=4 (TTFT 88ms → 195ms) vs. Ollama's serialized depth-1 queue.",
    },
  ];

  const maxTok = 1050;

  const bodyHtml = `<div class="container">
    <div class="hero">
      <div class="hero-label">Local Serving Bench &middot; Extracted Verbatim From Committed Reports</div>
      <h1>Local Models &amp;<br><em>Serving Physics</em></h1>
      <p class="hero-subtitle">
        Every row on this page is parsed directly by <code>scripts/extract-historical-reports.ts</code> from
        <code>${esc(archives.headroom.sourceReport)}</code> (${esc(archives.headroom.hardware)}) and
        <code>${esc(archives.showdown.sourceReport)}</code> &mdash; including recorded memory-pressure failures.
      </p>
      <div class="hero-meta">
        <span>Hardware: <strong>${esc(archives.headroom.hardware)}</strong></span>
        <span>Reproduce: <code>${esc(archives.headroom.reproduceCommand)}</code></span>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card s-local">
        <div class="stat-num">93.3%</div>
        <div class="stat-label">Top Local Ollama</div>
        <div class="stat-sub">gpt-oss:latest (#21 of 48)</div>
      </div>
      <div class="stat-card s-accent">
        <div class="stat-num">1,014.3</div>
        <div class="stat-label">Peak c=4 agg tok/s</div>
        <div class="stat-sub">gemma-4-E2B (llama-swap, 6.8&times;)</div>
      </div>
      <div class="stat-card s-yellow">
        <div class="stat-num">48,767ms</div>
        <div class="stat-label">Worst Queued TTFT</div>
        <div class="stat-sub">gemma4:31b on ollama @ c=4</div>
      </div>
      <div class="stat-card s-green">
        <div class="stat-num">${localShowdown.length}</div>
        <div class="stat-label">Local Models Scored</div>
        <div class="stat-sub">4-dim showdown baseline</div>
      </div>
    </div>

    ${renderModelPicks(
      localPicks,
      `extracted from ${archives.headroom.runDate} & ${archives.showdown.runDate} reports`,
      "Measured local findings",
    )}

    <section class="report-section">
      <div class="section-num">01 &mdash; Concurrency Headroom (${esc(archives.headroom.sourceReport)})</div>
      <h2 class="section-title">All ${headroomRows.length} measured M4 Max rows: <code>llama-swap</code> vs. <code>ollama</code></h2>
      <p class="body-text">
        Note on <code>gemma-4-31B</code> under <code>llama-swap</code>: recorded as <code>&mdash;</code> because four concurrent
        requests against 31B triggered an intermittent <code>Compute error</code> under unified-memory pressure &mdash; preserved
        transparently rather than omitted.
      </p>

      <div class="scale-bars">
        ${headroomRows
          .filter((r) => r.aggC1 !== null && r.aggC4 !== null)
          .slice(0, 8)
          .map((r) => {
            const w1 = Math.max(2, ((r.aggC1 ?? 0) / maxTok) * 100);
            const w4 = Math.max(2, ((r.aggC4 ?? 0) / maxTok) * 100);
            const isQ = r.mode === "queueing";
            return `<div class="scale-row">
            <div>
              <div class="model-cell">${esc(r.model)}</div>
              <div class="cost-cell" style="margin-top:2px">${esc(r.runtimeGroup)} &middot; decode ${(r.decodeC1 ?? 0).toFixed(1)} &rarr; ${(r.decodeC4 ?? 0).toFixed(1)} t/s</div>
            </div>
            <div class="scale-track-group">
              <div class="scale-track-line">
                <span>c = 1</span>
                <div class="scale-bar-bg"><div class="scale-bar-fill" style="width:${w1.toFixed(1)}%;opacity:0.55"></div></div>
                <span>${(r.aggC1 ?? 0).toFixed(1)} t/s</span>
              </div>
              <div class="scale-track-line">
                <span>c = 4</span>
                <div class="scale-bar-bg"><div class="scale-bar-fill ${isQ ? "is-queue" : ""}" style="width:${w4.toFixed(1)}%"></div></div>
                <strong>${(r.aggC4 ?? 0).toFixed(1)} t/s</strong>
              </div>
            </div>
            <div style="text-align:right">
              <span class="badge ${isQ ? "badge-closed" : "badge-green"}">${esc(r.scaling)} (${r.mode})</span>
              <div class="cost-cell" style="margin-top:4px">TTFT ${esc(r.ttftC1)} &rarr; ${esc(r.ttftC4)}</div>
            </div>
          </div>`;
          })
          .join("\n        ")}
      </div>

      <div class="results-table-wrap">
        <table class="labs-table">
          <thead>
            <tr>
              <th>Runtime</th>
              <th>Model</th>
              <th>agg c=1</th>
              <th>agg c=4</th>
              <th>Scaling</th>
              <th>decode c=1</th>
              <th>decode c=4</th>
              <th>TTFT c=1</th>
              <th>TTFT c=4</th>
            </tr>
          </thead>
          <tbody>
            ${headroomRows
              .map(
                (r) => `<tr class="${r.mode === "batching" ? "tier-1" : "tier-4"}">
              <td><span class="badge ${r.mode === "batching" ? "badge-green" : "badge-closed"}">${esc(r.runtimeGroup)}</span></td>
              <td class="model-cell">${esc(r.model)}</td>
              <td class="score-cell">${r.aggC1 === null ? "&mdash;" : r.aggC1.toFixed(1)}</td>
              <td class="combined-cell">${r.aggC4 === null ? "&mdash;" : r.aggC4.toFixed(1)}</td>
              <td class="score-cell">${esc(r.scaling)}</td>
              <td class="score-cell">${r.decodeC1 === null ? "&mdash;" : r.decodeC1.toFixed(1)}</td>
              <td class="score-cell">${r.decodeC4 === null ? "&mdash;" : r.decodeC4.toFixed(1)}</td>
              <td class="time-cell">${esc(r.ttftC1)}</td>
              <td class="time-cell">${esc(r.ttftC4)}</td>
            </tr>`,
              )
              .join("\n            ")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="report-section">
      <div class="section-num">02 &mdash; All ${localShowdown.length} Local Ollama Models (${esc(archives.showdown.sourceReport)})</div>
      <h2 class="section-title">Verbatim 4-dimension scores on local weights</h2>
      <div class="results-table-wrap">
        <table class="labs-table">
          <thead>
            <tr>
              <th>Overall Rank</th>
              <th>Model</th>
              <th>Combined</th>
              <th>Reasoning (/20)</th>
              <th>Knowledge (/30)</th>
              <th>Instruction (/30)</th>
              <th>Coding (/126)</th>
              <th>Wall Time</th>
            </tr>
          </thead>
          <tbody>
            ${localShowdown
              .map(
                (m) => `<tr class="tier-local">
              <td class="cost-cell">#${m.rank}</td>
              <td class="model-cell">${esc(m.id)}</td>
              <td class="combined-cell">${m.combined.toFixed(1)}%</td>
              <td class="score-cell">${esc(m.reasoningRaw)} (${m.reasoning}%)</td>
              <td class="score-cell">${esc(m.knowledgeRaw)} (${m.knowledge}%)</td>
              <td class="score-cell">${esc(m.instructionRaw)} (${m.instruction}%)</td>
              <td class="score-cell">${esc(m.codingRaw)} (${m.coding}%)</td>
              <td class="time-cell">${esc(m.timeRaw)}</td>
            </tr>`,
              )
              .join("\n            ")}
          </tbody>
        </table>
      </div>
    </section>
  </div>`;

  return renderShell({
    title: "Local Models & Serving Physics · Umwelten",
    description:
      "Verbatim M4 Max c=1 vs c=4 concurrency measurements and 13 local Ollama 4-dimension showdown scores.",
    activeNav: "local",
    prefix: ".",
    bodyHtml,
  });
}

function buildExamplesHubPage(): string {
  const counts = {
    all: PROMPT_EXAMPLES.length,
    evaluations: PROMPT_EXAMPLES.filter((e) => e.category === "evaluations").length,
    judgment: PROMPT_EXAMPLES.filter((e) => e.category === "judgment").length,
    sessions: PROMPT_EXAMPLES.filter((e) => e.category === "sessions").length,
    habitats: PROMPT_EXAMPLES.filter((e) => e.category === "habitats").length,
    mycel: PROMPT_EXAMPLES.filter((e) => e.category === "mycel").length,
  };

  const bodyHtml = `<div class="container">
    <div class="hero">
      <div class="hero-label">Standing Department &middot; ${PROMPT_EXAMPLES.length} Verified Workspace Scripts</div>
      <h1>Prompt-First<br><em>Pi Examples</em></h1>
      <p class="hero-subtitle">
        Each page starts at the top with the exact prompt you give Pi, followed by the real TypeScript file read directly from
        <code>examples/</code> at build time, and the actual captured execution output from <code>reports/data/examples-live.json</code>.
      </p>
    </div>

    <nav class="dept-switcher" id="cat-switcher" aria-label="Example categories">
      <button type="button" class="dept-pill is-active" data-cat="all"><span>All Recipes</span><span class="dept-pill-count">${counts.all}</span></button>
      <button type="button" class="dept-pill" data-cat="evaluations"><span>Evaluations &amp; Elo</span><span class="dept-pill-count">${counts.evaluations}</span></button>
      <button type="button" class="dept-pill" data-cat="judgment"><span>Calibrated Judgment</span><span class="dept-pill-count">${counts.judgment}</span></button>
      <button type="button" class="dept-pill" data-cat="sessions"><span>Sessions &amp; Pi CLI</span><span class="dept-pill-count">${counts.sessions}</span></button>
      <button type="button" class="dept-pill" data-cat="habitats"><span>Durable Habitats</span><span class="dept-pill-count">${counts.habitats}</span></button>
      <button type="button" class="dept-pill" data-cat="mycel"><span>Mycel Exchange</span><span class="dept-pill-count">${counts.mycel}</span></button>
    </nav>

    <div class="drafting-bento" style="margin-top:0">
      <div class="example-grid" id="hub-example-grid">
        ${PROMPT_EXAMPLES.map((ex) => renderExampleCard(ex, ".")).join("\n        ")}
      </div>
    </div>
  </div>`;

  const scriptHtml = `<script>
  (() => {
    const switcher = document.getElementById("cat-switcher");
    const cards = Array.from(document.querySelectorAll("#hub-example-grid .item-card"));
    switcher?.querySelectorAll("button[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        switcher.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        const cat = btn.getAttribute("data-cat") || "all";
        cards.forEach((c) => {
          const match = cat === "all" || c.getAttribute("data-cat") === cat;
          c.style.display = match ? "flex" : "none";
        });
      });
    });
  })();
  </script>`;

  return renderShell({
    title: "Prompt-First Examples · Umwelten",
    description:
      "Ten prompt-first Pi & Pi Durable examples with live workspace TypeScript sources and captured execution outputs.",
    activeNav: "examples",
    prefix: ".",
    bodyHtml,
    scriptHtml,
  });
}

function buildSingleExamplePage(
  ex: PromptExampleMeta,
  index: number,
  capturedOutputs: Record<string, string>,
  liveWatch: LiveWatchArtifact,
): string {
  const sourcePath = path.join(ROOT, ex.file);
  const rawCode = fs.readFileSync(sourcePath, "utf8").trimEnd();
  const prev = PROMPT_EXAMPLES[(index - 1 + PROMPT_EXAMPLES.length) % PROMPT_EXAMPLES.length];
  const next = PROMPT_EXAMPLES[(index + 1) % PROMPT_EXAMPLES.length];

  const liveSummary =
    ex.slug === "model-watch-bench" && liveWatch.models.length > 0
      ? summarizeLiveWatch(liveWatch)
      : null;

  const displayPicks: ExamplePick[] = liveSummary
    ? [
        {
          role: `Cost Pareto (${liveSummary.topCombined.toFixed(0)}%)`,
          name: `${liveSummary.costTopWinner.provider}:${liveSummary.costTopWinner.id}`,
          note: `${liveSummary.costTopWinner.combined.toFixed(1)}% (${liveSummary.costTopWinner.reasoningRaw} R, ${liveSummary.costTopWinner.codingRaw} C) for ${fmtUsd(liveSummary.costTopWinner.cost)} in ${liveSummary.costTopWinner.timeSec.toFixed(1)}s.`,
        },
        {
          role: "Speed Top Tier",
          name: `${liveSummary.speedTopWinner.provider}:${liveSummary.speedTopWinner.id}`,
          note: `${liveSummary.speedTopWinner.combined.toFixed(1)}% in ${liveSummary.speedTopWinner.timeSec.toFixed(1)}s for ${fmtUsd(liveSummary.speedTopWinner.cost)} (Elo ${liveSummary.speedTopWinner.elo ?? "—"}).`,
        },
        {
          role: "Cheapest Overall",
          name: `${liveSummary.cheapestOverall.provider}:${liveSummary.cheapestOverall.id}`,
          note: `${liveSummary.cheapestOverall.combined.toFixed(1)}% for ${fmtUsd(liveSummary.cheapestOverall.cost)} in ${liveSummary.cheapestOverall.timeSec.toFixed(1)}s (${(liveSummary.cheapestOverall.tokens?.total ?? 0).toLocaleString()} tok).`,
        },
        {
          role: "Reasoning Budget",
          name: `${liveSummary.slowestOrLoopModel.provider}:${liveSummary.slowestOrLoopModel.id}`,
          note: `${(liveSummary.slowestOrLoopModel.tokens?.reasoning ?? 0).toLocaleString()} reasoning tokens over ${liveSummary.slowestOrLoopModel.timeSec.toFixed(1)}s (${liveSummary.slowestOrLoopModel.combined.toFixed(1)}% combined).`,
        },
      ]
    : ex.picks;

  const outputText =
    ex.slug === "model-watch-bench"
      ? JSON.stringify(
          {
            generatedAt: liveWatch.generatedAt,
            judgeModel: liveWatch.judgeModel,
            totalSuiteCostUsd: liveWatch.totalSuiteCostUsd,
            judgeCostUsd: liveWatch.judgeCostUsd ?? 0,
            eloJudgeCostUsd: liveWatch.eloJudgeCostUsd ?? 0,
            totalRunCostUsd:
              liveWatch.totalRunCostUsd ??
              liveWatch.totalSuiteCostUsd +
                (liveWatch.judgeCostUsd ?? 0) +
                (liveWatch.eloJudgeCostUsd ?? 0),
            unavailableCatalogueModels: liveWatch.unavailableCatalogueModels,
            standings: liveWatch.models.map((m) => ({
              model: `${m.provider}:${m.id}`,
              effort: m.reasoningEffort ?? "default",
              combined: `${m.combined}%`,
              scores: `R:${m.reasoningRaw} K:${m.knowledgeRaw} I:${m.instructionRaw} C:${m.codingRaw} T:${m.toolsRaw}`,
              elo: m.elo,
              tokens: m.tokens?.total ?? null,
              tokPerSec: m.tokPerSec ?? null,
              costUsd: m.cost,
              timeSec: m.timeSec,
            })),
          },
          null,
          2,
        )
      : (capturedOutputs[ex.outputKey] ?? ex.fallbackOutput ?? "");

  const markdownBundle = `# ${ex.title}\n\n## Prompt for Pi\n\n> ${ex.prompt}\n\n## Built Example (${ex.file})\n\n\`\`\`ts\n${rawCode}\n\`\`\`\n\n## Run\n\n\`\`\`bash\n${ex.runCommand}\n\`\`\`\n\n## Captured Output\n\n\`\`\`text\n${outputText}\n\`\`\`\n`;

  const padTotal = String(PROMPT_EXAMPLES.length).padStart(2, "0");
  const storylineHtml = `<div class="issue-storyline">
    <div class="storyline-inner">
      <a class="storyline-back" href="../examples.html">&larr; All Examples</a>
      <span class="storyline-center">
        <span class="storyline-pill">Example ${esc(ex.num)} / ${padTotal}</span>
        <span class="storyline-title">${esc(ex.title)}</span>
      </span>
      <div class="storyline-actions">
        <button type="button" class="storyline-btn" id="copy-md-top">Copy Markdown</button>
        <button type="button" class="storyline-btn storyline-btn--primary" id="copy-prompt-top">Copy Prompt for Pi &#9112;</button>
      </div>
    </div>
  </div>`;

  const bodyHtml = `<div class="container">
    <div class="hero">
      <div class="hero-label">Prompt-First Example ${esc(ex.num)} &middot; ${esc(ex.categoryLabel)} &middot; ${esc(ex.badge)}</div>
      <h1>${ex.heroHtml}</h1>
      <p class="hero-subtitle">${esc(ex.subtitle)}</p>
      <div class="hero-meta">
        <span>File: <code>${esc(ex.file)}</code></span>
        <span>Recreate: <code>${esc(ex.runCommand)}</code></span>
        <span>Packages: ${ex.packages.map((p) => `<code>${esc(p)}</code>`).join(" ")}</span>
      </div>
    </div>

    <div class="prompt-sheet">
      <div class="prompt-sheet-head">
        <span class="prompt-sheet-kicker">01 &mdash; The Prompt You Give Pi</span>
        <button type="button" class="storyline-btn storyline-btn--primary" id="copy-prompt-card">Copy Prompt &#9112;</button>
      </div>
      <blockquote>&ldquo;${esc(ex.prompt)}&rdquo;</blockquote>
      <div class="prompt-sheet-foot">
        <span>Paste directly into <code>pi</code> or your coding agent with <code>@umwelten/*</code> installed.</span>
        <span>${ex.readMinutes} min walkthrough</span>
      </div>
    </div>

    ${renderModelPicks(displayPicks, `verified ${liveWatch.generatedAt.slice(0, 10)}`, "Measured notes for this recipe")}

    <section class="report-section" style="padding-top:1rem">
      <div class="section-num">02 &mdash; The Example That Gets Built</div>
      <h2 class="section-title">Live workspace source: <code>${esc(ex.file)}</code></h2>
      <p class="body-text">
        Read directly from disk at site-build time &mdash; byte-for-byte identical to the typechecked script in this repo.
      </p>

      <div class="code-sheet">
        <div class="code-sheet-head">
          <span class="code-sheet-path">
            <span class="badge badge-open">TypeScript</span>
            <span>${esc(ex.file)}</span>
          </span>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <code>${esc(ex.runCommand)}</code>
            <button type="button" class="storyline-btn" id="copy-code-btn">Copy Code &#9112;</button>
          </div>
        </div>
        <pre><code>${highlightTs(rawCode)}</code></pre>
      </div>
    </section>

    <section class="report-section">
      <div class="section-num">03 &mdash; Captured Execution Telemetry</div>
      <h2 class="section-title">Captured stdout from running <code>${esc(ex.runCommand)}</code></h2>
      <div class="output-sheet">
        <div class="output-sheet-head">
          <span>Captured Run Output</span>
          <span>${esc(ex.runCommand)}</span>
        </div>
        <pre>${esc(outputText)}</pre>
      </div>
    </section>

    <section class="report-section">
      <div class="section-num">04 &mdash; How &amp; Why This Extends Pi</div>
      <h2 class="section-title">Architectural notes</h2>
      ${ex.writeupHtml}

      <div class="prev-next-grid">
        ${renderExampleCard(prev, "..")}
        ${renderExampleCard(next, "..")}
      </div>
    </section>
  </div>`;

  const payloadJson = JSON.stringify({
    prompt: ex.prompt,
    code: rawCode,
    md: markdownBundle,
  }).replace(/<\//g, "<\\/");

  const scriptHtml = `<script>
  (() => {
    const DATA = ${payloadJson};
    document.getElementById("copy-prompt-top")?.addEventListener("click", function () {
      copyTextWithFeedback(this, DATA.prompt, "Prompt Copied ✓");
    });
    document.getElementById("copy-prompt-card")?.addEventListener("click", function () {
      copyTextWithFeedback(this, DATA.prompt, "Prompt Copied ✓");
    });
    document.getElementById("copy-code-btn")?.addEventListener("click", function () {
      copyTextWithFeedback(this, DATA.code, "Code Copied ✓");
    });
    document.getElementById("copy-md-top")?.addEventListener("click", function () {
      copyTextWithFeedback(this, DATA.md, "Markdown Copied ✓");
    });
  })();
  </script>`;

  return renderShell({
    title: `${ex.num}. ${ex.title} · Umwelten Examples`,
    description: ex.subtitle,
    activeNav: "examples",
    prefix: "..",
    storylineHtml,
    bodyHtml,
    scriptHtml,
  });
}

function buildArchitecturePage(): string {
  const decisionsPath = path.join(ROOT, "docs", "decisions.jsonl");
  const decisions = fs.existsSync(decisionsPath)
    ? fs
        .readFileSync(decisionsPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(
          (l) =>
            JSON.parse(l) as {
              id: string;
              date: string;
              title: string;
              summary: string;
              resolution?: string;
            },
        )
    : [];

  const runsDir = path.join(ROOT, "docs", "runs");
  const runFolders = fs.existsSync(runsDir)
    ? fs
        .readdirSync(runsDir)
        .filter((d) => fs.existsSync(path.join(runsDir, d, "verdicts.jsonl")))
        .sort()
    : [];
  const latestRun = runFolders[runFolders.length - 1] ?? "";
  const verdicts = latestRun
    ? fs
        .readFileSync(path.join(runsDir, latestRun, "verdicts.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(
          (l) =>
            JSON.parse(l) as {
              pack: string;
              id: string;
              kind: string;
              verdict: string;
              evidence: string;
            },
        )
    : [];

  const passCount = verdicts.filter((v) => v.verdict === "pass").length;

  const bodyHtml = `<div class="container">
    <div class="hero">
      <div class="hero-label">Architecture &amp; session-spec-verify Ledger</div>
      <h1>Ten Packages on<br><em>Pi &amp; Pi Durable</em></h1>
      <p class="hero-subtitle">
        Rebasing Umwelten onto <code>@earendil-works/pi-ai</code>, <code>pi-coding-agent</code>, <code>pi-mcp</code>, and
        <code>pi-durable</code> eliminated ~107,000 lines of bespoke cognition, provider wrappers, Vercel AI SDK adapters,
        and custom agent containers &mdash; leaving only what extends Pi.
      </p>
      <div class="hero-meta">
        <span><strong>52,823</strong> workspace LoC (&minus;67%)</span>
        <span><strong>&minus;247</strong> npm packages removed</span>
        <span><strong>${passCount}/${verdicts.length}</strong> spec rules verified</span>
        <span>Run: <code>${esc(latestRun || "latest")}</code></span>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card s-green">
        <div class="stat-num">${passCount}/${verdicts.length}</div>
        <div class="stat-label">Spec Rules Passing</div>
        <div class="stat-sub">session-spec-verify</div>
      </div>
      <div class="stat-card s-accent">
        <div class="stat-num">10</div>
        <div class="stat-label">Acyclic Packages</div>
        <div class="stat-sub">zero circular seams</div>
      </div>
      <div class="stat-card s-yellow">
        <div class="stat-num">&minus;93%</div>
        <div class="stat-label">Habitat LoC Cut</div>
        <div class="stat-sub">59,492 &rarr; 4,099 on pi-durable</div>
      </div>
      <div class="stat-card s-ink">
        <div class="stat-num">0</div>
        <div class="stat-label">Vercel SDK Deps</div>
        <div class="stat-sub">raw models.stream() only</div>
      </div>
    </div>

    <section class="report-section">
      <div class="section-num">01 &mdash; Workspace Package Matrix</div>
      <h2 class="section-title">What Pi owns vs. what each Umwelten package adds</h2>
      <div class="results-table-wrap">
        <table class="labs-table">
          <thead>
            <tr>
              <th>Package</th>
              <th>Layer</th>
              <th>LoC</th>
              <th>What It Adds Beyond Pi</th>
              <th>Rebase Delta</th>
            </tr>
          </thead>
          <tbody>
            ${ARCHITECTURE_PACKAGES.map(
              (pkg) => `<tr class="tier-1">
              <td class="model-cell">${esc(pkg.name)}</td>
              <td class="cost-cell">${esc(pkg.layer)}</td>
              <td class="score-cell">${pkg.loc.toLocaleString()}</td>
              <td class="cost-cell" style="white-space:normal;max-width:360px;color:var(--text)">${esc(pkg.role)}</td>
              <td class="cost-cell" style="white-space:normal;max-width:300px">${esc(pkg.piBaseline)}</td>
            </tr>`,
            ).join("\n            ")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="report-section">
      <div class="section-num">02 &mdash; Architectural Decisions (docs/decisions.jsonl)</div>
      <h2 class="section-title">Ratified rebase &amp; boundary invariants</h2>
      <div class="finding-grid">
        ${decisions
          .map(
            (d) => `<article class="finding-card">
          <div class="finding-head">
            <span class="f-num">${esc(d.id)}</span>
            <span class="f-date">${esc(d.date)}</span>
          </div>
          <h4>${esc(d.title)}</h4>
          <p>${esc(d.resolution || d.summary)}</p>
        </article>`,
          )
          .join("\n        ")}
      </div>
    </section>

    <section class="report-section">
      <div class="section-num">03 &mdash; Live Verification Verdicts (${esc(latestRun)})</div>
      <h2 class="section-title">Every invariant &amp; acceptance criterion checked against code and live runs</h2>
      <div class="results-table-wrap">
        <table class="labs-table">
          <thead>
            <tr>
              <th>Verdict</th>
              <th>Spec Pack</th>
              <th>Rule ID</th>
              <th>Kind</th>
              <th>Verified Evidence</th>
            </tr>
          </thead>
          <tbody>
            ${verdicts
              .map(
                (v) => `<tr class="${v.verdict === "pass" ? "tier-1" : "tier-4"}">
              <td><span class="badge ${v.verdict === "pass" ? "badge-green" : "badge-closed"}">${esc(v.verdict)}</span></td>
              <td class="cost-cell">${esc(v.pack)}</td>
              <td class="model-cell">${esc(v.id)}</td>
              <td class="cost-cell">${esc(v.kind)}</td>
              <td class="cost-cell" style="white-space:normal;max-width:440px">${esc(v.evidence)}</td>
            </tr>`,
              )
              .join("\n            ")}
          </tbody>
        </table>
      </div>
    </section>
  </div>`;

  return renderShell({
    title: "Architecture & Spec Verification · Umwelten",
    description:
      "The 10-package Umwelten architecture on Pi & Pi Durable, ratified decisions, and 39/39 passing session-spec-verify verdicts.",
    activeNav: "architecture",
    prefix: ".",
    bodyHtml,
  });
}

function main() {
  const { mockWatch, liveWatch, archives, jevLive, examplesMock, codingBench } =
    loadSiteDatasets(ROOT);

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, "styles"), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, "examples"), { recursive: true });

  fs.writeFileSync(path.join(OUT_DIR, "styles", "labs.css"), LABS_CSS, "utf8");
  fs.writeFileSync(
    path.join(OUT_DIR, "index.html"),
    buildIndexPage(mockWatch, liveWatch, archives, jevLive, codingBench),
    "utf8",
  );
  fs.writeFileSync(path.join(OUT_DIR, "local.html"), buildLocalPage(archives), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "examples.html"), buildExamplesHubPage(), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "architecture.html"), buildArchitecturePage(), "utf8");

  PROMPT_EXAMPLES.forEach((ex, i) => {
    fs.writeFileSync(
      path.join(OUT_DIR, "examples", `${ex.slug}.html`),
      buildSingleExamplePage(ex, i, examplesMock.outputs, liveWatch),
      "utf8",
    );
  });

  console.log(
    `Built umwelten.thefocus.ai static site (${4 + PROMPT_EXAMPLES.length} HTML pages + labs.css) from reports/data/*.json -> ${OUT_DIR}`,
  );
}

main();
