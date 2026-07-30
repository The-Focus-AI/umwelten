/**
 * Deterministic style signals — no LLM.
 *
 * LLM judges are weak at counting, so the mechanical claims of each register
 * are verified mechanically: sentence length, semicolon rate, contractions,
 * -ly adverbs, lexical variety, polysyllabic share, and a pentameter scansion
 * band. The syllable counter is a heuristic (vowel groups, silent-e); the
 * scansion check therefore uses a 9-11 syllable tolerance band per line.
 *
 * As a CLI it walks a run dir of the language-styles eval and writes
 * stylometrics.json next to the task results:
 *
 *   pnpm tsx examples/language-styles/stylometrics.ts             # latest run
 *   pnpm tsx examples/language-styles/stylometrics.ts --run 3
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface TextMetrics {
  words: number;
  sentences: number;
  avgSentenceLen: number;
  semicolonsPer100Words: number;
  contractionsPer100Words: number;
  lyAdverbsPer100Words: number;
  /** Unique words / total words (lowercased). */
  typeTokenRatio: number;
  /** Share of words with 3+ syllables, 0-1. */
  polysyllabicShare: number;
  lines: number;
  /** Share of non-empty lines with 9-11 syllables, 0-1. The pentameter signal. */
  linesInPentameterBand: number;
}

/** Words that end in -ly but are not adverbs (or not usefully so). */
const LY_EXCEPTIONS = new Set([
  'only', 'family', 'reply', 'supply', 'apply', 'assembly', 'belly', 'jelly',
  'holy', 'ugly', 'silly', 'bully', 'folly', 'melancholy', 'italy', 'july',
  'anomaly', 'ally', 'rally', 'tally', 'lily', 'monopoly',
]);

/**
 * Heuristic syllable counter: count vowel groups, drop a silent trailing -e
 * (but keep -le as in "table"), floor at 1. Within ±1 on most English words,
 * which is why consumers use tolerance bands rather than exact counts.
 */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  const groups = w.match(/[aeiouy]+/g);
  if (!groups) return 1;
  let n = groups.length;
  // Trailing silent e ("come", "there") — but "table" keeps its -le syllable,
  // and one-group words ("see", "the") stay at 1.
  if (n > 1 && w.endsWith('e') && !w.endsWith('le') && !/[aeiouy]e$/.test(w)) n -= 1;
  return Math.max(1, n);
}

export function countLineSyllables(line: string): number {
  return line.split(/\s+/).filter(Boolean).reduce((sum, w) => sum + countSyllables(w), 0);
}

const CONTRACTION_RE = /\b\w+['’](t|re|ve|ll|d|m|s)\b/gi;

export function computeTextMetrics(text: string): TextMetrics {
  const words = text.split(/\s+/).map((w) => w.replace(/^[^\w'’]+|[^\w'’]+$/g, '')).filter(Boolean);
  const wordCount = words.length;
  const per100 = (n: number) => (wordCount === 0 ? 0 : (n / wordCount) * 100);

  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().length > 0);
  const semicolons = (text.match(/;/g) ?? []).length;
  const contractions = (text.match(CONTRACTION_RE) ?? []).length;

  const lyAdverbs = words.filter((w) => {
    const lw = w.toLowerCase().replace(/[^a-z]/g, '');
    return lw.length > 3 && lw.endsWith('ly') && !LY_EXCEPTIONS.has(lw);
  }).length;

  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
  const polysyllabic = words.filter((w) => countSyllables(w) >= 3).length;

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const inBand = lines.filter((l) => {
    const n = countLineSyllables(l);
    return n >= 9 && n <= 11;
  }).length;

  return {
    words: wordCount,
    sentences: sentences.length,
    avgSentenceLen: sentences.length === 0 ? 0 : wordCount / sentences.length,
    semicolonsPer100Words: per100(semicolons),
    contractionsPer100Words: per100(contractions),
    lyAdverbsPer100Words: per100(lyAdverbs),
    typeTokenRatio: wordCount === 0 ? 0 : uniqueWords.size / wordCount,
    polysyllabicShare: wordCount === 0 ? 0 : polysyllabic / wordCount,
    lines: lines.length,
    linesInPentameterBand: lines.length === 0 ? 0 : inBand / lines.length,
  };
}

// ── Run-dir walking (CLI + report consumer) ──────────────────────────────────

export interface StylometricsEntry {
  taskId: string;
  style: string;
  brief: string;
  model: string;
  provider: string;
  metrics: TextMetrics;
}

export interface StylometricsFile {
  generatedAt: string;
  runDir: string;
  entries: StylometricsEntry[];
}

export function resolveRunDir(evalName: string, runFlag?: number | null): string {
  const runsDir = path.join(process.cwd(), 'output', 'evaluations', evalName, 'runs');
  if (runFlag != null) {
    const dir = path.join(runsDir, String(runFlag).padStart(3, '0'));
    if (!fs.existsSync(dir)) throw new Error(`Run dir not found: ${dir}`);
    return dir;
  }
  const runs = fs.existsSync(runsDir)
    ? fs.readdirSync(runsDir).filter((d) => /^\d+$/.test(d)).sort()
    : [];
  if (runs.length === 0) throw new Error(`No runs under ${runsDir} — run style-eval.ts first`);
  return path.join(runsDir, runs[runs.length - 1]);
}

/** Compute metrics for every task result in a run dir of the language-styles eval. */
export function computeRunStylometrics(runDir: string): StylometricsFile {
  const entries: StylometricsEntry[] = [];
  for (const taskDir of fs.readdirSync(runDir, { withFileTypes: true })) {
    if (!taskDir.isDirectory()) continue;
    const sep = taskDir.name.indexOf('--');
    if (sep === -1) continue;
    const style = taskDir.name.slice(0, sep);
    const brief = taskDir.name.slice(sep + 2);
    const taskPath = path.join(runDir, taskDir.name);
    for (const file of fs.readdirSync(taskPath)) {
      if (!file.endsWith('.json') || file.endsWith('.transcript.json')) continue;
      const record = JSON.parse(fs.readFileSync(path.join(taskPath, file), 'utf-8'));
      if (record.error || typeof record.responseText !== 'string' || record.responseText.length === 0) continue;
      entries.push({
        taskId: taskDir.name,
        style,
        brief,
        model: record.model ?? file.replace(/\.json$/, ''),
        provider: record.provider ?? '',
        metrics: computeTextMetrics(record.responseText),
      });
    }
  }
  return { generatedAt: new Date().toISOString(), runDir, entries };
}

async function main() {
  const { EVAL_NAME } = await import('./style-eval.js');
  const idx = process.argv.indexOf('--run');
  const runFlag = idx !== -1 ? parseInt(process.argv[idx + 1], 10) : null;
  const runDir = resolveRunDir(EVAL_NAME, Number.isNaN(runFlag) ? null : runFlag);
  const result = computeRunStylometrics(runDir);
  const outPath = path.join(runDir, 'stylometrics.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`${result.entries.length} responses measured → ${outPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
}
