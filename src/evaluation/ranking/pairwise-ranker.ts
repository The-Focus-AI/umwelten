/**
 * PairwiseRanker — run pairwise LLM-judge comparisons and compute Elo ratings.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Stimulus } from '../../stimulus/stimulus.js';
import { Interaction } from '../../interaction/core/interaction.js';
import type { ModelDetails } from '../../cognition/types.js';
import type {
  RankingEntry,
  PairwiseResult,
  RankingOutput,
  PairwiseRankerConfig,
  RankedModel,
} from './types.js';
import { updateElo, buildStandings } from './elo.js';
import { allPairs, swissPairs } from './pairing.js';
import type { Matchup } from './pairing.js';

export class PairwiseRanker {
  private entries: RankingEntry[];
  private config: PairwiseRankerConfig;

  constructor(entries: RankingEntry[], config: PairwiseRankerConfig) {
    this.entries = entries;
    this.config = config;
  }

  async rank(): Promise<RankingOutput> {
    const initialElo = this.config.initialElo ?? 1500;
    const kFactor = this.config.kFactor ?? 32;
    const maxLen = this.config.maxResponseLength ?? 3000;
    const delayMs = this.config.delayMs ?? 300;
    const pairingMode = this.config.pairingMode ?? 'swiss';
    const swissRounds = this.config.swissRounds ?? 5;

    const n = this.entries.length;
    const elo = new Array(n).fill(initialElo);
    const wins = new Array(n).fill(0);
    const losses = new Array(n).fill(0);
    const ties = new Array(n).fill(0);

    // Load cached comparisons
    const cache = this.loadCache();
    const allResults: PairwiseResult[] = [];

    // Generate pairs
    let rounds: Matchup[][];
    if (pairingMode === 'all') {
      rounds = [allPairs(n)];
    } else {
      rounds = [];
      for (let r = 0; r < swissRounds; r++) {
        rounds.push(swissPairs(elo, r));
      }
    }

    for (let roundIdx = 0; roundIdx < rounds.length; roundIdx++) {
      const pairs = pairingMode === 'swiss' ? swissPairs(elo, roundIdx) : rounds[0];
      // Only generate fresh pairs for swiss mode each round (elo changes between rounds)

      for (const pair of pairs) {
        const entryA = this.entries[pair.a];
        const entryB = this.entries[pair.b];

        // Stable cache key: alphabetical order
        const [lo, hi] = [entryA.key, entryB.key].sort();
        const cacheKey = `${lo}__vs__${hi}`;
        const label = `${entryA.key} vs ${entryB.key}`;

        if (cache.has(cacheKey)) {
          // Replay cached result
          const cached = cache.get(cacheKey)!;
          allResults.push(cached);
          this.applyResult(cached, pair.a, pair.b, elo, wins, losses, ties, kFactor);
          this.config.onProgress?.(label, true);
          continue;
        }

        // Run judge comparison
        const result = await this.judge(entryA, entryB, maxLen);
        cache.set(cacheKey, result);
        allResults.push(result);
        this.applyResult(result, pair.a, pair.b, elo, wins, losses, ties, kFactor);
        this.config.onProgress?.(label, false);

        if (delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    const rankings = buildStandings(this.entries, elo, wins, losses, ties);
    const judgeLabel = `${this.config.judgeModel.provider}:${this.config.judgeModel.name}`;

    const output: RankingOutput = {
      mode: pairingMode === 'all' ? 'round-robin' : `swiss-${swissRounds}`,
      comparisons: allResults.length,
      judge: judgeLabel,
      rankings,
      matchResults: allResults,
    };

    this.saveResults(output, cache);
    return output;
  }

  private applyResult(
    result: PairwiseResult,
    idxA: number,
    idxB: number,
    elo: number[],
    wins: number[],
    losses: number[],
    ties: number[],
    kFactor: number,
  ): void {
    // Map result keys back to indices — aKey/bKey may not match pair order
    let scoreA: number;
    if (result.winner === 'tie') {
      scoreA = 0.5;
      ties[idxA]++;
      ties[idxB]++;
    } else {
      // Determine which index won
      const aEntry = this.entries[idxA];
      const winnerIsA =
        (result.winner === 'A' && result.aKey === aEntry.key) ||
        (result.winner === 'B' && result.bKey === aEntry.key);
      if (winnerIsA) {
        scoreA = 1;
        wins[idxA]++;
        losses[idxB]++;
      } else {
        scoreA = 0;
        losses[idxA]++;
        wins[idxB]++;
      }
    }

    const [newA, newB] = updateElo(elo[idxA], elo[idxB], scoreA, kFactor);
    elo[idxA] = newA;
    elo[idxB] = newB;
  }

  private async judge(
    entryA: RankingEntry,
    entryB: RankingEntry,
    maxLen: number,
  ): Promise<PairwiseResult> {
    // Randomly flip presentation to mitigate position bias
    const flip = Math.random() < 0.5;
    const first = flip ? entryB : entryA;
    const second = flip ? entryA : entryB;

    const textFirst = first.responseText.slice(0, maxLen);
    const textSecond = second.responseText.slice(0, maxLen);

    const stimulus = new Stimulus({
      role: 'impartial judge',
      instructions: this.config.judgeInstructions,
      temperature: this.config.temperature ?? 0,
      maxTokens: this.config.maxTokens ?? 300,
    });

    const prompt = [
      '## Response A',
      '',
      textFirst,
      '',
      '## Response B',
      '',
      textSecond,
      '',
      'Reply with ONLY a JSON object: { "winner": "A" | "B" | "tie", "reason": "...", "confidence": "high" | "medium" | "low" }',
    ].join('\n');

    try {
      const interaction = new Interaction(this.config.judgeModel, stimulus);
      interaction.addMessage({ role: 'user', content: prompt });
      const response = await interaction.generateText();

      const parsed = this.parseJudgeResponse(response.content);

      // Un-flip the winner
      let winner = parsed.winner;
      if (flip && winner !== 'tie') {
        winner = winner === 'A' ? 'B' : 'A';
      }

      return {
        aKey: entryA.key,
        bKey: entryB.key,
        winner,
        reason: parsed.reason,
        confidence: parsed.confidence,
      };
    } catch {
      // On error, count as tie
      return {
        aKey: entryA.key,
        bKey: entryB.key,
        winner: 'tie',
        reason: 'judge error',
        confidence: 'low',
      };
    }
  }

  private parseJudgeResponse(content: string): {
    winner: 'A' | 'B' | 'tie';
    reason: string;
    confidence: string;
  } {
    // Strip markdown code fences if present
    let text = content.trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    const parsed = JSON.parse(text);
    const winner = parsed.winner === 'A' ? 'A' : parsed.winner === 'B' ? 'B' : 'tie';
    return {
      winner,
      reason: parsed.reason ?? '',
      confidence: parsed.confidence ?? 'medium',
    };
  }

  private loadCache(): Map<string, PairwiseResult> {
    const map = new Map<string, PairwiseResult>();
    if (!this.config.cacheDir) return map;

    const filePath = path.join(this.config.cacheDir, 'comparisons.json');
    if (!fs.existsSync(filePath)) return map;

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (typeof data === 'object' && data !== null) {
        for (const [key, value] of Object.entries(data)) {
          map.set(key, value as PairwiseResult);
        }
      }
    } catch {
      // Ignore corrupt cache
    }
    return map;
  }

  private saveResults(output: RankingOutput, cache: Map<string, PairwiseResult>): void {
    if (!this.config.cacheDir) return;

    fs.mkdirSync(this.config.cacheDir, { recursive: true });

    // Save comparisons cache
    const cacheObj: Record<string, PairwiseResult> = {};
    for (const [key, value] of cache) {
      cacheObj[key] = value;
    }
    fs.writeFileSync(
      path.join(this.config.cacheDir, 'comparisons.json'),
      JSON.stringify(cacheObj, null, 2),
    );

    // Save rankings
    fs.writeFileSync(
      path.join(this.config.cacheDir, 'rankings.json'),
      JSON.stringify(output, null, 2),
    );
  }
}
