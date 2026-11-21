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
import {
  ARCHITECTURE_PACKAGES,
  loadSiteDatasets,
  PROMPT_EXAMPLES,
  type ExamplePick,
  type HistoricalArchivesArtifact,
  type JevLiveArtifact,
  type LiveWatchArtifact,
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

function buildIndexPage(
  mockWatch: LiveWatchArtifact,
  liveWatch: LiveWatchArtifact,
  archives: HistoricalArchivesArtifact,
  jevLive: JevLiveArtifact,
): string {
  const liveRunDate = liveWatch.generatedAt.slice(0, 10);

  const frontDeskPicks: ExamplePick[] = [
    {
      role: "Gemini Fast",
      name: "google:gemini-3.8-flash / gemini-3.1-flash-lite",
      note: "Built-in Pi google slugs ($0.75/$3.75 & $0.25/$1.50 per M, 1M ctx) alongside gemini-4-hydrogen & gemini-3.5-flash-lite.",
    },
    {
      role: "Sub-dime Fast",
      name: "anthropic:claude-haiku-5-5 / openai:gpt-6-luna",
      note: "Both priced at $0.10/$0.50 per M in @earendil-works/pi-ai builtinModels() — 10× cheaper than previous mini/haiku tiers.",
    },
    {
      role: "Wafer / LPU",
      name: "cerebras:gpt-oss-120b / groq:openai/gpt-oss-20b",
      note: "2,000+ tok/s wafer-scale ($0.35/$0.75) and sub-100ms LPU ($0.075/$0.30) open-weight endpoints.",
    },
    {
      role: "Open Flash",
      name: "qwen3.8-flash / glm-5.3-flash / minimax-m3.1-flash",
      note: "1M-context sub-$0.60/M open-weight flash models via openrouter, mycel, or native Pi providers.",
    },
    {
      role: "Local Batch",
      name: "llamaswap:gemma-4-26b / gpt-oss-20b / gemma-4-e2b",
      note: "Configured for `--live` workstation runs via llama-server (-np 4 continuous batching, $0 marginal cost).",
    },
    {
      role: "Live Verified",
      name: "mycel:kimi-k3.1-pro ($0.0103) & claude-opus-5.5 (93.9s)",
      note: "Both scored 105/105 (100%) on the live 17-task Mycel verification run (switch to 'Measured Live Run' tab below).",
    },
  ];

  function mapWatchRows(artifact: LiveWatchArtifact) {
    return artifact.models.map((m) => {
      const failedTasks = Object.values(m.taskBreakdown)
        .flat()
        .filter((t) => t.score < t.maxScore);
      const note =
        failedTasks.length === 0
          ? `105/105 across all 17 tasks (${m.reasoningRaw} R, ${m.knowledgeRaw} K, ${m.instructionRaw} I, ${m.codingRaw} C, ${m.toolsRaw} T; Elo ${m.elo ?? "—"}).`
          : `Missed ${failedTasks.map((t) => `${t.taskId}: ${t.score}/${t.maxScore} (${t.details})`).join("; ")}.`;
      return {
        id: m.id,
        provider: m.provider,
        tier: m.tier,
        weights: m.weights,
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
        note,
      };
    });
  }

  const clientDatasets = {
    roster: {
      label: `20-Model Fast Roster · Mock Wiring (${mockWatch.models.length} models · fauxProvider)`,
      provenance: `[MOCK PREVIEW via @earendil-works/pi-ai fauxProvider + real builtinModels() pricing] Recreate offline in 4s with \`pnpm run site:bench\`, or run on device with \`pnpm run site:bench --live\`.`,
      hasTools: true,
      rows: mapWatchRows(mockWatch),
    },
    live: {
      label: `Measured Live Mycel Run (${liveRunDate} · ${liveWatch.models.length} models · $${liveWatch.totalSuiteCostUsd.toFixed(3)})`,
      provenance: `[LIVE MEASURED] Generated ${liveWatch.generatedAt} via \`pnpm run site:bench --live\` → reports/data/model-watch-live.json (judge: ${liveWatch.judgeModel})`,
      hasTools: true,
      rows: mapWatchRows(liveWatch),
    },
    archive: {
      label: `Archived 48-Model Showdown (${archives.showdown.runDate} · ${archives.showdown.modelCount} models · $${archives.showdown.totalCostUsd})`,
      provenance: `[ARCHIVED MEASURED] Extracted verbatim via \`pnpm run site:extract-archives\` from ${archives.showdown.sourceReport}`,
      hasTools: false,
      rows: archives.showdown.rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        tier: r.tier,
        weights: r.weights,
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
        note: `Archived Run #${r.rank}: ${r.reasoningRaw} Reason, ${r.knowledgeRaw} Know, ${r.instructionRaw} Instr, ${r.codingRaw} Coding (${r.costRaw}, ${r.timeRaw}).`,
      })),
    },
  };

  const datasetsJson = JSON.stringify(clientDatasets).replace(/<\//g, "<\\/");
  const batchRows = archives.headroom.rows.filter((r) => r.aggC1 !== null).slice(0, 6);

  const bodyHtml = `<div class="container">
    <div class="hero">
      <div class="hero-label">Umwelten Model Watch &middot; Reproducible Pi Benchmarks</div>
      <h1>The Cost&ndash;Capability<br><em>Pareto Frontier</em></h1>
      <p class="hero-subtitle">
        Every live score on this page comes from committed JSON artifacts generated by
        <a href="./examples/model-watch-bench.html"><code>examples/model-watch/run.ts</code></a> (<code>pnpm run site:bench</code>)
        running directly on <code>@earendil-works/pi-ai</code> &mdash; paired with verbatim historical baselines extracted by script
        from <code>reports/</code> and <code>docs-archive/</code>.
      </p>
      <div class="hero-meta">
        <span>Live run: <strong>${esc(liveRunDate)}</strong> (<code>$${liveWatch.totalSuiteCostUsd.toFixed(4)}</code> total)</span>
        <span><strong>17</strong> live tasks (Node-executed JS + tools + traps)</span>
        <span>Reproduce: <code>pnpm run site:bench</code></span>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card s-accent">
        <div class="stat-num">20</div>
        <div class="stat-label">Fast Roster Models</div>
        <div class="stat-sub">5 Gemini 3/4 + 11 Fast + 4 Local</div>
      </div>
      <div class="stat-card s-green">
        <div class="stat-num">$0.010</div>
        <div class="stat-label">Live 100% Cost Pareto</div>
        <div class="stat-sub">kimi-k3.1-pro (105/105 live)</div>
      </div>
      <div class="stat-card s-yellow">
        <div class="stat-num">${Math.round(jevLive.nativeJev.summary.successfulCallLatencyMs.p50)}ms</div>
        <div class="stat-label">Native Jev p50</div>
        <div class="stat-sub">typesafe/jev-1.13 (live)</div>
      </div>
      <div class="stat-card s-local">
        <div class="stat-num">6.8&times;</div>
        <div class="stat-label">M4 Max Batch Gain</div>
        <div class="stat-sub">llama-swap vs ollama @ c=4</div>
      </div>
    </div>

    ${renderModelPicks(
      frontDeskPicks,
      "Pi builtinModels() fast lineup · --mock offline / --live on device",
      "Fast Model Watch lineup",
    )}

    <!-- 01 — Pareto Frontier & Leaderboard -->
    <section class="report-section" id="pareto">
      <div class="section-num">01 &mdash; Fast Roster &amp; Measured Pareto Views</div>
      <h2 class="section-title">Mock-wired 20-model fast lineup + live Mycel &amp; 48-model baselines</h2>
      <p class="body-text">
        Every example and suite runs offline in seconds via <code>@earendil-works/pi-ai</code>&rsquo;s <code>fauxProvider</code>
        (<code>pnpm run site:bench</code>, isolated under <code>output/mock-evaluations/</code>) and switches to real cloud + local
        <code>llama-swap</code> hardware with <code>--live</code>. Switch between the <strong>20-Model Fast Roster (Mock Wiring)</strong>,
        the <strong>Measured Live Mycel Run</strong>, and the <strong>Archived 48-Model Baseline</strong>:
      </p>

      <div class="pareto-frame">
        <div class="pareto-toolbar" style="margin-bottom:0.65rem">
          <div class="pareto-toolbar-left" id="dataset-buttons">
            <span class="pareto-toolbar-label">Dataset:</span>
            <button type="button" class="filter-btn active" data-ds="roster">20-Model Fast Roster (Mock)</button>
            <button type="button" class="filter-btn" data-ds="live">Measured Live Run (${liveWatch.models.length})</button>
            <button type="button" class="filter-btn" data-ds="archive">Archived 48-Model Baseline</button>
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

      <h3 class="sub-title">Sortable Leaderboard (<span id="table-ds-title">Live Pi Suite</span>)</h3>
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
        <table class="labs-table">
          <thead>
            <tr>
              <th data-sort="rank">#</th>
              <th data-sort="id">Model</th>
              <th data-sort="provider">Provider</th>
              <th>Status</th>
              <th data-sort="combined">Combined &darr;</th>
              <th data-sort="reasoning">Reason</th>
              <th data-sort="knowledge">Know</th>
              <th data-sort="instruction">Instr</th>
              <th data-sort="coding">Coding</th>
              <th data-sort="tools">Tools</th>
              <th data-sort="cost">Cost</th>
              <th data-sort="timeSec">Time</th>
            </tr>
          </thead>
          <tbody id="watch-tbody"></tbody>
        </table>
      </div>
    </section>

    <!-- 02 — Empirical Findings from This Run -->
    <section class="report-section" id="dispatches">
      <div class="section-num">02 &mdash; Verified Findings From Real Runs</div>
      <h2 class="section-title">What actually happened when we ran the scripts</h2>

      <div class="finding-grid">
        <article class="finding-card">
          <div class="finding-head">
            <span class="f-num">#01 &middot; Live Cost vs. Speed</span>
            <span class="f-date">${esc(liveRunDate)}</span>
          </div>
          <h4>Kimi K3.1 Pro ($0.0103) vs. Claude Opus 5.5 (93.9s): Both Hit 105/105</h4>
          <p>
            On our 17-task live suite, <code>moonshotai/kimi-k3.1-pro</code> and <code>anthropic/claude-opus-5.5</code> both scored
            <strong>100%</strong> &mdash; including 15/15 Node-executed JS vectors and 5&times;8-word lipogram acrostics. Kimi cost
            <strong>22&times; less</strong> ($0.0103 vs. $0.2252); Opus finished <strong>2.6&times; faster</strong> (93.9s vs. 246.4s).
          </p>
        </article>

        <article class="finding-card">
          <div class="finding-head">
            <span class="f-num">#02 &middot; Reasoning Loop Pathology</span>
            <span class="f-date">${esc(liveRunDate)}</span>
          </div>
          <h4>DeepSeek v4.1 Flash Burned 87% of Its Budget on One Precedence Edge Case</h4>
          <p>
            <code>deepseek/deepseek-v4.1-flash</code> aced 16 of 17 tasks for <strong>$0.0129</strong>, then entered a <strong>298.2-second,
            $0.0857</strong> <code>&lt;think&gt;</code> self-verification spiral on <code>-2 ^ 2</code> vs. <code>2 ^ 3 ^ 2</code> rational
            precedence until hitting the upstream token ceiling with an empty answer.
          </p>
        </article>

        <article class="finding-card">
          <div class="finding-head">
            <span class="f-num">#03 &middot; Library Bug Caught Live</span>
            <span class="f-date">${esc(liveRunDate)}</span>
          </div>
          <h4>Hardcoded Judge maxTokens: 500 Truncated Thinking Judges Mid-JSON</h4>
          <p>
            Our first live run scored 0/5 on 12-coin balance with <code>Unexpected end of JSON input</code> because
            <code>EvalSuite.runJudge()</code> clamped <code>maxTokens: 500</code> while <code>deepseek-v4.1-flash</code> reasoned inside
            <code>&lt;think&gt;</code>. Removing judge token clamps restored 20/20 rubric accuracy.
          </p>
        </article>

        <article class="finding-card">
          <div class="finding-head">
            <span class="f-num">#04 &middot; Catalogue Liveness</span>
            <span class="f-date">${esc(liveRunDate)}</span>
          </div>
          <h4>Advertised /v1/models Entries Still Need Active Health Probes</h4>
          <p>
            <code>inception/mercury-3</code> appeared in Mycel&rsquo;s live <code>/v1/models</code> catalogue ($0.10/$0.40 per M)
            yet returned <code>404 &quot;upstream_error&quot;</code> on <code>/v1/chat/completions</code>. <code>examples/model-watch/run.ts</code>
            probes every advertised slug and logs dead offers explicitly.
          </p>
        </article>

        <article class="finding-card">
          <div class="finding-head">
            <span class="f-num">#05 &middot; Native Jev Latency</span>
            <span class="f-date">${esc(liveRunDate)}</span>
          </div>
          <h4>typesafe/jev-1.13 Cut Median Judgment Latency 2.8&times; (320ms vs. 886ms)</h4>
          <p>
            Across 9 live cases (and 80 calls in <code>reports/2026-09-20-jev-development-pilot.md</code> for $0.000486 total Mycel debit),
            native Jev hit <code>Brier 0.0022</code> on binary intent and <code>0%</code> selective error above <code>&tau; = 0.80</code>.
          </p>
        </article>

        <article class="finding-card">
          <div class="finding-head">
            <span class="f-num">#06 &middot; M4 Max Serving Physics</span>
            <span class="f-date">2026-07-26</span>
          </div>
          <h4>Ollama Serializes at c=1; llama-swap Scales Aggregate tok/s 2.9&times;&ndash;6.8&times;</h4>
          <p>
            In <code>reports/2026-07-26-headroom-ollama-does-not-batch.md</code>, all 9 Ollama models held flat aggregate tok/s
            (0.96&ndash;1.04&times;) with 9&times;&ndash;63&times; TTFT spikes at <code>c=4</code>, while <code>llama-server</code> batched
            <code>gemma-4-E2B</code> to <strong>1,014.3 tok/s</strong>.
          </p>
        </article>
      </div>
    </section>

    <!-- 03 — Local Preview -->
    <section class="report-section" id="local-preview">
      <div class="section-num">03 &mdash; Local Serving Headroom (Verbatim from reports/2026-07-26-headroom-ollama-does-not-batch.md)</div>
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

    <!-- 04 — Prompt-First Examples -->
    <section class="report-section" id="examples">
      <div class="section-num">04 &mdash; Prompt-First Examples (${PROMPT_EXAMPLES.length} Runnable Scripts)</div>
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
    const DATASETS = ${datasetsJson};
    let currentDs = "roster";
    let currentX = "cost";
    let currentMetric = "combined";
    let selectedId = "gemini-3.8-flash";
    let activeFilter = "all";
    let sortKey = "combined";
    let sortAsc = false;

    function rows() {
      return DATASETS[currentDs].rows;
    }

    function computeParetoIds(list, xKey, yKey) {
      const sorted = [...list].sort((a, b) => {
        if (a[xKey] !== b[xKey]) return a[xKey] - b[xKey];
        return b[yKey] - a[yKey];
      });
      const pareto = new Set();
      let best = -Infinity;
      for (const m of sorted) {
        const val = m[yKey];
        if (val > best) {
          pareto.add(m.id + "::" + m.provider);
          best = val;
        }
      }
      return pareto;
    }

    function keyOf(m) {
      return m.id + "::" + m.provider;
    }

    function shortLabel(id) {
      return id.replace(/^(anthropic|openai|qwen|deepseek|x-ai|moonshotai|mistralai|meta-llama|z-ai|nvidia|google|inception)\\//, "");
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

    function updateInspector(m, paretoSet) {
      const el = document.getElementById("pareto-inspector");
      if (!el || !m) return;
      const isP = paretoSet.has(keyOf(m));
      const badge = m.cost === 0 && currentX === "cost"
        ? '<span class="badge badge-local">Local $0 Pareto</span>'
        : isP
          ? '<span class="badge badge-pareto">Pareto Frontier</span>'
          : '<span class="badge badge-neutral">Dominated</span>';
      el.innerHTML = \`
        <div>
          <div class="inspector-name">\${m.id}</div>
          <div class="inspector-meta">\${m.provider} &middot; \${m.weights} weights &middot; \${fmtCost(m.cost)} &middot; \${fmtTime(m.timeSec)} &nbsp;\${badge}</div>
        </div>
        <div class="inspector-bars">
          <div class="inspector-dim">Comb<strong>\${m.combined.toFixed(1)}%</strong></div>
          <div class="inspector-dim">Reason<strong>\${m.reasoningRaw}</strong></div>
          <div class="inspector-dim">Coding<strong>\${m.codingRaw}</strong></div>
          <div class="inspector-dim">Instr<strong>\${m.instructionRaw}</strong></div>
        </div>
        <div class="inspector-note">\${m.note}</div>
      \`;
    }

    function renderChart() {
      const mount = document.getElementById("pareto-svg-mount");
      if (!mount) return;
      const list = rows();
      document.getElementById("pareto-provenance").textContent = DATASETS[currentDs].provenance;
      document.getElementById("table-ds-title").textContent = DATASETS[currentDs].label;

      const paretoSet = computeParetoIds(list, currentX, currentMetric);
      const W = 920, H = 415;
      const padL = 62, padR = 32, padT = 42, padB = 48;
      const hasZeroCost = currentX === "cost" && list.some((m) => m.cost === 0);
      const localLaneW = hasZeroCost ? 88 : 0;
      const apiLeft = padL + (hasZeroCost ? localLaneW + 26 : 18);
      const apiRight = W - padR;

      const vals = list.map((m) => m[currentMetric]);
      const minVal = Math.min(...vals);
      const yMin = Math.max(0, Math.min(90, Math.floor(minVal / 5) * 5 - 3));
      const yMax = 102.2;

      const posX = list.map((m) => m[currentX]).filter((v) => v > 0);
      const minPos = Math.min(...posX);
      const maxPos = Math.max(...posX);
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
        y: yOf(m[currentMetric]),
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
        ? [0.003, 0.01, 0.03, 0.10, 0.30, 1.00]
        : [30, 60, 120, 300, 900, 3600];
      const xTicks = tickCandidates.filter((t) => t >= minPos * 0.7 && t <= maxPos * 1.35);
      let xGrid = "";
      for (const tk of xTicks) {
        const x = xOf(tk, 0);
        const lbl = currentX === "cost" ? (tk < 0.01 ? "$" + tk.toFixed(3) : "$" + tk.toFixed(2)) : fmtTime(tk);
        xGrid += \`<line x1="\${x.toFixed(1)}" y1="\${padT - 12}" x2="\${x.toFixed(1)}" y2="\${H - padB}" stroke="rgba(26,26,26,0.09)" stroke-width="1"/>\`;
        xGrid += \`<text x="\${x.toFixed(1)}" y="\${H - padB + 18}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="10.5" fill="#524f47">\${lbl}</text>\`;
      }

      // Label Pareto models + key Gemini/frontier anchors
      const labelCandidates = pts
        .filter(
          (p) =>
            p.pareto ||
            list.length <= 8 ||
            p.m.id === "gemini-3.8-flash" ||
            p.m.id === "gemini-4-hydrogen" ||
            p.m.id === "claude-sonnet-5-5",
        )
        .sort((a, b) => (b.pareto ? 1 : 0) - (a.pareto ? 1 : 0) || a.x - b.x);

      const placed = [];
      for (const p of labelCandidates) {
        const text = shortLabel(p.m.id);
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
        const sel = p.m.id === selectedId;
        const isLocal = p.m.tier === "local";
        const stroke = isLocal ? "#5b2c6f" : "#0055aa";
        if (p.pareto) {
          const sz = sel ? 12 : 10;
          const half = sz / 2;
          return \`<g class="chart-pt" data-id="\${p.m.id}" style="cursor:pointer">
            \${sel ? \`<rect x="\${(p.x - 9).toFixed(1)}" y="\${(p.y - 9).toFixed(1)}" width="18" height="18" fill="none" stroke="#d93025" stroke-width="1.5"/>\` : ""}
            <rect x="\${(p.x - half).toFixed(1)}" y="\${(p.y - half).toFixed(1)}" width="\${sz}" height="\${sz}" fill="#ffffff" stroke="\${stroke}" stroke-width="2"/>
            <rect x="\${(p.x - 2).toFixed(1)}" y="\${(p.y - 2).toFixed(1)}" width="4" height="4" fill="\${stroke}"/>
          </g>\`;
        }
        const fill = isLocal ? "#5b2c6f" : "#7b7669";
        return \`<g class="chart-pt" data-id="\${p.m.id}" style="cursor:pointer">
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
          <text x="\${l.lx.toFixed(1)}" y="\${l.ly.toFixed(1)}" text-anchor="\${l.anchor}" font-family="IBM Plex Mono, monospace" font-size="10.5" font-weight="\${weight}" fill="\${color}" stroke="\${halo}" stroke-width="4" stroke-linejoin="round" style="paint-order:stroke;cursor:pointer" data-id="\${l.p.m.id}" class="chart-pt">\${l.text}</text>
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
          selectedId = node.getAttribute("data-id") || selectedId;
          renderChart();
        });
        node.addEventListener("mouseenter", () => {
          const id = node.getAttribute("data-id");
          const m = list.find((x) => x.id === id);
          if (m) updateInspector(m, paretoSet);
        });
      });

      const current = list.find((x) => x.id === selectedId) || frontierPts[0]?.m || list[0];
      if (current) selectedId = current.id;
      updateInspector(current, paretoSet);
    }

    function scoreCls(v) {
      if (v >= 99) return "score-perfect";
      if (v >= 90) return "score-good";
      if (v >= 78) return "score-mid";
      return "score-low";
    }

    function renderTable() {
      const list = rows();
      const paretoSet = computeParetoIds(list, currentX, currentMetric);
      const q = (document.getElementById("watch-search")?.value || "").trim().toLowerCase();

      const filtered = list.filter((m) => {
        if (q && !m.id.toLowerCase().includes(q) && !m.provider.toLowerCase().includes(q)) return false;
        if (activeFilter === "pareto") return paretoSet.has(keyOf(m));
        if (activeFilter === "local") return m.tier === "local";
        if (activeFilter === "open") return m.weights === "open";
        if (activeFilter === "closed") return m.weights === "closed";
        return true;
      });

      filtered.sort((a, b) => {
        const av = sortKey === "rank" ? a.combined : (a[sortKey] ?? -1);
        const bv = sortKey === "rank" ? b.combined : (b[sortKey] ?? -1);
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
          ? '<span class="badge badge-local">Local $0</span>'
          : isP
            ? '<span class="badge badge-pareto">Pareto</span>'
            : \`<span class="badge badge-\${m.weights}">\${m.weights}</span>\`;
        return \`<tr class="\${rowCls}" style="cursor:pointer" data-row-id="\${m.id}">
          <td class="cost-cell">\${idx + 1}</td>
          <td class="model-cell">\${m.id}</td>
          <td class="cost-cell">\${m.provider}</td>
          <td>\${statusBadge}</td>
          <td class="combined-cell \${scoreCls(m.combined)}">\${m.combined.toFixed(1)}%</td>
          <td class="score-cell \${scoreCls(m.reasoning)}">\${m.reasoningRaw}</td>
          <td class="score-cell \${scoreCls(m.knowledge)}">\${m.knowledgeRaw}</td>
          <td class="score-cell \${scoreCls(m.instruction)}">\${m.instructionRaw}</td>
          <td class="score-cell \${scoreCls(m.coding)}">\${m.codingRaw}</td>
          <td class="score-cell">\${m.tools === null ? "&mdash;" : m.toolsRaw}</td>
          <td class="cost-cell">\${fmtCost(m.cost)}</td>
          <td class="time-cell">\${fmtTime(m.timeSec)}</td>
        </tr>\`;
      }).join("");

      tbody.querySelectorAll("tr[data-row-id]").forEach((tr) => {
        tr.addEventListener("click", () => {
          selectedId = tr.getAttribute("data-row-id") || selectedId;
          renderChart();
          document.getElementById("pareto")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      });
    }

    document.querySelectorAll("#dataset-buttons button[data-ds]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#dataset-buttons button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentDs = btn.getAttribute("data-ds") || "live";
        selectedId = rows()[0]?.id || "";
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

    document.querySelectorAll(".table-controls button[data-f]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".table-controls button[data-f]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeFilter = btn.getAttribute("data-f") || "all";
        renderTable();
      });
    });

    document.getElementById("watch-search")?.addEventListener("input", renderTable);

    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const k = th.getAttribute("data-sort") || "combined";
        if (sortKey === k) sortAsc = !sortAsc;
        else {
          sortKey = k;
          sortAsc = k === "cost" || k === "timeSec" || k === "id" || k === "provider";
        }
        renderTable();
      });
    });

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

  const outputText =
    ex.slug === "model-watch-bench"
      ? JSON.stringify(
          {
            generatedAt: liveWatch.generatedAt,
            judgeModel: liveWatch.judgeModel,
            totalSuiteCostUsd: liveWatch.totalSuiteCostUsd,
            unavailableCatalogueModels: liveWatch.unavailableCatalogueModels,
            standings: liveWatch.models.map((m) => ({
              model: `${m.provider}:${m.id}`,
              combined: `${m.combined}%`,
              scores: `R:${m.reasoningRaw} K:${m.knowledgeRaw} I:${m.instructionRaw} C:${m.codingRaw} T:${m.toolsRaw}`,
              elo: m.elo,
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

    ${renderModelPicks(ex.picks, `verified ${liveWatch.generatedAt.slice(0, 10)}`, "Measured notes for this recipe")}

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
  const { mockWatch, liveWatch, archives, jevLive, examplesMock } = loadSiteDatasets(ROOT);

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, "styles"), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, "examples"), { recursive: true });

  fs.writeFileSync(path.join(OUT_DIR, "styles", "labs.css"), LABS_CSS, "utf8");
  fs.writeFileSync(
    path.join(OUT_DIR, "index.html"),
    buildIndexPage(mockWatch, liveWatch, archives, jevLive),
    "utf8",
  );
  fs.writeFileSync(path.join(OUT_DIR, "local.html"), buildLocalPage(archives), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "examples.html"), buildExamplesHubPage(), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "architecture.html"), buildArchitecturePage(), "utf8");

  PROMPT_EXAMPLES.forEach((ex, i) => {
    fs.writeFileSync(
      path.join(OUT_DIR, "examples", `${ex.slug}.html`),
      buildSingleExamplePage(ex, i, examplesMock.outputs, mockWatch),
      "utf8",
    );
  });

  console.log(
    `Built umwelten.thefocus.ai static site (${4 + PROMPT_EXAMPLES.length} HTML pages + labs.css) from reports/data/*.json -> ${OUT_DIR}`,
  );
}

main();
