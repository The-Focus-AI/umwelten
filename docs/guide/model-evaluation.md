# Model Evaluation

Learn how to systematically evaluate and compare AI models using Umwelten's comprehensive evaluation system.

## Overview

Model evaluation is at the heart of Umwelten's functionality. The `eval` command family provides systematic testing across multiple models with comprehensive reporting, cost analysis, and resume capability.

## Basic Evaluation

### Simple Model Comparison

```bash
umwelten eval run \
  --prompt "Explain machine learning in simple terms" \
  --models "ollama:gemma3:12b,google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini" \
  --id "ml-explanation" \
  --concurrent
```

### With System Context

```bash
umwelten eval run \
  --prompt "Explain quantum computing applications" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o" \
  --id "quantum-apps" \
  --system "You are a physics professor explaining to undergraduate students" \
  --temperature 0.3
```

## Advanced Features

### Interactive UI Mode

Watch evaluations in real-time:

```bash
umwelten eval run \
  --prompt "Write a creative story about AI" \
  --models "ollama:gemma3:12b,google:gemini-2.0-flash" \
  --id "ai-story" \
  --ui \
  --concurrent
```

### File Attachments

Test multimodal capabilities:

```bash
umwelten eval run \
  --prompt "Analyze this document and extract key insights" \
  --models "google:gemini-2.0-flash,google:gemini-2.5-pro-exp-03-25" \
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
umwelten eval report --id ml-explanation

# HTML report with rich formatting
umwelten eval report --id quantum-apps --format html --output report.html

# CSV export for analysis
umwelten eval report --id ai-story --format csv --output results.csv

# JSON for programmatic use
umwelten eval report --id document-analysis --format json
```

### List Evaluations

```bash
# List all evaluations
umwelten eval list

# Show detailed information
umwelten eval list --details

# JSON format for scripting
umwelten eval list --json
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

## Examples

For comprehensive examples, see:
- [Text Generation](/examples/text-generation) - Basic model comparison
- [Creative Writing](/examples/creative-writing) - Temperature and creativity testing
- [Analysis & Reasoning](/examples/analysis-reasoning) - Complex reasoning tasks
- [Cost Optimization](/examples/cost-optimization) - Budget-conscious evaluation

## Next Steps

- Try [batch processing](/guide/batch-processing) for multiple files
- Explore [structured output](/guide/structured-output) for data extraction
- Learn [cost analysis](/guide/cost-analysis) for budget optimization