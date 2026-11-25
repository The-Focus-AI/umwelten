import fs from "node:fs";
import path from "node:path";
import { runPiTurn } from "@umwelten/pi";
import type {
  RankingEntry,
  PairwiseResult,
  RankingOutput,
  PairwiseRankerConfig,
} from "./types.js";
import { updateElo, buildStandings } from "./elo.js";
import { allPairs, swissPairs, type Matchup } from "./pairing.js";

export class PairwiseRanker {
  private readonly entries: RankingEntry[];
  private readonly config: PairwiseRankerConfig;

  constructor(entries: RankingEntry[], config: PairwiseRankerConfig) {
    this.entries = entries;
    this.config = config;
  }

  async rank(): Promise<RankingOutput> {
    const initialElo = this.config.initialElo ?? 1500;
    const kFactor = this.config.kFactor ?? 32;
    const maxLen = this.config.maxResponseLength ?? 3000;
    const delayMs = this.config.delayMs ?? 300;
    const pairingMode = this.config.pairingMode ?? "swiss";
    const swissRounds = this.config.swissRounds ?? 5;

    const n = this.entries.length;
    const elo = new Array(n).fill(initialElo);
    const wins = new Array(n).fill(0);
    const losses = new Array(n).fill(0);
    const ties = new Array(n).fill(0);

    const cache = this.loadCache();
    const allResults: PairwiseResult[] = [];

    const rounds: Matchup[][] =
      pairingMode === "all"
        ? [allPairs(n)]
        : Array.from({ length: swissRounds }, (_, r) => swissPairs(elo, r));

    for (let roundIdx = 0; roundIdx < rounds.length; roundIdx++) {
      const pairs =
        pairingMode === "swiss" ? swissPairs(elo, roundIdx) : rounds[0];

      for (const pair of pairs) {
        const entryA = this.entries[pair.a];
        const entryB = this.entries[pair.b];
        const [lo, hi] = [entryA.key, entryB.key].sort();
        const cacheKey = `${lo}__vs__${hi}`;
        const label = `${entryA.key} vs ${entryB.key}`;

        if (cache.has(cacheKey)) {
          const cached = cache.get(cacheKey)!;
          allResults.push(cached);
          this.applyResult(cached, pair.a, pair.b, elo, wins, losses, ties, kFactor);
          this.config.onProgress?.(label, true);
          continue;
        }

        const result = await this.judge(entryA, entryB, maxLen);
        cache.set(cacheKey, result);
        allResults.push(result);
        this.applyResult(result, pair.a, pair.b, elo, wins, losses, ties, kFactor);
        this.config.onProgress?.(label, false);

        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    const rankings = buildStandings(this.entries, elo, wins, losses, ties);
    const judgeCostUsd = allResults.reduce((s, r) => s + (r.costUsd ?? 0), 0);
    const output: RankingOutput = {
      mode: pairingMode === "all" ? "round-robin" : `swiss-${swissRounds}`,
      comparisons: allResults.length,
      judge: `${this.config.judgeModel.provider}:${this.config.judgeModel.name}`,
      judgeCostUsd,
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
    let scoreA: number;
    if (result.winner === "tie") {
      scoreA = 0.5;
      ties[idxA]++;
      ties[idxB]++;
    } else {
      const aEntry = this.entries[idxA];
      const winnerIsA =
        (result.winner === "A" && result.aKey === aEntry.key) ||
        (result.winner === "B" && result.bKey === aEntry.key);
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
    const flip = Math.random() < 0.5;
    const first = flip ? entryB : entryA;
    const second = flip ? entryA : entryB;

    const systemPrompt = [
      "You are an impartial judge.",
      ...this.config.judgeInstructions,
    ].join("\n");

    const prompt = [
      "## Response A",
      "",
      first.responseText.slice(0, maxLen),
      "",
      "## Response B",
      "",
      second.responseText.slice(0, maxLen),
      "",
      'Reply with ONLY a JSON object: { "winner": "A" | "B" | "tie", "reason": "...", "confidence": "high" | "medium" | "low" }',
    ].join("\n");

    try {
      const response = await runPiTurn({
        model: this.config.judgeModel,
        systemPrompt,
        prompt,
        temperature: this.config.temperature ?? 0,
        maxTokens: this.config.maxTokens,
      });

      const trimmed = response.content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");
      const objMatch = trimmed.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(objMatch ? objMatch[0] : trimmed);
      let winner: "A" | "B" | "tie" =
        parsed.winner === "A" ? "A" : parsed.winner === "B" ? "B" : "tie";
      if (flip && winner !== "tie") {
        winner = winner === "A" ? "B" : "A";
      }

      return {
        aKey: entryA.key,
        bKey: entryB.key,
        winner,
        reason: parsed.reason ?? "",
        confidence: parsed.confidence ?? "medium",
        costUsd: response.costUsd,
      };
    } catch {
      return {
        aKey: entryA.key,
        bKey: entryB.key,
        winner: "tie",
        reason: "judge error",
        confidence: "low",
        costUsd: 0,
      };
    }
  }

  private loadCache(): Map<string, PairwiseResult> {
    const map = new Map<string, PairwiseResult>();
    if (!this.config.cacheDir) return map;
    const filePath = path.join(this.config.cacheDir, "comparisons.json");
    if (!fs.existsSync(filePath)) return map;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (data && typeof data === "object") {
        for (const [k, v] of Object.entries(data)) map.set(k, v as PairwiseResult);
      }
    } catch {
      // Ignore corrupt cache
    }
    return map;
  }

  private saveResults(output: RankingOutput, cache: Map<string, PairwiseResult>): void {
    if (!this.config.cacheDir) return;
    fs.mkdirSync(this.config.cacheDir, { recursive: true });
    const cacheObj: Record<string, PairwiseResult> = {};
    for (const [k, v] of cache) cacheObj[k] = v;
    fs.writeFileSync(
      path.join(this.config.cacheDir, "comparisons.json"),
      JSON.stringify(cacheObj, null, 2),
    );
    fs.writeFileSync(
      path.join(this.config.cacheDir, "rankings.json"),
      JSON.stringify(output, null, 2),
    );
  }
}
