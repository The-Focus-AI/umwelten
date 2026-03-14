/**
 * PairwiseRanker — orchestrates pairwise LLM-judge comparisons with Elo ratings.
 *
 * Consumes existing model responses and produces a ranking via head-to-head
 * comparisons judged by an LLM. Supports round-robin and swiss tournament modes.
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { clearAllRateLimitStates } from '../../rate-limit/rate-limit.js';
import { Interaction } from '../../interaction/core/interaction.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import type { RankingEntry, PairwiseResult, RankingOutput, PairwiseRankerConfig } from './types.js';
import { updateElo, buildStandings } from './elo.js';
import { allPairs, swissPairs } from './pairing.js';
import type { Matchup } from './pairing.js';

const PairwiseSchema = z.object({
  winner: z.enum(['A', 'B', 'tie']).describe(
    'Which response is better? A, B, or tie if genuinely equal.'
  ),
  reason: z.string().describe(
    'One sentence: why the winner is better (or why it is a tie).'
  ),
  confidence: z.enum(['high', 'medium', 'low']).describe(
    'How confident are you in this judgment?'
  ),
});

export class PairwiseRanker {
  private entries: RankingEntry[];
  private config: Required<Omit<PairwiseRankerConfig, 'onProgress' | 'cacheDir'>> & Pick<PairwiseRankerConfig, 'onProgress' | 'cacheDir'>;

  private elo: number[];
  private wins: number[];
  private losses: number[];
  private ties: number[];
  private allResults: PairwiseResult[] = [];
  private cacheMap = new Map<string, PairwiseResult>();
  private compCount = 0;

  constructor(entries: RankingEntry[], config: PairwiseRankerConfig) {
    this.entries = entries;
    this.config = {
      pairingMode: 'swiss',
      swissRounds: 5,
      kFactor: 32,
      initialElo: 1500,
      maxResponseLength: 3000,
      delayMs: 300,
      temperature: 0,
      maxTokens: 300,
      ...config,
    };

    const n = entries.length;
    this.elo = new Array(n).fill(this.config.initialElo);
    this.wins = new Array(n).fill(0);
    this.losses = new Array(n).fill(0);
    this.ties = new Array(n).fill(0);

    this.loadCache();
  }

  async rank(): Promise<RankingOutput> {
    const n = this.entries.length;
    const { pairingMode, swissRounds } = this.config;

    if (pairingMode === 'all') {
      const matchups = allPairs(n);
      for (const m of matchups) {
        this.compCount++;
        if (this.compCount % 50 === 0) clearAllRateLimitStates();
        const label = `[${this.compCount}/${matchups.length}] ${this.entries[m.a].model} vs ${this.entries[m.b].model}`;
        await this.runMatchup(m, label);
        this.saveProgress();
        if (this.config.delayMs > 0) await delay(this.config.delayMs);
      }
    } else {
      for (let round = 1; round <= swissRounds; round++) {
        const pairs = swissPairs(this.elo, round);
        for (const m of pairs) {
          this.compCount++;
          if (this.compCount % 50 === 0) clearAllRateLimitStates();
          const label = `[R${round} #${this.compCount}] ${this.entries[m.a].model} vs ${this.entries[m.b].model}`;
          await this.runMatchup(m, label);
          this.saveProgress();
          if (this.config.delayMs > 0) await delay(this.config.delayMs);
        }
      }
    }

    const rankings = buildStandings(this.entries, this.elo, this.wins, this.losses, this.ties);
    const mode = pairingMode === 'all' ? 'round-robin' : `swiss-${swissRounds}`;

    return {
      mode,
      comparisons: this.compCount,
      judge: `${this.config.judgeModel.provider}:${this.config.judgeModel.name}`,
      rankings,
      matchResults: this.allResults,
    };
  }

  private async runMatchup(m: Matchup, label: string): Promise<void> {
    const a = this.entries[m.a];
    const b = this.entries[m.b];

    // Check cache
    const cached = this.cacheMap.get(`${a.key}:${b.key}`);
    if (cached) {
      let winner = cached.winner;
      if (cached.aKey === b.key && cached.bKey === a.key) {
        winner = winner === 'A' ? 'B' : winner === 'B' ? 'A' : 'tie';
      }
      this.applyResult(m.a, m.b, winner);
      this.allResults.push(cached);
      this.config.onProgress?.(label, true);
      return;
    }

    // Randomize presentation order to avoid position bias
    const flip = Math.random() < 0.5;
    const first = flip ? b : a;
    const second = flip ? a : b;

    const maxLen = this.config.maxResponseLength;
    const textA = first.responseText.length > maxLen
      ? first.responseText.slice(0, maxLen) + '\n\n[... truncated for judging ...]'
      : first.responseText;
    const textB = second.responseText.length > maxLen
      ? second.responseText.slice(0, maxLen) + '\n\n[... truncated for judging ...]'
      : second.responseText;

    try {
      const judgeStimulus = new Stimulus({
        role: 'evaluation judge',
        objective: 'compare two AI-generated responses',
        instructions: this.config.judgeInstructions,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        runnerType: 'base',
      });

      const judgeInteraction = new Interaction(this.config.judgeModel, judgeStimulus);
      judgeInteraction.addMessage({
        role: 'user',
        content:
          `=== RESPONSE A ===\n${textA}\n\n` +
          `=== RESPONSE B ===\n${textB}\n\n` +
          `Which response is better?`,
      });

      const judgeResponse = await judgeInteraction.generateObject(PairwiseSchema);
      const raw = judgeResponse.content;
      const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as z.infer<typeof PairwiseSchema>;

      let actualWinner: 'A' | 'B' | 'tie' = parsed.winner;
      if (flip && actualWinner !== 'tie') {
        actualWinner = actualWinner === 'A' ? 'B' : 'A';
      }

      const result: PairwiseResult = {
        aKey: a.key,
        bKey: b.key,
        winner: actualWinner,
        reason: parsed.reason,
        confidence: parsed.confidence,
      };

      this.cacheMap.set(`${a.key}:${b.key}`, result);
      this.cacheMap.set(`${b.key}:${a.key}`, result);
      this.allResults.push(result);
      this.applyResult(m.a, m.b, actualWinner);

      this.config.onProgress?.(label, false);
    } catch {
      // Count as a tie on error
      this.applyResult(m.a, m.b, 'tie');
      this.config.onProgress?.(label, false);
    }
  }

  private applyResult(aIdx: number, bIdx: number, winner: 'A' | 'B' | 'tie') {
    const K = this.config.kFactor;
    if (winner === 'A') {
      const [newA, newB] = updateElo(this.elo[aIdx], this.elo[bIdx], 1, K);
      this.elo[aIdx] = newA;
      this.elo[bIdx] = newB;
      this.wins[aIdx]++;
      this.losses[bIdx]++;
    } else if (winner === 'B') {
      const [newA, newB] = updateElo(this.elo[aIdx], this.elo[bIdx], 0, K);
      this.elo[aIdx] = newA;
      this.elo[bIdx] = newB;
      this.losses[aIdx]++;
      this.wins[bIdx]++;
    } else {
      const [newA, newB] = updateElo(this.elo[aIdx], this.elo[bIdx], 0.5, K);
      this.elo[aIdx] = newA;
      this.elo[bIdx] = newB;
      this.ties[aIdx]++;
      this.ties[bIdx]++;
    }
  }

  private loadCache() {
    if (!this.config.cacheDir) return;
    const cacheFile = path.join(this.config.cacheDir, 'comparisons.json');
    if (!fs.existsSync(cacheFile)) return;

    try {
      const cached: PairwiseResult[] = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      for (const r of cached) {
        this.cacheMap.set(`${r.aKey}:${r.bKey}`, r);
        this.cacheMap.set(`${r.bKey}:${r.aKey}`, r);
      }
    } catch {
      // Ignore corrupt cache
    }
  }

  private saveProgress() {
    if (!this.config.cacheDir) return;
    fs.mkdirSync(this.config.cacheDir, { recursive: true });

    fs.writeFileSync(
      path.join(this.config.cacheDir, 'comparisons.json'),
      JSON.stringify(this.allResults, null, 2),
    );

    const rankings = buildStandings(this.entries, this.elo, this.wins, this.losses, this.ties);
    const mode = this.config.pairingMode === 'all' ? 'round-robin' : `swiss-${this.config.swissRounds}`;
    fs.writeFileSync(
      path.join(this.config.cacheDir, 'rankings.json'),
      JSON.stringify({
        mode,
        comparisons: this.compCount,
        judge: `${this.config.judgeModel.provider}:${this.config.judgeModel.name}`,
        rankings,
        matchResults: this.allResults,
      }, null, 2),
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
