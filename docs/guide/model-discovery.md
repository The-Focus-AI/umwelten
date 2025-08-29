# Model Discovery

Umwelten provides comprehensive model discovery features to help you find and compare models across all supported providers (Google, Ollama, OpenRouter, LM Studio, GitHub Models).

## Listing Models

### Basic Model List

```bash
# List all available models
umwelten models list

# List with JSON output for programmatic use
umwelten models list --json
```

### Filter by Provider

```bash
# Filter by specific provider
umwelten models list --provider openrouter
umwelten models list --provider ollama
umwelten models list --provider google
umwelten models list --provider lmstudio
umwelten models list --provider github-models
```

### Filter by Cost

```bash
# Show only free models
umwelten models list --free

# Sort by cost (ascending by default)
umwelten models list --sort cost
```

### Search Models

```bash
# Search for specific models
umwelten models list --search "gpt-4"
umwelten models list --search "gemini"
umwelten models list --search "llama"
```

### Sorting Options

```bash
# Sort by different fields
umwelten models list --sort addedDate --desc
umwelten models list --sort contextLength
umwelten models list --sort cost
umwelten models list --sort name
```

## Model Information

### Detailed Model Info

Get comprehensive information about a specific model:

```bash
umwelten models info <model-id>

# Examples
umwelten models info openai/gpt-4o
umwelten models info gemini-2.0-flash
umwelten models info gemma3:12b
```

### Cost Analysis

View cost breakdown across all models:

```bash
# View all model costs
umwelten models costs

# Sort by different cost metrics
umwelten models costs --sort-by prompt
umwelten models costs --sort-by completion
umwelten models costs --sort-by total
```

## Understanding the Output

### Model List Table

```
Found 150+ models

┌───────────────────┬────────────┬─────────┬───────────────┬────────────────┬────────┐
│ ID                │ Provider   │ Context │ Input Cost/1M │ Output Cost/1M │ Added  │
├───────────────────┼────────────┼─────────┼───────────────┼────────────────┼────────┤
│ openai/gpt-4o     │ openrouter │ 128K    │ $2.5000       │ $10.0000       │ 5/12/24│
│ openai/gpt-4o-mini│ openrouter │ 128K    │ $0.1500       │ $0.6000        │ 7/17/24│
│ gemini-2.0-flash  │ google     │ 1M      │ $0.0750       │ $0.3000        │ 12/11/24│
│ gemma3:12b        │ ollama     │ 8K      │ Free          │ Free           │ 7/15/25│
└───────────────────┴────────────┴─────────┴───────────────┴────────────────┴────────┘
```

### Key Information

- **ID**: Model identifier used in commands
- **Provider**: Which service hosts the model
- **Context**: Maximum context window (8K, 128K, 1M, etc.)
- **Input/Output Cost**: Cost per 1 million tokens
- **Added**: When the model was added to our database

## Model Selection Tips

### For Development & Testing
- **Free models**: Ollama models (gemma3:12b, llama3.2:latest)
- **Fast & cheap**: Google Gemini 2.0 Flash, OpenAI GPT-4o-mini

### For Production
- **High quality**: OpenAI GPT-4o, Google Gemini 2.5 Pro
- **Cost-effective**: Google Gemini 2.0 Flash, OpenAI GPT-4o-mini

### For Specialized Tasks
- **Vision**: Google Gemini 2.0 Flash, Ollama qwen2.5vl:latest
- **Code**: Ollama codestral:latest, OpenAI GPT-4o
- **Long context**: Google Gemini models (up to 2M tokens)

## Provider-Specific Notes

### Ollama
- Requires local Ollama server running
- Models must be pulled locally first: `ollama pull model-name`
- Free to use (only compute costs)
- Best for privacy and local development

### Google Gemini
- Excellent vision capabilities
- Very large context windows (up to 2M tokens)
- Competitive pricing
- Fast inference

### OpenRouter
- Access to many different model providers
- Pay-per-use pricing
- Wide variety of models and capabilities
- Good for testing different providers

### LM Studio
- Local model hosting
- No API key required
- Models must be downloaded and loaded in LM Studio
- Full privacy and control

### GitHub Models
- Free access during preview period
- Requires GitHub Personal Access Token with `models` scope
- Access to models from OpenAI, Meta, DeepSeek, and other providers
- OpenAI-compatible API interface

## Next Steps

Once you've discovered suitable models:

- [Run basic prompts](/guide/running-prompts) to test functionality
- [Start model evaluation](/guide/model-evaluation) for systematic comparison
- [Use cost analysis](/guide/cost-analysis) to optimize spending