# Configuration

Configure Umwelten for optimal performance with API keys, environment variables, and custom settings. Learn how to set up authentication, customize behavior, and manage different environments.

## Quick Setup

### API Key Configuration

Set up authentication for your preferred AI providers:

```bash
# Google Gemini (required for Google models)
export GOOGLE_GENERATIVE_AI_API_KEY="your-google-api-key"

# OpenRouter (required for OpenRouter models)
export OPENROUTER_API_KEY="your-openrouter-api-key"

# Ollama (optional, defaults to localhost)
export OLLAMA_HOST="http://localhost:11434"

# LM Studio (optional, defaults to localhost)
export LMSTUDIO_BASE_URL="http://localhost:1234"
```

### Using .env Files

Create a `.env` file in your project directory:

```bash
# .env
GOOGLE_GENERATIVE_AI_API_KEY=your-google-api-key
OPENROUTER_API_KEY=your-openrouter-api-key
OLLAMA_HOST=http://localhost:11434
LMSTUDIO_BASE_URL=http://localhost:1234
```

Umwelten automatically loads `.env` files from:
1. Current working directory
2. User home directory (`~/.umwelten/.env`)

## Provider Configuration

### Google Gemini

Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey):

```bash
export GOOGLE_GENERATIVE_AI_API_KEY="AIza..."
```

**Available Models**:
- `gemini-2.0-flash` - Fast and cost-effective
- `gemini-2.5-pro-exp-03-25` - Highest quality reasoning
- `gemini-1.5-flash-8b` - Ultra-fast for simple tasks

**Configuration Example**:
```bash
npx umwelten run \
  --provider google \
  --model gemini-2.0-flash \
  --temperature 0.7 \
  "Your prompt here"
```

### Ollama (Local)

Install and configure Ollama for local model execution:

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Start Ollama service
ollama serve

# Pull models
ollama pull gemma3:12b
ollama pull gemma3:27b
ollama pull qwen2.5vl:latest  # Vision model
ollama pull codestral:latest  # Code model
```

**Configuration**:
```bash
# Default configuration (localhost:11434)
npx umwelten run \
  --provider ollama \
  --model gemma3:12b \
  "Your prompt here"

# Custom Ollama server
export OLLAMA_HOST="http://your-ollama-server:11434"
```

### OpenRouter

Get your API key from [OpenRouter](https://openrouter.ai/keys):

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

**Popular Models**:
- `openai/gpt-4o` - Highest quality (premium)
- `openai/gpt-4o-mini` - Balanced cost/quality
- `anthropic/claude-3.7-sonnet:thinking` - Excellent analysis

### LM Studio

Configure LM Studio for local model hosting:

1. Download and install [LM Studio](https://lmstudio.ai/)
2. Load a model through the GUI
3. Start the local server in LM Studio
4. Configure Umwelten to use the server

```bash
# Default configuration (localhost:1234)
export LMSTUDIO_BASE_URL="http://localhost:1234"

npx umwelten run \
  --provider lmstudio \
  --model your-loaded-model \
  "Your prompt here"
```

## Advanced Configuration

### Configuration Files

Create persistent configuration files for repeated settings:

**Global Config**: `~/.umwelten/config.json`
```json
{
  "defaultProvider": "google",
  "defaultModel": "gemini-2.0-flash",
  "defaultTemperature": 0.7,
  "defaultTimeout": 30000,
  "outputDirectory": "~/umwelten-results",
  "maxConcurrency": 5
}
```

**Project Config**: `./umwelten.config.json`
```json
{
  "models": [
    "google:gemini-2.0-flash",
    "ollama:gemma3:12b"
  ],
  "defaultSchema": "title, summary, key_points array",
  "batchSettings": {
    "maxConcurrency": 3,
    "timeout": 45000,
    "resume": true
  }
}
```

### Environment-Specific Configuration

#### Development Environment

```bash
# .env.development
GOOGLE_GENERATIVE_AI_API_KEY=your-dev-key
DEFAULT_MODELS="ollama:gemma3:12b"  # Use free local models
DEFAULT_TIMEOUT=30000
MAX_CONCURRENCY=2
```

#### Production Environment

```bash
# .env.production
GOOGLE_GENERATIVE_AI_API_KEY=your-prod-key
OPENROUTER_API_KEY=your-prod-openrouter-key
DEFAULT_MODELS="google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini"
DEFAULT_TIMEOUT=60000
MAX_CONCURRENCY=8
```

### Performance Settings

#### Timeout Configuration

Set appropriate timeouts based on task complexity:

```bash
# Simple tasks (30 seconds default)
npx umwelten run --timeout 30000 "Simple question"

# Complex analysis (2 minutes)
npx umwelten eval run --timeout 120000 --prompt "Complex analysis task"

# Large file processing (5 minutes)
npx umwelten eval run --timeout 300000 --file large-document.pdf "Analyze document"
```

#### Concurrency Settings

Optimize concurrent processing based on your resources:

```bash
# Conservative (good for API rate limits)
npx umwelten eval batch --max-concurrency 2

# Balanced (default for most use cases)
npx umwelten eval batch --max-concurrency 5

# Aggressive (high-performance systems)
npx umwelten eval batch --max-concurrency 10
```

## Output Configuration

### Default Output Directory

Configure where evaluations are stored:

```bash
# Environment variable
export UMWELTEN_OUTPUT_DIR="/path/to/output"

# Command line override
npx umwelten eval run --output-dir "./custom-output" "Your prompt"
```

### Output Format Preferences

Set default output formats:

```bash
# JSON (default)
npx umwelten eval report --id evaluation-name

# HTML with styling
npx umwelten eval report --id evaluation-name --format html

# CSV for analysis
npx umwelten eval report --id evaluation-name --format csv

# Markdown for documentation
npx umwelten eval report --id evaluation-name --format markdown
```

## Security Configuration

### API Key Security

Protect your API keys:

```bash
# Good: Environment variables
export GOOGLE_GENERATIVE_AI_API_KEY="your-key"

# Good: .env files (not committed to git)
echo "*.env" >> .gitignore

# Bad: Direct command line (visible in history)
npx umwelten run --api-key "your-key" "prompt"  # DON'T DO THIS
```

### Local vs Remote Execution

Configure based on data sensitivity:

```bash
# Sensitive data: Use local models only
export DEFAULT_PROVIDER="ollama"
npx umwelten eval run --models "ollama:gemma3:12b" "Sensitive analysis"

# Public data: Use any provider
npx umwelten eval run --models "google:gemini-2.0-flash" "Public analysis"
```

## Troubleshooting Configuration

### Verify Configuration

Check your current configuration:

```bash
# Test API connectivity
npx umwelten models list --provider google
npx umwelten models list --provider ollama
npx umwelten models list --provider openrouter

# Test basic functionality
npx umwelten run --provider google --model gemini-2.0-flash "Hello, world!"
```

### Common Configuration Issues

#### API Key Problems

```bash
# Check if API key is set
echo $GOOGLE_GENERATIVE_AI_API_KEY

# Test API key validity
npx umwelten run --provider google --model gemini-2.0-flash "Test"
```

#### Network Issues

```bash
# Test Ollama connectivity
curl http://localhost:11434/api/version

# Test LM Studio connectivity
curl http://localhost:1234/v1/models
```

#### Permission Issues

```bash
# Check output directory permissions
ls -la ~/umwelten-output

# Create output directory with correct permissions
mkdir -p ~/umwelten-output
chmod 755 ~/umwelten-output
```

## Advanced Use Cases

### Multi-Environment Setup

```bash
# config/development.env
GOOGLE_GENERATIVE_AI_API_KEY=dev-key
DEFAULT_MODELS="ollama:gemma3:12b"
MAX_CONCURRENCY=2

# config/staging.env
GOOGLE_GENERATIVE_AI_API_KEY=staging-key
DEFAULT_MODELS="google:gemini-2.0-flash"
MAX_CONCURRENCY=4

# config/production.env
GOOGLE_GENERATIVE_AI_API_KEY=prod-key
OPENROUTER_API_KEY=prod-openrouter-key
DEFAULT_MODELS="google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini"
MAX_CONCURRENCY=8

# Load specific environment
source config/production.env
npx umwelten eval batch --directory ./data
```

### Team Configuration

```bash
# shared-config.json
{
  "team": {
    "models": [
      "google:gemini-2.0-flash",
      "ollama:gemma3:12b"
    ],
    "defaultSchema": "analysis, confidence number, key_points array",
    "batchDefaults": {
      "maxConcurrency": 3,
      "timeout": 60000,
      "resume": true
    }
  }
}

# Use shared configuration
npx umwelten eval batch \
  --config shared-config.json \
  --directory ./team-data
```

### CI/CD Configuration

```yaml
# .github/workflows/evaluation.yml
env:
  GOOGLE_GENERATIVE_AI_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
  OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
  UMWELTEN_OUTPUT_DIR: "./ci-results"

steps:
  - name: Run Evaluation
    run: |
      npx umwelten eval batch \
        --models "google:gemini-2.0-flash" \
        --directory "./test-data" \
        --max-concurrency 2 \
        --timeout 90000
```

## Best Practices

### Security
- Never commit API keys to version control
- Use environment variables or secure .env files
- Rotate API keys regularly
- Use local models for sensitive data

### Performance
- Start with conservative concurrency settings
- Increase timeout for complex tasks
- Monitor API rate limits and costs
- Use appropriate models for task complexity

### Organization
- Use consistent evaluation IDs
- Organize output directories by project
- Document configuration choices
- Share configuration templates with team

## Next Steps

- See [Basic Usage](/guide/basic-usage) for hands-on configuration examples
- Check [Model Discovery](/guide/model-discovery) for provider-specific setup
- Review [Troubleshooting](/guide/troubleshooting) for configuration issues
- Visit [Cost Analysis](/guide/cost-analysis) for optimizing API usage