# API Reference

## Overview

umwelten exposes a small public API from `umwelten` (see `src/index.ts`). For deep internals, use deep imports (`umwelten/dist/…`).

## Public Exports

### Core

| Export | Description |
|--------|-------------|
| `Habitat` | Agent container — work dir, config, sessions, tools |
| `Interaction` | Conversation holder — messages, model, stimulus, runner |
| `Stimulus` | Prompt config — role, objective, instructions, tools |

### Evaluation

| Export | Description |
|--------|-------------|
| `EvalSuite` | **Recommended.** Declarative eval runner — tasks + stimulus + models → scored results |
| `PairwiseRanker` | Head-to-head LLM judge comparisons → Elo ratings |
| `runEvaluation` | Lower-level: run a single evaluation from config |
| `runEvaluationWithProgress` | Same, with progress callback |
| `generateReport` | Generate a report from evaluation results |
| `listEvaluations` | List existing evaluation runs |
| `parseModel` | Parse `"provider:model"` string into `ModelDetails` |

### Types

```typescript
// EvalSuite types
EvalSuiteConfig, EvalTask, VerifyTask, JudgeTask, VerifyResult, TaskResultRecord

// PairwiseRanker types
RankingEntry, PairwiseResult, RankedModel, RankingOutput, PairwiseRankerConfig

// Evaluation API types
EvaluationConfig, EvaluationResult, EnhancedEvaluationConfig

// Habitat types
HabitatConfig, HabitatOptions, HabitatSessionMetadata, HabitatSessionType, AgentEntry, OnboardingResult
```

## Quick Start — EvalSuite

`EvalSuite` is the recommended way to build evaluations. Define tasks, stimulus, and models; the suite handles CLI flags, caching, execution, judging, and output.

```typescript
import { EvalSuite } from 'umwelten';
import { z } from 'zod';

const suite = new EvalSuite({
  name: 'my-eval',
  stimulus: {
    role: 'helpful assistant',
    objective: 'answer clearly and concisely',
    temperature: 0.3,
    maxTokens: 500,
  },
  models: [
    { name: 'gemini-3-flash-preview', provider: 'google' },
    { name: 'openai/gpt-4o', provider: 'openrouter' },
  ],
  tasks: [
    // Deterministic scoring (no LLM judge)
    {
      id: 'math',
      prompt: 'What is 2+2?',
      maxScore: 1,
      verify: (response) => ({
        score: response.trim() === '4' ? 1 : 0,
        details: response.trim(),
      }),
    },
    // LLM-judged scoring
    {
      id: 'reasoning',
      prompt: 'Should I walk or drive to the car wash?',
      maxScore: 5,
      judge: {
        schema: z.object({
          recommendation: z.string(),
          reasoning_quality: z.coerce.number().min(1).max(5),
          explanation: z.string(),
        }),
        instructions: [
          'The correct answer is DRIVE — the car must be at the wash.',
          '5=immediately gets it, 1=missed completely.',
        ],
      },
    },
  ],
});

suite.run().catch(console.error);
```

Run with CLI flags: `--all` (use `allModels` list), `--new` (skip cache), `--run N` (specific run).

## Model Configuration

```typescript
import type { ModelDetails } from 'umwelten/dist/cognition/types.js';

// Minimal — just name and provider
const model: ModelDetails = {
  name: 'gemini-3-flash-preview',
  provider: 'google',
};

// With options inherited from ModelRoute
const modelWithOptions: ModelDetails = {
  name: 'openai/gpt-4o',
  provider: 'openrouter',
  temperature: 0.7,
  reasoningEffort: 'high',
};
```

`ModelDetails` extends `ModelRoute` (`name`, `provider`, `variant?`, `temperature?`, `topP?`, `topK?`, `numCtx?`, `reasoningEffort?`) and adds optional fields: `description`, `contextLength`, `costs`, `addedDate`, `lastUpdated`, `details`, `originalProvider`.

## Lower-Level Strategies

For custom evaluation pipelines, use the strategy classes directly (in `src/evaluation/strategies/`):

| Strategy | Use case |
|----------|----------|
| `SimpleEvaluation` | Run one prompt against one or more models |
| `MatrixEvaluation` | Cross-product of models × prompts |
| `BatchEvaluation` | Batch multiple prompts efficiently |

These are building blocks — prefer `EvalSuite` for most use cases.

## Pairwise Ranking

```typescript
import { PairwiseRanker } from 'umwelten';

const ranker = new PairwiseRanker({
  evalDir: './output/evals/my-eval',
  judgeModel: { name: 'gemini-3-flash-preview', provider: 'google' },
  mode: 'swiss',       // or 'round-robin'
  swissRounds: 5,
  initialElo: 1500,
});

const output = await ranker.rank();
console.log(output.standings); // sorted by Elo
```

## Multi-Dimension Aggregation

Combine results from multiple evaluations into a unified leaderboard:

```bash
dotenvx run -- pnpm run cli eval combine --config examples/model-showdown/suite-config.ts
```

See [Model showdown walkthrough](/walkthroughs/model-showdown) and `src/evaluation/combine/` for details.

## Further Reading

- [Getting started](/guide/getting-started)
- [Creating evaluations](/guide/creating-evaluations)
- [Model evaluation guide](/guide/model-evaluation)
- [EvalSuite examples](https://github.com/The-Focus-AI/umwelten/tree/main/examples/evals) (`car-wash.ts`, `instruction.ts`, `reasoning.ts`)
