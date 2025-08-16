import fs from 'node:fs';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import Papa from 'papaparse';

export type SampleOptions = {
  head: number;
  random: number;
  cap: number;
  seed: number;
};

export type CSVDetection = {
  encoding: string;
  delimiter: string;
};

export type CSVPreview = {
  filePath: string;
  detection: CSVDetection;
  rows: string[][];
};

export function detectEncoding(filePath: string): string {
  const buf = fs.readFileSync(filePath, { flag: 'r' });
  const enc = chardet.detect(buf) || 'utf-8';
  return enc.toLowerCase();
}

const CANDIDATE_DELIMS = [',', ';', '\t', '|'];

export function sniffDelimiter(sample: string): string {
  let best: { delim: string; score: number } = { delim: ',', score: -Infinity };
  for (const d of CANDIDATE_DELIMS) {
    const lines = sample.split(/\r?\n/).filter(Boolean).slice(0, 300);
    const counts = lines.map(l => l.split(d).length);
    if (counts.length < 2) continue;
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / counts.length;
    const score = mean - variance;
    if (score > best.score) best = { delim: d, score };
  }
  return best.delim;
}

export function loadAndPreviewCSV(filePath: string, opts: SampleOptions): CSVPreview {
  const encoding = detectEncoding(filePath);
  const raw = fs.readFileSync(filePath);
  const text = iconv.decode(raw, encoding);
  const sniffWindow = text.slice(0, Math.min(text.length, 200_000));
  const delimiter = sniffDelimiter(sniffWindow);
  const lines = sniffWindow.split(/\r?\n/).slice(0, Math.min(300, opts.cap));
  const rows: string[][] = lines.map(l => l.split(delimiter));
  return { filePath, detection: { encoding, delimiter }, rows };
}

export function parseEntireCSV(filePath: string, detection: CSVDetection): string[][] {
  const raw = fs.readFileSync(filePath);
  const text = iconv.decode(raw, detection.encoding);
  const parsed = Papa.parse<string[]>(text, { delimiter: detection.delimiter as Papa.ParseConfig["delimiter"], skipEmptyLines: 'greedy' });
  if (parsed.errors && parsed.errors.length) {
    throw new Error(`CSV parse error: ${parsed.errors[0].message}`);
  }
  return parsed.data as string[][];
}

export function sampleRows(allRows: string[][], opts: SampleOptions): string[][] {
  const headRows = allRows.slice(0, opts.head);
  const remaining = allRows.slice(opts.head);
  const rng = mulberry32(opts.seed);
  const indices = new Set<number>();
  for (let i = 0; i < remaining.length && indices.size < opts.random; i++) {
    const idx = Math.floor(rng() * remaining.length);
    indices.add(idx);
  }
  const randomRows: string[][] = Array.from(indices).map(i => remaining[i]).filter(Boolean);
  const combined = [...headRows, ...randomRows].slice(0, opts.cap);
  return combined;
}

function mulberry32(a: number) {
  return function() {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}