/**
 * Pure Elo math — Bradley-Terry expected scores and rating updates.
 */

import type { RankingEntry, RankedModel } from './types.js';

/** Bradley-Terry expected score for player A against player B. */
export function expectedScore(rA: number, rB: number): number {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

/**
 * Update Elo ratings after a single match.
 * @param scoreA — 1 for A wins, 0 for B wins, 0.5 for tie
 * @returns [newA, newB]
 */
export function updateElo(rA: number, rB: number, scoreA: number, K: number = 32): [number, number] {
  const eA = expectedScore(rA, rB);
  const eB = 1 - eA;
  const scoreB = 1 - scoreA;
  return [
    rA + K * (scoreA - eA),
    rB + K * (scoreB - eB),
  ];
}

/**
 * Build sorted standings from entries and their accumulated stats.
 */
export function buildStandings(
  entries: RankingEntry[],
  elo: number[],
  wins: number[],
  losses: number[],
  ties: number[],
): RankedModel[] {
  return entries.map((e, i) => ({
    model: e.model,
    provider: e.provider,
    key: e.key,
    elo: Math.round(elo[i]),
    wins: wins[i],
    losses: losses[i],
    ties: ties[i],
    matches: wins[i] + losses[i] + ties[i],
    metadata: e.metadata,
  })).sort((a, b) => b.elo - a.elo);
}
