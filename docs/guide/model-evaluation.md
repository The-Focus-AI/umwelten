# Model Evaluation

Learn how to systematically evaluate and compare AI models using Umwelten's comprehensive evaluation system.

## Overview

Model evaluation is at the heart of Umwelten's functionality. The `eval` command family provides systematic testing across multiple models with comprehensive reporting, cost analysis, and resume capability.

## Basic Evaluation

### Simple Model Comparison

```bash
pnpm run cli -- eval run \
  --prompt "Explain machine learning in simple terms" \
  --models "ollama:gemma3:12b,google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini" \
  --id "ml-explanation" \
  --concurrent
```

### With System Context

```bash
pnpm run cli -- eval run \
  --prompt "Explain quantum computing applications" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o" \
  --id "quantum-apps" \
  --system "You are a physics professor explaining to undergraduate students" \
  --temperature 0.3
```

## Advanced Features

### Interactive UI Mode

Watch evaluations in real-time:

```bash
pnpm run cli -- eval run \
  --prompt "Write a creative story about AI" \
  --models "ollama:gemma3:12b,google:gemini-3-flash-preview" \
  --id "ai-story" \
  --ui \
  --concurrent
```

### File Attachments

Test multimodal capabilities:

```bash
pnpm run cli -- eval run \
  --prompt "Analyze this document and extract key insights" \
  --models "google:gemini-3-flash-preview,google:gemini-2.5-pro-exp-03-25" \
  --id "document-analysis" \
  --attach "./documents/report.pdf" \
  --concurrent
```

## Evaluation Options

### Core Parameters
- `--prompt`: The prompt to evaluate (required)
- `--models`: Comma-separated models in `provider:model` format (required)
- `--id`: Unique evaluation identifier (required)
- `--system`: Optional system prompt
- `--temperature`: Temperature for generation (0.0-2.0)
- `--timeout`: Timeout in milliseconds (minimum 1000ms)

### Advanced Options
- `--resume`: Re-run existing responses (default: false)
- `--attach`: Comma-separated file paths to attach
- `--ui`: Use interactive UI with streaming responses
- `--concurrent`: Enable concurrent evaluation for faster processing
- `--max-concurrency <number>`: Maximum concurrent evaluations (1-20, default: 3)

## Report Generation

### Generate Reports

```bash
# Markdown report (default)
pnpm run cli -- eval report --id ml-explanation

# HTML report with rich formatting
pnpm run cli -- eval report --id quantum-apps --format html --output report.html

# CSV export for analysis
pnpm run cli -- eval report --id ai-story --format csv --output results.csv

# JSON for programmatic use
pnpm run cli -- eval report --id document-analysis --format json
```

### List Evaluations

```bash
# List all evaluations
pnpm run cli -- eval list

# Show detailed information
pnpm run cli -- eval list --details

# JSON format for scripting
pnpm run cli -- eval list --json
```

## Best Practices

### Model Selection
- Start with free Ollama models for development
- Use Google Gemini 2.0 Flash for production (cost-effective)
- Reserve premium models (GPT-4o) for critical quality needs
- Use multiple models for comparison and validation

### Prompt Design
- Be specific about desired output format and length
- Include context about target audience when relevant
- Use system prompts to set role and expertise level
- Test with different temperature values for creativity vs consistency

### Performance Optimization
- Use `--concurrent` for faster multi-model evaluation (3-5x speedup)
- Set appropriate `--timeout` for complex prompts
- Use `--ui` for long-running evaluations to monitor progress
- Enable `--resume` for reliability with large evaluation sets

## Pairwise Ranking

After running an evaluation, you can rank the results head-to-head using an LLM judge with Elo ratings. This is especially useful for subjective quality comparisons where absolute scoring is unreliable.

```typescript
import { PairwiseRanker, evaluationResultsToRankingEntries } from '../src/evaluation/ranking/index.js';

const entries = evaluationResultsToRankingEntries(evalResult);
const ranker = new PairwiseRanker(entries, {
  judgeModel: { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' },
  judgeInstructions: ['Compare these responses. Which is more helpful and accurate?'],
  pairingMode: 'swiss',
  swissRounds: 5,
});

const output = await ranker.rank();
for (const r of output.rankings) {
  console.log(`${r.model} — Elo ${r.elo} (${r.wins}W/${r.losses}L/${r.ties}T)`);
}
```

See the full [Pairwise Ranking Guide](/guide/pairwise-ranking) for configuration details and the [Pairwise Ranking Example](/examples/pairwise-ranking) for a complete walkthrough.

## Combining Multiple Evaluations

When you have multiple evaluations that test different capabilities, use `eval combine` to aggregate them into a unified leaderboard.

### Define a Suite Configuration

Create a TypeScript file that defines how to read each evaluation's results:

```typescript
import type { EvalDimension } from '../src/evaluation/combine/types.js';

export const MY_SUITE: EvalDimension[] = [
  {
    evalName: 'my-eval-reasoning',
    label: 'Reasoning',
    maxScore: 20,
    extractScore: (r) => r.judge?.reasoning_quality ?? 0,
    hasResultsSubdir: true,
  },
  {
    evalName: 'my-eval-knowledge',
    label: 'Knowledge',
    maxScore: 30,
    extractScore: (r) => r.correct ? 1 : 0,
  },
];
```

### Generate Combined Reports

```bash
# Console leaderboard
dotenvx run -- pnpm run cli eval combine --config path/to/suite-config.ts

# Structured markdown
dotenvx run -- pnpm run cli eval combine --config path/to/suite-config.ts --format md

# Full narrative writeup with methodology, analysis, and judge explanations
dotenvx run -- pnpm run cli eval combine --config path/to/suite-config.ts --format narrative --output report.md

# Focus on specific models
dotenvx run -- pnpm run cli eval combine --config path/to/suite-config.ts --format md --focus nemotron qwen
```

The combine system:
- Reads result JSON files from each eval's `output/evaluations/{name}/runs/` directory
- Extracts scores using the dimension's `extractScore` function
- Normalizes each dimension to 0–100%, then averages across dimensions
- Only includes models present in ALL dimensions
- Preserves raw data for detailed per-task breakdowns and judge explanations

For a complete walkthrough, see [Building a Multi-Dimension Model Showdown](/walkthroughs/model-showdown).

## Examples

For comprehensive examples, see:
- [Text Generation](/examples/text-generation) - Basic model comparison
- [Creative Writing](/examples/creative-writing) - Temperature and creativity testing
- [Analysis & Reasoning](/examples/analysis-reasoning) - Complex reasoning tasks
- [Cost Optimization](/examples/cost-optimization) - Budget-conscious evaluation
- [Pairwise Ranking](/examples/pairwise-ranking) - Head-to-head Elo ranking via LLM judge
- [Model Showdown](/walkthroughs/model-showdown) - Multi-dimension evaluation suite with combined reporting

## Next Steps

- Try [batch processing](/guide/batch-processing) for multiple files
- Explore [structured output](/guide/structured-output) for data extraction
- Learn [cost analysis](/guide/cost-analysis) for budget optimization
- Use [pairwise ranking](/guide/pairwise-ranking) for head-to-head model comparison
- Build [multi-dimension suites](/walkthroughs/model-showdown) with combined reporting