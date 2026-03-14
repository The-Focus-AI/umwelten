/**
 * Types for pairwise Elo ranking of model responses.
 */

import type { EvaluationResult } from '../api.js';
import type { ModelDetails } from '../../cognition/types.js';

/** A single model response to be ranked. */
export interface RankingEntry {
  key: string;
  model: string;
  provider: string;
  responseText: string;
  metadata?: Record<string, unknown>;
}

/** Result of a single pairwise comparison. */
export interface PairwiseResult {
  aKey: string;
  bKey: string;
  winner: 'A' | 'B' | 'tie';
  reason: string;
  confidence: string;
}

/** A model's final ranked position with Elo and match stats. */
export interface RankedModel {
  model: string;
  provider: string;
  key: string;
  elo: number;
  wins: number;
  losses: number;
  ties: number;
  matches: number;
  metadata?: Record<string, unknown>;
}

/** Output from a full ranking run. */
export interface RankingOutput {
  mode: string;
  comparisons: number;
  judge: string;
  rankings: RankedModel[];
  matchResults: PairwiseResult[];
}

/** Configuration for the PairwiseRanker. */
export interface PairwiseRankerConfig {
  /** Model to use as judge. */
  judgeModel: ModelDetails;
  /** Instructions for the judge stimulus. */
  judgeInstructions: string[];
  /** 'all' for round-robin, 'swiss' for swiss tournament. Default: 'swiss'. */
  pairingMode?: 'all' | 'swiss';
  /** Number of swiss rounds (only used when pairingMode is 'swiss'). Default: 5. */
  swissRounds?: number;
  /** Elo K-factor. Default: 32. */
  kFactor?: number;
  /** Initial Elo rating. Default: 1500. */
  initialElo?: number;
  /** Max response length before truncation. Default: 3000. */
  maxResponseLength?: number;
  /** Directory to cache comparisons and rankings. */
  cacheDir?: string;
  /** Delay between comparisons in ms. Default: 300. */
  delayMs?: number;
  /** Judge temperature. Default: 0. */
  temperature?: number;
  /** Judge max tokens. Default: 300. */
  maxTokens?: number;
  /** Callback for progress reporting. */
  onProgress?: (label: string, cached: boolean) => void;
}

/**
 * Convert EvaluationResult entries into RankingEntry[].
 * Filters out failed results and results without response content.
 */
export function evaluationResultsToRankingEntries(
  evalResult: EvaluationResult
): RankingEntry[] {
  return evalResult.results
    .filter(r => r.success && r.response?.content)
    .map(r => ({
      key: `${r.model.provider}__${r.model.name}`.replace(/[/:]/g, '_'),
      model: r.model.name,
      provider: r.model.provider,
      responseText: r.response!.content,
    }));
}
