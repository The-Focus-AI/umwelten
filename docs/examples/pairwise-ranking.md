# Pairwise Ranking Example

This example demonstrates head-to-head model comparison using the `PairwiseRanker` to produce Elo-based rankings via an LLM judge.

## Running the Example

The Rivian narrative ranking script compares model responses from a prior evaluation:

```bash
# Swiss tournament (default, 5 rounds)
dotenvx run -- pnpm tsx examples/mcp-chat/elo-rivian.ts --run 4

# Full round-robin (all pairs)
dotenvx run -- pnpm tsx examples/mcp-chat/elo-rivian.ts --full

# Custom swiss rounds
dotenvx run -- pnpm tsx examples/mcp-chat/elo-rivian.ts --rounds 7
```

## What This Example Shows

- **Pairwise Ranking**: Head-to-head LLM-judge comparisons between model responses
- **Elo Ratings**: Bradley-Terry model for computing relative rankings from pairwise results
- **Swiss Tournament**: Efficient pairing strategy (5 rounds vs full round-robin)
- **Caching**: Comparison results are cached — re-runs are instant for existing matchups
- **Metadata Preservation**: Tool usage scores carried through from evaluation to ranking

## Code Walkthrough

### 1. Load Responses from Prior Evaluation

The script reads cached model responses from a completed evaluation run:

```typescript
import { PairwiseRanker } from '../../src/evaluation/ranking/index.js';
import type { RankingEntry } from '../../src/evaluation/ranking/index.js';

// Load responses from evaluation run directory
const entries: RankingEntry[] = [];
for (const file of fs.readdirSync(resultsDir)) {
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  const resp = JSON.parse(fs.readFileSync(responsePath, 'utf8'));

  entries.push({
    key,
    model: result.model,
    provider: result.provider,
    responseText: resp.responseText,
    metadata: { toolScore: result.toolUsage?.tool_score ?? 0 },
  });
}
```

### 2. Configure the Ranker

Set up the judge model and ranking parameters:

```typescript
const ranker = new PairwiseRanker(entries, {
  judgeModel: { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' },
  judgeInstructions: [
    'You will see two model responses (A and B) to the same prompt:',
    '"Summarize the 10 days of the Rivian\'s activity."',
    '',
    'Judge ONLY the quality of the narrative summary. Consider:',
    '- Storytelling: Does it read like a story, not a data dump?',
    '- Specificity: Real dates, distances, locations, charge percentages?',
    '- Completeness: Does it cover the full 10-day range?',
    '- Engagement: Would a human enjoy reading this?',
    '- Structure: Is it well-organized with a clear arc?',
    '',
    'Focus purely on which response is a better piece of writing.',
    'If one is clearly better, pick it. Only say "tie" if genuinely equal.',
  ],
  pairingMode: fullRoundRobin ? 'all' : 'swiss',
  swissRounds: 5,
  cacheDir: path.join(runDir, 'elo'),
  onProgress: (label, cached) => {
    process.stdout.write(cached ? `  📁 ${label} (cached)\n` : `  ${label}\n`);
  },
});
```

### 3. Run and Display Results

```typescript
const output = await ranker.rank();

for (let i = 0; i < output.rankings.length; i++) {
  const r = output.rankings[i];
  const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`;
  const toolScore = (r.metadata as any)?.toolScore ?? 0;
  console.log(
    `${medal} ${r.provider}:${r.model} — Elo ${r.elo} ` +
    `(${r.wins}W/${r.losses}L/${r.ties}T) Tools: ${toolScore}/5`
  );
}
```

## Expected Output

```
⚔️  Elo Narrative Ranking — Run 004
════════════════════════════════════════════════════════════════
Loaded 12 responses with text

Mode: Swiss tournament — 5 rounds
Judge: openrouter:anthropic/claude-haiku-4.5

📋 Round 1/5
────────────────────────────────────────────────────────────
  [R1 #1] gpt-4o vs gemini-3-flash-preview → gpt-4o (high)
  [R1 #2] claude-sonnet-4 vs llama-3.3-70b → claude-sonnet-4 (high)
  [R1 #3] gemini-2.5-pro vs mistral-large → gemini-2.5-pro (medium)
  ...

🏆 ELO NARRATIVE RANKINGS
════════════════════════════════════════════════════════════════
Rank  Model                                     Elo     W    L    T    Games  Tools
────────────────────────────────────────────────────────────────
🥇    openrouter:openai/gpt-4o                  1580    4    1    0    5      4/5
🥈    openrouter:anthropic/claude-sonnet-4       1565    3    1    1    5      5/5
🥉    google:gemini-2.5-pro                      1548    3    2    0    5      3/5
4.    openrouter:meta-llama/llama-3.3-70b        1502    2    2    1    5      2/5
...

📊 30 comparisons completed
📁 Results: output/evaluations/rivian-10day/runs/004/elo/rankings.json
   Comparisons cached — re-run is instant for existing matchups.
```

## Standalone Usage Pattern

Use the ranker independently of any evaluation framework:

```typescript
import { PairwiseRanker } from '../../src/evaluation/ranking/index.js';

// Your responses from any source
const entries = [
  { key: 'model-a', model: 'gpt-4o', provider: 'openrouter', responseText: 'Response from model A...' },
  { key: 'model-b', model: 'gemini-3-flash', provider: 'google', responseText: 'Response from model B...' },
  { key: 'model-c', model: 'claude-sonnet-4', provider: 'openrouter', responseText: 'Response from model C...' },
];

const ranker = new PairwiseRanker(entries, {
  judgeModel: { name: 'gemini-3-flash-preview', provider: 'google' },
  judgeInstructions: ['Compare the two responses. Which is more helpful?'],
  pairingMode: 'all',  // round-robin for small sets
});

const output = await ranker.rank();
console.log(`Top model: ${output.rankings[0].model} with Elo ${output.rankings[0].elo}`);
```

## Integration with Evaluation Framework

Bridge from `runEvaluation()` results:

```typescript
import { runEvaluation } from '../../src/evaluation/api.js';
import { evaluationResultsToRankingEntries, PairwiseRanker } from '../../src/evaluation/ranking/index.js';

// Step 1: Run evaluation
const evalResult = await runEvaluation({
  evaluationId: 'my-eval',
  prompt: 'Write a haiku about programming',
  models: ['google:gemini-3-flash-preview', 'openrouter:openai/gpt-4o', 'openrouter:anthropic/claude-sonnet-4'],
});

// Step 2: Convert to ranking entries
const entries = evaluationResultsToRankingEntries(evalResult);

// Step 3: Rank pairwise
const ranker = new PairwiseRanker(entries, {
  judgeModel: { name: 'gemini-3-flash-preview', provider: 'google' },
  judgeInstructions: ['Which haiku is more evocative and follows proper 5-7-5 form?'],
  pairingMode: 'all',
});

const output = await ranker.rank();
```

## Key Concepts

### Position Bias Mitigation

The ranker randomly flips which response is shown as "A" vs "B" for each comparison. This eliminates systematic preference for the first or second position.

### Incremental Caching

With `cacheDir` set, every comparison is cached to `comparisons.json`. If you re-run the script:
- Cached comparisons replay instantly (no API calls)
- New matchups (e.g., from additional swiss rounds) are computed and added
- Rankings update incrementally

### Swiss vs Round-Robin Trade-offs

For 12 models:
- **Swiss (5 rounds)**: ~30 comparisons, good approximate ranking
- **Round-robin**: 66 comparisons, exact ranking
- Swiss at 7 rounds with 12 models gives accuracy close to round-robin

### Error Handling

If a judge call fails (network error, rate limit, malformed response), the comparison counts as a **tie**. This prevents one bad API call from corrupting the ranking.

## Next Steps

- [Pairwise Ranking Guide](/guide/pairwise-ranking) — Detailed configuration and usage guide
- [API Reference](/api/pairwise-ranking) — Full type and function reference
- [Matrix Evaluation](/examples/matrix-evaluation) — Generate responses to rank
- [Cost Optimization](/examples/cost-optimization) — Budget-conscious evaluation
