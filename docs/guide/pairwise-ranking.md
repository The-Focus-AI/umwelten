# Pairwise Ranking with Elo Ratings

Compare model responses head-to-head using an LLM judge and produce a total ordering via Elo ratings. The `PairwiseRanker` is a post-processing step that consumes existing model responses — it doesn't generate them.

## Overview

Traditional evaluation scores each model independently. Pairwise ranking takes a different approach: present two responses side-by-side to a judge LLM and ask "which is better?" After enough comparisons, Bradley-Terry Elo ratings produce a statistically meaningful ranking.

**When to use pairwise ranking:**
- Subjective quality comparisons (narrative writing, creativity, style)
- Tasks where absolute scoring is unreliable but relative preference is clear
- Producing a total ordering of many models from head-to-head matchups
- Validating or supplementing automated scoring

## Quick Start

### From Existing Evaluation Results

If you've already run an evaluation with `eval run`, bridge the results directly:

```typescript
import { PairwiseRanker, evaluationResultsToRankingEntries } from '../src/evaluation/ranking/index.js';

// Convert evaluation results to ranking entries
const entries = evaluationResultsToRankingEntries(evalResult);

const ranker = new PairwiseRanker(entries, {
  judgeModel: { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' },
  judgeInstructions: [
    'You will see two model responses to the same prompt.',
    'Judge which response is better overall.',
    'Consider clarity, accuracy, and completeness.',
    'Only say "tie" if they are genuinely equal quality.',
  ],
});

const output = await ranker.rank();

for (const r of output.rankings) {
  console.log(`${r.model} — Elo ${r.elo} (${r.wins}W/${r.losses}L/${r.ties}T)`);
}
```

### From Custom Response Data

You can rank any set of text responses, not just evaluation results:

```typescript
import { PairwiseRanker } from '../src/evaluation/ranking/index.js';
import type { RankingEntry } from '../src/evaluation/ranking/index.js';

const entries: RankingEntry[] = [
  { key: 'gpt4o', model: 'gpt-4o', provider: 'openrouter', responseText: '...' },
  { key: 'gemini', model: 'gemini-3-flash-preview', provider: 'google', responseText: '...' },
  { key: 'claude', model: 'claude-sonnet-4', provider: 'openrouter', responseText: '...' },
];

const ranker = new PairwiseRanker(entries, {
  judgeModel: { name: 'gemini-3-flash-preview', provider: 'google' },
  judgeInstructions: [
    'Compare these two summaries of a news article.',
    'Which is more accurate and engaging?',
  ],
  pairingMode: 'swiss',
  swissRounds: 5,
  cacheDir: './output/rankings/my-ranking',
});

const output = await ranker.rank();
```

## Configuration

The `PairwiseRankerConfig` controls all aspects of ranking:

```typescript
interface PairwiseRankerConfig {
  /** Model to use as judge (required). */
  judgeModel: ModelDetails;

  /** Instructions for the judge (required). */
  judgeInstructions: string[];

  /** 'all' for round-robin, 'swiss' for swiss tournament. Default: 'swiss'. */
  pairingMode?: 'all' | 'swiss';

  /** Number of swiss rounds. Default: 5. */
  swissRounds?: number;

  /** Elo K-factor — higher = more volatile ratings. Default: 32. */
  kFactor?: number;

  /** Initial Elo rating for all entries. Default: 1500. */
  initialElo?: number;

  /** Max response length before truncation. Default: 3000. */
  maxResponseLength?: number;

  /** Directory for caching comparisons and rankings. */
  cacheDir?: string;

  /** Delay between comparisons in ms. Default: 300. */
  delayMs?: number;

  /** Judge temperature. Default: 0. */
  temperature?: number;

  /** Judge max tokens. Default: 300. */
  maxTokens?: number;

  /** Progress callback. */
  onProgress?: (label: string, cached: boolean) => void;
}
```

### Pairing Modes

**Swiss tournament** (default, recommended):
- Pairs models with similar current ratings each round
- Efficient: `swissRounds × floor(n/2)` comparisons
- Good accuracy with 5-7 rounds for up to ~20 models
- Best for: large model counts, budget-conscious ranking

**Round-robin** (`pairingMode: 'all'`):
- Every model plays every other model exactly once
- `n×(n-1)/2` total comparisons
- Maximum accuracy, highest cost
- Best for: small model counts (< 10), high-stakes ranking

### Choosing a Judge Model

The judge model evaluates pairs and returns structured JSON. Good choices:

| Model | Speed | Cost | Quality |
|-------|-------|------|---------|
| `anthropic/claude-haiku-4.5` | Fast | Low | Good |
| `gemini-3-flash-preview` | Fast | Very Low | Good |
| `openai/gpt-4o-mini` | Fast | Low | Good |
| `anthropic/claude-sonnet-4` | Medium | Medium | Excellent |

Use a cheaper/faster judge for initial exploration, then a stronger one for final rankings.

## How It Works

### 1. Pairing

The ranker selects pairs of models to compare. In swiss mode, models with similar ratings face each other, producing more informative comparisons. Pairs are shuffled to avoid systematic bias.

### 2. Judging

For each pair, the ranker:
1. **Randomly flips** presentation order (A/B) to eliminate position bias
2. **Truncates** long responses to `maxResponseLength`
3. Creates a judge `Interaction` with the configured `Stimulus`
4. Calls `generateObject()` with a structured schema requiring `winner` (A/B/tie), `reason`, and `confidence`
5. **Unflips** the winner to map back to the original entries

### 3. Elo Update

After each comparison, ratings update using the Bradley-Terry model:

```
E(A) = 1 / (1 + 10^((rB - rA) / 400))
new_rA = rA + K × (scoreA - E(A))
```

- Win: `scoreA = 1`, Loss: `scoreA = 0`, Tie: `scoreA = 0.5`
- K-factor controls volatility (32 is standard, use 16 for stability, 64 for fast convergence)
- Errors during judging count as ties

### 4. Caching

If `cacheDir` is set, comparisons are saved to `comparisons.json` and rankings to `rankings.json` after every matchup. Re-running instantly replays cached results — you only pay for new comparisons.

## Output Format

```typescript
interface RankingOutput {
  mode: string;              // 'round-robin' | 'swiss-5'
  comparisons: number;       // Total comparisons run
  judge: string;             // 'openrouter:anthropic/claude-haiku-4.5'
  rankings: RankedModel[];   // Sorted by Elo descending
  matchResults: PairwiseResult[];  // All individual comparison results
}

interface RankedModel {
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
```

## Progress Tracking

Use the `onProgress` callback for real-time updates:

```typescript
const ranker = new PairwiseRanker(entries, {
  // ...config
  onProgress: (label, cached) => {
    if (cached) {
      console.log(`  📁 ${label} (cached)`);
    } else {
      console.log(`  ⚔️  ${label}`);
    }
  },
});
```

## Writing Good Judge Instructions

The judge instructions are critical. Guidelines:

1. **Be specific** about what to evaluate — "narrative quality" not "which is better"
2. **List criteria** explicitly (storytelling, accuracy, completeness, engagement)
3. **Clarify what NOT to judge** — e.g., "don't judge model intelligence, only writing quality"
4. **Set the tie bar** — "only say tie if genuinely equal quality"
5. **Include context** about the original task/prompt

Example for code review:

```typescript
judgeInstructions: [
  'Compare two code solutions to the same programming problem.',
  'Judge based on:',
  '- Correctness: Does the code solve the problem?',
  '- Readability: Is it clean and well-organized?',
  '- Efficiency: Is the algorithm choice appropriate?',
  '- Error handling: Does it handle edge cases?',
  '',
  'Do NOT judge based on comment style or formatting preferences.',
  'Only say "tie" if both solutions are genuinely equal in quality.',
],
```

## Metadata

Attach arbitrary metadata to entries for downstream analysis:

```typescript
const entries: RankingEntry[] = results.map(r => ({
  key: r.key,
  model: r.model,
  provider: r.provider,
  responseText: r.responseText,
  metadata: {
    toolScore: r.toolScore,
    responseTime: r.duration,
    tokenCount: r.tokens,
  },
}));

// After ranking, metadata is preserved on RankedModel
for (const r of output.rankings) {
  const toolScore = (r.metadata as any)?.toolScore ?? 0;
  console.log(`${r.model} — Elo ${r.elo}, tool score ${toolScore}/5`);
}
```

## Real-World Example: Rivian Narrative Ranking

The `examples/mcp-chat/elo-rivian.ts` script demonstrates a complete workflow:

1. **Load responses** from a prior evaluation run (cached model responses + judge scores)
2. **Create ranking entries** with metadata (tool usage scores)
3. **Configure ranker** with narrative-quality judge instructions
4. **Run ranking** with swiss tournament or full round-robin
5. **Print results** table with Elo, W/L/T, and tool scores
6. **Save report data** for HTML report integration

```bash
# Run with cached responses from evaluation run 4
dotenvx run -- pnpm tsx examples/mcp-chat/elo-rivian.ts --run 4

# Full round-robin (all pairs, more comparisons)
dotenvx run -- pnpm tsx examples/mcp-chat/elo-rivian.ts --full

# Custom swiss rounds
dotenvx run -- pnpm tsx examples/mcp-chat/elo-rivian.ts --rounds 7
```

## Pure Functions

The Elo math and pairing strategies are exported as pure functions for custom use:

```typescript
import { expectedScore, updateElo, buildStandings, allPairs, swissPairs } from '../src/evaluation/ranking/index.js';

// Bradley-Terry expected score
const eA = expectedScore(1600, 1400); // ~0.76

// Update ratings after a match (A wins)
const [newA, newB] = updateElo(1600, 1400, 1, 32); // scoreA=1 means A wins

// Generate all round-robin pairs for 10 models
const pairs = allPairs(10); // 45 pairs, shuffled

// Swiss pairing based on current ratings
const ratings = [1600, 1550, 1500, 1450, 1400, 1350];
const swissMatchups = swissPairs(ratings, 1); // 3 pairs
```

## Next Steps

- [Model Evaluation](/guide/model-evaluation) — Generate the responses to rank
- [Reports & Analysis](/guide/reports) — Visualize ranking results
- [Creating Evaluations](/guide/creating-evaluations) — Design custom evaluation strategies
- [Cost Optimization](/examples/cost-optimization) — Budget-conscious model comparison
