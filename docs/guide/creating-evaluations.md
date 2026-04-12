# Creating Evaluations

## Overview

This guide covers how to create evaluations using the umwelten framework. The recommended approach is **EvalSuite** — a declarative API that handles CLI flags, run directories, caching, execution, judging, and output in ~60-100 lines.

## Quick Start: EvalSuite

`EvalSuite` (`src/evaluation/suite.ts`) is the primary way to build evaluations. You define **tasks** with prompts and scoring, and the suite handles everything else.

### Simplest Example: Car Wash Test

```typescript
import '../../src/env/load.js';
import { z } from 'zod';
import { EvalSuite } from '../../src/evaluation/suite.js';

const suite = new EvalSuite({
  name: 'car-wash-test',
  stimulus: {
    role: 'helpful assistant',
    objective: 'answer clearly and concisely',
    instructions: ['Think carefully', 'Give a clear recommendation', 'Explain briefly'],
    temperature: 0.3,
    maxTokens: 500,
  },
  models: [
    { name: 'gemini-3-flash-preview', provider: 'google' },
    { name: 'openai/gpt-5.4-nano', provider: 'openrouter' },
  ],
  allModels: [
    // ... expanded list used when --all is passed
  ],
  tasks: [{
    id: 'car-wash',
    name: 'Car Wash',
    prompt: 'I want to wash my car. The car wash is 50 meters away. Should I walk or drive?',
    maxScore: 5,
    judge: {
      schema: z.object({
        recommendation: z.string().describe('"drive" or "walk" or "unclear"'),
        recognizes_need_for_car: z.coerce.boolean().describe('Does model understand car must be at the wash?'),
        reasoning_quality: z.coerce.number().min(1).max(5).describe('5=immediately gets it, 1=missed'),
        explanation: z.string(),
      }),
      instructions: [
        'The ONLY correct answer is DRIVE — the car must be at the car wash to be washed.',
        'A model saying "drive" for convenience/laziness has the wrong reason (score 2).',
        'A model saying "walk" completely fails (score 1).',
      ],
    },
  }],
});

suite.run().catch(err => { console.error('Fatal:', err); process.exit(1); });
```

Run it:

```bash
dotenvx run -- pnpm tsx examples/evals/car-wash.ts          # quick (default models)
dotenvx run -- pnpm tsx examples/evals/car-wash.ts --all     # full model list
dotenvx run -- pnpm tsx examples/evals/car-wash.ts --new     # force fresh run
```

The suite automatically:
- Creates run directories under `output/evaluations/{name}/runs/{NNN}/`
- Caches model responses per-run (resume interrupted runs by re-running)
- Runs an LLM judge on each response
- Prints a leaderboard with scores, cost, and timing

## Two Scoring Modes

### 1. VerifyTask — Deterministic Scoring

For tasks where you can write a `verify(response) → { score, details }` function. No LLM judge needed — fast, free, and reproducible.

```typescript
import { EvalSuite } from '../../src/evaluation/suite.js';

const suite = new EvalSuite({
  name: 'instruction-eval',
  stimulus: {
    role: 'precise assistant that follows instructions exactly',
    objective: 'follow the given instructions with exact format compliance',
    instructions: ['Follow instructions EXACTLY', 'Output ONLY what is requested'],
    temperature: 0.0,
    maxTokens: 500,
  },
  models: [
    { name: 'gemini-3-flash-preview', provider: 'google' },
    { name: 'openai/gpt-5.4-nano', provider: 'openrouter' },
  ],
  tasks: [
    {
      id: 'word-count',
      name: 'Word Count',
      prompt: 'Write a sentence about the ocean that contains EXACTLY 12 words. Just the sentence, nothing else.',
      maxScore: 5,
      verify: (r) => {
        const words = r.trim().replace(/^["']|["']$/g, '').split(/\s+/).filter(Boolean);
        const diff = Math.abs(words.length - 12);
        if (diff === 0) return { score: 5, details: `${words.length} words ✓` };
        if (diff <= 1) return { score: 3, details: `${words.length} words (off by ${diff})` };
        return { score: 0, details: `${words.length} words (wanted 12)` };
      },
    },
    {
      id: 'json-output',
      name: 'JSON Output',
      prompt: 'Output a JSON object: {"name": string, "age": number 25-35, "skills": array of 3 strings, "active": true}. No markdown fences.',
      maxScore: 5,
      verify: (r) => {
        let s = 0; const fails: string[] = [];
        const clean = r.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
        try {
          const obj = JSON.parse(clean);
          if (typeof obj.name === 'string' && obj.name.length > 0) s++; else fails.push('name');
          if (typeof obj.age === 'number' && obj.age >= 25 && obj.age <= 35) s++; else fails.push('age');
          if (Array.isArray(obj.skills) && obj.skills.length === 3) s++; else fails.push('skills');
          if (obj.active === true) s++; else fails.push('active');
          if (!r.includes('```')) s++; else fails.push('fences');
        } catch { return { score: 0, details: 'Invalid JSON' }; }
        return { score: s, details: fails.length ? `Failed: ${fails.join(', ')}` : 'Perfect' };
      },
    },
  ],
});

suite.run().catch(err => { console.error('Fatal:', err); process.exit(1); });
```

### 2. JudgeTask — LLM Judge Scoring

For tasks where scoring requires understanding (reasoning quality, creative writing, etc.). You provide a Zod schema for the judge output and instructions for how to score.

```typescript
import { z } from 'zod';
import { EvalSuite } from '../../src/evaluation/suite.js';

const judgeSchema = z.object({
  reasoning_quality: z.coerce.number().min(1).max(5).describe('1=missed, 3=partial, 5=perfect'),
  explanation: z.string().describe('Brief explanation'),
});

const suite = new EvalSuite({
  name: 'reasoning-eval',
  stimulus: {
    role: 'helpful assistant',
    objective: 'answer clearly and concisely',
    instructions: ['Think carefully', 'Give a clear answer', 'Explain briefly'],
    temperature: 0.3,
    maxTokens: 500,
  },
  models: [
    { name: 'gemini-3-flash-preview', provider: 'google' },
    { name: 'openai/gpt-5.4-nano', provider: 'openrouter' },
  ],
  judgeModel: { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' },
  tasks: [
    {
      id: 'surgeon',
      name: 'Surgeon Riddle',
      prompt: 'A father and his son are in a car accident. The father dies. The son is rushed to the hospital. The surgeon says: "I can\'t operate on this boy, he\'s my son." How is this possible?',
      maxScore: 5,
      judge: {
        schema: judgeSchema,
        instructions: [
          'Correct answer: the surgeon is the boy\'s MOTHER.',
          '5=immediately says mother, 3=lists many possibilities including mother, 1=missed.',
        ],
      },
    },
    {
      id: 'bat-ball',
      name: 'Bat & Ball',
      prompt: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?',
      maxScore: 5,
      judge: {
        schema: judgeSchema,
        instructions: [
          'Correct answer: $0.05 (five cents). The trap answer is $0.10.',
          '5=immediately gets $0.05, 3=self-corrects from $0.10, 2=says $0.10.',
        ],
      },
    },
  ],
});

suite.run().catch(err => { console.error('Fatal:', err); process.exit(1); });
```

The judge defaults to `anthropic/claude-haiku-4.5` via OpenRouter. Override with `judgeModel` in the config.

By default, the score is extracted from `result.reasoning_quality ?? result.score ?? 0`. Override with `extractScore`:

```typescript
judge: {
  schema: mySchema,
  instructions: [...],
  extractScore: (result) => result.accuracy * 2 + result.style,
}
```

## EvalSuite Config Reference

```typescript
interface EvalSuiteConfig {
  name: string;                    // Output directory name
  stimulus: StimulusOptions | ((task) => StimulusOptions);  // Shared or per-task
  tasks: EvalTask[];               // VerifyTask[] | JudgeTask[]
  models?: ModelDetails[];         // Default model list
  allModels?: ModelDetails[];      // Used when --all is passed
  judgeModel?: ModelDetails;       // For JudgeTasks (default: claude-haiku-4.5)
  concurrency?: number;            // Max concurrent model calls (default: 5)
  judgeDelayMs?: number;           // Delay between judge calls in ms (default: 500)
}
```

CLI flags handled automatically:
- `--all` — use `allModels` instead of `models`
- `--new` — force a fresh run (new run directory)
- `--run N` — resume a specific run number

## Lower-Level Building Blocks

For cases where `EvalSuite` doesn't fit, three lower-level strategies are available in `src/evaluation/strategies/`:

### SimpleEvaluation

Send the same prompt to multiple models concurrently with caching. This is what `EvalSuite` uses internally.

```typescript
import { SimpleEvaluation } from '../src/evaluation/strategies/simple-evaluation.js';

const evaluation = new SimpleEvaluation(stimulus, models, prompt, cache, {
  evaluationId: 'my-eval',
  useCache: true,
  concurrent: true,
  maxConcurrency: 5,
});

const results = await evaluation.run();
```

### MatrixEvaluation

Compare multiple models on the same test cases.

### BatchEvaluation

Process multiple inputs with the same model.

These are useful when you need fine-grained control over execution, custom caching strategies, or integration with other systems.

## Post-Processing

### Pairwise Ranking

After generating responses with any strategy, rank them head-to-head using the `PairwiseRanker`:

```typescript
import { PairwiseRanker, evaluationResultsToRankingEntries } from '../src/evaluation/ranking/index.js';

const entries = evaluationResultsToRankingEntries(evalResult);

const ranker = new PairwiseRanker(entries, {
  judgeModel: { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' },
  judgeInstructions: [
    'Compare the two responses. Which is better overall?',
    'Consider clarity, accuracy, completeness, and engagement.',
    'Only say "tie" if genuinely equal.',
  ],
  pairingMode: 'swiss',  // or 'all' for round-robin
  swissRounds: 5,
  cacheDir: './output/rankings/my-ranking',
});

const output = await ranker.rank();
// output.rankings: sorted by Elo descending
```

**When to use:**
- Subjective quality comparisons (narrative, creative, style)
- Producing a total ordering of many models from pairwise matchups
- Validating or supplementing automated scoring
- Tasks where relative preference is clearer than absolute scores

See the [Pairwise Ranking Guide](/guide/pairwise-ranking) for detailed configuration and the [API Reference](/api/pairwise-ranking) for type definitions.

### Multi-Dimension Suites (eval combine)

Run several evaluations independently, then combine them into a unified leaderboard using the `eval combine` system. Each evaluation becomes a "dimension" in the combined report.

```typescript
import type { EvalDimension } from '../src/evaluation/combine/types.js';
import { loadSuite, buildSuiteReport, buildNarrativeReport } from '../src/evaluation/combine/index.js';

const MY_SUITE: EvalDimension[] = [
  { evalName: 'my-accuracy-eval', label: 'Accuracy', maxScore: 100,
    extractScore: (r) => r.score ?? 0 },
  { evalName: 'my-speed-eval', label: 'Speed', maxScore: 50,
    extractScore: (r) => r.timingScore ?? 0, hasResultsSubdir: true },
];

const result = loadSuite(MY_SUITE);
const narrative = buildNarrativeReport(result, { title: 'My Combined Report' });
```

Or via the CLI:

```bash
dotenvx run -- pnpm run cli eval combine --config path/to/suite-config.ts --format narrative --output report.md
```

**When to use:**
- Comparing models across fundamentally different capabilities
- Producing a unified ranking from independent evaluations
- Generating narrative reports with methodology and analysis

See the [Model Showdown walkthrough](/walkthroughs/model-showdown) for a complete example.

## Examples

See `examples/evals/` for complete working examples:
- [`car-wash.ts`](../../examples/evals/car-wash.ts) — Common-sense reasoning with LLM judge (~64 lines)
- [`reasoning.ts`](../../examples/evals/reasoning.ts) — 4 logic puzzles with LLM judge (~100 lines)
- [`instruction.ts`](../../examples/evals/instruction.ts) — 4 constraint tasks with deterministic scoring (~100 lines)

For the detailed car wash walkthrough (manual approach without EvalSuite), see [`scripts/examples/car-wash-test.ts`](../../scripts/examples/car-wash-test.ts).

For pairwise ranking, see `examples/mcp-chat/elo-rivian.ts` and the [Pairwise Ranking Guide](/guide/pairwise-ranking).

For multi-dimension suites, see `examples/model-showdown/` and the [Model Showdown walkthrough](/walkthroughs/model-showdown).

## Related Documentation

- [Model Evaluation](model-evaluation.md) — CLI commands and eval combine
- [Pairwise Ranking](pairwise-ranking.md) — Head-to-head Elo ranking
- [Writing Scripts](writing-scripts.md)
- [Stimulus Templates](stimulus-templates.md)
- [Tool Integration](tool-integration.md)
- [Best Practices](best-practices.md)
