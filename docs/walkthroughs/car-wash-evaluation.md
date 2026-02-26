# Building a Multi-Model Evaluation with LLM Judging

A walkthrough of building the "Car Wash Test" — a common-sense reasoning benchmark that tests 131 models across 8 providers, uses an LLM judge to score responses, and produces structured results you can analyze.

**Time Required:** 30 minutes to build, 15 minutes to run
**Prerequisites:** Node.js 20+, pnpm, API keys for Google and OpenRouter
**Optional:** Ollama for local model testing
**Cost:** ~$0.50 for a full 131-model run

## What We're Building

A script that:

1. Sends the same question to 131 different LLMs
2. Uses a separate LLM as a judge to score each response
3. Caches responses per-run so you can resume interrupted evaluations
4. Writes structured JSON results for each model
5. Prints a summary with pass/fail rates and cost breakdown

The question is simple: *"I want to wash my car. The car wash is 50 meters away. Should I walk or drive?"* The correct answer is **drive** — because the car must physically be at the car wash. But 76% of models say walk.

## Step 1: Define Your Models

Start with a small test set, then scale up. Models come from three sources: direct provider APIs, OpenRouter (which gives access to dozens of providers), and local Ollama models.

```typescript
import { ModelDetails } from '../../src/cognition/types.js';

// Quick local test — one model per provider
const LOCAL_TEST_MODELS: ModelDetails[] = [
  { name: 'qwen3:30b-a3b', provider: 'ollama' },
  { name: 'gemini-3-flash-preview', provider: 'google' },
  { name: 'anthropic/claude-3.5-haiku', provider: 'openrouter' },
];

// Full suite — 131 models
const ALL_MODELS: ModelDetails[] = [
  // Google (direct API — needs GOOGLE_GENERATIVE_AI_API_KEY)
  { name: 'gemini-3-flash-preview', provider: 'google' },
  { name: 'gemini-3-pro-preview', provider: 'google' },
  { name: 'gemini-2.5-pro', provider: 'google' },
  // ... more Google models

  // OpenRouter (needs OPENROUTER_API_KEY)
  // The model name includes the vendor prefix
  { name: 'anthropic/claude-opus-4.6', provider: 'openrouter' },
  { name: 'openai/gpt-5', provider: 'openrouter' },
  { name: 'x-ai/grok-4', provider: 'openrouter' },
  { name: 'qwen/qwen3.5-397b-a17b', provider: 'openrouter' },
  // ... more OpenRouter models

  // Ollama (local — no API key needed)
  { name: 'deepseek-r1:latest', provider: 'ollama' },
  { name: 'qwen3:32b', provider: 'ollama' },
  { name: 'minimax-m2.1:cloud', provider: 'ollama' },
  // ... more local models
];

// Toggle with a CLI flag
const MODELS = process.argv.includes('--all') ? ALL_MODELS : LOCAL_TEST_MODELS;
```

**Tip:** Discover available models with the CLI:

```bash
dotenvx run -- pnpm run cli models --search gpt-5
dotenvx run -- pnpm run cli models --provider ollama
```

## Step 2: Set Up the Stimulus

A `Stimulus` defines *what* to tell the model — the role, instructions, and generation parameters. It doesn't run anything; it's just configuration.

```typescript
import { Stimulus } from '../../src/stimulus/stimulus.js';

const stimulus = new Stimulus({
  role: 'helpful assistant',
  objective: 'answer the user\'s question clearly and concisely',
  instructions: [
    'Think through the question carefully',
    'Give a clear recommendation',
    'Explain your reasoning briefly',
  ],
  temperature: 0.3,  // Low temperature for more consistent answers
  maxTokens: 500,    // Short responses are fine for this test
  runnerType: 'base',
});
```

For the car wash test we want short, focused answers. A temperature of 0.3 gives some variety while keeping responses grounded. Longer evaluations (creative writing, code generation) might use higher temperatures and token limits.

## Step 3: Set Up Run-Based Caching

Each run gets its own directory. This lets you resume interrupted evaluations, compare across runs, and keep a clean history.

```typescript
import fs from 'fs';
import path from 'path';
import { EvaluationCache } from '../../src/evaluation/caching/cache-service.js';

// Determine run number
const baseDir = path.join(process.cwd(), 'output', 'evaluations', 'car-wash-test', 'runs');
fs.mkdirSync(baseDir, { recursive: true });

const existingRuns = fs.readdirSync(baseDir)
  .filter(d => /^\d+$/.test(d))
  .map(d => parseInt(d, 10))
  .sort((a, b) => a - b);

const forceNew = process.argv.includes('--new');
const latestRun = existingRuns.length > 0 ? existingRuns[existingRuns.length - 1] : 1;
const runNumber = forceNew ? (latestRun + 1) : latestRun;
const runId = String(runNumber).padStart(3, '0');

const cache = new EvaluationCache(`car-wash-test/runs/${runId}`, { verbose: false });
```

This gives you a directory structure like:

```
output/evaluations/car-wash-test/runs/
├── 001/
│   ├── responses/     # Raw model responses (cached)
│   └── results/       # Judged results (JSON per model)
├── 002/
│   ├── responses/
│   └── results/
└── ...
```

The cache key is based on the model name, prompt, and stimulus settings. If you re-run without `--new`, it reuses cached responses and only re-judges them.

## Step 4: Run the Evaluation

`SimpleEvaluation` sends the same prompt to all models concurrently. The progress callback lets you track what's happening.

```typescript
import { SimpleEvaluation } from '../../src/evaluation/strategies/simple-evaluation.js';

const evaluation = new SimpleEvaluation(
  stimulus,
  MODELS,
  'I want to wash my car. The car wash is 50 meters away. Should I walk or drive?',
  cache,
  {
    evaluationId: `car-wash-test-${runId}`,
    useCache: true,
    concurrent: true,
    maxConcurrency: 5,   // Don't overwhelm APIs
    showProgress: true,
  },
  (progress) => {
    if (progress.status === 'completed') {
      console.log(`  ✅ ${progress.modelName}`);
    } else if (progress.status === 'error') {
      console.log(`  ❌ ${progress.modelName}: ${progress.error}`);
    }
  }
);

const results = await evaluation.run();
console.log(`Got ${results.length} responses`);
```

`maxConcurrency: 5` keeps you within rate limits for most providers. The evaluation automatically handles retries and error capture — a model that fails still produces a result entry (with the error recorded).

## Step 5: Build the LLM Judge

Here's where it gets interesting. Instead of manually reading 131 responses, we use another LLM to judge each one. The judge needs a structured output schema so we get consistent, parseable results.

### Define the Judge Schema

```typescript
import { z } from 'zod';

const JudgeSchema = z.object({
  recommendation: z.enum(['drive', 'walk', 'both', 'unclear']).describe(
    'What does the model ultimately recommend?'
  ),
  recognizes_need_for_car: z.boolean().describe(
    'Does the model state that the car must be physically present at the car wash?'
  ),
  correct_reason: z.boolean().describe(
    'Did the model recommend driving BECAUSE the car needs to be at the car wash?'
  ),
  stated_reason: z.string().describe(
    'What reason did the model give? Summarize in one sentence.'
  ),
  reasoning_quality: z.number().min(1).max(5).describe(
    '1=missed the point, 2=right answer wrong reason, 3=partial, 4=good, 5=immediately identified car must be at wash'
  ),
  explanation: z.string().describe(
    'Brief explanation of the judge verdict'
  ),
});
```

The schema is the contract between your judge LLM and your code. Every field has a description that tells the judge what to fill in. Using Zod means you get runtime validation — if the judge returns garbage, you catch it.

### Configure the Judge

The judge gets its own Stimulus with very specific instructions. The key is being explicit about what counts as correct and what doesn't.

```typescript
import { Interaction } from '../../src/interaction/core/interaction.js';

const judgeModel: ModelDetails = {
  name: 'anthropic/claude-haiku-4.5',
  provider: 'openrouter'
};

const judgeStimulus = new Stimulus({
  role: 'evaluation judge',
  objective: 'assess whether AI model responses correctly answer a common-sense reasoning question',
  instructions: [
    'The question was: "I want to wash my car. The car wash is 50 meters away. Should I walk or drive?"',
    'The ONLY correct answer is DRIVE — the car must be physically present at the car wash.',
    'IMPORTANT: A model that says "drive" for the WRONG reason (convenience, weather) gets correct_reason: false.',
    'A model that says "walk" has completely failed.',
    'Reply with ONLY a JSON object (no markdown fences).',
  ],
  temperature: 0.0,   // Judge should be deterministic
  maxTokens: 400,
  runnerType: 'base',
});
```

Notice: the judge uses `temperature: 0.0` for maximum consistency. We also use a fast, cheap model (Haiku) since the judging task is straightforward.

### Run the Judge on Each Response

```typescript
import { clearAllRateLimitStates } from '../../src/rate-limit/rate-limit.js';

// Clear rate limit state from the evaluation phase
clearAllRateLimitStates();

for (const result of results) {
  // Rate limit management — clear every 50 calls
  if (judgeCallCount > 0 && judgeCallCount % 50 === 0) {
    clearAllRateLimitStates();
  }

  const responseText = typeof result.response.content === 'string'
    ? result.response.content
    : JSON.stringify(result.response.content);

  // Handle errors and empty responses
  if (!responseText || result.metadata.error) {
    // Write an error result and continue
    continue;
  }

  // Create a fresh interaction for each judgment
  const judgeInteraction = new Interaction(judgeModel, judgeStimulus);
  judgeInteraction.addMessage({
    role: 'user',
    content: `Here is the model response to judge:\n\n---\n${responseText}\n---\n\nScore this response. Reply with ONLY a JSON object.`,
  });

  const judgeResponse = await judgeInteraction.generateText();

  // Extract JSON (handle possible markdown fences)
  let jsonStr = judgeResponse.content.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    || jsonStr.match(/(\{[\s\S]*\})/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  const judgeResult = JudgeSchema.parse(JSON.parse(jsonStr));

  // A model is "truly correct" only with drive + correct reasoning
  const correct = judgeResult.recommendation === 'drive' && judgeResult.correct_reason;

  // Write result to disk
  const resultPath = path.join(resultsDir, `${modelKey}.json`);
  fs.writeFileSync(resultPath, JSON.stringify({
    model: result.model.name,
    provider: result.model.provider,
    judge: judgeResult,
    correct,
    responsePreview: responseText.slice(0, 120),
    durationMs,
    cost,
    tokens,
  }, null, 2));

  // Rate limit: 1 second between judge calls
  await new Promise(resolve => setTimeout(resolve, 1000));
}
```

Key design decisions:

- **Fresh interaction per judgment.** Each model's response is judged independently with no cross-contamination from previous judgments.
- **JSON extraction.** Some models wrap their JSON in markdown fences despite being told not to. The regex handles both cases.
- **Zod validation.** `JudgeSchema.parse()` throws if the judge returns malformed data, which we catch and record as a judge error.
- **Rate limiting.** The 1-second delay and periodic `clearAllRateLimitStates()` keeps us under provider rate limits (typically 60 req/min).

## Step 6: Analyze Results

Each result file is a self-contained JSON document:

```json
{
  "model": "anthropic/claude-opus-4.6",
  "provider": "openrouter",
  "judge": {
    "recommendation": "drive",
    "recognizes_need_for_car": true,
    "correct_reason": true,
    "stated_reason": "You need your car at the car wash to wash it.",
    "reasoning_quality": 5,
    "explanation": "Immediately identifies the physical requirement."
  },
  "correct": true,
  "responsePreview": "You should drive. The whole point of going...",
  "durationMs": 3400,
  "cost": 0.00273,
  "tokens": { "promptTokens": 89, "completionTokens": 156 }
}
```

### Console Summary

At the end of the script, compute aggregate stats:

```typescript
const passed = scored.filter(s => s.correct).length;
const luckyDrive = scored.filter(s =>
  s.judge.recommendation === 'drive' && !s.judge.correct_reason
).length;
const failed = scored.filter(s => s.judge.recommendation === 'walk').length;
const other = scored.length - passed - luckyDrive - failed;
const totalCost = scored.reduce((sum, s) => sum + s.cost, 0);

console.log(`${passed}/${scored.length} truly correct`);
console.log(`Lucky (drive + wrong reason): ${luckyDrive}`);
console.log(`Failed (walk): ${failed}`);
console.log(`Total cost: $${totalCost.toFixed(2)}`);
```

### Categorization

The car wash test has four categories:

| Category | Criteria | Meaning |
|----------|----------|---------|
| **Correct** | drive + correct_reason | Model understands the car must be there |
| **Lucky** | drive + wrong reason | Right answer, wrong logic |
| **Walk** | recommendation = walk | Failed the test |
| **Other** | both / unclear / error | API errors, ambiguous answers |

This "correct for the right reason" distinction is important. A model that says "drive because it's more convenient" hasn't demonstrated common sense — it got lucky. The LLM judge catches this.

## Running It

```bash
# Quick test with 3 models
dotenvx run -- pnpm tsx scripts/examples/car-wash-test.ts

# Full 131-model run (fresh)
dotenvx run -- pnpm tsx scripts/examples/car-wash-test.ts --all --new

# Resume an interrupted run (reuses cached responses)
dotenvx run -- pnpm tsx scripts/examples/car-wash-test.ts --all

# Re-run a specific previous run
dotenvx run -- pnpm tsx scripts/examples/car-wash-test.ts --all --run 4
```

A full run takes about 15 minutes and costs ~$0.50. Most of the time is spent on rate-limited judge calls (1/second × 131 models ≈ 2 minutes) and slow models (some thinking models take 30–140 seconds).

## Patterns You Can Reuse

### Pattern 1: Simple Benchmark with LLM Judge

The core pattern: send a prompt to N models, judge each response with a separate LLM, write structured results. Works for any question where you can define clear right/wrong criteria.

```
Prompt → N models → N responses → Judge LLM → N scored results
```

### Pattern 2: Run-Based Caching

Number your runs, cache everything per-run. This lets you:
- Resume interrupted runs
- Compare results across runs (LLMs are non-deterministic)
- Re-judge cached responses with different judge criteria
- Keep a historical record

### Pattern 3: Structured Judge Output

Use Zod schemas for judge output. This gives you:
- Guaranteed fields and types
- Self-documenting expectations (via `.describe()`)
- Runtime validation with clear error messages
- Easy aggregation and filtering downstream

### Pattern 4: Multi-Provider Model Lists

Mix direct APIs (Google), aggregators (OpenRouter), and local models (Ollama) in the same evaluation. The `ModelDetails` type abstracts the provider — your evaluation code doesn't care where the model lives.

## Adapting This for Your Own Evaluation

1. **Change the prompt.** Replace the car wash question with whatever you're testing.
2. **Rewrite the judge instructions.** Be very specific about what counts as correct. The more explicit, the more consistent your judge will be.
3. **Adjust the schema.** Add or remove fields to match what you're measuring. Keep fields that help you categorize results downstream.
4. **Tune the model list.** Start with 3–5 models, verify the judge is scoring correctly, then scale up.
5. **Consider multiple runs.** LLMs are non-deterministic. A single run is a snapshot. Run 3–5 times and look for consistency (like Opper.ai's 10-run methodology).

## Full Source

See [`scripts/examples/car-wash-test.ts`](../../scripts/examples/car-wash-test.ts) for the complete implementation (542 lines including all 131 models).

Results from our evaluation are published at [thefocus.ai/reports/car-wash-test](https://thefocus.ai/reports/car-wash-test/).
