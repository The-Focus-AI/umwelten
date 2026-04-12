# Multi-Dimension Evaluation Suite

This guide covers building **multi-dimension evaluation pipelines** — the actual way to compose multiple evaluations into a unified model comparison in umwelten.

Instead of a single monolithic evaluation, you run independent evaluations (each using `EvalSuite`), then combine their results with `eval combine` to produce leaderboards and narrative reports.

## Overview

The workflow has three steps:

1. **Run independent evaluations** — each one tests a specific capability (reasoning, coding, instruction-following, etc.)
2. **Define an `EvalDimension[]` suite config** — maps evaluation names to labels, max scores, and score extractors
3. **Combine with `eval combine`** — loads results from disk, builds per-model scorecards, and generates reports

## Step 1: Run Individual Evaluations

Each dimension is a standalone `EvalSuite` script. Run them independently:

```bash
dotenvx run -- pnpm tsx examples/model-showdown/reasoning/eval.ts --all
dotenvx run -- pnpm tsx examples/model-showdown/instruction/eval.ts --all
dotenvx run -- pnpm tsx examples/model-showdown/coding/eval.ts --all
```

Results are written to `output/evaluations/{eval-name}/runs/{NNN}/` as JSON files — one per model per task.

## Step 2: Define the Suite Config

Create a TypeScript file that exports an `EvalDimension[]`. Each dimension maps to one evaluation's output directory and tells the combiner how to extract scores.

```typescript
import type { EvalDimension } from '../../src/evaluation/combine/types.js';

export const SHOWDOWN_SUITE: EvalDimension[] = [
  {
    evalName: 'model-showdown-reasoning',
    label: 'Reasoning',
    maxScore: 20,
    perTaskMaxScore: 5,
    extractScore: (r) => r.judge?.reasoning_quality ?? r.score ?? 0,
    hasResultsSubdir: true,
  },
  {
    evalName: 'model-showdown-knowledge',
    label: 'Knowledge',
    maxScore: 30,
    perTaskMaxScore: 1,
    extractScore: (r) => r.correct ? 1 : 0,
  },
  {
    evalName: 'model-showdown-instruction',
    label: 'Instruction',
    maxScore: 30,
    perTaskMaxScore: 5,
    extractScore: (r) => r.score ?? 0,
  },
  {
    evalName: 'model-showdown-coding',
    label: 'Coding',
    maxScore: 126,
    perTaskMaxScore: 7,
    extractScore: (r) => r.totalScore ?? r.score ?? 0,
    hasResultsSubdir: true,
  },
];
```

### `EvalDimension` fields

| Field | Description |
|-------|-------------|
| `evalName` | Directory name under `output/evaluations/` |
| `label` | Human-readable name shown in reports |
| `maxScore` | Total max score for the full evaluation |
| `perTaskMaxScore` | Points added to denominator per result file (for partial runs) |
| `extractScore` | Function to pull a numeric score from each result JSON file |
| `hasResultsSubdir` | Whether task dirs contain a `results/` subdirectory |
| `runNumber` | Pin to a specific run (default: latest) |

## Step 3: Combine and Report

```bash
# Console table (default)
dotenvx run -- pnpm run cli -- eval combine \
  --config examples/model-showdown/suite-config.ts

# Markdown report
dotenvx run -- pnpm run cli -- eval combine \
  --config examples/model-showdown/suite-config.ts \
  --format md

# Full narrative report with methodology and analysis
dotenvx run -- pnpm run cli -- eval combine \
  --config examples/model-showdown/suite-config.ts \
  --format narrative --output report.md

# Focus on a specific model
dotenvx run -- pnpm run cli -- eval combine \
  --config examples/model-showdown/suite-config.ts \
  --format md --focus gemini
```

## What the Combiner Does

1. **Loads results** — scans `output/evaluations/{evalName}/runs/{latest}/` for each dimension
2. **Extracts scores** — calls your `extractScore` function on each JSON result file
3. **Builds scorecards** — aggregates per-model scores across all dimensions into `ModelScorecard` objects
4. **Calculates rankings** — computes combined percentage (mean of dimension percentages), total cost, total duration
5. **Generates reports** — outputs leaderboard tables, cost efficiency analysis, speed comparisons, and per-dimension breakdowns

### Report Formats

| Format | Description |
|--------|-------------|
| `console` | Structured tables to stdout |
| `md` / `markdown` | Markdown with leaderboard and dimension tables |
| `json` | Structured JSON for programmatic use |
| `narrative` | Full prose writeup with methodology, analysis, and judge explanations |

## Programmatic Usage

You can also use the combine system directly in code:

```typescript
import { loadSuite } from '../../src/evaluation/combine/loader.js';
import { buildSuiteReport } from '../../src/evaluation/combine/report-builder.js';
import { buildNarrativeReport } from '../../src/evaluation/combine/narrative-report.js';
import type { EvalDimension } from '../../src/evaluation/combine/types.js';

const dimensions: EvalDimension[] = [ /* ... */ ];

const suite = loadSuite(dimensions);

// Structured report
const report = buildSuiteReport(suite);

// Narrative markdown
const narrative = buildNarrativeReport(suite);
```

## Full Working Example

See [`examples/model-showdown/`](https://github.com/the-focus-ai/umwelten/tree/main/examples/model-showdown) for the complete working example including:

- **`suite-config.ts`** — 5-dimension suite config
- **`run-all.ts`** — orchestration script that runs all dimensions then combines
- **Individual evaluations** — `reasoning/`, `knowledge/`, `instruction/`, `coding/`, `mcp-tool-use/`
- **`shared/models.ts`** — shared model list

For a step-by-step walkthrough, see the [Model Showdown walkthrough](https://umwelten.thefocus.ai/walkthroughs/model-showdown).

## Next Steps

- Start with [EvalSuite Examples](/examples/comprehensive-analysis) to learn how to write individual evaluations
- See the [Pairwise Ranking Example](/examples/pairwise-ranking) for Elo-based head-to-head comparisons
- Read the [Model Evaluation guide](https://umwelten.thefocus.ai/guide/model-evaluation) for full API reference
