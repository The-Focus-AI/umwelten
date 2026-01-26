# Basic Usage

Learn the fundamental commands and workflows for using Umwelten effectively. This guide covers the essential operations you'll use most frequently.

## Quick Start

### 1. Check Your Installation

Verify Umwelten is working correctly:

```bash
# Check version
npx umwelten --version

# See all available commands
npx umwelten --help
```

### 2. List Available Models

Discover what models you can use:

```bash
# List all models across all providers
npx umwelten models

# List models from a specific provider
npx umwelten models --provider google

# Get detailed information about a specific model
npx umwelten models --view info --id "google:gemini-2.0-flash"
```

### 3. Run Your First Prompt

Execute a simple prompt with any model:

```bash
# Basic text generation
npx umwelten run --provider ollama --model gemma3:12b "Explain quantum computing in simple terms"

# With a specific model
npx umwelten run --provider google --model gemini-2.0-flash "Write a short story about a robot learning to paint"
```

## Core Commands

### The `run` Command

The `run` command is your primary tool for executing single prompts:

```bash
npx umwelten run [options] "your prompt here"
```

**Common Options**:
- `--provider`: Specify the AI provider (google, ollama, openrouter, lmstudio)
- `--model`: Choose the specific model to use
- `--temperature`: Control creativity (0.0-2.0, default 0.7)
- `--system`: Set the AI's role or behavior
- `--attach`: Include file attachments (images, documents)

**Examples**:
```bash
# Simple text generation
npx umwelten run --provider ollama --model gemma3:12b "What is machine learning?"

# Creative writing with temperature control
npx umwelten run \
  --provider google \
  --model gemini-2.0-flash \
  --temperature 0.9 \
  --system "You are a creative writer" \
  "Write a poem about artificial intelligence"

# Image analysis
npx umwelten run \
  --provider google \
  --model gemini-2.0-flash \
  --attach ./photo.jpg \
  "Describe what you see in this image"
```

### The `chat` Command

Start an interactive conversation:

```bash
# Basic chat session
npx umwelten chat --provider ollama --model gemma3:12b

# Chat with memory enabled
npx umwelten chat --provider google --model gemini-2.0-flash --memory

# Chat with tools
npx umwelten chat --provider ollama --model qwen3:latest --tools calculator,statistics
```

### The `eval` Command

Run systematic evaluations across multiple models:

```bash
# Basic evaluation
npx umwelten eval run \
  --prompt "Explain the concept of recursion" \
  --models "ollama:gemma3:12b,google:gemini-2.0-flash" \
  --id "recursion-explanation"

# Evaluation with structured output
npx umwelten eval run \
  --prompt "Extract person info: John is 25 and works as a developer" \
  --models "google:gemini-2.0-flash" \
  --id "person-extraction" \
  --schema "name, age int, job"
```

## Common Workflows

### 1. Model Comparison

Compare how different models handle the same task:

```bash
# Compare multiple models on a single prompt
npx umwelten eval run \
  --prompt "Write a function to calculate fibonacci numbers" \
  --models "ollama:gemma3:12b,ollama:codestral:latest,google:gemini-2.0-flash" \
  --id "fibonacci-comparison"

# Generate comparison report
npx umwelten eval report --id fibonacci-comparison --format markdown
```

### 2. Temperature Testing

Test how temperature affects output quality:

```bash
# Low temperature (focused, deterministic)
npx umwelten run \
  --provider google \
  --model gemini-2.0-flash \
  --temperature 0.1 \
  "Write technical documentation for a REST API"

# High temperature (creative, varied)
npx umwelten run \
  --provider google \
  --model gemini-2.0-flash \
  --temperature 0.9 \
  "Write a creative story about time travel"
```

### 3. File Processing

Work with different file types:

```bash
# Image analysis
npx umwelten run \
  --provider google \
  --model gemini-2.0-flash \
  --attach ./image.jpg \
  "Analyze this image and describe the key elements"

# PDF analysis
npx umwelten run \
  --provider google \
  --model gemini-2.0-flash \
  --attach ./document.pdf \
  "Summarize the main points of this document"

# Batch processing
npx umwelten eval batch \
  --prompt "Analyze this image and extract key features" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "image-batch" \
  --directory "input/images" \
  --file-pattern "*.jpg" \
  --concurrent
```

### 4. Structured Data Extraction

Extract structured information from text:

```bash
# Simple schema
npx umwelten eval run \
  --prompt "Extract person info: Alice is 30 and works as a designer" \
  --models "google:gemini-2.0-flash" \
  --id "person-extraction" \
  --schema "name, age int, job"

# Complex schema with nested objects
npx umwelten eval run \
  --prompt "Extract book info: 'The Great Gatsby' by F. Scott Fitzgerald, published in 1925, genre: classic fiction" \
  --models "google:gemini-2.0-flash" \
  --id "book-extraction" \
  --schema "title, author, year int, genre"
```

## Provider-Specific Examples

### Google Models

```bash
# Fast and cost-effective
npx umwelten run --provider google --model gemini-2.0-flash "Quick analysis task"

# Highest quality reasoning
npx umwelten run --provider google --model gemini-2.5-pro-exp-03-25 "Complex reasoning task"

# Vision capabilities
npx umwelten run \
  --provider google \
  --model gemini-2.0-flash \
  --attach ./image.jpg \
  "Describe this image in detail"
```

### Ollama Models (Local)

```bash
# General purpose
npx umwelten run --provider ollama --model gemma3:12b "General task"

# Code generation
npx umwelten run --provider ollama --model codestral:latest "Write Python code for sorting"

# Vision model
npx umwelten run \
  --provider ollama \
  --model qwen2.5vl:latest \
  --attach ./image.jpg \
  "Analyze this image"
```

### OpenRouter Models

```bash
# GPT-4o (premium quality)
npx umwelten run --provider openrouter --model openai/gpt-4o "High-quality analysis"

# Claude 3.7 Sonnet
npx umwelten run --provider openrouter --model anthropic/claude-3.7-sonnet "Detailed reasoning task"
```

## Best Practices

### 1. Start Simple

Begin with basic commands and gradually add complexity:

```bash
# Start with simple text generation
npx umwelten run --provider ollama --model gemma3:12b "Hello, world!"

# Add temperature control
npx umwelten run --provider ollama --model gemma3:12b --temperature 0.5 "Hello, world!"

# Add system prompt
npx umwelten run \
  --provider ollama \
  --model gemma3:12b \
  --temperature 0.5 \
  --system "You are a helpful assistant" \
  "Hello, world!"
```

### 2. Use Meaningful IDs

When running evaluations, use descriptive IDs for easy reference:

```bash
# Good: Descriptive ID
npx umwelten eval run \
  --prompt "Explain quantum computing" \
  --models "ollama:gemma3:12b,google:gemini-2.0-flash" \
  --id "quantum-explanation-comparison"

# Bad: Generic ID
npx umwelten eval run \
  --prompt "Explain quantum computing" \
  --models "ollama:gemma3:12b,google:gemini-2.0-flash" \
  --id "test1"
```

### 3. Leverage Concurrent Processing

Use concurrent processing for faster batch operations:

```bash
# Process multiple files concurrently
npx umwelten eval batch \
  --prompt "Analyze this image" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "image-analysis" \
  --directory "input/images" \
  --file-pattern "*.jpg" \
  --concurrent \
  --max-concurrency 5
```

### 4. Monitor Costs

Keep track of your usage costs:

```bash
# Check model costs
npx umwelten models costs --sort prompt

# Run with cost tracking
npx umwelten run --provider openrouter --model openai/gpt-4o "Your prompt" --verbose
```

## Troubleshooting

### Common Issues

1. **"Model not found"**: Check available models with `npx umwelten models --provider <provider>`
2. **"API key required"**: Set your environment variables or use `.env` file
3. **"Connection failed"**: Verify your network connection and API endpoints
4. **"File not found"**: Ensure file paths are correct and files exist

### Getting Help

```bash
# Command-specific help
npx umwelten run --help
npx umwelten chat --help
npx umwelten eval --help

# Provider-specific help
npx umwelten models --help
```

## Next Steps

Now that you understand the basics, explore:

- 🔍 [Model Discovery](/guide/model-discovery) - Find the right models for your tasks
- 💬 [Interactive Chat](/guide/interactive-chat) - Extended conversations with memory
- 🎯 [Model Evaluation](/guide/model-evaluation) - Systematic model testing
- 📊 [Structured Output](/guide/structured-output) - Extract structured data
- 🔧 [Tool Calling](/guide/tool-calling) - Enhance models with external tools
