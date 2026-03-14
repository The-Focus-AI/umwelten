import fs from 'node:fs';
import path from 'node:path';

const EVAL_ID = 'rivian-10day';
const EXPECTED_START = '2026-02-27';
const EXPECTED_END = '2026-03-08';
const RIVIAN_PROMPT =
  `look through my real data and summarize the 10 days of the rivians activity between february 27 and march 8 2026. ` +
  `if there were any notable trips, create a narrative of the time frame. ` +
  `today is mar 8 2026 and make sure that you include full 10 days, so if you don't ` +
  `have any drives and chargers in february its obviously false.`;

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface ToolUsage {
  calls: ToolCall[];
  called_list_vehicles: boolean;
  called_get_drives: boolean;
  called_get_charges: boolean;
  drives_start_date: string | null;
  drives_end_date: string | null;
  charges_start_date: string | null;
  charges_end_date: string | null;
  drives_has_date_range: boolean;
  charges_has_date_range: boolean;
  dates_cover_feb27: boolean;
  tool_score: number;
  tool_score_breakdown: string;
}

interface Tokens {
  promptTokens?: number;
  completionTokens?: number;
  total?: number;
}

interface JudgeResult {
  covers_full_date_range: boolean;
  has_trip_narrative: boolean;
  narrative_quality: number;
  factual_grounding: number;
  overall_score: number;
  explanation: string;
}

interface StoredResult {
  model: string;
  provider: string;
  responseText: string;
  durationMs: number;
  cost: number;
  tokens: Tokens | null;
  toolUsage: ToolUsage;
  error?: string;
  judge?: JudgeResult | null;
  judgeError?: string;
}

type EntryStatus = 'success' | 'response-error' | 'judge-error' | 'ungjudged';

interface ReportEntry extends StoredResult {
  key: string;
  label: string;
  responseFile?: string;
  resultFile?: string;
  status: EntryStatus;
  durationSec: number;
  totalScore: number | null;
  pointsPerDollar: number | null;
  pointsPerSecond: number | null;
  isCloud: boolean;
  isPerfect: boolean;
  isHighQuality: boolean;
  costLabel: string;
  searchText: string;
  responseHtml: string;
  explanationHtml: string;
  toolCallsHtml: string;
}

function emptyToolUsage(): ToolUsage {
  return {
    calls: [],
    called_list_vehicles: false,
    called_get_drives: false,
    called_get_charges: false,
    drives_start_date: null,
    drives_end_date: null,
    charges_start_date: null,
    charges_end_date: null,
    drives_has_date_range: false,
    charges_has_date_range: false,
    dates_cover_feb27: false,
    tool_score: 0,
    tool_score_breakdown: '',
  };
}

function parseRunFlag(): number | null {
  const idx = process.argv.indexOf('--run');
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  const n = parseInt(process.argv[idx + 1], 10);
  return Number.isNaN(n) ? null : n;
}

function formatRunId(run: number): string {
  return String(run).padStart(3, '0');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function inlineMarkdown(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\n/g, '<br />');
  return html;
}

function renderMarkdown(markdown: string): string {
  const src = markdown.replace(/\r\n/g, '\n').trim();
  if (!src) return '<p class="muted">No content.</p>';

  const codeBlocks: string[] = [];
  const withPlaceholders = src.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang = '', code = '') => {
    const token = `@@CODEBLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(`<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(code.trim())}</code></pre>`);
    return token;
  });

  const lines = withPlaceholders.split('\n');
  const blocks: string[] = [];
  let i = 0;

  const isTableSeparator = (line: string) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
  const isTableLine = (line: string) => line.includes('|');

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^@@CODEBLOCK_\d+@@$/.test(trimmed)) {
      blocks.push(trimmed);
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push('<hr />');
      i += 1;
      continue;
    }

    if (isTableLine(trimmed) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = trimmed;
      const body: string[] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && isTableLine(lines[i].trim())) {
        body.push(lines[i].trim());
        i += 1;
      }
      const parseCells = (row: string) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const headCells = parseCells(header);
      const bodyRows = body.map(parseCells);
      blocks.push(
        `<table><thead><tr>${headCells.map(c => `<th>${inlineMarkdown(c)}</th>`).join('')}</tr></thead>` +
        `<tbody>${bodyRows.map(row => `<tr>${row.map(c => `<td>${inlineMarkdown(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(`<ul>${items.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`);
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const current = lines[i].trim();
      if (!current) break;
      if (/^@@CODEBLOCK_\d+@@$/.test(current)) break;
      if (/^(#{1,6})\s+/.test(current)) break;
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(current)) break;
      if (/^[-*]\s+/.test(current)) break;
      if (isTableLine(current) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) break;
      paragraphLines.push(current);
      i += 1;
    }
    blocks.push(`<p>${inlineMarkdown(paragraphLines.join('\n'))}</p>`);
  }

  let html = blocks.join('\n');
  html = html.replace(/@@CODEBLOCK_(\d+)@@/g, (_, index) => codeBlocks[Number(index)] ?? '');
  return html;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatMaybe(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function entryKey(model: string, provider: string): string {
  return `${provider}:${model}`;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function compareDescNullable(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function compareAscNullable(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function deriveEntry(base: Partial<StoredResult> & { key: string; label: string; responseFile?: string; resultFile?: string }): ReportEntry {
  const toolUsage = base.toolUsage ?? emptyToolUsage();
  const judge = base.judge ?? null;
  const durationMs = base.durationMs ?? 0;
  const cost = base.cost ?? 0;
  const durationSec = durationMs / 1000;
  const totalScore = judge ? judge.overall_score + toolUsage.tool_score : null;
  const isCloud = (base.provider ?? '') !== 'ollama';
  const status: EntryStatus = base.error
    ? 'response-error'
    : judge
      ? 'success'
      : base.judgeError
        ? 'judge-error'
        : 'ungjudged';

  const pointsPerDollar = judge && cost > 0 ? totalScore! / cost : null;
  const pointsPerSecond = judge && durationSec > 0 ? totalScore! / durationSec : null;
  const costLabel = cost > 0 ? formatCurrency(cost) : isCloud ? '$0.0000' : 'local';
  const responseText = base.responseText ?? '';
  const explanation = judge?.explanation ?? base.judgeError ?? base.error ?? 'No explanation available.';
  const toolCallsHtml = toolUsage.calls.length
    ? `<ol>${toolUsage.calls.map(call => `<li><code>${escapeHtml(call.name)}</code><pre>${escapeHtml(JSON.stringify(call.args, null, 2))}</pre></li>`).join('')}</ol>`
    : '<p class="muted">No tool calls recorded.</p>';

  const searchText = [
    base.label,
    base.provider ?? '',
    base.model ?? '',
    responseText,
    explanation,
    toolUsage.tool_score_breakdown,
    base.error ?? '',
    base.judgeError ?? '',
  ].join(' ').toLowerCase();

  return {
    model: base.model ?? 'unknown',
    provider: base.provider ?? 'unknown',
    responseText,
    durationMs,
    cost,
    tokens: base.tokens ?? null,
    toolUsage,
    error: base.error,
    judge,
    judgeError: base.judgeError,
    key: base.key,
    label: base.label,
    responseFile: base.responseFile,
    resultFile: base.resultFile,
    status,
    durationSec,
    totalScore,
    pointsPerDollar,
    pointsPerSecond,
    isCloud,
    isPerfect: totalScore === 15,
    isHighQuality: judge !== null && toolUsage.tool_score === 5 && judge.overall_score >= 9,
    costLabel,
    searchText,
    responseHtml: renderMarkdown(responseText),
    explanationHtml: renderMarkdown(explanation),
    toolCallsHtml,
  };
}

function loadRunEntries(runDir: string): ReportEntry[] {
  const responsesDir = path.join(runDir, 'responses');
  const resultsDir = path.join(runDir, 'results');
  const merged = new Map<string, Partial<StoredResult> & { key: string; label: string; responseFile?: string; resultFile?: string }>();

  if (fs.existsSync(responsesDir)) {
    for (const file of fs.readdirSync(responsesDir).filter(f => f.endsWith('.json'))) {
      const responsePath = path.join(responsesDir, file);
      const data = readJson<StoredResult>(responsePath);
      if (!data.model || !data.provider) continue;
      const key = entryKey(data.model, data.provider);
      const existing = merged.get(key) ?? { key, label: key };
      merged.set(key, { ...existing, ...data, responseFile: file });
    }
  }

  if (fs.existsSync(resultsDir)) {
    for (const file of fs.readdirSync(resultsDir).filter(f => f.endsWith('.json'))) {
      const resultPath = path.join(resultsDir, file);
      const data = readJson<StoredResult>(resultPath);
      if (!data.model || !data.provider) continue;
      const key = entryKey(data.model, data.provider);
      const existing = merged.get(key) ?? { key, label: key };
      merged.set(key, { ...existing, ...data, resultFile: file });
    }
  }

  return [...merged.values()].map(deriveEntry).sort((a, b) => a.label.localeCompare(b.label));
}

function sortByQuality(a: ReportEntry, b: ReportEntry): number {
  return compareDescNullable(a.totalScore, b.totalScore)
    || compareDescNullable(a.judge?.overall_score ?? null, b.judge?.overall_score ?? null)
    || (b.toolUsage.tool_score - a.toolUsage.tool_score)
    || compareAscNullable(a.durationSec, b.durationSec)
    || compareAscNullable(a.isCloud ? a.cost : null, b.isCloud ? b.cost : null)
    || a.label.localeCompare(b.label);
}

function sortByValue(a: ReportEntry, b: ReportEntry): number {
  return compareDescNullable(a.pointsPerDollar, b.pointsPerDollar)
    || compareDescNullable(a.totalScore, b.totalScore)
    || compareAscNullable(a.durationSec, b.durationSec)
    || compareAscNullable(a.cost, b.cost)
    || a.label.localeCompare(b.label);
}

function sortBySpeed(a: ReportEntry, b: ReportEntry): number {
  return compareAscNullable(a.durationSec, b.durationSec)
    || compareDescNullable(a.totalScore, b.totalScore)
    || compareAscNullable(a.cost, b.cost)
    || a.label.localeCompare(b.label);
}

function sortByCheapest(a: ReportEntry, b: ReportEntry): number {
  return compareAscNullable(a.isCloud ? a.cost : null, b.isCloud ? b.cost : null)
    || compareDescNullable(a.totalScore, b.totalScore)
    || compareAscNullable(a.durationSec, b.durationSec)
    || a.label.localeCompare(b.label);
}

function medal(index: number): string {
  return ['🥇', '🥈', '🥉'][index] ?? '•';
}

function mdTable(headers: string[], rows: string[][]): string {
  const header = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${row.join(' | ')} |`).join('\n');
  return [header, separator, body].filter(Boolean).join('\n');
}

function buildFindings(entries: ReportEntry[]) {
  const successes = entries.filter(e => e.status === 'success');
  const failures = entries.filter(e => e.status !== 'success');
  const byQuality = [...successes].sort(sortByQuality);
  const byValue = [...successes].filter(e => e.isCloud && e.pointsPerDollar !== null).sort(sortByValue);
  const fastHighQuality = [...successes].filter(e => e.isHighQuality).sort(sortBySpeed);
  const perfect = [...successes].filter(e => e.isPerfect).sort(sortBySpeed);
  const local = [...successes].filter(e => !e.isCloud).sort(sortByQuality);
  const cloud = [...successes].filter(e => e.isCloud).sort(sortByQuality);
  const cheapestPerfectCloud = [...perfect].filter(e => e.isCloud && e.cost > 0).sort(sortByCheapest)[0] ?? null;
  const bestOverall = byQuality[0] ?? null;
  const fastestPerfect = perfect[0] ?? null;
  const bestValue = byValue[0] ?? null;
  const bestLocal = local[0] ?? null;
  const bestCloud = cloud[0] ?? null;

  return {
    entries,
    successes,
    failures,
    byQuality,
    byValue,
    fastHighQuality,
    perfect,
    bestOverall,
    fastestPerfect,
    cheapestPerfectCloud,
    bestValue,
    bestLocal,
    bestCloud,
  };
}

function buildExecutiveSummary(runId: string, data: ReturnType<typeof buildFindings>): string {
  const parts: string[] = [`# Rivian 10-Day Evaluation Report`, '', `Run **${runId}** evaluates how well models summarize the Rivian activity for **${EXPECTED_START} → ${EXPECTED_END}** using TezLab MCP tools and an LLM judge.`];

  if (data.bestOverall) {
    parts.push('', '## Executive summary', '', `- **Best overall quality:** **${data.bestOverall.label}** with **${data.bestOverall.totalScore}/15** (${data.bestOverall.judge!.overall_score}/10 LLM + ${data.bestOverall.toolUsage.tool_score}/5 tools).`);
  }
  if (data.fastestPerfect) {
    parts.push(`- **Fastest perfect result:** **${data.fastestPerfect.label}** at **${data.fastestPerfect.durationSec.toFixed(1)}s**.`);
  }
  if (data.cheapestPerfectCloud) {
    parts.push(`- **Cheapest perfect cloud result:** **${data.cheapestPerfectCloud.label}** at **${data.cheapestPerfectCloud.costLabel}**.`);
  }
  if (data.bestValue) {
    parts.push(`- **Best cloud value:** **${data.bestValue.label}** at **${formatMaybe(data.bestValue.pointsPerDollar)} pts/$**.`);
  }
  parts.push(`- **Successful judged models:** **${data.successes.length}/${data.entries.length}**.`);
  if (data.failures.length) {
    parts.push(`- **Models with errors or missing judgments:** **${data.failures.length}**.`);
  }
  return parts.join('\n');
}

function buildMethodology(entries: ReportEntry[]): string {
  const providers = [...new Set(entries.map(e => e.provider))].sort();
  return [
    '## How the test was run',
    '',
    `- **Prompt:** \`${RIVIAN_PROMPT}\``,
    `- **Required coverage window:** **${EXPECTED_START}** through **${EXPECTED_END}**.`,
    `- **Data source:** TezLab MCP tools connected to the real Rivian data.`,
    `- **Providers in this run:** ${providers.map(p => `\`${p}\``).join(', ')}.`,
    '- **Execution model:** sequential model runs against a shared MCP connection, with per-run response caching.',
    '- **Resumability:** interrupted runs reuse cached response/result files; this report also recovers orphan cached results from the run directory.',
    '- **Judge model:** Claude Haiku 4.5 via OpenRouter when available, otherwise local fallback.',
  ].join('\n');
}

function buildScoring(): string {
  return [
    '## How to score the results',
    '',
    'The report separates **quality**, **speed**, and **cost** instead of pretending there is one perfect metric.',
    '',
    '### Deterministic tool score (0–5)',
    '',
    '- Called `get_drives`',
    '- Called `get_charges`',
    '- `get_drives` included a `start_date`',
    '- `get_charges` included a `start_date`',
    `- At least one call started on or before **${EXPECTED_START}**`,
    '',
    '### LLM judge score (0–10)',
    '',
    'The judge scores whether the final text is actually good:',
    '',
    '- **covers full date range**',
    '- **has trip narrative**',
    '- **narrative quality** (1–5)',
    '- **factual grounding** (1–5)',
    '- **overall score** (1–10)',
    '',
    '### Final score',
    '',
    '- **Total quality score = overall_score + tool_score** → **0–15**',
    '- **pts/$** = total score divided by metered cloud cost',
    '- **pts/s** = total score divided by runtime in seconds',
    '',
    '### Best way to read the report',
    '',
    '- Use **Final Rankings** for best raw quality.',
    '- Use **Best Cloud Value** for price-sensitive decisions.',
    '- Use **Fastest High-Quality** when latency matters.',
  ].join('\n');
}

function buildFindingsMarkdown(data: ReturnType<typeof buildFindings>): string {
  const lines: string[] = ['## Key findings', ''];
  if (data.fastestPerfect && data.fastHighQuality.length) {
    lines.push(`- **Speed surprise:** **${data.fastestPerfect.label}** was the fastest perfect result at **${data.fastestPerfect.durationSec.toFixed(1)}s**.`);
  }
  if (data.bestValue) {
    lines.push(`- **Value leader:** **${data.bestValue.label}** delivered **${formatMaybe(data.bestValue.pointsPerDollar)} pts/$** while still scoring **${data.bestValue.totalScore}/15**.`);
  }
  if (data.bestLocal) {
    lines.push(`- **Best local option:** **${data.bestLocal.label}** finished at **${data.bestLocal.totalScore}/15** in **${data.bestLocal.durationSec.toFixed(1)}s**.`);
  }
  if (data.bestCloud) {
    lines.push(`- **Best cloud quality:** **${data.bestCloud.label}** reached **${data.bestCloud.totalScore}/15** at **${data.bestCloud.costLabel}**.`);
  }
  if (data.failures.length) {
    lines.push(`- **Failures still matter:** ${data.failures.length} model(s) ended with response or judge errors and should not be ignored in model selection.`);
  }
  lines.push('', '### Top quality leaders', '');
  lines.push(mdTable(
    ['Rank', 'Model', 'Total', 'Time', 'Cost'],
    data.byQuality.slice(0, 10).map((entry, index) => [medal(index), entry.label, `${entry.totalScore}/15`, `${entry.durationSec.toFixed(1)}s`, entry.costLabel])
  ));

  if (data.byValue.length) {
    lines.push('', '### Best cloud value', '', mdTable(
      ['Rank', 'Model', 'Total', 'Cost', 'pts/$'],
      data.byValue.slice(0, 10).map((entry, index) => [medal(index), entry.label, `${entry.totalScore}/15`, entry.costLabel, formatMaybe(entry.pointsPerDollar)])
    ));
  }

  if (data.failures.length) {
    lines.push('', '### Failures / unsupported models', '', mdTable(
      ['Model', 'Status', 'Error'],
      data.failures.slice(0, 15).map(entry => [entry.label, entry.status, (entry.error ?? entry.judgeError ?? 'Unknown error').replace(/\|/g, '\\|').slice(0, 120)])
    ));
  }

  return lines.join('\n');
}

function buildMarkdownReport(runId: string, data: ReturnType<typeof buildFindings>): string {
  return [
    buildExecutiveSummary(runId, data),
    '',
    buildMethodology(data.entries),
    '',
    buildScoring(),
    '',
    buildFindingsMarkdown(data),
  ].join('\n');
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function buildHtmlReport(runId: string, data: ReturnType<typeof buildFindings>, markdownReport: string): string {
  const sections = {
    executive: buildExecutiveSummary(runId, data),
    methodology: buildMethodology(data.entries),
    scoring: buildScoring(),
    findings: buildFindingsMarkdown(data),
  };

  const payload = {
    meta: {
      runId,
      generatedAt: new Date().toISOString(),
      evalId: EVAL_ID,
      expectedStart: EXPECTED_START,
      expectedEnd: EXPECTED_END,
      prompt: RIVIAN_PROMPT,
    },
    summary: {
      totalEntries: data.entries.length,
      successCount: data.successes.length,
      failureCount: data.failures.length,
      perfectCount: data.perfect.length,
      bestOverall: data.bestOverall ? {
        label: data.bestOverall.label,
        totalScore: data.bestOverall.totalScore,
        durationSec: data.bestOverall.durationSec,
        costLabel: data.bestOverall.costLabel,
      } : null,
      fastestPerfect: data.fastestPerfect ? {
        label: data.fastestPerfect.label,
        durationSec: data.fastestPerfect.durationSec,
      } : null,
      bestValue: data.bestValue ? {
        label: data.bestValue.label,
        pointsPerDollar: formatMaybe(data.bestValue.pointsPerDollar),
      } : null,
    },
    sections: {
      executiveHtml: renderMarkdown(sections.executive),
      methodologyHtml: renderMarkdown(sections.methodology),
      scoringHtml: renderMarkdown(sections.scoring),
      findingsHtml: renderMarkdown(sections.findings),
    },
    markdownReportHtml: renderMarkdown(markdownReport),
    entries: data.entries.map(entry => ({
      id: slugify(entry.label),
      label: entry.label,
      model: entry.model,
      provider: entry.provider,
      status: entry.status,
      totalScore: entry.totalScore,
      llmScore: entry.judge?.overall_score ?? null,
      toolScore: entry.toolUsage.tool_score,
      storyScore: entry.judge?.narrative_quality ?? null,
      factsScore: entry.judge?.factual_grounding ?? null,
      cost: entry.cost,
      costLabel: entry.costLabel,
      durationSec: entry.durationSec,
      pointsPerDollar: entry.pointsPerDollar,
      pointsPerSecond: entry.pointsPerSecond,
      coversFullDateRange: entry.judge?.covers_full_date_range ?? false,
      drivesStartDate: entry.toolUsage.drives_start_date,
      chargesStartDate: entry.toolUsage.charges_start_date,
      isCloud: entry.isCloud,
      isPerfect: entry.isPerfect,
      isHighQuality: entry.isHighQuality,
      explanation: entry.judge?.explanation ?? entry.judgeError ?? entry.error ?? '',
      explanationHtml: entry.explanationHtml,
      responseHtml: entry.responseHtml,
      responseText: entry.responseText,
      toolScoreBreakdown: entry.toolUsage.tool_score_breakdown,
      toolCallsHtml: entry.toolCallsHtml,
      responseFile: entry.responseFile ?? null,
      resultFile: entry.resultFile ?? null,
      error: entry.error ?? null,
      judgeError: entry.judgeError ?? null,
      searchText: entry.searchText,
    })),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rivian Eval Report — Run ${runId}</title>
  <style>
    :root {
      --bg: #0b1020;
      --panel: #131a2a;
      --panel-2: #182238;
      --text: #e8eef9;
      --muted: #9fb0cf;
      --accent: #7dd3fc;
      --good: #34d399;
      --warn: #fbbf24;
      --bad: #fb7185;
      --border: #2a3550;
      --code: #0f172a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(180deg, #08101d 0%, #0b1020 100%);
      color: var(--text);
      line-height: 1.5;
    }
    a { color: var(--accent); }
    code { background: rgba(125, 211, 252, 0.12); padding: 0.1rem 0.35rem; border-radius: 0.35rem; }
    pre { background: var(--code); padding: 0.9rem; border-radius: 0.75rem; overflow: auto; }
    .page { max-width: 1500px; margin: 0 auto; padding: 1.5rem; }
    .hero, .card, .detail-card, .section, .table-wrap { background: rgba(19, 26, 42, 0.92); border: 1px solid var(--border); border-radius: 1rem; box-shadow: 0 12px 40px rgba(0,0,0,0.24); }
    .hero { padding: 1.5rem; margin-bottom: 1.25rem; }
    h1,h2,h3,h4 { margin-top: 0; }
    .muted { color: var(--muted); }
    .subhead { display: flex; flex-wrap: wrap; gap: 0.75rem; color: var(--muted); margin-top: 0.5rem; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 1rem; margin: 1.25rem 0; }
    .card { padding: 1rem; }
    .metric-label { color: var(--muted); font-size: 0.9rem; }
    .metric-value { font-size: 1.8rem; font-weight: 700; margin-top: 0.2rem; }
    .layout { display: grid; grid-template-columns: 1.3fr 1fr; gap: 1rem; align-items: start; }
    .section { padding: 1rem 1.15rem; margin-bottom: 1rem; }
    .toolbar { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 0.75rem; margin: 1rem 0; }
    input, select, button {
      width: 100%; background: #0f1729; color: var(--text); border: 1px solid var(--border); border-radius: 0.75rem; padding: 0.8rem 0.9rem;
      font: inherit;
    }
    button { cursor: pointer; }
    .table-wrap { overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem 0.7rem; border-bottom: 1px solid rgba(159,176,207,0.12); vertical-align: top; text-align: left; }
    th { color: var(--muted); font-size: 0.86rem; text-transform: uppercase; letter-spacing: 0.03em; position: sticky; top: 0; background: rgba(24, 34, 56, 0.98); }
    tbody tr { cursor: pointer; }
    tbody tr:hover { background: rgba(125,211,252,0.06); }
    .badge { display: inline-flex; align-items: center; gap: 0.35rem; border-radius: 999px; padding: 0.2rem 0.55rem; font-size: 0.78rem; font-weight: 600; border: 1px solid transparent; }
    .badge.good { background: rgba(52,211,153,0.12); color: var(--good); border-color: rgba(52,211,153,0.3); }
    .badge.warn { background: rgba(251,191,36,0.12); color: var(--warn); border-color: rgba(251,191,36,0.3); }
    .badge.bad { background: rgba(251,113,133,0.12); color: var(--bad); border-color: rgba(251,113,133,0.3); }
    .badge.info { background: rgba(125,211,252,0.12); color: var(--accent); border-color: rgba(125,211,252,0.28); }
    .detail-card { padding: 1rem 1.1rem; position: sticky; top: 1rem; }
    .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; margin: 1rem 0; }
    .detail-stat { background: var(--panel-2); border: 1px solid var(--border); border-radius: 0.8rem; padding: 0.75rem; }
    .detail-stat .k { color: var(--muted); font-size: 0.82rem; }
    .detail-stat .v { font-size: 1.1rem; font-weight: 700; margin-top: 0.15rem; }
    .markdown table { margin: 1rem 0; }
    .markdown th, .markdown td { border: 1px solid rgba(159,176,207,0.16); }
    .markdown ul { padding-left: 1.2rem; }
    .tabs { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.8rem; }
    .tab { background: #0f1729; border: 1px solid var(--border); border-radius: 999px; padding: 0.45rem 0.75rem; font-size: 0.84rem; }
    .small { font-size: 0.9rem; }
    .footer-note { margin-top: 1rem; color: var(--muted); font-size: 0.9rem; }
    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr; }
      .detail-card { position: static; }
      .toolbar { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 700px) {
      .toolbar { grid-template-columns: 1fr; }
      .detail-grid { grid-template-columns: 1fr; }
      .page { padding: 1rem; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="hero">
      <h1>🚗 Rivian 10-Day Evaluation Report</h1>
      <div class="subhead">
        <span>Run <strong>${escapeHtml(runId)}</strong></span>
        <span>Window <strong>${EXPECTED_START}</strong> → <strong>${EXPECTED_END}</strong></span>
        <span>Self-contained HTML artifact: safe to copy anywhere</span>
      </div>
      <div class="metrics" id="summary-cards"></div>
    </div>

    <div class="layout">
      <div>
        <div class="section markdown" id="executive-section"></div>
        <div class="section markdown" id="methodology-section"></div>
        <div class="section markdown" id="scoring-section"></div>
        <div class="section markdown" id="findings-section"></div>

        <div class="section">
          <h2>Interactive results table</h2>
          <p class="muted">Sort and filter by quality, speed, cost, cloud/local, and failure status. Click a row to inspect the full result.</p>
          <div class="toolbar">
            <input id="search" type="search" placeholder="Search model, provider, explanation, response text…" />
            <select id="status-filter">
              <option value="all">All rows</option>
              <option value="success">Successful only</option>
              <option value="perfect">Perfect only (15/15)</option>
              <option value="high-quality">High-quality only (tools 5/5, LLM ≥ 9)</option>
              <option value="failures">Failures / judge errors</option>
            </select>
            <select id="location-filter">
              <option value="all">Cloud + local</option>
              <option value="cloud">Cloud only</option>
              <option value="local">Local only</option>
            </select>
            <select id="sort-by">
              <option value="quality">Sort: quality</option>
              <option value="value">Sort: cloud value</option>
              <option value="speed">Sort: speed</option>
              <option value="cheapest">Sort: cheapest cloud</option>
            </select>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Total</th>
                  <th>LLM</th>
                  <th>Tools</th>
                  <th>Cost</th>
                  <th>Time</th>
                  <th>pts/$</th>
                  <th>pts/s</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody id="results-body"></tbody>
            </table>
          </div>
          <div class="footer-note" id="results-count"></div>
        </div>
      </div>

      <div>
        <div class="detail-card" id="detail-panel">
          <h2>Model detail</h2>
          <p class="muted">Select a row to inspect the response, explanation, and tool usage.</p>
        </div>
      </div>
    </div>
  </div>

  <script id="report-data" type="application/json">${jsonForScript(payload)}</script>
  <script>
    const report = JSON.parse(document.getElementById('report-data').textContent);

    const els = {
      summaryCards: document.getElementById('summary-cards'),
      executive: document.getElementById('executive-section'),
      methodology: document.getElementById('methodology-section'),
      scoring: document.getElementById('scoring-section'),
      findings: document.getElementById('findings-section'),
      search: document.getElementById('search'),
      statusFilter: document.getElementById('status-filter'),
      locationFilter: document.getElementById('location-filter'),
      sortBy: document.getElementById('sort-by'),
      resultsBody: document.getElementById('results-body'),
      resultsCount: document.getElementById('results-count'),
      detailPanel: document.getElementById('detail-panel'),
    };

    const summary = report.summary;
    const entries = report.entries;

    function badge(label, kind = 'info') {
      return '<span class="badge ' + kind + '">' + label + '</span>';
    }

    function formatNum(value, digits = 1) {
      return value == null || !Number.isFinite(value) ? '—' : Number(value).toFixed(digits);
    }

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function renderSummaryCards() {
      const cards = [
        { label: 'Judged models', value: summary.successCount + '/' + summary.totalEntries },
        { label: 'Perfect scores', value: String(summary.perfectCount) },
        { label: 'Best overall', value: summary.bestOverall ? summary.bestOverall.label : '—' },
        { label: 'Fastest perfect', value: summary.fastestPerfect ? summary.fastestPerfect.label + ' (' + summary.fastestPerfect.durationSec.toFixed(1) + 's)' : '—' },
        { label: 'Best value', value: summary.bestValue ? summary.bestValue.label + ' (' + summary.bestValue.pointsPerDollar + ' pts/$)' : '—' },
      ];
      els.summaryCards.innerHTML = cards.map(function(card) {
        return '<div class="card">' +
          '<div class="metric-label">' + escapeHtml(card.label) + '</div>' +
          '<div class="metric-value small">' + escapeHtml(card.value) + '</div>' +
        '</div>';
      }).join('');
    }

    function sortEntries(rows) {
      const mode = els.sortBy.value;
      const sorted = [...rows];
      if (mode === 'speed') {
        sorted.sort((a, b) => (a.durationSec ?? 1e9) - (b.durationSec ?? 1e9) || (b.totalScore ?? -1) - (a.totalScore ?? -1));
      } else if (mode === 'value') {
        sorted.sort((a, b) => (b.pointsPerDollar ?? -1) - (a.pointsPerDollar ?? -1) || (b.totalScore ?? -1) - (a.totalScore ?? -1) || (a.durationSec ?? 1e9) - (b.durationSec ?? 1e9));
      } else if (mode === 'cheapest') {
        sorted.sort((a, b) => ((a.isCloud ? a.cost : Number.MAX_SAFE_INTEGER) - (b.isCloud ? b.cost : Number.MAX_SAFE_INTEGER)) || (b.totalScore ?? -1) - (a.totalScore ?? -1));
      } else {
        sorted.sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1) || (b.llmScore ?? -1) - (a.llmScore ?? -1) || (a.durationSec ?? 1e9) - (b.durationSec ?? 1e9) || (a.cost ?? 1e9) - (b.cost ?? 1e9));
      }
      return sorted;
    }

    function filterEntries(rows) {
      const search = els.search.value.trim().toLowerCase();
      const status = els.statusFilter.value;
      const location = els.locationFilter.value;
      return rows.filter(row => {
        if (search && !row.searchText.includes(search)) return false;
        if (location === 'cloud' && !row.isCloud) return false;
        if (location === 'local' && row.isCloud) return false;
        if (status === 'success' && row.status !== 'success') return false;
        if (status === 'perfect' && !row.isPerfect) return false;
        if (status === 'high-quality' && !row.isHighQuality) return false;
        if (status === 'failures' && row.status === 'success') return false;
        return true;
      });
    }

    function statusBadge(row) {
      if (row.status === 'success' && row.isPerfect) return badge('Perfect', 'good');
      if (row.status === 'success' && row.isHighQuality) return badge('High quality', 'good');
      if (row.status === 'success') return badge('Success', 'info');
      if (row.status === 'judge-error') return badge('Judge error', 'warn');
      if (row.status === 'response-error') return badge('Response error', 'bad');
      return badge('Ungjudged', 'warn');
    }

    function renderTable() {
      const rows = sortEntries(filterEntries(entries));
      els.resultsBody.innerHTML = rows.map(function(row) {
        return '<tr data-id="' + row.id + '">' +
          '<td>' +
            '<div><strong>' + escapeHtml(row.label) + '</strong></div>' +
            '<div style="margin-top:0.35rem; display:flex; gap:0.35rem; flex-wrap:wrap;">' +
              (row.isCloud ? badge('cloud', 'info') : badge('local', 'warn')) +
              (row.coversFullDateRange ? badge('full range', 'good') : '') +
            '</div>' +
          '</td>' +
          '<td>' + (row.totalScore == null ? '—' : row.totalScore + '/15') + '</td>' +
          '<td>' + (row.llmScore == null ? '—' : row.llmScore + '/10') + '</td>' +
          '<td>' + row.toolScore + '/5</td>' +
          '<td>' + escapeHtml(row.costLabel) + '</td>' +
          '<td>' + formatNum(row.durationSec) + 's</td>' +
          '<td>' + formatNum(row.pointsPerDollar) + '</td>' +
          '<td>' + formatNum(row.pointsPerSecond, 2) + '</td>' +
          '<td>' + statusBadge(row) + '</td>' +
        '</tr>';
      }).join('');
      els.resultsCount.textContent = rows.length + ' row(s) shown out of ' + entries.length + '.';
      if (rows[0]) {
        renderDetail(rows[0].id);
      } else {
        els.detailPanel.innerHTML = '<h2>Model detail</h2><p class="muted">No rows match the current filters.</p>';
      }
    }

    function renderDetail(id) {
      const row = entries.find(entry => entry.id === id);
      if (!row) return;
      const errorBlock = row.error || row.judgeError
        ? '<div class="section"><h3>Error</h3><p>' + escapeHtml(row.error || row.judgeError) + '</p></div>'
        : '';
      els.detailPanel.innerHTML =
        '<h2>' + escapeHtml(row.label) + '</h2>' +
        '<div class="tabs">' +
          statusBadge(row) +
          (row.isCloud ? badge('cloud', 'info') : badge('local', 'warn')) +
          (row.isPerfect ? badge('15/15', 'good') : '') +
        '</div>' +
        '<div class="detail-grid">' +
          '<div class="detail-stat"><div class="k">Total</div><div class="v">' + (row.totalScore == null ? '—' : row.totalScore + '/15') + '</div></div>' +
          '<div class="detail-stat"><div class="k">Runtime</div><div class="v">' + formatNum(row.durationSec) + 's</div></div>' +
          '<div class="detail-stat"><div class="k">Cost</div><div class="v">' + escapeHtml(row.costLabel) + '</div></div>' +
          '<div class="detail-stat"><div class="k">Value</div><div class="v">' + formatNum(row.pointsPerDollar) + ' pts/$</div></div>' +
          '<div class="detail-stat"><div class="k">Judge</div><div class="v">' + (row.llmScore == null ? '—' : row.llmScore + '/10') + '</div></div>' +
          '<div class="detail-stat"><div class="k">Tool score</div><div class="v">' + row.toolScore + '/5</div></div>' +
        '</div>' +
        '<div class="section markdown"><h3>Judge explanation</h3>' + row.explanationHtml + '</div>' +
        '<div class="section markdown">' +
          '<h3>Tool usage</h3>' +
          '<p><strong>Drives start:</strong> ' + escapeHtml(row.drivesStartDate || '—') + ' &nbsp; <strong>Charges start:</strong> ' + escapeHtml(row.chargesStartDate || '—') + '</p>' +
          '<p><strong>Breakdown:</strong> ' + escapeHtml(row.toolScoreBreakdown || '—') + '</p>' +
          row.toolCallsHtml +
        '</div>' +
        errorBlock +
        '<div class="section markdown"><h3>Rendered model response</h3>' + row.responseHtml + '</div>' +
        '<div class="footer-note">Response file: ' + escapeHtml(row.responseFile || '—') + ' • Result file: ' + escapeHtml(row.resultFile || '—') + '</div>';
      document.querySelectorAll('tbody tr').forEach(tr => {
        if (tr.dataset.id === id) tr.style.background = 'rgba(125,211,252,0.12)';
        else tr.style.background = '';
      });
    }

    els.executive.innerHTML = report.sections.executiveHtml;
    els.methodology.innerHTML = report.sections.methodologyHtml;
    els.scoring.innerHTML = report.sections.scoringHtml;
    els.findings.innerHTML = report.sections.findingsHtml;

    ['search', 'status-filter', 'location-filter', 'sort-by'].forEach(id => {
      document.getElementById(id).addEventListener('input', renderTable);
      document.getElementById(id).addEventListener('change', renderTable);
    });

    els.resultsBody.addEventListener('click', event => {
      const row = event.target.closest('tr[data-id]');
      if (row) renderDetail(row.dataset.id);
    });

    renderSummaryCards();
    renderTable();
  </script>
</body>
</html>`;
}

async function main() {
  const baseDir = path.join(process.cwd(), 'output', 'evaluations', EVAL_ID, 'runs');
  if (!fs.existsSync(baseDir)) {
    throw new Error(`No runs found at ${baseDir}`);
  }

  const existingRuns = fs.readdirSync(baseDir)
    .filter(name => /^\d+$/.test(name))
    .map(name => parseInt(name, 10))
    .sort((a, b) => a - b);
  if (!existingRuns.length) {
    throw new Error(`No numeric run directories found in ${baseDir}`);
  }

  const requestedRun = parseRunFlag();
  const runNumber = requestedRun ?? existingRuns[existingRuns.length - 1];
  const runId = formatRunId(runNumber);
  const runDir = path.join(baseDir, runId);
  if (!fs.existsSync(runDir)) {
    throw new Error(`Run ${runId} does not exist at ${runDir}`);
  }

  const reportDir = path.join(runDir, 'report');
  fs.mkdirSync(reportDir, { recursive: true });

  const entries = loadRunEntries(runDir);
  const findings = buildFindings(entries);
  const markdownReport = buildMarkdownReport(runId, findings);
  const htmlReport = buildHtmlReport(runId, findings, markdownReport);
  const jsonReport = {
    runId,
    generatedAt: new Date().toISOString(),
    expectedStart: EXPECTED_START,
    expectedEnd: EXPECTED_END,
    prompt: RIVIAN_PROMPT,
    summary: {
      totalEntries: findings.entries.length,
      successCount: findings.successes.length,
      failureCount: findings.failures.length,
      perfectCount: findings.perfect.length,
      bestOverall: findings.bestOverall?.label ?? null,
      fastestPerfect: findings.fastestPerfect?.label ?? null,
      cheapestPerfectCloud: findings.cheapestPerfectCloud?.label ?? null,
      bestValue: findings.bestValue?.label ?? null,
    },
    entries: findings.entries,
  };

  const htmlPath = path.join(reportDir, 'summary.html');
  const mdPath = path.join(reportDir, 'summary.md');
  const jsonPath = path.join(reportDir, 'summary.json');

  fs.writeFileSync(htmlPath, htmlReport);
  fs.writeFileSync(mdPath, markdownReport);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));

  console.log(`📄 Rivian report generated for run ${runId}`);
  console.log(`   HTML: ${htmlPath}`);
  console.log(`   MD:   ${mdPath}`);
  console.log(`   JSON: ${jsonPath}`);
  console.log('   The HTML report is self-contained and safe to copy elsewhere.');
}

main().catch(err => {
  console.error('Failed to generate Rivian report:', err);
  process.exit(1);
});