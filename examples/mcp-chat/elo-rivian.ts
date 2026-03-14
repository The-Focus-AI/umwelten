#!/usr/bin/env node
/**
 * Rivian Elo Narrative Ranking — Pairwise LLM Judge with Bradley-Terry Ratings
 *
 * Reads cached responses from a rivian eval run and runs pairwise comparisons
 * using the extracted PairwiseRanker framework.
 *
 * Usage:
 *   pnpm tsx elo-rivian.ts                # run 004 (latest), sample ~100 pairs
 *   pnpm tsx elo-rivian.ts --run 3        # specific run
 *   pnpm tsx elo-rivian.ts --full         # full round-robin (all pairs)
 *   pnpm tsx elo-rivian.ts --rounds 7     # swiss-tournament rounds (default: 5)
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });

import fs from 'fs';
import path from 'path';
import type { ModelDetails } from '../../src/cognition/types.js';
import { PairwiseRanker } from '../../src/evaluation/ranking/index.js';
import type { RankingEntry } from '../../src/evaluation/ranking/index.js';

// ── CLI flags ────────────────────────────────────────────────────────

function parseFlag(name: string): number | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  const n = parseInt(process.argv[idx + 1], 10);
  return Number.isNaN(n) ? null : n;
}

const fullRoundRobin = process.argv.includes('--full');
const swissRounds = parseFlag('--rounds') ?? 5;

// ── Load responses ───────────────────────────────────────────────────

const baseDir = path.join(process.cwd(), 'output', 'evaluations', 'rivian-10day', 'runs');
const existingRuns = fs.readdirSync(baseDir)
  .filter(d => /^\d+$/.test(d))
  .map(d => parseInt(d, 10))
  .sort((a, b) => a - b);

const requestedRun = parseFlag('--run');
const runNumber = requestedRun ?? existingRuns[existingRuns.length - 1];
const runId = String(runNumber).padStart(3, '0');
const runDir = path.join(baseDir, runId);

console.log(`\n⚔️  Elo Narrative Ranking — Run ${runId}`);
console.log('═'.repeat(60));

const responsesDir = path.join(runDir, 'responses');
const resultsDir = path.join(runDir, 'results');
const entries: (RankingEntry & { toolScore: number })[] = [];

for (const file of fs.readdirSync(resultsDir).filter(f => f.endsWith('.json'))) {
  const resultPath = path.join(resultsDir, file);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  if (!result.judge) continue;

  const key = file.replace('.json', '');
  const responsePath = path.join(responsesDir, key + '.json');
  if (!fs.existsSync(responsePath)) continue;

  const resp = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
  if (!resp.responseText) continue;

  entries.push({
    key,
    model: result.model,
    provider: result.provider,
    responseText: resp.responseText,
    toolScore: result.toolUsage?.tool_score ?? 0,
    metadata: { toolScore: result.toolUsage?.tool_score ?? 0 },
  });
}

console.log(`Loaded ${entries.length} responses with text\n`);

// ── Run ranking ──────────────────────────────────────────────────────

const judgeModel: ModelDetails = process.env.OPENROUTER_API_KEY
  ? { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' }
  : { name: 'gpt-oss:latest', provider: 'ollama' };

const eloDir = path.join(runDir, 'elo');

const ranker = new PairwiseRanker(entries, {
  judgeModel,
  judgeInstructions: [
    'You will see two model responses (A and B) to the same prompt:',
    '"Summarize the 10 days of the Rivian\'s activity between Feb 27 and Mar 8, 2026."',
    '',
    'Judge ONLY the quality of the narrative summary. Consider:',
    '- Storytelling: Does it read like a story, not a data dump?',
    '- Specificity: Does it use real dates, distances, locations, charge percentages?',
    '- Completeness: Does it cover the full 10-day range?',
    '- Engagement: Would a human enjoy reading this?',
    '- Structure: Is it well-organized with a clear arc?',
    '',
    'Do NOT judge which model is "smarter" or "more capable" generally.',
    'Focus purely on which response is a better piece of writing.',
    '',
    'If one is clearly better, pick it. Only say "tie" if they are genuinely equal quality.',
    'Reply with ONLY a JSON object, no markdown fences.',
  ],
  pairingMode: fullRoundRobin ? 'all' : 'swiss',
  swissRounds,
  cacheDir: eloDir,
  onProgress: (label, cached) => {
    process.stdout.write(cached ? `  📁 ${label} (cached)\n` : `  ${label}\n`);
  },
});

console.log(`Mode: ${fullRoundRobin ? 'Full round-robin' : `Swiss tournament — ${swissRounds} rounds`}`);
console.log(`Judge: ${judgeModel.provider}:${judgeModel.name}\n`);

async function main() {
  const output = await ranker.rank();

  // Also update the report's elo-data.json
  const reportDir = path.join(runDir, 'report');
  if (fs.existsSync(reportDir)) {
    const lookup: Record<string, any> = {};
    for (const r of output.rankings) {
      lookup[r.key] = { elo: r.elo, wins: r.wins, losses: r.losses, ties: r.ties, matches: r.matches };
    }
    fs.writeFileSync(path.join(reportDir, 'elo-data.json'), JSON.stringify({
      mode: output.mode,
      comparisons: output.comparisons,
      judge: output.judge,
      lookup,
      ranked: output.rankings,
    }, null, 2));
  }

  // ── Print results ─────────────────────────────────────────────────
  const ranked = output.rankings;
  const mw = Math.max(40, ...ranked.map(r => `${r.provider}:${r.model}`.length + 2));

  console.log('\n\n🏆 ELO NARRATIVE RANKINGS');
  console.log('═'.repeat(100));
  console.log(
    `${'Rank'.padEnd(6)}${'Model'.padEnd(mw)}${'Elo'.padEnd(8)}${'W'.padEnd(5)}${'L'.padEnd(5)}${'T'.padEnd(5)}${'Games'.padEnd(7)}${'Tools'.padEnd(7)}`
  );
  console.log('─'.repeat(100));

  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`;
    const label = `${r.provider}:${r.model}`;
    const toolScore = (r.metadata as any)?.toolScore ?? 0;
    console.log(
      `${medal.padEnd(6)}${label.padEnd(mw)}${String(r.elo).padEnd(8)}${String(r.wins).padEnd(5)}${String(r.losses).padEnd(5)}${String(r.ties).padEnd(5)}${String(r.matches).padEnd(7)}${toolScore}/5`
    );
  }

  console.log('─'.repeat(100));
  console.log(`\n📊 ${output.comparisons} comparisons completed`);
  console.log(`   #1 ${ranked[0].provider}:${ranked[0].model} — Elo ${ranked[0].elo}`);
  console.log(`   #2 ${ranked[1].provider}:${ranked[1].model} — Elo ${ranked[1].elo}`);
  console.log(`   #3 ${ranked[2].provider}:${ranked[2].model} — Elo ${ranked[2].elo}`);
  console.log(`\n📁 Results: ${path.join(eloDir, 'rankings.json')}`);
  console.log('   Comparisons cached — re-run is instant for existing matchups.\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
