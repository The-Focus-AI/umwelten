/**
 * Metrics computation for the memorization pipeline.
 * Wraps bmc@k with per-book and per-model aggregation.
 */

import type { BookMetrics, BmcResult, GenerationResult, BookChunk, Summary } from './types.js';
import { computeBmcAtK } from './bmc.js';

/**
 * Compute all metrics for a single book and model.
 *
 * @param bookId - Book identifier
 * @param bookText - Full book text
 * @param chunks - Segmented chunks for this book
 * @param summaries - Summaries for each chunk
 * @param generations - Generation results grouped by chunk index
 * @param modelKey - Model identifier string
 * @param k - Minimum span length (default: 5)
 * @param m - Instruction n-gram size (default: 5)
 */
export function computeBookMetrics(
  bookId: string,
  bookText: string,
  chunks: BookChunk[],
  summaries: Summary[],
  generations: Map<number, string[]>,
  modelKey: string,
  k: number = 5,
  m: number = 5,
): BookMetrics {
  // Align chunks and summaries
  const excerpts: string[] = [];
  const instructions: string[] = [];
  const genArrays: string[][] = [];

  for (const chunk of chunks) {
    const summary = summaries.find(
      s => s.bookId === bookId && s.chunkIndex === chunk.chunkIndex,
    );
    if (!summary) continue;

    const gens = generations.get(chunk.chunkIndex);
    if (!gens || gens.length === 0) continue;

    excerpts.push(chunk.text);
    instructions.push(summary.summary);
    genArrays.push(gens);
  }

  const bmcResult = computeBmcAtK(bookText, excerpts, instructions, genArrays, k, m);
  bmcResult.bookId = bookId;

  const totalGenerations = genArrays.reduce((sum, g) => sum + g.length, 0);

  return {
    bookId,
    modelKey,
    bmcAtK: bmcResult.bmcAtK,
    longestSpan: bmcResult.longestSpan,
    longestRegurgitated: bmcResult.longestRegurgitated,
    spanCount: bmcResult.spanCount,
    regurgitatedSpanCount: bmcResult.regurgitatedSpans.length,
    totalGenerations,
    totalBookWords: bmcResult.totalBookWords,
    coveredWords: bmcResult.coveredWords,
  };
}

/**
 * Group generation results by chunk index.
 */
export function groupGenerationsByChunk(
  results: GenerationResult[],
): Map<number, string[]> {
  const grouped = new Map<number, string[]>();
  for (const r of results) {
    const existing = grouped.get(r.chunkIndex);
    if (existing) {
      existing.push(r.generation);
    } else {
      grouped.set(r.chunkIndex, [r.generation]);
    }
  }
  return grouped;
}

/**
 * Format metrics as a summary string for console output.
 */
export function formatMetricsSummary(metrics: BookMetrics): string {
  const pct = (metrics.bmcAtK * 100).toFixed(1);
  return [
    `Book: ${metrics.bookId}`,
    `  Model: ${metrics.modelKey}`,
    `  bmc@k: ${pct}% (${metrics.coveredWords}/${metrics.totalBookWords} words)`,
    `  Longest span: ${metrics.longestSpan} words`,
    `  Longest regurgitated span (>20w): ${metrics.longestRegurgitated} words`,
    `  Total spans: ${metrics.spanCount}`,
    `  Regurgitated spans (>20w): ${metrics.regurgitatedSpanCount}`,
    `  Total generations: ${metrics.totalGenerations}`,
  ].join('\n');
}
