# EvalSuite Examples

`EvalSuite` is the recommended high-level API for creating evaluations in umwelten. You define tasks and scoring — the suite handles CLI flags, run directories, caching, execution, judging, and leaderboard output.

Three working examples live in [`examples/evals/`](https://github.com/the-focus-ai/umwelten/tree/main/examples/evals):

| Example | Scoring Mode | What It Tests |
|---------|-------------|---------------|
| `car-wash.ts` | JudgeTask (LLM judge) | Common-sense reasoning |
| `instruction.ts` | VerifyTask (deterministic) | Instruction following |
| `reasoning.ts` | JudgeTask (LLM judge) | Classic logic puzzles |

## Two Scoring Modes

**VerifyTask** — you supply a `verify(response) → { score, details }` function. No LLM call needed, fully deterministic.

**JudgeTask** — you supply a Zod schema and judge instructions. EvalSuite automatically calls an LLM judge (default: Claude Haiku) to score responses.

## Example 1: Car Wash Test (JudgeTask)

The classic common-sense reasoning test: "Should I walk or drive to the car wash?"

```typescript
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
        '5=immediately identifies car must be at wash, 4=good reasoning, 3=partial, 2=right answer wrong reason.',
      ],
    },
  }],
});

suite.run();
```

Key points:
- The `judge.schema` defines what the LLM judge must output (parsed with Zod)
- The `judge.instructions` tell the judge how to score
- Score is extracted from `reasoning_quality` by default (or supply `extractScore`)

## Example 2: Instruction Following (VerifyTask)

Deterministic scoring — no LLM judge needed. Each task has a `verify` function that checks the response programmatically.

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
      prompt: 'Write a sentence about the ocean that contains EXACTLY 12 words.',
      maxScore: 5,
      verify: (r) => {
        const words = r.trim().split(/\s+/).filter(Boolean);
        const diff = Math.abs(words.length - 12);
        if (diff === 0) return { score: 5, details: `${words.length} words ✓` };
        if (diff <= 1) return { score: 3, details: `${words.length} words (off by ${diff})` };
        return { score: 0, details: `${words.length} words (wanted 12)` };
      },
    },
    {
      id: 'json-output',
      name: 'JSON Output',
      prompt: 'Output a JSON object: {"name": string, "age": number 25-35, "skills": array of 3 strings, "active": true}.',
      maxScore: 5,
      verify: (r) => {
        const clean = r.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
        try {
          const obj = JSON.parse(clean);
          let s = 0;
          if (typeof obj.name === 'string') s++;
          if (typeof obj.age === 'number' && obj.age >= 25 && obj.age <= 35) s++;
          if (Array.isArray(obj.skills) && obj.skills.length === 3) s++;
          if (obj.active === true) s++;
          if (!r.includes('```')) s++;
          return { score: s, details: s === 5 ? 'Perfect' : `${s}/5 fields correct` };
        } catch { return { score: 0, details: 'Invalid JSON' }; }
      },
    },
  ],
});

suite.run();
```

## Example 3: Reasoning Eval (Mixed)

Tests classic logic puzzles using `JudgeTask` with a shared judge schema across all tasks:

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
  tasks: [
    {
      id: 'surgeon',
      name: 'Surgeon Riddle',
      prompt: 'A father and his son are in a car accident. The father dies. The son is rushed to the hospital. The surgeon says: "I can\'t operate, he\'s my son." How?',
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
      prompt: 'A bat and a ball cost $1.10. The bat costs $1.00 more than the ball. How much does the ball cost?',
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

suite.run();
```

## Running the Examples

```bash
# Quick run (default models only)
dotenvx run -- pnpm tsx examples/evals/car-wash.ts
dotenvx run -- pnpm tsx examples/evals/instruction.ts
dotenvx run -- pnpm tsx examples/evals/reasoning.ts

# Full run with all models
dotenvx run -- pnpm tsx examples/evals/car-wash.ts --all

# Start a fresh run (ignore cached results)
dotenvx run -- pnpm tsx examples/evals/reasoning.ts --new

# Resume a specific run number
dotenvx run -- pnpm tsx examples/evals/reasoning.ts --run 2
```

## CLI Flags

| Flag | Description |
|------|-------------|
| `--all` | Use the `allModels` list instead of `models` |
| `--new` | Start a fresh run (increment run number) |
| `--run N` | Resume or target a specific run number |

## Output Structure

Results are saved to `output/evaluations/{name}/runs/{NNN}/`:

```
output/evaluations/reasoning-eval/runs/001/
  surgeon/
    gemini-3-flash-preview-google.json
    gpt-5.4-nano-openrouter.json
  bat-ball/
    gemini-3-flash-preview-google.json
    gpt-5.4-nano-openrouter.json
```

Each JSON file contains the full `TaskResultRecord` with score, response text, cost, duration, and judge output (if applicable).

## Next Steps

- See [Multi-Dimension Evaluation Suite](/examples/complex-pipeline) to combine multiple evaluations into a unified leaderboard
- Explore the [Pairwise Ranking Example](/examples/pairwise-ranking) for Elo-based comparisons
- Read the [Model Evaluation guide](https://umwelten.thefocus.ai/guide/model-evaluation) for full API reference
