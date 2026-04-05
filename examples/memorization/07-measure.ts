/**
 * Stage 7: Compute bmc@k and all metrics per book/model.
 *
 * Reads inference results + original book text, computes memorization metrics.
 *
 * Usage: pnpm tsx examples/memorization/07-measure.ts
 */

import fs from 'fs';
import path from 'path';
import { resolveRun } from '../model-showdown/shared/runner-utils.js';
import { computeBookMetrics, groupGenerationsByChunk, formatMetricsSummary } from './shared/metrics.js';
import type { BookChunk, Summary, GenerationResult, BookMetrics, MemorizationConfig } from './shared/types.js';

const CONFIG_PATH = path.join(process.cwd(), 'input', 'memorization', 'config.json');
const BOOKS_DIR = path.join(process.cwd(), 'input', 'memorization', 'books');
const SEGMENTS_EVAL = 'memorization-segments';
const SUMMARIES_EVAL = 'memorization-summaries';
const INFERENCE_EVAL = 'memorization-inference';
const METRICS_EVAL = 'memorization-metrics';

function loadConfig(): MemorizationConfig {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function loadChunks(dir: string, bookId: string): BookChunk[] {
  const p = path.join(dir, bookId, 'chunks.jsonl');
  return fs.readFileSync(p, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
}

function loadSummaries(dir: string, bookId: string): Summary[] {
  const p = path.join(dir, bookId, 'summaries.jsonl');
  return fs.readFileSync(p, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
}

function loadGenerations(dir: string, bookId: string, modelKey: string): GenerationResult[] {
  // New format: bookId/chunk-N/model.jsonl
  const bookDir = path.join(dir, bookId);
  if (!fs.existsSync(bookDir)) return [];

  const results: GenerationResult[] = [];

  // Try new per-chunk directory format
  const entries = fs.readdirSync(bookDir, { withFileTypes: true });
  const chunkDirs = entries.filter(e => e.isDirectory() && e.name.startsWith('chunk-'));

  if (chunkDirs.length > 0) {
    for (const chunkDir of chunkDirs) {
      const p = path.join(bookDir, chunkDir.name, `${modelKey}.jsonl`);
      if (fs.existsSync(p)) {
        const lines = fs.readFileSync(p, 'utf-8').trim().split('\n').filter(l => l.trim());
        results.push(...lines.map(l => JSON.parse(l)));
      }
    }
  } else {
    // Legacy flat format: bookId/model.jsonl
    const p = path.join(bookDir, `${modelKey}.jsonl`);
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, 'utf-8').trim().split('\n').filter(l => l.trim());
      results.push(...lines.map(l => JSON.parse(l)));
    }
  }

  return results;
}

async function main() {
  console.log('=== Stage 7: Compute Metrics ===\n');

  const config = loadConfig();
  const segmentsRun = resolveRun(SEGMENTS_EVAL);
  const summariesRun = resolveRun(SUMMARIES_EVAL);
  const inferenceRun = resolveRun(INFERENCE_EVAL);
  const { runId, runDir } = resolveRun(METRICS_EVAL);

  console.log(`Inference: ${inferenceRun.runDir}`);
  console.log(`Output: ${runDir}\n`);

  const modelKeys = ['baseline', 'finetuned'];
  const allMetrics: BookMetrics[] = [];

  for (const bookId of config.testBooks) {
    // Load book text
    const bookPath = path.join(BOOKS_DIR, `${bookId}.txt`);
    if (!fs.existsSync(bookPath)) {
      console.error(`Book not found: ${bookPath}`);
      continue;
    }
    const bookText = fs.readFileSync(bookPath, 'utf-8');

    // Load chunks and summaries
    const chunks = loadChunks(segmentsRun.runDir, bookId);
    const summaries = loadSummaries(summariesRun.runDir, bookId);

    console.log(`Book: ${bookId} (${chunks.length} chunks)`);

    const bookDir = path.join(runDir, bookId, 'results');
    fs.mkdirSync(bookDir, { recursive: true });

    for (const modelKey of modelKeys) {
      const generations = loadGenerations(inferenceRun.runDir, bookId, modelKey);
      if (generations.length === 0) {
        console.log(`  ${modelKey}: no generations found, skipping`);
        continue;
      }

      const grouped = groupGenerationsByChunk(generations);
      const metrics = computeBookMetrics(
        bookId,
        bookText,
        chunks,
        summaries,
        grouped,
        modelKey,
      );

      allMetrics.push(metrics);

      // Save per-model results
      fs.writeFileSync(
        path.join(bookDir, `${modelKey}.json`),
        JSON.stringify(metrics, null, 2),
      );

      console.log(formatMetricsSummary(metrics));
      console.log();
    }
  }

  // Save combined metrics
  fs.writeFileSync(
    path.join(runDir, 'all-metrics.json'),
    JSON.stringify(allMetrics, null, 2),
  );

  // Print comparison table
  if (allMetrics.length >= 2) {
    console.log('=== Comparison ===\n');
    console.log(
      'Model'.padEnd(15) +
      'bmc@k'.padEnd(10) +
      'Longest'.padEnd(10) +
      'Regurg'.padEnd(10) +
      'Spans'.padEnd(10),
    );
    console.log('-'.repeat(55));
    for (const m of allMetrics) {
      console.log(
        m.modelKey.padEnd(15) +
        `${(m.bmcAtK * 100).toFixed(1)}%`.padEnd(10) +
        `${m.longestSpan}w`.padEnd(10) +
        `${m.longestRegurgitated}w`.padEnd(10) +
        `${m.spanCount}`.padEnd(10),
      );
    }
  }

  console.log(`\nOutput: ${runDir}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
