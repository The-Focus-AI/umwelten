# Building a Multi-Dimension Model Showdown

A walkthrough of building the "Model Showdown" — a comprehensive evaluation suite that tests 49 models across 5 dimensions (reasoning, knowledge, instruction following, coding, MCP tool use), combines the results into a unified leaderboard, and generates a full narrative report with per-dimension analysis.

**Time Required:** 30 minutes to build, 2–4 hours to run
**Prerequisites:** Node.js 20+, pnpm, API keys for Google, OpenRouter, and DeepInfra
**Cost:** ~$4.63 for a full 49-model run

## What We're Building

A multi-evaluation suite that:

1. Runs 5 independent evaluations testing different capabilities
2. Uses LLM judges and deterministic verifiers to score results
3. Combines results across all dimensions into per-model scorecards
4. Generates both structured reports (console, markdown, JSON) and full narrative writeups
5. Includes per-dimension breakdowns, cost/speed analysis, and provider comparisons

Unlike the [Car Wash evaluation](./car-wash-evaluation.md) which tests one question across many models, the Model Showdown tests multiple questions across multiple dimensions — and introduces the **suite combine** system for cross-evaluation analysis.

## Architecture

The showdown is split into three layers:

```
examples/model-showdown/
├── shared/                  # Common: models, judge, env, utilities
├── reasoning/               # 4 logic puzzles, LLM-judged
├── knowledge/               # 30 factual questions, LLM-judged
├── instruction/             # 6 constraint tasks, deterministic scoring
├── coding/                  # 6 challenges × 3 languages, compiled & run
├── mcp-tool-use/            # MCP tool orchestration, LLM-judged
├── suite-config.ts          # EvalDimension[] — defines how to combine
├── generate-report.ts       # Report entry point (4 output formats)
└── run-all.ts               # Orchestrator — runs all evals + report
```

Each evaluation writes results to `output/evaluations/model-showdown-{name}/runs/{number}/`. The combine system reads from these directories to build unified reports.

## Step 1: Define Your Model List

All evals share the same model list from `shared/models.ts`:

```typescript
import { ModelDetails } from '../../../src/cognition/types.js';

const LOCAL_TEST_MODELS: ModelDetails[] = [
  { name: 'gemini-3-flash-preview', provider: 'google' },
  { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' },
];

const ALL_MODELS: ModelDetails[] = [
  { name: 'gemini-3-flash-preview', provider: 'google' },
  { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' },
  { name: 'qwen/qwen3.5-122b-a10b', provider: 'openrouter' },
  { name: 'openai/gpt-oss-120b', provider: 'openrouter' },
  // ... 45 more models across openrouter, deepinfra, and ollama
];

export const MODELS = process.argv.includes('--all') ? ALL_MODELS : LOCAL_TEST_MODELS;
```

## Step 2: Build the Four Evaluation Dimensions

### Reasoning (4 puzzles, /20)

Four classic logic puzzles that test whether models can reason past intuitive traps:

- **Bat & Ball:** The classic $1.10 problem (trap: $0.10, correct: $0.05)
- **Counterfeit Coin:** 12 coins, 3 weighings, find the fake
- **Lily Pad:** Doubling lily pads — covers the lake in 48 days, half in...?
- **Surgeon Riddle:** "I can't operate — he's my son"

Each puzzle is scored 1–5 by an LLM judge (Claude Haiku 4.5) on reasoning quality — not just the answer, but whether the model shows genuine understanding. Max score: 20.

```typescript
// reasoning/puzzles.ts
export const PUZZLES = [
  {
    id: 'bat-ball',
    prompt: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?',
    correct: '$0.05',
    trap: '$0.10',
  },
  // ... 3 more puzzles
];
```

### Knowledge (30 questions, /30)

30 factual questions across 6 categories: Science, Geography, History, Technology, AI/ML, and Tricky/Adversarial. Each is binary — correct (1) or incorrect (0) — judged by an LLM that allows formatting variations (e.g., "5730 years" and "5,730 years" both count).

```typescript
// knowledge/questions.ts
export const QUESTIONS = [
  { id: 'sci-1', category: 'Science',
    question: 'What is the half-life of carbon-14?',
    answer: '5,730 years' },
  { id: 'geo-3', category: 'Geography',
    question: 'Which country has the most time zones?',
    answer: 'France (12 time zones including overseas territories)' },
  // ... 28 more
];
```

### Instruction Following (6 tasks, /30)

Six tasks with strict format constraints verified deterministically — no LLM judge needed. Each task is scored 0–5 based on how many constraints are satisfied.

Examples:
- Write exactly 3 sentences, each starting with a given word
- Output valid JSON with specific required fields
- Write a poem with exactly 4 lines of exactly 8 words each
- Respond with only uppercase letters

The scorer uses regex, JSON parsing, and character counting — no ambiguity.

### Coding (6 challenges × 3 languages, /126)

Six programming challenges implemented in TypeScript, Python, and Rust. Each submission is compiled (where applicable), run against test cases, and scored on correctness.

Challenges include FizzBuzz, palindrome checking, Fibonacci, matrix transposition, Caesar cipher, and anagram detection. Each challenge has 3–7 test cases with expected outputs. Max score per challenge per language: 7 (1 for compilation + 1 per test case).

Execution uses either Dagger containers (isolated Docker) or local runtimes with the `--no-dagger` flag.

### MCP Tool Use (1 task, /16)

Tests whether models can orchestrate multiple MCP (Model Context Protocol) tools to analyze real-world data. The eval connects to the TezLab MCP server (EV vehicle data) and asks each model to analyze battery health and charging patterns.

Scoring has two components:
- **Tool score (0-6):** Deterministic — checks whether the model called each required tool: `list_vehicles`, `get_battery_health`, `get_charges`, `get_efficiency`, `get_my_chargers`, `find_nearby_chargers`
- **Quality score (1-10):** LLM judge assesses data synthesis, actionable insights, and factual grounding

```typescript
// mcp-tool-use/mcp-eval.ts
const PROMPT =
  `Analyze my vehicle's battery health and charging patterns. ` +
  `First identify my vehicle, then get the battery health data...`;

// Scoring
function scoreToolUsage(calls: ToolCall[]): ToolUsage {
  const names = calls.map(c => c.name);
  const checks = [
    [names.includes('list_vehicles'), 'list_vehicles'],
    [names.includes('get_battery_health'), 'get_battery_health'],
    // ... 4 more required tools
  ];
  return { tool_score: checks.filter(([ok]) => ok).length, ... };
}
```

This dimension requires TezLab OAuth credentials. The eval connects via `examples/mcp-chat/tezlab-mcp.ts` and runs models sequentially over a shared MCP connection.

## Step 3: Define the Suite Configuration

The suite config tells the combine system how to read each evaluation's results:

```typescript
// suite-config.ts
import type { EvalDimension } from '../../src/evaluation/combine/types.js';

export const SHOWDOWN_SUITE: EvalDimension[] = [
  {
    evalName: 'model-showdown-reasoning',
    label: 'Reasoning',
    maxScore: 20,
    extractScore: (r) => r.judge?.reasoning_quality ?? r.reasoningQuality ?? r.score ?? 0,
    hasResultsSubdir: true,
  },
  {
    evalName: 'model-showdown-knowledge',
    label: 'Knowledge',
    maxScore: 30,
    extractScore: (r) => r.correct ? 1 : 0,
  },
  {
    evalName: 'model-showdown-instruction',
    label: 'Instruction',
    maxScore: 30,
    extractScore: (r) => r.score ?? 0,
  },
  {
    evalName: 'model-showdown-coding',
    label: 'Coding',
    maxScore: 126,
    extractScore: (r) => r.totalScore ?? r.score ?? 0,
    hasResultsSubdir: true,
  },
  {
    evalName: 'model-showdown-mcp',
    label: 'MCP Tool Use',
    maxScore: 16,
    extractScore: (r) => (r.toolUsage?.tool_score ?? 0) + (r.judge?.overall_score ?? 0),
    hasResultsSubdir: true,
  },
];
```

Each dimension defines:

| Field | Purpose |
|-------|---------|
| `evalName` | Maps to `output/evaluations/{evalName}/` directory |
| `label` | Human-readable name for reports |
| `maxScore` | Perfect score for this dimension |
| `extractScore` | Function to pull a numeric score from each result JSON file |
| `hasResultsSubdir` | Whether results are in `{task}/results/` vs `{task}/` |

The `extractScore` function is the key abstraction — each eval stores results differently, and this function normalizes them to a number.

## Step 4: Run the Evaluations

### Run Everything at Once

```bash
# Quick test (2 models × 4 evals)
dotenvx run -- pnpm tsx examples/model-showdown/run-all.ts

# Full showdown (25 models × 4 evals)
dotenvx run -- pnpm tsx examples/model-showdown/run-all.ts --all

# Fresh run (don't reuse cached responses)
dotenvx run -- pnpm tsx examples/model-showdown/run-all.ts --all --new
```

### Run Individual Evals

```bash
dotenvx run -- pnpm tsx examples/model-showdown/reasoning/reasoning-eval.ts --all
dotenvx run -- pnpm tsx examples/model-showdown/knowledge/knowledge-eval.ts --all
dotenvx run -- pnpm tsx examples/model-showdown/instruction/instruction-eval.ts --all
dotenvx run -- pnpm tsx examples/model-showdown/coding/coding-eval.ts --all --no-dagger
dotenvx run -- pnpm tsx examples/model-showdown/mcp-tool-use/mcp-eval.ts --all
```

Each eval writes results to `output/evaluations/model-showdown-{name}/runs/{NNN}/`. The combine system automatically picks the latest run.

## Step 5: Generate Combined Reports

### Via the Generate Script

```bash
# Console tables (default)
dotenvx run -- pnpm tsx examples/model-showdown/generate-report.ts

# Structured markdown
dotenvx run -- pnpm tsx examples/model-showdown/generate-report.ts --format md

# Full narrative writeup
dotenvx run -- pnpm tsx examples/model-showdown/generate-report.ts --format narrative

# Save to file
dotenvx run -- pnpm tsx examples/model-showdown/generate-report.ts --format narrative --output report.md
```

### Via the CLI

```bash
# Console tables
dotenvx run -- pnpm run cli eval combine --config examples/model-showdown/suite-config.ts

# Narrative report to file
dotenvx run -- pnpm run cli eval combine \
  --config examples/model-showdown/suite-config.ts \
  --format narrative \
  --output report.md

# Focus on specific models
dotenvx run -- pnpm run cli eval combine \
  --config examples/model-showdown/suite-config.ts \
  --format md \
  --focus nemotron qwen
```

## Step 6: Understanding the Report Formats

### Console / Structured Report

The `buildSuiteReport()` function produces a `Report` object (from `src/reporting/types.ts`) with these sections:

1. **Overall Leaderboard** — Rank, Model, Combined %, one column per dimension, Cost, Time
2. **Cost Efficiency** — Sorted by score/dollar (free models at top)
3. **Speed Leaderboard** — Sorted by total time ascending
4. **Per-Dimension Details** — task-level breakdowns, judge explanations, failure reasons
5. **Focus Model Comparison** — filtered deep-dive (when `--focus` is set)
6. **Run Info** — which directories were used, model count, timestamp

Render via `Reporter`:
```typescript
import { loadSuite, buildSuiteReport } from '../../src/evaluation/combine/index.js';
import { Reporter } from '../../src/reporting/reporter.js';
import { SHOWDOWN_SUITE } from './suite-config.js';

const result = loadSuite(SHOWDOWN_SUITE);
const report = buildSuiteReport(result, {
  title: 'Model Showdown — Combined Results',
  focusModels: ['nemotron'],
});

const reporter = new Reporter();
reporter.toConsole(report);   // terminal with colors
reporter.toMarkdown(report);  // markdown string
reporter.toJson(report);      // JSON string
```

### Narrative Report

The `buildNarrativeReport()` function produces a standalone markdown article — a full writeup with:

- **Overview** — models tested, providers, total cost and time
- **Overall Leaderboard** — table with raw scores and percentages
- **Key Findings** — best overall, best value, fastest
- **Per-Dimension Sections** — each with:
  - Methodology (what's being tested, how it's scored)
  - Test descriptions (the actual puzzles/questions/tasks)
  - Results table with per-task scores
  - Analysis (which tasks were hardest, error patterns)
  - Selected judge explanations (for LLM-judged dimensions)
- **Cost & Speed Analysis** — cost efficiency, speed leaderboard
- **Provider Comparison** — average scores by inference provider
- **Methodology** — how scores are combined, what "combined %" means

```typescript
import { loadSuite, buildNarrativeReport } from '../../src/evaluation/combine/index.js';
import { SHOWDOWN_SUITE } from './suite-config.js';

const result = loadSuite(SHOWDOWN_SUITE);
const markdown = buildNarrativeReport(result, {
  title: 'Model Showdown — Full Evaluation Report',
});
```

## How the Combine System Works

### Loading

`loadSuite(dimensions)` does the following:

1. For each dimension, find the latest run directory under `output/evaluations/{evalName}/runs/`
2. Walk task subdirectories, read each `{modelKey}.json` file
3. Call `dimension.extractScore(result)` to get the score
4. Sum cost and durationMs per model across all tasks
5. Normalize to percentage: `rawScore / maxScore × 100`
6. **Only include models present in ALL dimensions** — partial coverage is excluded
7. Combine across dimensions: `mean(dimension percentages)`
8. Sort by combined percentage descending

### Model Key Parsing

Result files are named like `gemini-3-flash-preview-google.json`. The loader strips known provider suffixes (`-google`, `-openrouter`, `-deepinfra`, etc.) to extract the model name and provider.

### Task Results

The loader preserves the full raw JSON from every result file in `SuiteResult.taskResults`. This enables the detailed per-dimension reports — judge explanations, compilation errors, wrong answers, and response previews are all available.

## Adapting This for Your Own Suite

1. **Create your evaluations.** Each eval should write JSON result files to `output/evaluations/{evalName}/runs/{NNN}/`. Use the run-based caching pattern from the [Car Wash walkthrough](./car-wash-evaluation.md).

2. **Define your suite config.** Create an `EvalDimension[]` array:

```typescript
import type { EvalDimension } from '../../src/evaluation/combine/types.js';

export const MY_SUITE: EvalDimension[] = [
  {
    evalName: 'my-eval-accuracy',
    label: 'Accuracy',
    maxScore: 100,
    extractScore: (r) => r.score ?? 0,
  },
  {
    evalName: 'my-eval-speed',
    label: 'Speed',
    maxScore: 50,
    extractScore: (r) => r.timingScore ?? 0,
    hasResultsSubdir: true,
  },
];
```

3. **Generate reports.** Use the CLI:

```bash
dotenvx run -- pnpm run cli eval combine --config path/to/suite-config.ts
dotenvx run -- pnpm run cli eval combine --config path/to/suite-config.ts --format narrative --output report.md
```

Or programmatically:

```typescript
import { loadSuite, buildSuiteReport, buildNarrativeReport } from '../../src/evaluation/combine/index.js';
import { Reporter } from '../../src/reporting/reporter.js';

const result = loadSuite(MY_SUITE);

// Structured report
const report = buildSuiteReport(result, { title: 'My Suite Results' });
new Reporter().toConsole(report);

// Narrative writeup
const narrative = buildNarrativeReport(result, { title: 'My Evaluation Report' });
```

## Patterns You Can Reuse

### Pattern 1: Multi-Dimension Evaluation

Test models on fundamentally different capabilities and combine into one ranking. The key insight: a model that scores 90% on coding but 60% on reasoning has a different profile than one that scores 75% on both — the suite captures this.

### Pattern 2: Mixed Scoring Methods

Combine LLM-judged scores (reasoning, knowledge) with deterministic scores (instruction, coding) in the same suite. The `extractScore` function normalizes everything to a number, regardless of how it was produced.

### Pattern 3: Suite Configuration as Data

The `EvalDimension[]` is just data — you can version it, share it, and modify it without changing any framework code. Different teams can define different suites over the same evaluations.

### Pattern 4: Report Format Separation

The combine system produces data (`SuiteResult`). Rendering is separate: `buildSuiteReport()` for structured `Report` objects, `buildNarrativeReport()` for prose markdown. You can add new renderers without touching the loader.

## Sample Output

From the model showdown with 49 models across 4 dimensions (all models) and 22 models across 5 dimensions (with MCP):

- **Best overall (4-dim):** Claude Sonnet 4.6 at 100% across all 4 dimensions
- **Best value:** `openai/gpt-oss-120b` — 98.3% for $0.01
- **Best free:** `gpt-oss:latest` on Ollama — 93.3% for $0.00
- **Hardest dimension:** Coding — average 55%
- **Easiest dimension:** Instruction — average 89%
- **Total cost:** $4.63 across all 49 models
- **The frontier is crowded:** 11 models score above 95%

The counterfeit coin reasoning puzzle was the hardest individual task — only 9/22 models scored above 2/5. The MCP dimension revealed that most models can orchestrate all 6 required tools (scoring 6/6), but quality varied — the LLM judge scores ranged from 2/10 to 5/10 based on how well models synthesized the tool results into actionable insights.

## Quick Reference: Running & Generating Reports

### Run the full suite (with caching)

By default, runs resume the latest run number and skip models that already have cached results. Only new/missing models are evaluated.

```bash
# Full showdown — all base models, uses cached results
dotenvx run -- pnpm tsx examples/model-showdown/run-all.ts --all

# Full showdown with thinking effort variants (low/medium/high)
dotenvx run -- pnpm tsx examples/model-showdown/run-all.ts --all --with-reasoning-levels

# Include MCP eval (requires TezLab MCP server running)
dotenvx run -- pnpm tsx examples/model-showdown/run-all.ts --all --with-mcp

# Force a fresh run (ignores all caches, creates new run number)
dotenvx run -- pnpm tsx examples/model-showdown/run-all.ts --all --new

# Resume a specific run number
dotenvx run -- pnpm tsx examples/model-showdown/run-all.ts --all --run 8
```

### Run individual evals

```bash
dotenvx run -- pnpm tsx examples/model-showdown/reasoning/reasoning-eval.ts --all
dotenvx run -- pnpm tsx examples/model-showdown/knowledge/knowledge-eval.ts --all
dotenvx run -- pnpm tsx examples/model-showdown/instruction/instruction-eval.ts --all
dotenvx run -- pnpm tsx examples/model-showdown/coding/coding-eval.ts --all --no-dagger
dotenvx run -- pnpm tsx examples/model-showdown/mcp-tool-use/mcp-eval.ts --all
```

### Generate reports

#### Markdown (structured tables)

```bash
dotenvx run -- pnpm tsx examples/model-showdown/generate-report.ts --format md
dotenvx run -- pnpm tsx examples/model-showdown/generate-report.ts --format md --output output/model-showdown-results.md
```

#### Markdown (narrative writeup)

```bash
dotenvx run -- pnpm tsx examples/model-showdown/generate-report.ts --format narrative
dotenvx run -- pnpm tsx examples/model-showdown/generate-report.ts --format narrative --output output/model-showdown-narrative.md
```

#### 4-Dimension Report (All Models)

If some models are missing from the MCP dimension, use the 4-dimension report to include all models:

```bash
dotenvx run -- pnpm tsx examples/model-showdown/generate-4dim-report.ts --format narrative --output output/model-showdown-4dim-narrative.md
dotenvx run -- pnpm tsx examples/model-showdown/generate-4dim-report.ts --format md --output output/model-showdown-4dim-full.md
```

#### JSON

```bash
dotenvx run -- pnpm tsx examples/model-showdown/generate-report.ts --format json --output output/model-showdown-results.json
```

#### HTML (via Focus.AI brand report skill)

Generate a styled HTML report from the narrative markdown, ready for PDF printing:

```bash
# 1. Generate the narrative markdown
dotenvx run -- pnpm tsx examples/model-showdown/generate-report.ts \
  --format narrative --output output/model-showdown-narrative.md

# 2. Convert to branded HTML using the /report skill in Claude Code:
#    /report file:output/model-showdown-narrative.md style:labs
#
#    This opens a styled HTML page in the browser. Print to PDF with Cmd+P.
```

#### CLI (via eval combine command)

```bash
# Console output
dotenvx run -- pnpm run cli eval combine --config examples/model-showdown/suite-config.ts

# Narrative to file
dotenvx run -- pnpm run cli eval combine \
  --config examples/model-showdown/suite-config.ts \
  --format narrative --output report.md

# Focus on specific models
dotenvx run -- pnpm run cli eval combine \
  --config examples/model-showdown/suite-config.ts \
  --format md --focus nemotron qwen
```

### How caching works

- Results are stored as JSON files in `output/evaluations/model-showdown-{dim}/runs/{NNN}/`
- Each model's API response is cached in `{task}/responses/{modelKey}.json`
- Each model's scored result is cached in `{task}/results/{modelKey}.json`
- Without `--new`, the runner picks the latest run number and only evaluates models missing from that run
- Adding new models to `SHOWDOWN_MODELS` and re-running will only call APIs for the new models — existing results are preserved
- Use `--new` to force a clean run (creates a new run number, ignores all previous results)

### Output files

| File | Format | Description |
|------|--------|-------------|
| `output/model-showdown-narrative.md` | Markdown | Full prose report with methodology, analysis, tables (5-dim, models with MCP) |
| `output/model-showdown-4dim-narrative.md` | Markdown | Full prose report across 4 dimensions (all models) |
| `output/model-showdown-results.md` | Markdown | Structured tables (leaderboard, cost, speed) |
| `output/model-showdown-results.json` | JSON | Machine-readable results |
| `/tmp/focus-report-*.html` | HTML | Branded report for PDF printing (via `/report` skill) |

## Full Source

See [`examples/model-showdown/`](../../examples/model-showdown/) for the complete implementation.

The generated narrative report is at [`output/model-showdown-narrative.md`](../../output/model-showdown-narrative.md).
