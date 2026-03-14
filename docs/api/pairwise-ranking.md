# Pairwise Ranking API Reference

API reference for the pairwise Elo ranking module at `src/evaluation/ranking/`.

## Imports

```typescript
// All exports available from the ranking module
import {
  PairwiseRanker,
  expectedScore,
  updateElo,
  buildStandings,
  allPairs,
  swissPairs,
  evaluationResultsToRankingEntries,
} from '../src/evaluation/ranking/index.js';

// Also re-exported from the evaluation barrel
import { PairwiseRanker } from '../src/evaluation/index.js';

// Types
import type {
  RankingEntry,
  PairwiseResult,
  RankedModel,
  RankingOutput,
  PairwiseRankerConfig,
  Matchup,
} from '../src/evaluation/ranking/index.js';
```

## PairwiseRanker

The main orchestrator class. Runs pairwise LLM-judge comparisons and computes Elo ratings.

### Constructor

```typescript
new PairwiseRanker(entries: RankingEntry[], config: PairwiseRankerConfig)
```

**Parameters:**
- `entries` — Array of model responses to rank. Each must have a unique `key`.
- `config` — Configuration for judging, pairing, caching, and Elo parameters.

The constructor loads any cached comparisons from `config.cacheDir` and initializes Elo ratings.

### Methods

#### `rank(): Promise<RankingOutput>`

Runs all pairwise comparisons and returns the final ranking.

- In `'swiss'` mode: runs `swissRounds` rounds, each pairing `floor(n/2)` matchups
- In `'all'` mode: runs all `n×(n-1)/2` pairs in shuffled order
- Saves progress after each comparison if `cacheDir` is set
- Clears rate limit state every 50 comparisons
- Returns sorted rankings (highest Elo first) with all match results

## Types

### RankingEntry

Input: a single model response to be ranked.

```typescript
interface RankingEntry {
  key: string;                         // Unique identifier for this entry
  model: string;                       // Model name
  provider: string;                    // Provider name
  responseText: string;                // The response text to judge
  metadata?: Record<string, unknown>;  // Arbitrary metadata (preserved through ranking)
}
```

### PairwiseResult

Output of a single head-to-head comparison.

```typescript
interface PairwiseResult {
  aKey: string;       // Key of the first entry
  bKey: string;       // Key of the second entry
  winner: 'A' | 'B' | 'tie';
  reason: string;     // One-sentence explanation from the judge
  confidence: string; // 'high' | 'medium' | 'low'
}
```

### RankedModel

A model's final position in the ranking.

```typescript
interface RankedModel {
  model: string;
  provider: string;
  key: string;
  elo: number;        // Rounded to nearest integer
  wins: number;
  losses: number;
  ties: number;
  matches: number;    // wins + losses + ties
  metadata?: Record<string, unknown>;
}
```

### RankingOutput

Complete output from a ranking run.

```typescript
interface RankingOutput {
  mode: string;                    // 'round-robin' | 'swiss-5' etc.
  comparisons: number;             // Total comparisons executed
  judge: string;                   // 'provider:model' of the judge
  rankings: RankedModel[];         // Sorted by Elo descending
  matchResults: PairwiseResult[];  // All individual comparison results
}
```

### PairwiseRankerConfig

Full configuration for the ranker.

```typescript
interface PairwiseRankerConfig {
  judgeModel: ModelDetails;       // Required: model to use as judge
  judgeInstructions: string[];    // Required: instructions for the judge stimulus
  pairingMode?: 'all' | 'swiss'; // Default: 'swiss'
  swissRounds?: number;           // Default: 5 (only for swiss mode)
  kFactor?: number;               // Default: 32
  initialElo?: number;            // Default: 1500
  maxResponseLength?: number;     // Default: 3000
  cacheDir?: string;              // Optional: directory for comparison/ranking cache
  delayMs?: number;               // Default: 300
  temperature?: number;           // Default: 0 (judge temperature)
  maxTokens?: number;             // Default: 300 (judge max tokens)
  onProgress?: (label: string, cached: boolean) => void;
}
```

## Pure Functions

### `expectedScore(rA: number, rB: number): number`

Bradley-Terry expected score for player A against player B.

```typescript
expectedScore(1500, 1500); // 0.5
expectedScore(1600, 1400); // ~0.76
expectedScore(1400, 1600); // ~0.24
```

Property: `expectedScore(a, b) + expectedScore(b, a) === 1.0`

### `updateElo(rA: number, rB: number, scoreA: number, K?: number): [number, number]`

Compute new ratings after a match.

**Parameters:**
- `rA` — Current rating of player A
- `rB` — Current rating of player B
- `scoreA` — `1` if A wins, `0` if B wins, `0.5` for tie
- `K` — K-factor (default: 32)

**Returns:** `[newRatingA, newRatingB]`

Property: total rating is conserved — `newA + newB === rA + rB`

```typescript
updateElo(1500, 1500, 1, 32);   // [1516, 1484] — A wins
updateElo(1500, 1500, 0, 32);   // [1484, 1516] — B wins
updateElo(1500, 1500, 0.5, 32); // [1500, 1500] — tie
```

### `buildStandings(entries, elo, wins, losses, ties): RankedModel[]`

Build a sorted standings array from parallel arrays of stats.

**Parameters:**
- `entries: RankingEntry[]` — The original entries
- `elo: number[]` — Current Elo ratings (parallel to entries)
- `wins: number[]` — Win counts (parallel to entries)
- `losses: number[]` — Loss counts
- `ties: number[]` — Tie counts

**Returns:** `RankedModel[]` sorted by Elo descending. Elo values are rounded to integers.

## Pairing Functions

### `allPairs(n: number): Matchup[]`

Generate all unique pairs for n entries (round-robin). Pairs are shuffled randomly.

```typescript
allPairs(4).length;  // 6 = 4×3/2
allPairs(10).length; // 45 = 10×9/2
allPairs(1).length;  // 0
```

### `swissPairs(ratings: number[], round: number): Matchup[]`

Swiss-style pairing: sort entries by current rating, pair adjacent entries.

```typescript
const ratings = [1500, 1600, 1400, 1550];
const pairs = swissPairs(ratings, 1);
// Pairs the highest-rated with second-highest, third with fourth
// Returns floor(n/2) matchups; odd entry gets a bye
```

### Matchup

```typescript
interface Matchup {
  a: number; // Index into entries array
  b: number; // Index into entries array
}
```

## Bridge Function

### `evaluationResultsToRankingEntries(evalResult: EvaluationResult): RankingEntry[]`

Convert `EvaluationResult` (from `src/evaluation/api.ts`) to `RankingEntry[]`.

- Filters out failed results and results without response content
- Generates keys from `provider__model` with special characters replaced by underscores

```typescript
import { runEvaluation } from '../src/evaluation/api.js';
import { evaluationResultsToRankingEntries, PairwiseRanker } from '../src/evaluation/ranking/index.js';

const evalResult = await runEvaluation(config);
const entries = evaluationResultsToRankingEntries(evalResult);
// entries is now ready for PairwiseRanker
```

## Cache Format

When `cacheDir` is set, two files are maintained:

### `comparisons.json`

Array of `PairwiseResult` objects — one per comparison:

```json
[
  {
    "aKey": "google__gemini-3-flash-preview",
    "bKey": "openrouter__openai_gpt-4o",
    "winner": "B",
    "reason": "Response B provides more specific examples and better structure.",
    "confidence": "high"
  }
]
```

### `rankings.json`

Full ranking output:

```json
{
  "mode": "swiss-5",
  "comparisons": 25,
  "judge": "openrouter:anthropic/claude-haiku-4.5",
  "rankings": [
    { "model": "gpt-4o", "provider": "openrouter", "key": "...", "elo": 1580, "wins": 4, "losses": 1, "ties": 0, "matches": 5 }
  ],
  "matchResults": [...]
}
```

Cache is bidirectional — if A-vs-B is cached, B-vs-A lookups find it and flip the winner.

## Module Structure

```
src/evaluation/ranking/
├── types.ts            — Type definitions + evaluationResultsToRankingEntries()
├── elo.ts              — Pure Elo math (expectedScore, updateElo, buildStandings)
├── pairing.ts          — Pairing strategies (allPairs, swissPairs)
├── pairwise-ranker.ts  — PairwiseRanker orchestrator class
├── index.ts            — Re-exports
├── elo.test.ts         — Unit tests for Elo math (13 tests)
└── pairing.test.ts     — Unit tests for pairing strategies (8 tests)
```
