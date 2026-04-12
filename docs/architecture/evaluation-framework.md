# Evaluation Framework

## Stimulus-centric evaluation

Evaluations center on a **[Stimulus](./stimulus-system.md)** (role, objective, instructions, tools, temperature): it defines *what* cognitive work you are testing.

The **recommended high-level API** is `EvalSuite` (`src/evaluation/suite.ts`) — a declarative runner that handles CLI flags, run directories, caching, execution, judging (via VerifyTask or JudgeTask), and leaderboard output. See [`examples/evals/`](../../examples/evals/) for working examples.

**Strategies** in `src/evaluation/strategies/` (`SimpleEvaluation`, `MatrixEvaluation`, `BatchEvaluation`) are lower-level building blocks used internally by EvalSuite and available for custom workflows. **`EvaluationRunner`** (`src/evaluation/runner.ts`) is the extension point for custom cached runs. The CLI (`eval run`, `eval report`, `eval combine`) and [`runEvaluation`](../api/overview.md) use the same stack.

For **multi-dimension benchmarks**, define an `EvalDimension[]` suite and run [`eval combine`](../guide/model-evaluation.md); see **[`examples/model-showdown/`](../../examples/model-showdown/README.md)**.

## Overview

The evaluation framework provides a comprehensive set of strategies for testing AI models. It's designed to be composable, reusable, and extensible, allowing you to build complex evaluations from simple building blocks.

## Core Concepts

### Evaluation Strategy
An evaluation strategy defines how to run a specific type of evaluation. Strategies handle:
- Model execution
- Input processing
- Result collection
- Error handling
- Caching

### Test Case
A test case defines a specific test to run:
- **Stimulus**: The cognitive task to perform
- **Input**: The input data for the test
- **Expected Output**: Optional expected results
- **Metadata**: Additional test information

### Evaluation Result
The result of running an evaluation:
- **Responses**: Model responses for each test case
- **Metrics**: Performance metrics (time, tokens, cost)
- **Scores**: Evaluation scores (if applicable)
- **Metadata**: Additional result information

## Available Strategies

### 1. SimpleEvaluation

Send the same prompt to multiple models with caching. This is what `EvalSuite` uses internally.

```typescript
import { SimpleEvaluation } from '../src/evaluation/strategies/simple-evaluation.js';
import { EvaluationCache } from '../src/evaluation/caching/cache-service.js';

const evaluation = new SimpleEvaluation(stimulus, models, prompt, cache, {
  evaluationId: 'my-eval',
  useCache: true,
  concurrent: true,
  maxConcurrency: 5,
});

const results = await evaluation.run();
// results: EvaluationResult[] — one per model with response + metadata
```

### 2. MatrixEvaluation

Evaluate a prompt with `{placeholder}` variables across a cartesian product of dimensions.

```typescript
import { MatrixEvaluation } from '../src/evaluation/strategies/matrix-evaluation.js';

const evaluation = new MatrixEvaluation(stimulus, models, 'Write a {tone} {genre} story', cache, {
  dimensions: [
    { name: 'tone', values: ['formal', 'casual'] },
    { name: 'genre', values: ['mystery', 'comedy', 'romance'] },
  ],
});

const results = await evaluation.run();
// results: MatrixResult[] — includes the combination used for each result
```

### 3. BatchEvaluation

Process multiple content items with a template prompt.

```typescript
import { BatchEvaluation } from '../src/evaluation/strategies/batch-evaluation.js';

const evaluation = new BatchEvaluation(stimulus, models, 'Summarize: {content}', cache, {
  items: [
    { id: 'doc-1', content: 'First document text...' },
    { id: 'doc-2', content: 'Second document text...' },
  ],
});

const results = await evaluation.run();
// results: BatchResult[] — includes the item metadata for each result
```

### 4. EvalSuite (Recommended)

High-level declarative API that wraps SimpleEvaluation with automatic caching, judging, and leaderboard output. Supports two scoring modes: **VerifyTask** (deterministic) and **JudgeTask** (LLM judge).

```typescript
import { EvalSuite } from '../src/evaluation/suite.js';
import { z } from 'zod';

const suite = new EvalSuite({
  name: 'my-eval',
  stimulus: { role: 'helpful assistant', temperature: 0.3, maxTokens: 500 },
  models: [
    { name: 'gemini-3-flash-preview', provider: 'google' },
    { name: 'openai/gpt-5.4-nano', provider: 'openrouter' },
  ],
  tasks: [
    {
      id: 'verify-example',
      prompt: 'What is 2+2?',
      maxScore: 1,
      verify: (r) => ({ score: r.trim() === '4' ? 1 : 0, details: r.trim() }),
    },
    {
      id: 'judge-example',
      prompt: 'Explain why the sky is blue',
      maxScore: 5,
      judge: {
        schema: z.object({
          accuracy: z.coerce.number().min(1).max(5),
          explanation: z.string(),
        }),
        instructions: ['Score 5 for correct Rayleigh scattering explanation, 1 for wrong.'],
        extractScore: (r) => r.accuracy,
      },
    },
  ],
});

await suite.run();
```

**Use Cases:**
- Most evaluations — this is the recommended starting point
- Multi-task benchmarks with mixed scoring modes
- Rapid prototyping of new evaluations

## Caching System

The evaluation framework includes comprehensive caching to improve performance and reduce costs.

### Model Response Caching
- Cache model responses to avoid re-running expensive calls
- Automatic cache invalidation based on model parameters
- Configurable cache TTL and storage options

### File Caching
- Cache processed files and metadata
- Automatic file change detection
- Support for large file processing

### Score Caching
- Cache evaluation scores and results
- Avoid re-computing expensive scoring functions
- Support for different scoring strategies

## Error Handling

The framework provides robust error handling:

### Retry Logic
- Automatic retries for transient failures
- Exponential backoff for rate limits
- Configurable retry policies

### Error Classification
- **Transient Errors**: Network issues, rate limits
- **Permanent Errors**: Authentication failures, invalid inputs
- **Model Errors**: Model-specific issues

### Graceful Degradation
- Continue evaluation even if some tests fail
- Detailed error reporting
- Partial results when possible

## Performance Optimization

### Parallel Processing
- Run multiple evaluations in parallel
- Configurable concurrency limits
- Resource management

### Memory Management
- Efficient data structures
- Garbage collection optimization
- Memory monitoring

### Cost Optimization
- Caching to reduce redundant calls
- Cost tracking and monitoring
- Budget limits and alerts

## 6. Pairwise Ranking (Post-Processing)

Rank model responses via head-to-head LLM-judge comparisons with Elo ratings.

Unlike the evaluation strategies above, the ranking module is a **post-processing step** — it consumes existing responses rather than generating them. This makes it composable with any evaluation strategy.

```typescript
import { PairwiseRanker, evaluationResultsToRankingEntries } from '../src/evaluation/ranking/index.js';

// Bridge from evaluation results
const entries = evaluationResultsToRankingEntries(evalResult);

const ranker = new PairwiseRanker(entries, {
  judgeModel: { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' },
  judgeInstructions: [
    'Compare the two responses. Which is better overall?',
    'Consider clarity, accuracy, and completeness.',
  ],
  pairingMode: 'swiss',  // or 'all' for round-robin
  swissRounds: 5,
  cacheDir: './output/rankings/my-ranking',
});

const output = await ranker.rank();
// output.rankings: RankedModel[] sorted by Elo descending
```

**Key features:**
- **Swiss tournament** (default) — efficient pairing by current rating, `O(rounds × n/2)` comparisons
- **Round-robin** — all pairs, `O(n²)` comparisons, maximum accuracy
- **Position bias mitigation** — random A/B flip for each comparison
- **Incremental caching** — cached comparisons replay instantly on re-runs
- **Bradley-Terry Elo** — configurable K-factor (default 32), initial rating (default 1500)
- **Error resilience** — failed judge calls count as ties

**Module structure:**
```
src/evaluation/ranking/
├── index.ts            — Barrel re-exports
├── types.ts            — RankingEntry, PairwiseResult, RankedModel, RankingOutput, PairwiseRankerConfig, evaluationResultsToRankingEntries()
├── elo.ts              — expectedScore(), updateElo(), buildStandings()
├── pairing.ts          — allPairs(), swissPairs()
└── pairwise-ranker.ts  — PairwiseRanker class
```

**Use Cases:**
- Subjective quality ranking (narrative, creative writing, style)
- Validating or supplementing automated scoring
- Producing a total ordering of many models
- Tasks where relative preference is clearer than absolute scores

For detailed usage, see the [Pairwise Ranking Guide](../guide/pairwise-ranking.md).

## Best Practices

### 1. Choose the Right Strategy
- Use `EvalSuite` for most evaluations (recommended starting point)
- Use `SimpleEvaluation` for basic testing or custom workflows
- Use `MatrixEvaluation` for model comparison
- Use `BatchEvaluation` for bulk processing
- Use `PairwiseRanker` for head-to-head ranking of existing responses

### 2. Design Effective Test Cases
- Clear, specific prompts
- Appropriate input data
- Realistic expectations
- Good test coverage

### 3. Use Caching Effectively
- Enable caching for expensive operations
- Set appropriate TTL values
- Monitor cache hit rates
- Clean up old cache entries

### 4. Handle Errors Gracefully
- Implement proper error handling
- Use retry logic for transient errors
- Provide meaningful error messages
- Log errors for debugging

### 5. Monitor Performance
- Track evaluation metrics
- Monitor costs and usage
- Optimize based on results
- Set up alerts for issues

## Examples

See `examples/evals/` for EvalSuite examples (car-wash, reasoning, instruction), `scripts/examples/` for lower-level evaluation scripts, and `examples/mcp-chat/elo-rivian.ts` for a full pairwise ranking workflow.

## API Reference

For detailed API documentation, see the [API Reference](../api/evaluation-strategies.md) and [Pairwise Ranking API](../api/pairwise-ranking.md).
