# Model Discovery

Umwelten provides comprehensive model discovery features to help you find and compare models across all supported providers (Google, Ollama, OpenRouter, LM Studio, GitHub Models).

## Listing Models

### Basic Model List

```bash
# List all available models
dotenvx run -- pnpm run cli -- models 

# List with JSON output for programmatic use
dotenvx run -- pnpm run cli -- models  --json

# Use dotenvx to load environment variables from .env
dotenvx run -- dotenvx run -- pnpm run cli -- models
```

### Filter by Provider

```bash
# Filter by specific provider
# Use dotenvx to ensure API keys are loaded from .env
dotenvx run -- dotenvx run -- pnpm run cli -- models --provider openrouter      # requires OPENROUTER_API_KEY
dotenvx run -- pnpm run cli -- models  --provider ollama
dotenvx run -- dotenvx run -- pnpm run cli -- models  --provider google         # GOOGLE_GENERATIVE_AI_API_KEY
dotenvx run -- pnpm run cli -- models  --provider lmstudio
dotenvx run -- dotenvx run -- pnpm run cli -- models  --provider github-models  # GITHUB_TOKEN

# Or using pnpm cli (for local development)
dotenvx run -- pnpm run cli models --provider github-models
```

### Filter by Cost

```bash
# Show only free models
dotenvx run -- pnpm run cli -- models --free

# Sort by cost (ascending by default)
dotenvx run -- pnpm run cli -- models --sort cost
```

### Search Models

```bash
# Search for specific models
dotenvx run -- pnpm run cli -- models --search "gpt-4"
dotenvx run -- pnpm run cli -- models --search "gemini"
dotenvx run -- pnpm run cli -- models --search "llama"
```

### Sorting Options

```bash
# Sort by different fields
dotenvx run -- pnpm run cli -- models --sort addedDate --desc
dotenvx run -- pnpm run cli -- models --sort contextLength
dotenvx run -- pnpm run cli -- models --sort cost
dotenvx run -- pnpm run cli -- models --sort name
```

## Model Information

### Detailed Model Info

Get comprehensive information about a specific model:

```bash
# Basic model info (finds first match across all providers)
dotenvx run -- pnpm run cli -- models --view info --id <model-id>

# Examples
dotenvx run -- pnpm run cli -- models --view info --id openai/gpt-4o
dotenvx run -- pnpm run cli -- models --view info --id gemini-3-flash-preview
dotenvx run -- pnpm run cli -- models --view info --id gemma3:12b

# Get info for a specific provider's version of a model
dotenvx run -- pnpm run cli -- models --provider github-models --view info --id openai/gpt-4.1
dotenvx run -- pnpm run cli -- models --provider openrouter --view info --id openai/gpt-4o
dotenvx run -- pnpm run cli -- models --provider google --view info --id gemini-3-flash-preview
```

### Cost Analysis

View cost breakdown across all models:

```bash
# View all model costs
dotenvx run -- pnpm run cli -- models costs

# Sort by different cost metrics
dotenvx run -- pnpm run cli -- models costs --sort-by prompt
dotenvx run -- pnpm run cli -- models costs --sort-by completion
dotenvx run -- pnpm run cli -- models costs --sort-by total
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
│ gemini-3-flash-preview  │ google     │ 1M      │ $0.0750       │ $0.3000        │ 12/11/24│
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
- Models are fetched from `https://models.github.ai/catalog/models`
- Use `dotenvx run` to load `GITHUB_TOKEN` from `.env`:
  ```bash
  dotenvx run -- dotenvx run -- pnpm run cli -- models --provider github-models
  ```

**Note**: GitHub Models API (`models.github.ai`) is different from **GitHub Copilot** (the IDE tool). 
- GitHub Copilot has access to Anthropic/Claude models (see [GitHub Copilot supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models))
- GitHub Models API currently does **not** include Anthropic models - it only includes models from OpenAI, Meta, DeepSeek, AI21 Labs, Cohere, Mistral AI, xAI, and Microsoft
- To access Anthropic models, use the OpenRouter provider instead

## Next Steps

Once you've discovered suitable models:

- [Run basic prompts](/guide/running-prompts) to test functionality
- [Start interactive chat](/guide/interactive-chat) for extended conversations
- [Start model evaluation](/guide/model-evaluation) for systematic comparison
- [Use cost analysis](/guide/cost-analysis) to optimize spending
