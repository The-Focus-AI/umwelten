# Model Discovery

Umwelten provides comprehensive model discovery features to help you find and compare models across all supported providers (Google, Ollama, OpenRouter, LM Studio, GitHub Models).

## Listing Models

### Basic Model List

```bash
# List all available models
npx umwelten models 

# List with JSON output for programmatic use
npx umwelten models  --json
```

### Filter by Provider

```bash
# Filter by specific provider
npx umwelten models --provider openrouter      # requires OPENROUTER_API_KEY
npx umwelten models  --provider ollama
npx umwelten models  --provider google         # GOOGLE_GENERATIVE_AI_API_KEY
npx umwelten models  --provider lmstudio
npx umwelten models  --provider github-models  # GITHUB_TOKEN
```

### Filter by Cost

```bash
# Show only free models
npx umwelten models --free

# Sort by cost (ascending by default)
npx umwelten models --sort cost
```

### Search Models

```bash
# Search for specific models
npx umwelten models --search "gpt-4"
npx umwelten models --search "gemini"
npx umwelten models --search "llama"
```

### Sorting Options

```bash
# Sort by different fields
npx umwelten models --sort addedDate --desc
npx umwelten models --sort contextLength
npx umwelten models --sort cost
npx umwelten models --sort name
```

## Model Information

### Detailed Model Info

Get comprehensive information about a specific model:

```bash
# Basic model info (finds first match across all providers)
npx umwelten models --view info --id <model-id>

# Examples
npx umwelten models --view info --id openai/gpt-4o
npx umwelten models --view info --id gemini-2.0-flash
npx umwelten models --view info --id gemma3:12b

# Get info for a specific provider's version of a model
npx umwelten models --provider github-models --view info --id openai/gpt-4.1
npx umwelten models --provider openrouter --view info --id openai/gpt-4o
npx umwelten models --provider google --view info --id gemini-2.0-flash
```

### Cost Analysis

View cost breakdown across all models:

```bash
# View all model costs
npx umwelten models costs

# Sort by different cost metrics
npx umwelten models costs --sort-by prompt
npx umwelten models costs --sort-by completion
npx umwelten models costs --sort-by total
```

The costs command shows:
- **Model**: Model identifier
- **Provider**: Which service hosts the model (ollama, openrouter, google, github-models, lmstudio)
- **Prompt**: Cost per 1M input tokens
- **Completion**: Cost per 1M output tokens  
- **Total**: Combined cost per 1M tokens

Models are sorted by the specified metric (default: total cost).

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
- [Start interactive chat](/guide/interactive-chat) for extended conversations
- [Start model evaluation](/guide/model-evaluation) for systematic comparison
- [Use cost analysis](/guide/cost-analysis) to optimize spending
