#!/usr/bin/env node
/**
 * Language Styles — research report generator.
 *
 * Custom markdown builder (the shared narrative-report writer dispatches by
 * evalName substring and has no section for a style eval). Merges the judge
 * scores from a run with fresh deterministic stylometrics.
 *
 * Usage:
 *   pnpm tsx examples/language-styles/generate-report.ts                # latest run
 *   pnpm tsx examples/language-styles/generate-report.ts --run 2
 *   pnpm tsx examples/language-styles/generate-report.ts --output output/reports/language-styles.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadStyles, type StyleDef } from './load-styles.js';
import { BRIEFS } from './briefs.js';
import { EVAL_NAME } from './style-eval.js';
import {
  computeRunStylometrics, resolveRunDir,
  type StylometricsEntry, type TextMetrics,
} from './stylometrics.js';

interface ResultRecord {
  taskId: string;
  style: string;
  brief: string;
  model: string;
  provider: string;
  score: number;
  maxScore: number;
  responseText: string;
  judge?: {
    style_fidelity?: number;
    content_fidelity?: number;
    fluency?: number;
    rule_violations?: string;
    explanation?: string;
  };
  error?: string;
  cost: number;
  durationMs: number;
}

function loadRunResults(runDir: string): ResultRecord[] {
  const records: ResultRecord[] = [];
  for (const taskDir of fs.readdirSync(runDir, { withFileTypes: true })) {
    if (!taskDir.isDirectory()) continue;
    const sep = taskDir.name.indexOf('--');
    if (sep === -1) continue;
    const taskPath = path.join(runDir, taskDir.name);
    for (const file of fs.readdirSync(taskPath)) {
      if (!file.endsWith('.json') || file.endsWith('.transcript.json')) continue;
      const r = JSON.parse(fs.readFileSync(path.join(taskPath, file), 'utf-8'));
      records.push({
        ...r,
        taskId: taskDir.name,
        style: taskDir.name.slice(0, sep),
        brief: taskDir.name.slice(sep + 2),
      });
    }
  }
  return records;
}

const mean = (ns: number[]) => (ns.length === 0 ? NaN : ns.reduce((a, b) => a + b, 0) / ns.length);
const fmt = (n: number, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : '—');
const pct = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : '—');
const modelName = (r: { model: string; provider: string }) => `${r.model} (${r.provider})`;

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = out.get(k) ?? [];
    arr.push(item);
    out.set(k, arr);
  }
  return out;
}

function metricsRow(label: string, entries: StylometricsEntry[]): string {
  const get = (f: (m: TextMetrics) => number) => mean(entries.map((e) => f(e.metrics)));
  return `| ${label} | ${fmt(get((m) => m.avgSentenceLen))} | ${fmt(get((m) => m.semicolonsPer100Words))} | ${fmt(get((m) => m.contractionsPer100Words))} | ${fmt(get((m) => m.lyAdverbsPer100Words))} | ${fmt(get((m) => m.typeTokenRatio), 2)} | ${pct(get((m) => m.polysyllabicShare))} | ${pct(get((m) => m.linesInPentameterBand))} |`;
}

function buildReport(
  styles: StyleDef[],
  results: ResultRecord[],
  stylometrics: StylometricsEntry[],
  runDir: string,
): string {
  const ok = results.filter((r) => !r.error && r.responseText);
  const errored = results.filter((r) => r.error);
  const models = [...new Set(results.map(modelName))].sort();
  const styleIds = styles.map((s) => s.id);
  const styleLabel = new Map(styles.map((s) => [s.id, s.label]));
  const lines: string[] = [];

  lines.push('# Language Styles — model comparison');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString().slice(0, 10)} from \`${path.relative(process.cwd(), runDir)}\`.`);
  lines.push('');
  lines.push(`${models.length} models × ${styleIds.length} registers × ${new Set(results.map((r) => r.brief)).size} briefs; ${ok.length} scored responses${errored.length ? `, ${errored.length} errors` : ''}.`);
  lines.push('');

  // ── Leaderboard ────────────────────────────────────────────────────────────
  lines.push('## Leaderboard');
  lines.push('');
  lines.push('Score = 0.6 × style fidelity + 0.4 × content fidelity (judge, 0-10), shown as % of max.');
  lines.push('');
  lines.push(`| Model | Overall | ${styleIds.map((s) => styleLabel.get(s)).join(' | ')} |`);
  lines.push(`|---|---|${styleIds.map(() => '---').join('|')}|`);
  const byModel = groupBy(ok, modelName);
  const overall = (rs: ResultRecord[]) => mean(rs.map((r) => r.score / r.maxScore));
  const ranked = [...byModel.entries()].sort((a, b) => overall(b[1]) - overall(a[1]));
  for (const [m, rs] of ranked) {
    const perStyle = styleIds.map((s) => pct(overall(rs.filter((r) => r.style === s))));
    lines.push(`| ${m} | ${pct(overall(rs))} | ${perStyle.join(' | ')} |`);
  }
  lines.push('');

  // ── Style vs content fidelity ──────────────────────────────────────────────
  lines.push('## Style fidelity vs content fidelity');
  lines.push('');
  lines.push('Judge sub-scores (0-10), averaged over briefs and models per register. The gap between the two columns shows how much content each register costs.');
  lines.push('');
  lines.push('| Register | Style fidelity | Content fidelity | Fluency |');
  lines.push('|---|---|---|---|');
  for (const s of styleIds) {
    const rs = ok.filter((r) => r.style === s && r.judge);
    lines.push(`| ${styleLabel.get(s)} | ${fmt(mean(rs.map((r) => r.judge!.style_fidelity ?? NaN)))} | ${fmt(mean(rs.map((r) => r.judge!.content_fidelity ?? NaN)))} | ${fmt(mean(rs.map((r) => r.judge!.fluency ?? NaN)))} |`);
  }
  lines.push('');

  // ── Stylometrics ───────────────────────────────────────────────────────────
  lines.push('## Did the registers actually move? (deterministic stylometrics)');
  lines.push('');
  lines.push('Computed mechanically from the responses — no LLM. Expected signature: Strunk & White lowest sentence length and -ly rate; Victorian highest semicolons with zero contractions; iambic pentameter high in the 9-11-syllable line band (syllable counting is heuristic, hence the band).');
  lines.push('');
  lines.push('| Register | Avg sentence len | Semicolons /100w | Contractions /100w | -ly adverbs /100w | Type-token | 3+ syllable words | Lines in 9-11 band |');
  lines.push('|---|---|---|---|---|---|---|---|');
  const smByStyle = groupBy(stylometrics, (e) => e.style);
  for (const s of styleIds) {
    lines.push(metricsRow(styleLabel.get(s) ?? s, smByStyle.get(s) ?? []));
  }
  lines.push('');
  const pentameterEntries = smByStyle.get('iambic-pentameter') ?? [];
  if (pentameterEntries.length > 0) {
    lines.push('Scansion by model (iambic-pentameter tasks only — share of lines in the 9-11 syllable band):');
    lines.push('');
    lines.push('| Model | Lines in band |');
    lines.push('|---|---|');
    for (const [m, es] of groupBy(pentameterEntries, (e) => `${e.model} (${e.provider})`)) {
      lines.push(`| ${m} | ${pct(mean(es.map((e) => e.metrics.linesInPentameterBand)))} |`);
    }
    lines.push('');
  }

  // ── Methodology ────────────────────────────────────────────────────────────
  lines.push('## Methodology');
  lines.push('');
  lines.push('Each register is authored as a skill (`skills/<id>/SKILL.md`); the body below is injected verbatim into the generation stimulus and quoted to the judge.');
  lines.push('');
  lines.push('| Brief | Kind | Content required |');
  lines.push('|---|---|---|');
  for (const b of BRIEFS) {
    lines.push(`| ${b.name} | ${b.kind} | ${b.contentChecklist.join('; ')} |`);
  }
  lines.push('');
  for (const s of styles) {
    lines.push(`<details><summary><b>${s.label}</b> — role: ${s.role}, temperature ${s.temperature}</summary>`);
    lines.push('');
    lines.push(s.rules);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  // ── Excerpts ───────────────────────────────────────────────────────────────
  lines.push('## The same brief in five voices');
  lines.push('');
  const briefIds = [...new Set(ok.map((r) => r.brief))];
  for (const briefId of briefIds) {
    const brief = BRIEFS.find((b) => b.id === briefId);
    lines.push(`### ${brief?.name ?? briefId}`);
    lines.push('');
    for (const m of models) {
      const rs = ok.filter((r) => r.brief === briefId && modelName(r) === m);
      if (rs.length === 0) continue;
      lines.push(`<details><summary>${m}</summary>`);
      lines.push('');
      for (const s of styleIds) {
        const r = rs.find((x) => x.style === s);
        if (!r) continue;
        lines.push(`**${styleLabel.get(s)}** (${fmt((r.score / r.maxScore) * 10)}/10)`);
        lines.push('');
        lines.push(r.responseText.trim());
        lines.push('');
      }
      lines.push('</details>');
      lines.push('');
    }
  }

  // ── Cost & speed ───────────────────────────────────────────────────────────
  lines.push('## Cost & speed');
  lines.push('');
  lines.push('| Model | Total cost | Avg response time |');
  lines.push('|---|---|---|');
  for (const [m, rs] of ranked) {
    const cost = rs.reduce((a, r) => a + (r.cost ?? 0), 0);
    lines.push(`| ${m} | $${cost.toFixed(4)} | ${fmt(mean(rs.map((r) => r.durationMs)) / 1000)}s |`);
  }
  lines.push('');

  // ── Judge notes ────────────────────────────────────────────────────────────
  lines.push('## Appendix: judge notes');
  lines.push('');
  for (const s of styleIds) {
    const rs = ok.filter((r) => r.style === s && r.judge);
    if (rs.length === 0) continue;
    lines.push(`<details><summary>${styleLabel.get(s)}</summary>`);
    lines.push('');
    for (const r of rs) {
      const j = r.judge!;
      lines.push(`- **${r.brief} / ${modelName(r)}** — style ${fmt(j.style_fidelity ?? NaN)}, content ${fmt(j.content_fidelity ?? NaN)}; violations: ${j.rule_violations || 'n/a'}. ${j.explanation ?? ''}`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  if (errored.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const r of errored) lines.push(`- ${r.taskId} / ${modelName(r)}: ${r.error}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const idx = process.argv.indexOf('--run');
  const runFlag = idx !== -1 ? parseInt(process.argv[idx + 1], 10) : null;
  const outIdx = process.argv.indexOf('--output');
  const outPath = outIdx !== -1
    ? path.resolve(process.argv[outIdx + 1])
    : path.join(process.cwd(), 'output', 'reports', 'language-styles.md');

  const runDir = resolveRunDir(EVAL_NAME, runFlag != null && Number.isNaN(runFlag) ? null : runFlag);
  const styles = await loadStyles();
  const results = loadRunResults(runDir);
  if (results.length === 0) throw new Error(`No results in ${runDir} — run style-eval.ts first`);
  const stylometrics = computeRunStylometrics(runDir).entries;

  const report = buildReport(styles, results, stylometrics, runDir);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, report);
  console.log(`Report: ${outPath} (${results.length} results, ${stylometrics.length} measured responses)`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
