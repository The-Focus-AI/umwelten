#!/usr/bin/env node
/**
 * Programmatically extracts historical benchmark tables directly from the
 * committed Markdown experiment reports so zero numbers are ever hand-copied.
 *
 * Sources:
 *   - docs-archive/walkthroughs/model-showdown-results.md (March 2026, 48 models)
 *   - reports/2026-07-26-headroom-ollama-does-not-batch.md (July 2026, M4 Max c=1 vs c=4)
 *
 * Usage:
 *   pnpm tsx scripts/extract-historical-reports.ts
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "reports", "data");

export interface ArchivedShowdownRow {
  rank: number;
  id: string;
  provider: string;
  tier: "cloud" | "local";
  weights: "open" | "closed";
  combined: number;
  reasoningRaw: string;
  reasoning: number;
  knowledgeRaw: string;
  knowledge: number;
  instructionRaw: string;
  instruction: number;
  codingRaw: string;
  coding: number;
  cost: number;
  costRaw: string;
  timeRaw: string;
  timeSec: number;
}

export interface ArchivedHeadroomRow {
  runtimeGroup: "ollama" | "llama-swap";
  mode: "queueing" | "batching";
  model: string;
  aggC1: number | null;
  aggC4: number | null;
  scaling: string;
  decodeC1: number | null;
  decodeC4: number | null;
  ttftC1: string;
  ttftC4: string;
}

const CLOSED_PREFIXES = [
  "anthropic/",
  "openai/gpt-5",
  "x-ai/",
  "gemini-",
  "google/gemini-",
  "minimax/",
  "inception/",
  "mistralai/codestral",
];

function inferWeights(id: string, provider: string): "open" | "closed" {
  if (provider.toLowerCase() === "ollama") return "open";
  if (id.startsWith("openai/gpt-oss")) return "open";
  return CLOSED_PREFIXES.some((p) => id.startsWith(p)) ? "closed" : "open";
}

function parseFractionPct(cell: string): number {
  const m = cell.trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`Invalid fraction cell: "${cell}"`);
  return Number(((Number(m[1]) / Number(m[2])) * 100).toFixed(1));
}

function parseCost(cell: string): number {
  const t = cell.trim();
  if (/^free$/i.test(t)) return 0;
  const num = Number(t.replace(/^\$/, ""));
  if (Number.isNaN(num)) throw new Error(`Invalid cost cell: "${cell}"`);
  return num;
}

function parseDurationSec(cell: string): number {
  const t = cell.trim();
  let total = 0;
  const h = t.match(/(\d+)h/);
  const m = t.match(/(\d+)m/);
  const s = t.match(/(\d+)s/);
  if (h) total += Number(h[1]) * 3600;
  if (m) total += Number(m[1]) * 60;
  if (s) total += Number(s[1]);
  return total || 60;
}

function extractShowdown(): ArchivedShowdownRow[] {
  const mdPath = path.join(ROOT, "docs-archive", "walkthroughs", "model-showdown-results.md");
  const md = fs.readFileSync(mdPath, "utf8");
  const sectionStart = md.indexOf("## The Full Leaderboard: 49 Models × 4 Dimensions");
  if (sectionStart === -1) throw new Error("Could not locate 4-dimension leaderboard heading");
  const after = md.slice(sectionStart);
  const lines = after.split("\n");

  const rows: ArchivedShowdownRow[] = [];
  for (const line of lines) {
    if (line.startsWith("### Key Findings")) break;
    const m = line.match(
      /^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([\d.]+)%\s*\|\s*(\d+\/\d+)\s*\|\s*(\d+\/\d+)\s*\|\s*(\d+\/\d+)\s*\|\s*(\d+\/\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/,
    );
    if (!m) continue;
    const [, rankS, id, provider, combS, rRaw, kRaw, iRaw, cRaw, costRaw, timeRaw] = m;
    const provNorm = provider.trim().toLowerCase();
    rows.push({
      rank: Number(rankS),
      id: id.trim(),
      provider: provNorm,
      tier: provNorm === "ollama" ? "local" : "cloud",
      weights: inferWeights(id.trim(), provNorm),
      combined: Number(combS),
      reasoningRaw: rRaw,
      reasoning: parseFractionPct(rRaw),
      knowledgeRaw: kRaw,
      knowledge: parseFractionPct(kRaw),
      instructionRaw: iRaw,
      instruction: parseFractionPct(iRaw),
      codingRaw: cRaw,
      coding: parseFractionPct(cRaw),
      cost: parseCost(costRaw),
      costRaw: costRaw.trim(),
      timeRaw: timeRaw.trim(),
      timeSec: parseDurationSec(timeRaw),
    });
  }
  if (rows.length === 0) throw new Error("Extracted 0 showdown rows");
  return rows;
}

function parseNumOrNull(raw: string): number | null {
  const cleaned = raw.replace(/\*\*/g, "").trim();
  if (cleaned === "—" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function extractHeadroom(): ArchivedHeadroomRow[] {
  const mdPath = path.join(ROOT, "reports", "2026-07-26-headroom-ollama-does-not-batch.md");
  const md = fs.readFileSync(mdPath, "utf8");
  const lines = md.split("\n");

  const out: ArchivedHeadroomRow[] = [];
  let section: "none" | "ollama" | "llama-swap" = "none";

  for (const line of lines) {
    if (line.startsWith("### Ollama")) {
      section = "ollama";
      continue;
    }
    if (line.startsWith("### llama-swap")) {
      section = "llama-swap";
      continue;
    }
    if (line.startsWith("### ") || line.startsWith("## ")) {
      if (!line.includes("Results")) section = "none";
    }
    if (!line.startsWith("|") || line.includes("---") || line.includes("| Model |")) continue;

    const cols = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.replace(/\*\*/g, "").trim());

    if (section === "ollama" && cols.length === 7) {
      const aggC1 = parseNumOrNull(cols[1]);
      const aggC4 = parseNumOrNull(cols[2]);
      const ratio = aggC1 && aggC4 ? `${(aggC4 / aggC1).toFixed(2)}×` : "—";
      out.push({
        runtimeGroup: "ollama",
        mode: "queueing",
        model: cols[0],
        aggC1,
        aggC4,
        scaling: ratio,
        decodeC1: parseNumOrNull(cols[3]),
        decodeC4: parseNumOrNull(cols[4]),
        ttftC1: cols[5],
        ttftC4: cols[6],
      });
    } else if (section === "llama-swap" && cols.length === 8) {
      out.push({
        runtimeGroup: "llama-swap",
        mode: "batching",
        model: cols[0],
        aggC1: parseNumOrNull(cols[1]),
        aggC4: parseNumOrNull(cols[2]),
        scaling: cols[3],
        decodeC1: parseNumOrNull(cols[4]),
        decodeC4: parseNumOrNull(cols[5]),
        ttftC1: cols[6],
        ttftC4: cols[7],
      });
    }
  }

  if (out.length === 0) throw new Error("Extracted 0 headroom rows");
  return out;
}

function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const showdown = extractShowdown();
  const headroom = extractHeadroom();

  const payload = {
    extractedAt: new Date().toISOString(),
    showdown: {
      title: "March 2026 48-Model × 4-Dimension Showdown (Archived Baseline)",
      sourceReport: "docs-archive/walkthroughs/model-showdown-results.md",
      runDate: "2026-03",
      reproduceCommand: "pnpm tsx examples/model-showdown/generate-report.ts",
      modelCount: showdown.length,
      totalCostUsd: 4.63,
      rows: showdown,
    },
    headroom: {
      title: "July 2026 M4 Max Concurrency Headroom (c=1 vs. c=4)",
      sourceReport: "reports/2026-07-26-headroom-ollama-does-not-batch.md",
      runDate: "2026-07-26",
      hardware: "Apple M4 Max",
      reproduceCommand: "pnpm --filter @umwelten/cli exec tsx src/entry.ts supplier probe --concurrency 1,4",
      rows: headroom,
    },
  };

  const outPath = path.join(DATA_DIR, "historical-archives.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(
    `Extracted ${showdown.length} showdown rows + ${headroom.length} headroom rows -> ${outPath}`,
  );
}

main();
