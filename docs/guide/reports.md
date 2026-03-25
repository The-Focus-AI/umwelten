# Reports & Analysis

Learn how to generate comprehensive reports from your Umwelten evaluations. Reports provide detailed analysis, comparisons, and insights from your model evaluations, making it easy to understand performance, costs, and quality differences.

## Overview

Umwelten's reporting system enables you to:

- **Generate detailed reports** from evaluation results
- **Compare model performance** across different metrics
- **Analyze costs and efficiency** for optimization
- **Export data** in multiple formats for further analysis
- **Create visual summaries** of evaluation results

## Basic Report Generation

### The `eval report` Command

Generate reports from completed evaluations:

```bash
# Basic report generation
pnpm run cli -- eval report --id "your-evaluation-id"

# Specify output format
pnpm run cli -- eval report --id "your-evaluation-id" --format markdown

# Save to file
pnpm run cli -- eval report --id "your-evaluation-id" --format html --output report.html

# Generate short summary (without full response content)
pnpm run cli -- eval report --id "your-evaluation-id" --short
```

### Available Report Formats

Umwelten supports multiple output formats:

```bash
# Markdown (default) - Good for documentation
pnpm run cli -- eval report --id "evaluation-id" --format markdown

# HTML - Interactive web reports
pnpm run cli -- eval report --id "evaluation-id" --format html

# JSON - Machine-readable data
pnpm run cli -- eval report --id "evaluation-id" --format json

# CSV - Spreadsheet-friendly data
pnpm run cli -- eval report --id "evaluation-id" --format csv
```

### Report Options

- `--id <id>`: Evaluation ID to generate report for (required)
- `--format <format>`: Output format: markdown, html, json, csv (default: markdown)
- `--output <file>`: Output file path (defaults to stdout)
- `--short`: Generate summary report without full response content

## Report Types and Content

### Evaluation Summary Reports

Get an overview of your evaluation results:

```bash
# Generate summary report
pnpm run cli -- eval report --id "quantum-explanation" --format markdown

# Generate short summary
pnpm run cli -- eval report --id "quantum-explanation" --short

# Output includes:
# - Evaluation metadata (prompt, models, timestamp)
# - Performance metrics (response time, token usage)
# - Cost analysis (total cost, cost per model)
# - Quality scores (if applicable)
# - Model comparisons
```

### Model Comparison Reports

Compare multiple models on the same task:

```bash
# Compare models on a single prompt
pnpm run cli -- eval run \
  --prompt "Explain quantum computing in simple terms" \
  --models "ollama:gemma3:12b,google:gemini-3-flash-preview,openai/gpt-4o" \
  --id "quantum-comparison"

# Generate comparison report
pnpm run cli -- eval report --id "quantum-comparison" --format html --output comparison.html

# Generate short comparison summary
pnpm run cli -- eval report --id "quantum-comparison" --short
```

### Batch Processing Reports

Analyze results from batch operations:

```bash
# Process batch of files
pnpm run cli -- eval batch \
  --prompt "Analyze this image and describe key features" \
  --models "google:gemini-3-flash-preview,ollama:qwen2.5vl:latest" \
  --id "image-batch" \
  --directory "input/images" \
  --file-pattern "*.jpg" \
  --concurrent

# Generate batch report
pnpm run cli -- eval report --id "image-batch" --format markdown --output batch-analysis.md

# Generate short batch summary
pnpm run cli -- eval report --id "image-batch" --short
```

## Report Content Examples

### Full Report vs Short Report

#### Full Report (Default)
```bash
pnpm run cli -- eval report --id "quantum-explanation" --format markdown
```

Includes:
- Complete evaluation metadata
- Full response content from all models
- Detailed performance metrics
- Cost breakdown
- Quality scores (if applicable)

#### Short Report
```bash
pnpm run cli -- eval report --id "quantum-explanation" --short
```

Includes:
- Evaluation metadata (prompt, models, timestamp)
- Summary statistics (response times, costs)
- Model comparison table
- **No full response content** (much more concise)

### Markdown Report Structure

```markdown
# Evaluation Report: quantum-explanation

## Summary
- **Evaluation ID**: quantum-explanation
- **Prompt**: "Explain quantum computing in simple terms"
- **Models**: 3 models evaluated
- **Total Cost**: $0.0234
- **Average Response Time**: 2.3 seconds

## Model Performance Comparison

| Model | Response Time | Cost | Quality Score | Status |
|-------|---------------|------|---------------|--------|
| ollama:gemma3:12b | 1.2s | $0.0000 | 7.2/10 | ✅ Success |
| google:gemini-3-flash-preview | 2.1s | $0.0123 | 8.5/10 | ✅ Success |
| openai/gpt-4o | 3.5s | $0.0111 | 9.1/10 | ✅ Success |

## Cost Analysis
- **Total Cost**: $0.0234
- **Cost per Model**: $0.0078 average
- **Most Expensive**: google:gemini-3-flash-preview ($0.0123)
- **Most Cost-Effective**: ollama:gemma3:12b (Free)

## Detailed Responses
[Full response content for each model...]
```

### HTML Report Features

HTML reports include interactive features:

```bash
# Generate interactive HTML report
pnpm run cli -- eval report \
  --id "evaluation-id" \
  --format html \
  --output interactive-report.html

# Generate short HTML report
pnpm run cli -- eval report \
  --id "evaluation-id" \
  --format html \
  --short \
  --output short-report.html

# Features include:
# - Interactive tables with sorting
# - Expandable sections
# - Search functionality
# - Export options
# - Responsive design
```

### JSON Report Structure

Machine-readable JSON format:

```json
{
  "evaluation": {
    "id": "quantum-explanation",
    "prompt": "Explain quantum computing in simple terms",
    "timestamp": "2024-01-27T10:30:00Z",
    "models": ["ollama:gemma3:12b", "google:gemini-3-flash-preview", "openai/gpt-4o"]
  },
  "results": [
    {
      "model": "ollama:gemma3:12b",
      "response": "...",
      "metrics": {
        "responseTime": 1.2,
        "tokenUsage": 150,
        "cost": 0.0
      }
    }
  ],
  "summary": {
    "totalCost": 0.0234,
    "averageResponseTime": 2.3,
    "successRate": 1.0
  }
}
```

## Cost Analysis Reports

### Detailed Cost Breakdown

```bash
# Generate cost-focused report
pnpm run cli -- eval report \
  --id "evaluation-id" \
  --format markdown \
  --output cost-analysis.md

# Generate short cost summary
pnpm run cli -- eval report \
  --id "evaluation-id" \
  --short \
  --output cost-summary.md
```

### Cost Optimization Insights

```bash
# Compare costs across providers
pnpm run cli -- eval run \
  --prompt "Your prompt" \
  --models "ollama:gemma3:12b,google:gemini-3-flash-preview,openai/gpt-4o" \
  --id "cost-comparison"

pnpm run cli -- eval report \
  --id "cost-comparison" \
  --format markdown \
  --output cost-optimization.md

# Generate short cost comparison
pnpm run cli -- eval report \
  --id "cost-comparison" \
  --short \
  --output cost-comparison-summary.md
```

## Performance Analysis Reports

### Response Time Analysis

```bash
# Analyze performance patterns
pnpm run cli -- eval report \
  --id "evaluation-id" \
  --format markdown \
  --output performance-analysis.md

# Generate short performance summary
pnpm run cli -- eval report \
  --id "evaluation-id" \
  --short \
  --output performance-summary.md
```

### Quality Assessment Reports

For evaluations with quality scoring:

```bash
# Generate quality-focused report
pnpm run cli -- eval report \
  --id "code-evaluation" \
  --format markdown \
  --output quality-analysis.md

# Generate short quality summary
pnpm run cli -- eval report \
  --id "code-evaluation" \
  --short \
  --output quality-summary.md
```

## Batch Processing Reports

### Large Dataset Analysis

```bash
# Process large batch
pnpm run cli -- eval batch \
  --prompt "Analyze this image" \
  --models "google:gemini-3-flash-preview" \
  --id "large-dataset" \
  --directory "input/images" \
  --file-pattern "*.jpg" \
  --concurrent

# Generate comprehensive batch report
pnpm run cli -- eval report \
  --id "large-dataset" \
  --format html \
  --output batch-analysis.html

# Generate short batch summary
pnpm run cli -- eval report \
  --id "large-dataset" \
  --short \
  --output batch-summary.md
```

### Batch Report Features

Batch reports include:

- **Processing statistics**: Success rate, failure analysis
- **Performance metrics**: Average processing time, throughput
- **Cost analysis**: Total cost, cost per file
- **Error summary**: Common failure patterns
- **File-level details**: Individual file results

## Export and Integration

### Export to External Tools

```bash
# Export to spreadsheet
pnpm run cli -- eval report \
  --id "evaluation-id" \
  --format csv \
  --output data.csv

# Export short summary to CSV
pnpm run cli -- eval report \
  --id "evaluation-id" \
  --format csv \
  --short \
  --output summary.csv

# Import into Excel, Google Sheets, or data analysis tools
```

### API Integration

```bash
# Get JSON data for API integration
pnpm run cli -- eval report \
  --id "evaluation-id" \
  --format json \
  --output data.json

# Get short JSON summary
pnpm run cli -- eval report \
  --id "evaluation-id" \
  --format json \
  --short \
  --output summary.json

# Use with custom dashboards or analysis tools
```

## Best Practices

### 1. Use Descriptive Evaluation IDs

```bash
# Good: Descriptive ID
pnpm run cli -- eval run \
  --prompt "Explain quantum computing" \
  --models "model1,model2,model3" \
  --id "quantum-explanation-comparison-2024"

# Bad: Generic ID
pnpm run cli -- eval run \
  --prompt "Explain quantum computing" \
  --models "model1,model2,model3" \
  --id "test1"
```

### 2. Generate Reports Immediately

```bash
# Generate report right after evaluation
pnpm run cli -- eval run \
  --prompt "Your prompt" \
  --models "model1,model2" \
  --id "evaluation-id"

pnpm run cli -- eval report --id "evaluation-id" --format markdown
```

### 3. Use Appropriate Formats

```bash
# Documentation: Markdown
pnpm run cli -- eval report --id "evaluation-id" --format markdown

# Presentations: HTML
pnpm run cli -- eval report --id "evaluation-id" --format html

# Data Analysis: JSON/CSV
pnpm run cli -- eval report --id "evaluation-id" --format json

# Quick summaries: Short format
pnpm run cli -- eval report --id "evaluation-id" --short
```

### 4. Organize Reports by Project

```bash
# Create project-specific report directories
mkdir -p reports/quantum-computing

# Generate full reports
pnpm run cli -- eval report \
  --id "quantum-*" \
  --format markdown \
  --output reports/quantum-computing/detailed-analysis.md

# Generate short summaries
pnpm run cli -- eval report \
  --id "quantum-*" \
  --short \
  --output reports/quantum-computing/summary.md
```

### 5. Use Short Reports for Quick Overviews

```bash
# Quick overview of all evaluations
pnpm run cli -- eval list | while read -r id; do
  pnpm run cli -- eval report --id "$id" --short --format markdown
done

# Generate short summaries for presentations
pnpm run cli -- eval report \
  --id "evaluation-id" \
  --short \
  --format html \
  --output presentation-summary.html
```

## Troubleshooting

### Common Issues

1. **"Evaluation not found"**: Check evaluation ID with `pnpm run cli -- eval list`
2. **"No data to report"**: Ensure evaluation completed successfully
3. **"Format not supported"**: Use supported formats (markdown, html, json, csv)
4. **"Output file error"**: Check file permissions and directory existence

### Debugging Report Generation

```bash
# Enable verbose output
pnpm run cli -- eval report \
  --id "evaluation-id" \
  --format markdown \
  --verbose

# Check evaluation status
pnpm run cli -- eval list --id "evaluation-id"
```

## Programmatic Reporting with Reporter

For programmatic report generation in your TypeScript code, use the `Reporter` class:

### Basic Usage

```typescript
import { Reporter } from '../src/reporting/index.js';

// Create a reporter
const reporter = new Reporter({ outputDir: './reports' });

// Create a report from tool test results
const report = reporter.fromToolTest(results, 'Tool Conversation Evaluation');

// Output to console with colors and formatting
reporter.toConsole(report);

// Get markdown string
const markdown = reporter.toMarkdown(report);

// Save to file (auto-generates filename if not provided)
const filepath = await reporter.toFile(report, 'my-report.md', 'md');
```

### Report Types

The Reporter supports multiple result types:

```typescript
// From tool test results
const report = reporter.fromToolTest(toolTestResults, 'Tool Evaluation');

// Output formats
reporter.toConsole(report);                    // Rich terminal output
const md = reporter.toMarkdown(report);        // Markdown string
const json = reporter.toJson(report);          // JSON string
await reporter.toFile(report, 'file.md');      // Save to file
```

### Console Output

The console renderer provides rich terminal output:

- Boxed headers with Unicode borders
- Color-coded status indicators (green ✓ for pass, red ✗ for fail)
- Aligned tables with proper column sizing
- Summary metrics and highlights

### Markdown Output

Markdown reports include:

- YAML frontmatter with metadata
- Summary section with key metrics
- Tables for detailed results
- Collapsible sections for verbose data

### Reporter Options

```typescript
const reporter = new Reporter({
  colors: true,       // Enable ANSI colors for console output
  verbose: false,     // Enable verbose output
  outputDir: './reports'  // Directory for saved reports
});
```

## Suite Reports (eval combine)

When you have multiple evaluations testing different capabilities, combine them into a unified report with `eval combine`.

### The `eval combine` Command

```bash
# Console leaderboard with per-dimension scores
dotenvx run -- pnpm run cli eval combine --config path/to/suite-config.ts

# Structured markdown with detailed breakdowns
dotenvx run -- pnpm run cli eval combine --config path/to/suite-config.ts --format md

# JSON for programmatic use
dotenvx run -- pnpm run cli eval combine --config path/to/suite-config.ts --format json

# Full narrative writeup — standalone article with methodology, analysis, judge explanations
dotenvx run -- pnpm run cli eval combine --config path/to/suite-config.ts --format narrative --output report.md

# Focus on specific models for comparison
dotenvx run -- pnpm run cli eval combine --config path/to/suite-config.ts --format md --focus nemotron qwen
```

### Suite Config Format

The config file defines how to read and normalize scores from each evaluation:

```typescript
import type { EvalDimension } from '../src/evaluation/combine/types.js';

export const MY_SUITE: EvalDimension[] = [
  {
    evalName: 'my-eval-reasoning',    // maps to output/evaluations/{evalName}/
    label: 'Reasoning',               // human-readable name
    maxScore: 20,                     // perfect score
    extractScore: (r) => r.score ?? 0, // how to read a result JSON file
    hasResultsSubdir: true,           // results in {task}/results/ vs {task}/
  },
];
```

### Report Formats

| Format | Description |
|--------|-------------|
| `console` (default) | Colored terminal tables with leaderboard, cost, speed |
| `md` / `markdown` | Structured markdown with tables for each section |
| `json` | Machine-readable JSON |
| `narrative` / `full` | Standalone prose markdown article with methodology, per-dimension analysis, judge explanations, and cost/speed breakdown |

### Narrative Reports

The `narrative` format generates a full writeup suitable for publishing or sharing:

- **Overview** — models tested, providers, total cost
- **Overall Leaderboard** — table with raw scores and combined percentage
- **Key Findings** — best overall, best value, fastest
- **Per-Dimension Sections** — methodology, test descriptions, results matrix, analysis, judge explanations
- **Cost & Speed Analysis** — cost efficiency rankings, speed comparison
- **Provider Comparison** — average scores by inference provider
- **Methodology** — how scores are normalized and combined

### Programmatic Usage

```typescript
import { loadSuite, buildSuiteReport, buildNarrativeReport } from '../src/evaluation/combine/index.js';
import { Reporter } from '../src/reporting/reporter.js';

const result = loadSuite(MY_SUITE);

// Structured report → console/markdown/json
const report = buildSuiteReport(result, { title: 'My Results', focusModels: ['qwen'] });
new Reporter().toConsole(report);

// Narrative report → standalone markdown
const markdown = buildNarrativeReport(result, { title: 'Full Analysis' });
```

For a complete example, see the [Model Showdown walkthrough](/walkthroughs/model-showdown).

## Pairwise Ranking Reports

If you've used the `PairwiseRanker` to rank model responses, ranking results are saved to `rankings.json` in the cache directory. These include Elo ratings, win/loss/tie records, and individual match results.

The Rivian example (`examples/mcp-chat/elo-rivian.ts`) also writes `elo-data.json` to the run's `report/` directory for integration with HTML reports.

```json
{
  "mode": "swiss-5",
  "comparisons": 30,
  "judge": "openrouter:anthropic/claude-haiku-4.5",
  "rankings": [
    { "model": "gpt-4o", "elo": 1580, "wins": 4, "losses": 1, "ties": 0 }
  ]
}
```

For details on running pairwise rankings, see the [Pairwise Ranking Guide](/guide/pairwise-ranking).

## Next Steps

Now that you understand reporting, explore:

- 💰 [Cost Analysis](/guide/cost-analysis) - Deep dive into cost optimization
- 🔄 [Concurrent Processing](/guide/concurrent-processing) - Generate reports from concurrent evaluations
- 📈 [Batch Processing](/guide/batch-processing) - Create reports from large-scale operations
- 🔧 [Memory & Tools](/guide/memory-tools) - Integrate reports with memory and tools
- ⚔️ [Pairwise Ranking](/guide/pairwise-ranking) - Head-to-head Elo ranking via LLM judge
