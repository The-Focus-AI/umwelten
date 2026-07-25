/**
 * Self-contained HTML report.
 *
 * No build step, no CDN, no external fonts — one string you can open, email, or
 * push to artifacts.thefocus.ai. The chart is inline SVG with a hover crosshair;
 * every table is also the data behind it, so nothing is color-only.
 *
 * Palette: categorical slots 1 and 2 from the validated default, stepped
 * separately for each mode (validated with scripts/validate_palette.js — all
 * checks pass in both light and dark).
 */

import type { FissionReport } from "./build-report.js";

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pct(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

function num(value: number): string {
  return value.toLocaleString("en-US");
}

function usd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/** Line chart: prompt tokens sent per turn, tree vs one-long-chat baseline. */
function renderChart(report: FissionReport): string {
  const points = report.growth;
  if (points.length < 2) {
    return `<p class="empty">Not enough turns yet to plot context growth — this needs at least two.</p>`;
  }

  const W = 720;
  const H = 300;
  const PAD = { top: 20, right: 96, bottom: 40, left: 64 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxY = Math.max(
    ...points.map((p) => Math.max(p.actualTokens, p.baselineTokens)),
    1,
  );
  const niceMax = Math.ceil(maxY / 500) * 500 || 500;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / niceMax) * plotH;

  const line = (get: (p: (typeof points)[number]) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join(" ");

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const value = niceMax * f;
    return `<g><line x1="${PAD.left}" y1="${y(value).toFixed(1)}" x2="${PAD.left + plotW}" y2="${y(value).toFixed(1)}" class="grid"/><text x="${PAD.left - 10}" y="${(y(value) + 4).toFixed(1)}" class="tick" text-anchor="end">${num(Math.round(value))}</text></g>`;
  }).join("");

  // Label at most ~8 turns so the axis stays readable on long runs.
  const xStep = Math.max(1, Math.ceil(points.length / 8));
  const xTicks = points
    .map((p, i) =>
      i % xStep === 0 || i === points.length - 1
        ? `<text x="${x(i).toFixed(1)}" y="${PAD.top + plotH + 16}" class="tick" text-anchor="middle">${p.turnIndex}</text>`
        : "",
    )
    .join("");

  const forkMarks = points
    .map((p, i) =>
      p.forked
        ? `<line x1="${x(i).toFixed(1)}" y1="${PAD.top}" x2="${x(i).toFixed(1)}" y2="${PAD.top + plotH}" class="forkline"/>`
        : "",
    )
    .join("");

  const lastIndex = points.length - 1;
  const lastActual = points[lastIndex].actualTokens;
  const lastBaseline = points[lastIndex].baselineTokens;

  const hotspots = points
    .map(
      (p, i) =>
        `<rect x="${(x(i) - plotW / (points.length - 1) / 2).toFixed(1)}" y="${PAD.top}" width="${(plotW / (points.length - 1)).toFixed(1)}" height="${plotH}" fill="transparent" data-i="${i}" data-turn="${p.turnIndex}" data-node="${esc(p.nodeTitle)}" data-actual="${p.actualTokens}" data-baseline="${p.baselineTokens}" data-x="${x(i).toFixed(1)}"/>`,
    )
    .join("");

  return `
<figure class="chart-figure">
  <figcaption>
    <span class="fig-title">Prompt tokens sent per turn</span>
    <span class="fig-sub">Every turn re-sends its whole context. The gap between the lines is what fission plus per-turn compaction is buying.</span>
  </figcaption>
  <div class="legend">
    <span class="legend-item"><span class="swatch s1"></span>This tree</span>
    <span class="legend-item"><span class="swatch s2"></span>One long chat (never compacted, never forked)</span>
    <span class="legend-item"><span class="swatch fork"></span>Fork</span>
  </div>
  <div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Prompt tokens sent per turn, this tree versus a single uncompacted chat" id="growth">
      ${ticks}
      ${xTicks}
      ${forkMarks}
      <line x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${PAD.left + plotW}" y2="${PAD.top + plotH}" class="axis"/>
      <path d="${line((p) => p.baselineTokens)}" class="series s2" fill="none"/>
      <path d="${line((p) => p.actualTokens)}" class="series s1" fill="none"/>
      <text x="${(PAD.left + plotW + 8).toFixed(1)}" y="${(y(lastActual) + 4).toFixed(1)}" class="endlabel e1">${num(lastActual)}</text>
      <text x="${(PAD.left + plotW + 8).toFixed(1)}" y="${(y(lastBaseline) + 4).toFixed(1)}" class="endlabel e2">${num(lastBaseline)}</text>
      <text x="${PAD.left + plotW / 2}" y="${H - 6}" class="axislabel" text-anchor="middle">turn</text>
      <line id="crosshair" x1="0" y1="${PAD.top}" x2="0" y2="${PAD.top + plotH}" class="crosshair" style="opacity:0"/>
      ${hotspots}
    </svg>
    <div id="tooltip" class="tooltip" hidden></div>
  </div>
</figure>`;
}

function renderDetectorTable(report: FissionReport): string {
  const rows = report.detectors
    .map((row) => {
      const active = row.detectorId === report.config.detectorId;
      return `<tr${active ? ' class="active-row"' : ""}>
      <td>${esc(row.detectorId)}${active ? ' <span class="badge">active</span>' : ""}</td>
      <td class="n">${num(row.scored)}</td>
      <td class="n">${num(row.forks)}</td>
      <td class="n">${num(row.llmCalls)}</td>
      <td class="n">${num(row.meanLatencyMs)} ms</td>
      <td class="n">${usd(row.costUsd)}</td>
      <td class="n">${pct(row.agreementWithActive)}</td>
      <td class="n">${row.labeled.count > 0 ? pct(row.labeled.accuracy) : "—"}</td>
      <td class="n">${row.labeled.count > 0 ? `${row.labeled.count}` : "—"}</td>
    </tr>`;
    })
    .join("");

  const totalLabels = report.stats.labeledTurns;
  const caveat =
    totalLabels === 0
      ? `<p class="caveat">No turns are labeled yet, so the accuracy column is empty. Label decisions in the tree browser (the ✓ / ✗ buttons on each turn) and these numbers become real.</p>`
      : totalLabels < 20
        ? `<p class="caveat">Accuracy is computed over ${totalLabels} labeled turn${totalLabels === 1 ? "" : "s"} — too few to conclude anything. Treat it as a smoke test, not a measurement.</p>`
        : "";

  return `<table>
  <thead><tr><th>Detector</th><th class="n">Scored</th><th class="n">Forks</th><th class="n">LLM calls</th><th class="n">Mean latency</th><th class="n">Cost</th><th class="n">Agreement</th><th class="n">Accuracy</th><th class="n">Labels</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="9" class="empty">No turns yet.</td></tr>`}</tbody>
</table>${caveat}`;
}

function renderCompactionTable(report: FissionReport): string {
  const rows = report.compaction
    .map(
      (row) => `<tr>
      <td>${esc(row.strategyId)}${row.fromPlayground ? ' <span class="badge alt">playground</span>' : ""}</td>
      <td class="n">${num(row.runs)}</td>
      <td class="n">${(row.meanRatio * 100).toFixed(1)}%</td>
      <td class="n">${num(row.meanTokensBefore)}</td>
      <td class="n">${num(row.meanTokensAfter)}</td>
      <td class="n">${num(row.tokensSaved)}</td>
      <td class="n">${num(row.meanLatencyMs)} ms</td>
      <td class="n">${row.errors > 0 ? `<span class="err">${row.errors}</span>` : "0"}</td>
    </tr>`,
    )
    .join("");

  return `<table>
  <thead><tr><th>Strategy</th><th class="n">Runs</th><th class="n">Mean ratio</th><th class="n">Tokens in</th><th class="n">Tokens out</th><th class="n">Saved</th><th class="n">Mean latency</th><th class="n">Errors</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="8" class="empty">No compaction has run yet.</td></tr>`}</tbody>
</table>
<p class="caveat">Rows marked <em>playground</em> were run from the tree browser against a rebuilt raw context, so every strategy there saw byte-identical input. Live rows ran against whatever the context held at the time and are only comparable to each other within one run.</p>`;
}

function renderForks(report: FissionReport): string {
  if (report.forks.length === 0) {
    return `<p class="empty">No forks yet. Either the conversation stayed on one subject, or the threshold (${report.config.driftThreshold}) is too high for it.</p>`;
  }
  return report.forks
    .map(
      (fork) => `<div class="fork-card">
    <div class="fork-head">
      <span class="fork-path">${esc(fork.fromNode)} → <strong>${esc(fork.toNode)}</strong></span>
      <span class="fork-score">drift ${fork.driftScore.toFixed(2)} ≥ ${fork.threshold.toFixed(2)}</span>
      <span class="chip${fork.usedLlm ? "" : " chip-free"}">${fork.usedLlm ? "LLM" : "no model call"}</span>
      ${fork.label ? `<span class="chip chip-label">labeled ${esc(fork.label)}</span>` : ""}
    </div>
    <blockquote>${esc(fork.userText.slice(0, 400))}${fork.userText.length > 400 ? "…" : ""}</blockquote>
    <p class="fork-reason">${esc(fork.reason)}</p>
  </div>`,
    )
    .join("");
}

function renderNodes(report: FissionReport): string {
  const rows = report.nodes
    .map(
      (node) => `<tr>
      <td style="padding-left:${node.depth * 18}px">${node.depth > 0 ? "└ " : ""}${esc(node.title)}</td>
      <td class="n">${node.depth}</td>
      <td class="n">${num(node.turnCount)}</td>
      <td class="n">${node.seedTokens > 0 ? num(node.seedTokens) : "—"}</td>
    </tr>`,
    )
    .join("");
  return `<table>
  <thead><tr><th>Thread</th><th class="n">Depth</th><th class="n">Turns</th><th class="n">Seed tokens</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

export function renderReportHtml(report: FissionReport): string {
  const savings = 1 - report.totals.savingsRatio;
  const savingsLabel =
    report.totals.baselinePromptTokensSent > 0
      ? `${(savings * 100).toFixed(1)}%`
      : "—";
  const avoided = report.totals.detectorCallsAvoided;
  const scored = avoided + report.totals.llmDetectorCalls;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fission report — ${esc(report.title)}</title>
<style>
  :root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --plane: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --muted: #898781;
    --grid: #e1e0d9;
    --axis: #c3c2b7;
    --border: rgba(11,11,11,0.10);
    --series-1: #2a78d6;
    --series-2: #eb6834;
    --critical: #d03b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --plane: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --muted: #898781;
      --grid: #2c2c2a;
      --axis: #383835;
      --border: rgba(255,255,255,0.10);
      --series-1: #3987e5;
      --series-2: #d95926;
      --critical: #d03b3b;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --plane: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --muted: #898781;
    --grid: #2c2c2a;
    --axis: #383835;
    --border: rgba(255,255,255,0.10);
    --series-1: #3987e5;
    --series-2: #d95926;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem 1.25rem 5rem;
    background: var(--plane);
    color: var(--text-primary);
    font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 1.8rem; margin: 0 0 .25rem; letter-spacing: -0.01em; }
  h2 { font-size: 1.15rem; margin: 2.5rem 0 .5rem; letter-spacing: -0.005em; }
  .sub { color: var(--text-secondary); margin: 0 0 2rem; }
  .stat-row { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1.5rem 0; }
  .stat {
    flex: 1 1 150px; background: var(--surface-1); border: 1px solid var(--border);
    border-radius: 10px; padding: .85rem 1rem;
  }
  .stat .value { font-size: 1.6rem; font-weight: 600; letter-spacing: -0.02em; }
  .stat .label { color: var(--text-secondary); font-size: .8rem; margin-top: .15rem; }
  section { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; }
  .chart-wrap { position: relative; overflow-x: auto; }
  svg { width: 100%; height: auto; min-width: 520px; display: block; }
  .grid { stroke: var(--grid); stroke-width: 1; }
  .axis { stroke: var(--axis); stroke-width: 1; }
  .crosshair { stroke: var(--axis); stroke-width: 1; stroke-dasharray: 3 3; }
  .forkline { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 2 4; }
  .tick, .axislabel { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .series { stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .s1 { stroke: var(--series-1); }
  .s2 { stroke: var(--series-2); }
  .endlabel { font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .e1 { fill: var(--series-1); }
  .e2 { fill: var(--series-2); }
  figcaption { display: block; margin-bottom: .75rem; }
  .fig-title { display: block; font-weight: 600; }
  .fig-sub { display: block; color: var(--text-secondary); font-size: .85rem; }
  .legend { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: .5rem; font-size: .82rem; color: var(--text-secondary); }
  .legend-item { display: inline-flex; align-items: center; gap: .4rem; }
  .swatch { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }
  .swatch.s1 { background: var(--series-1); }
  .swatch.s2 { background: var(--series-2); }
  .swatch.fork { background: repeating-linear-gradient(to right, var(--muted) 0 2px, transparent 2px 6px); height: 2px; }
  .tooltip {
    position: absolute; pointer-events: none; background: var(--surface-1);
    border: 1px solid var(--border); border-radius: 8px; padding: .5rem .65rem;
    font-size: .8rem; box-shadow: 0 4px 14px rgba(0,0,0,.12); min-width: 150px;
  }
  .tooltip .tt-title { font-weight: 600; margin-bottom: .25rem; }
  .tooltip .tt-row { display: flex; justify-content: space-between; gap: 1rem; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: .87rem; }
  th, td { text-align: left; padding: .45rem .5rem; border-bottom: 1px solid var(--grid); }
  th { color: var(--text-secondary); font-weight: 600; font-size: .78rem; text-transform: uppercase; letter-spacing: .03em; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .active-row { background: color-mix(in srgb, var(--series-1) 8%, transparent); }
  .badge { font-size: .68rem; padding: .1rem .35rem; border-radius: 4px; border: 1px solid var(--border); color: var(--text-secondary); }
  .badge.alt { font-style: italic; }
  .err { color: var(--critical); font-weight: 600; }
  .caveat, .empty { color: var(--text-secondary); font-size: .85rem; margin: .75rem 0 0; }
  .fork-card { border: 1px solid var(--border); border-radius: 10px; padding: .85rem; margin-bottom: .75rem; }
  .fork-head { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; font-size: .85rem; margin-bottom: .5rem; }
  .fork-score { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .chip { font-size: .7rem; border: 1px solid var(--border); border-radius: 999px; padding: .05rem .5rem; color: var(--text-secondary); }
  .chip-free { border-color: var(--series-1); color: var(--series-1); }
  blockquote { margin: 0 0 .5rem; padding-left: .75rem; border-left: 2px solid var(--axis); color: var(--text-secondary); font-size: .87rem; }
  .fork-reason { margin: 0; font-size: .85rem; }
  dl.config { display: grid; grid-template-columns: max-content 1fr; gap: .2rem 1rem; font-size: .87rem; margin: 0; }
  dt { color: var(--text-secondary); }
  dd { margin: 0; font-variant-numeric: tabular-nums; }
  footer { max-width: 900px; margin: 2rem auto 0; color: var(--muted); font-size: .8rem; }
</style>
</head>
<body>
<main>
  <h1>${esc(report.title)}</h1>
  <p class="sub">Session fission report · ${esc(report.model.provider)}/${esc(report.model.name)} · generated ${esc(report.generatedAt.slice(0, 19).replace("T", " "))} UTC</p>

  <div class="stat-row">
    <div class="stat"><div class="value">${num(report.stats.turnCount)}</div><div class="label">turns</div></div>
    <div class="stat"><div class="value">${num(report.stats.nodeCount)}</div><div class="label">threads</div></div>
    <div class="stat"><div class="value">${num(report.stats.forkCount)}</div><div class="label">forks</div></div>
    <div class="stat"><div class="value">${savingsLabel}</div><div class="label">fewer prompt tokens than one long chat</div></div>
    <div class="stat"><div class="value">${usd(report.totals.answerCostUsd + report.totals.detectorCostUsd)}</div><div class="label">total cost</div></div>
  </div>

  <section>${renderChart(report)}</section>

  <h2>Detectors</h2>
  <section>
    <p class="caveat" style="margin-top:0">Shadow detectors score every turn without acting on it, so the cheap ones are measured against the expensive one on identical input. <em>Agreement</em> is how often a detector matched the one that actually decided; it says nothing about who was right.</p>
    ${renderDetectorTable(report)}
  </section>

  <h2>Detection cost</h2>
  <section>
    <p style="margin-top:0">The active detector (<strong>${esc(report.config.detectorId)}</strong>) scored ${num(scored)} turn${scored === 1 ? "" : "s"} and made ${num(report.totals.llmDetectorCalls)} model call${report.totals.llmDetectorCalls === 1 ? "" : "s"} — ${num(avoided)} decided by the free lexical gate alone.</p>
    <p class="caveat">Per-turn detection is only viable if most turns never reach the judge. That ratio, not the accuracy, is what decides whether this can run on every message.</p>
  </section>

  <h2>Compaction</h2>
  <section>${renderCompactionTable(report)}</section>

  <h2>Forks</h2>
  <section>${renderForks(report)}</section>

  <h2>Threads</h2>
  <section>${renderNodes(report)}</section>

  <h2>Configuration</h2>
  <section>
    <dl class="config">
      <dt>detector</dt><dd>${esc(report.config.detectorId)}</dd>
      <dt>shadow detectors</dt><dd>${esc(report.config.shadowDetectorIds.join(", ") || "none")}</dd>
      <dt>compaction</dt><dd>${esc(report.config.compactionStrategyId)}</dd>
      <dt>carry-over</dt><dd>${esc(report.config.carryoverStrategyId)}</dd>
      <dt>drift threshold</dt><dd>${report.config.driftThreshold}</dd>
      <dt>compact every turn</dt><dd>${report.config.compactEveryTurn ? "yes" : `no — above ${num(report.config.compactAboveTokens)} tokens`}</dd>
      <dt>keep recent messages</dt><dd>${report.config.keepRecentMessages}</dd>
      <dt>auto-fork</dt><dd>${report.config.autoFork ? "yes" : "no (proposals recorded only)"}</dd>
    </dl>
  </section>
</main>
<footer>Generated by <code>umwelten fission report</code> · tree ${esc(report.treeId)}</footer>
<script>
(function () {
  var svg = document.getElementById('growth');
  if (!svg) return;
  var tooltip = document.getElementById('tooltip');
  var crosshair = document.getElementById('crosshair');
  var wrap = svg.parentElement;

  svg.addEventListener('mousemove', function (event) {
    var target = event.target;
    if (!target || !target.dataset || target.dataset.turn === undefined) return;
    var d = target.dataset;
    crosshair.setAttribute('x1', d.x);
    crosshair.setAttribute('x2', d.x);
    crosshair.style.opacity = '1';
    tooltip.hidden = false;
    tooltip.innerHTML =
      '<div class="tt-title">Turn ' + d.turn + ' · ' + d.node + '</div>' +
      '<div class="tt-row"><span>This tree</span><span>' + Number(d.actual).toLocaleString() + '</span></div>' +
      '<div class="tt-row"><span>One long chat</span><span>' + Number(d.baseline).toLocaleString() + '</span></div>';
    var rect = wrap.getBoundingClientRect();
    var left = event.clientX - rect.left + 14;
    if (left + 190 > rect.width) left = event.clientX - rect.left - 190;
    tooltip.style.left = left + 'px';
    tooltip.style.top = (event.clientY - rect.top - 10) + 'px';
  });

  svg.addEventListener('mouseleave', function () {
    tooltip.hidden = true;
    crosshair.style.opacity = '0';
  });
})();
</script>
</body>
</html>`;
}
