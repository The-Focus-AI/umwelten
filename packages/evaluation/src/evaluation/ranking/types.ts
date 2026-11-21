import type { ModelSpec } from "@umwelten/pi";

export interface RankableEvaluationResult {
  results: Array<{
    model: ModelSpec;
    success: boolean;
    response?: { content?: string } | null;
  }>;
}

export interface RankingEntry {
  key: string;
  model: string;
  provider: string;
  responseText: string;
  metadata?: Record<string, unknown>;
}

export interface PairwiseResult {
  aKey: string;
  bKey: string;
  winner: "A" | "B" | "tie";
  reason: string;
  confidence: string;
}

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

export interface RankingOutput {
  mode: string;
  comparisons: number;
  judge: string;
  rankings: RankedModel[];
  matchResults: PairwiseResult[];
}

export interface PairwiseRankerConfig {
  judgeModel: ModelSpec;
  judgeInstructions: string[];
  pairingMode?: "all" | "swiss";
  swissRounds?: number;
  kFactor?: number;
  initialElo?: number;
  maxResponseLength?: number;
  cacheDir?: string;
  delayMs?: number;
  temperature?: number;
  maxTokens?: number;
  onProgress?: (label: string, cached: boolean) => void;
}

export function evaluationResultsToRankingEntries(
  evalResult: RankableEvaluationResult,
): RankingEntry[] {
  return evalResult.results
    .filter((r) => r.success && r.response?.content)
    .map((r) => ({
      key: `${r.model.provider}__${r.model.name}`.replace(/[/:]/g, "_"),
      model: r.model.name,
      provider: r.model.provider,
      responseText: r.response!.content!,
    }));
}
