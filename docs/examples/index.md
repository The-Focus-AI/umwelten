# Examples Overview

This section provides comprehensive examples showing how to use Umwelten for various AI model evaluation tasks. Many of these examples correspond to scripts that have been migrated from the `scripts/` directory to CLI commands.

## 🆕 New Interaction + Interface Pattern

The modern way to use Umwelten with pre-configured interactions and clean interfaces:

- **[Interaction + Interface Examples](/examples/interaction-interface-examples)** - Comprehensive examples of the new pattern
- **[Chat with Tools](/examples/interaction-interface-examples#chat-with-tools)** - Interactive chat with weather, calculator, file analysis
- **[Web Integration](/examples/interaction-interface-examples#web-integration)** - React, Vue.js, and Next.js examples
- **[Agent Workflows](/examples/interaction-interface-examples#agent-examples)** - Autonomous agents with triggers and events

## Basic Examples

Perfect for getting started with Umwelten:

- **[Simple Text Generation](/examples/text-generation)** - Basic prompt evaluation across models
- **[Creative Writing](/examples/creative-writing)** - Poetry and story generation with temperature control  
- **[Analysis & Reasoning](/examples/analysis-reasoning)** - Complex reasoning tasks and literary analysis
- **[Tool Integration](/examples/tool-integration)** - Using and creating tools to enhance AI capabilities

## Image Processing Examples

Working with visual content and structured data extraction:

- **[Basic Image Analysis](/examples/image-analysis)** - Simple image description and analysis
- **[Structured Image Features](/examples/image-features)** - Extract structured data with confidence scores
- **[Batch Image Processing](/examples/image-batch)** - Process multiple images concurrently

## Document Processing

Handle various document formats:

- **[PDF Analysis](/examples/pdf-analysis)** - Test native PDF parsing capabilities
- **[Multi-format Documents](/examples/multi-format)** - Work with different document types

## Advanced Workflows

Complex evaluation patterns and optimization:

- **[Multi-language Evaluation](/examples/multi-language)** - Code generation across programming languages
- **[Complex Structured Output](/examples/complex-structured)** - Advanced schema validation with nested objects
- **[Cost Optimization](/examples/cost-optimization)** - Compare model costs and performance

## Migration Reference

These examples show CLI equivalents for scripts that have been migrated:

| Script | Example | Status |
|--------|---------|--------|
| `cat-poem.ts` | [Creative Writing](/examples/creative-writing) | ✅ Complete |
| `temperature.ts` | [Creative Writing](/examples/creative-writing) | ✅ Complete |
| `frankenstein.ts` | [Analysis & Reasoning](/examples/analysis-reasoning) | ✅ Complete |
| `google-pricing.ts` | [Cost Optimization](/examples/cost-optimization) | ✅ Complete |
| `image-parsing.ts` | [Basic Image Analysis](/examples/image-analysis) | ✅ Complete |
| `image-feature-extract.ts` | [Structured Image Features](/examples/image-features) | ✅ Complete |
| `image-feature-batch.ts` | [Batch Image Processing](/examples/image-batch) | ✅ Complete |
| `pdf-identify.ts` | [PDF Analysis](/examples/pdf-analysis) | ✅ Complete |
| `pdf-parsing.ts` | [PDF Analysis](/examples/pdf-analysis) | ✅ Complete |
| `roadtrip.ts` | [Complex Structured Output](/examples/complex-structured) | 🔄 Partial |
| `multi-language-evaluation.ts` | [Multi-language Evaluation](/examples/multi-language) | 🔄 Needs Pipeline |

## Quick Examples

### 🆕 New Pattern Examples

```bash
# Interactive chat with tools
pnpm tsx src/cli/cli.ts chat-new -p ollama -m llama3.2:latest

# Tools demonstration
pnpm tsx scripts/tools.ts -p ollama -m llama3.2:latest --prompt "What's the weather in New York?"

# Programmatic usage
pnpm tsx scripts/new-pattern-example.ts
```

### Traditional CLI Examples

Here are some quick examples to get you started:

### Basic Evaluation
```bash
umwelten eval run \
  --prompt "Explain quantum computing in simple terms" \
  --models "ollama:gemma3:12b,google:gemini-2.0-flash" \
  --id "quantum-explanation"
```

### With Structured Output
```bash
umwelten eval run \
  --prompt "Extract person info: John is 25 and works as a developer" \
  --models "google:gemini-2.0-flash" \
  --id "person-extraction" \
  --schema "name, age int, job"
```

### Batch Processing
```bash
umwelten eval batch \
  --prompt "Analyze this image and describe key features" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "image-batch" \
  --directory "input/images" \
  --file-pattern "*.jpg" \
  --concurrent
```

### Generate Reports
```bash
# Markdown report
umwelten eval report --id quantum-explanation --format markdown

# HTML report with export
umwelten eval report --id image-batch --format html --output report.html
```

## Common Patterns

### Temperature Testing
Compare model outputs at different creativity levels:
```bash
# High creativity
umwelten eval run --prompt "Write a creative story" --models "ollama:gemma3:12b" --temperature 1.5 --id "creative-high"

# Low creativity  
umwelten eval run --prompt "Write a creative story" --models "ollama:gemma3:12b" --temperature 0.2 --id "creative-low"
```

### Cost Comparison
Evaluate cost vs. quality trade-offs:
```bash
umwelten eval run \
  --prompt "Write a detailed analysis of renewable energy trends" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini,openrouter:openai/gpt-4o" \
  --id "cost-comparison" \
  --concurrent
```

### Multi-modal Evaluation
Test vision capabilities across models:
```bash
umwelten eval run \
  --prompt "Describe this image in detail and identify any text" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "vision-test" \
  --attach "./test-image.jpg"
```

## Next Steps

- Browse specific examples for your use case
- Check the [Migration Guide](/migration/) to see how scripts were converted
- Review [Advanced Features](/guide/advanced) for complex workflows