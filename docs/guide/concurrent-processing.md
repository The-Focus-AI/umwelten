# Concurrent Processing

Learn how to use Umwelten's concurrent processing capabilities to dramatically speed up your evaluations and batch operations. Concurrent processing allows you to run multiple model evaluations simultaneously, making it ideal for large-scale testing and analysis.

## Overview

Concurrent processing in Umwelten enables you to:

- **Speed up evaluations**: Run multiple models simultaneously instead of sequentially
- **Process large datasets**: Handle hundreds of files efficiently
- **Optimize resource usage**: Make better use of available computing resources
- **Scale operations**: Handle production workloads with predictable performance

## Basic Concurrent Processing

### The `--concurrent` Flag

Enable concurrent processing for any evaluation:

```bash
# Basic concurrent evaluation
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Explain quantum computing" \
  --models "ollama:gemma3:12b,ollama:codestral:latest,google:gemini-3-flash-preview" \
  --id "quantum-comparison" \
  --concurrent
```

### Concurrent Batch Processing

Process multiple files concurrently:

```bash
# Process images concurrently
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Analyze this image and describe key features" \
  --models "google:gemini-3-flash-preview,ollama:qwen2.5vl:latest" \
  --id "image-analysis" \
  --directory "input/images" \
  --file-pattern "*.jpg" \
  --concurrent
```

## Performance Optimization

### Concurrency Control

Control the level of concurrency to optimize performance:

```bash
# Set maximum concurrency (default: 5)
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Process this file" \
  --models "ollama:gemma3:12b,google:gemini-3-flash-preview" \
  --id "batch-test" \
  --directory "input/files" \
  --file-pattern "*.txt" \
  --concurrent \
  --max-concurrency 10
```

### Provider-Specific Considerations

Different providers have different rate limits and capabilities:

#### Google Models
```bash
# Google models handle high concurrency well
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Your prompt" \
  --models "google:gemini-3-flash-preview,google:gemini-2.5-pro-exp-03-25" \
  --id "google-comparison" \
  --concurrent \
  --max-concurrency 20
```

#### OpenRouter Models
```bash
# OpenRouter has rate limits - use moderate concurrency
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Your prompt" \
  --models "openai/gpt-4o,anthropic/claude-3.7-sonnet" \
  --id "openrouter-comparison" \
  --concurrent \
  --max-concurrency 5
```

#### Ollama Models (Local)
```bash
# Local models - concurrency limited by hardware
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Your prompt" \
  --models "ollama:gemma3:12b,ollama:codestral:latest" \
  --id "ollama-comparison" \
  --concurrent \
  --max-concurrency 3
```

## Advanced Concurrent Patterns

### Multi-Model Evaluation

Compare multiple models on the same prompt:

```bash
# Evaluate 5 models concurrently
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a function to calculate fibonacci numbers in Python" \
  --models "ollama:gemma3:12b,ollama:codestral:latest,google:gemini-3-flash-preview,openai/gpt-4o,anthropic/claude-3.7-sonnet" \
  --id "fibonacci-comparison" \
  --concurrent \
  --max-concurrency 5
```

### Multi-File Processing

Process large datasets efficiently:

```bash
# Process 100+ images concurrently
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Analyze this image and extract: objects, colors, text, people" \
  --models "google:gemini-3-flash-preview,ollama:qwen2.5vl:latest" \
  --id "large-image-dataset" \
  --directory "input/dataset" \
  --file-pattern "*.jpg" \
  --concurrent \
  --max-concurrency 10 \
  --max-files 1000
```

### Mixed Provider Evaluation

Combine local and cloud models:

```bash
# Mix local and cloud models for cost optimization
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Explain machine learning concepts" \
  --models "ollama:gemma3:12b,ollama:codestral:latest,google:gemini-3-flash-preview" \
  --id "mixed-provider-eval" \
  --concurrent \
  --max-concurrency 5
```

## Performance Monitoring

### Progress Tracking

Monitor concurrent operations in real-time:

```bash
# Enable verbose output for progress tracking
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Process this file" \
  --models "google:gemini-3-flash-preview" \
  --id "progress-test" \
  --directory "input/files" \
  --file-pattern "*.txt" \
  --concurrent \
  --verbose
```

### Performance Metrics

Track performance improvements:

```bash
# Compare sequential vs concurrent performance
echo "Sequential processing:"
time dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Process this file" \
  --models "google:gemini-3-flash-preview" \
  --id "sequential-test" \
  --directory "input/files" \
  --file-pattern "*.txt"

echo "Concurrent processing:"
time dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Process this file" \
  --models "google:gemini-3-flash-preview" \
  --id "concurrent-test" \
  --directory "input/files" \
  --file-pattern "*.txt" \
  --concurrent \
  --max-concurrency 5
```

## Best Practices

### 1. Start Conservative

Begin with lower concurrency and increase gradually:

```bash
# Start with 2-3 concurrent operations
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Your prompt" \
  --models "model1,model2,model3" \
  --id "conservative-test" \
  --concurrent \
  --max-concurrency 2

# Increase if performance is good
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Your prompt" \
  --models "model1,model2,model3" \
  --id "optimized-test" \
  --concurrent \
  --max-concurrency 5
```

### 2. Consider Provider Limits

Respect provider-specific rate limits:

```bash
# Google: High concurrency (20+)
dotenvx run -- pnpm run cli -- eval run \
  --models "google:gemini-3-flash-preview,google:gemini-2.5-pro-exp-03-25" \
  --concurrent \
  --max-concurrency 20

# OpenRouter: Moderate concurrency (5-10)
dotenvx run -- pnpm run cli -- eval run \
  --models "openai/gpt-4o,anthropic/claude-3.7-sonnet" \
  --concurrent \
  --max-concurrency 5

# Ollama: Limited by hardware (2-5)
dotenvx run -- pnpm run cli -- eval run \
  --models "ollama:gemma3:12b,ollama:codestral:latest" \
  --concurrent \
  --max-concurrency 3
```

### 3. Monitor Resource Usage

Keep an eye on system resources:

```bash
# Monitor CPU and memory usage during concurrent operations
htop  # or top

# Check for memory leaks or excessive CPU usage
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Process this file" \
  --models "google:gemini-3-flash-preview" \
  --id "resource-test" \
  --directory "input/files" \
  --file-pattern "*.txt" \
  --concurrent \
  --max-concurrency 10
```

### 4. Handle Failures Gracefully

Concurrent operations can fail - handle them properly:

```bash
# Use resume capability for large batch operations
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Process this file" \
  --models "google:gemini-3-flash-preview" \
  --id "resume-test" \
  --directory "input/files" \
  --file-pattern "*.txt" \
  --concurrent \
  --max-concurrency 5 \
  --resume  # Skip completed files if interrupted
```

## Error Handling

### Rate Limiting

Handle provider rate limits:

```bash
# If you hit rate limits, reduce concurrency
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Your prompt" \
  --models "openai/gpt-4o,anthropic/claude-3.7-sonnet" \
  --id "rate-limit-test" \
  --concurrent \
  --max-concurrency 2  # Reduced from 5
```

### Network Issues

Handle network connectivity problems:

```bash
# Use retry logic for network issues
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Your prompt" \
  --models "google:gemini-3-flash-preview" \
  --id "network-test" \
  --concurrent \
  --max-concurrency 3 \
  --verbose  # See detailed error messages
```

### Memory Management

Handle memory constraints:

```bash
# Reduce concurrency if memory usage is high
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Process this file" \
  --models "ollama:gemma3:12b" \
  --id "memory-test" \
  --directory "input/files" \
  --file-pattern "*.txt" \
  --concurrent \
  --max-concurrency 1  # Reduced for memory constraints
```

## Performance Benchmarks

### Typical Performance Improvements

| Operation Type | Sequential Time | Concurrent Time | Improvement |
|----------------|-----------------|-----------------|-------------|
| 5 models, 1 prompt | 25 seconds | 8 seconds | 3.1x faster |
| 1 model, 100 files | 300 seconds | 60 seconds | 5x faster |
| 3 models, 50 files | 450 seconds | 90 seconds | 5x faster |

### Optimal Concurrency Settings

| Provider | Recommended Max Concurrency | Notes |
|----------|------------------------------|-------|
| Google | 20-30 | High rate limits, good performance |
| OpenRouter | 5-10 | Moderate rate limits, cost considerations |
| Ollama (Local) | 2-5 | Limited by hardware resources |
| LM Studio (Local) | 2-3 | Limited by local server capacity |

## Advanced Use Cases

### Pipeline Processing

Chain multiple concurrent operations:

```bash
# Step 1: Process images concurrently
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Extract text from this image" \
  --models "google:gemini-3-flash-preview" \
  --id "text-extraction" \
  --directory "input/images" \
  --file-pattern "*.jpg" \
  --concurrent \
  --max-concurrency 10

# Step 2: Process extracted text concurrently
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Analyze this extracted text" \
  --models "ollama:gemma3:12b,google:gemini-3-flash-preview" \
  --id "text-analysis" \
  --directory "output/text-extraction" \
  --file-pattern "*.txt" \
  --concurrent \
  --max-concurrency 5
```

### Load Balancing

Distribute load across different providers:

```bash
# Balance load between local and cloud models
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Your prompt" \
  --models "ollama:gemma3:12b,ollama:codestral:latest,google:gemini-3-flash-preview" \
  --id "load-balanced" \
  --concurrent \
  --max-concurrency 6  # 2 per provider
```

## Troubleshooting

### Common Issues

1. **"Rate limit exceeded"**: Reduce `--max-concurrency`
2. **"Memory usage too high"**: Reduce concurrency or use smaller models
3. **"Network timeouts"**: Check connectivity and reduce concurrency
4. **"Provider unavailable"**: Check provider status and API keys

### Debugging Concurrent Operations

```bash
# Enable verbose output for debugging
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Your prompt" \
  --models "model1,model2,model3" \
  --id "debug-test" \
  --concurrent \
  --max-concurrency 3 \
  --verbose \
  --debug
```

## Next Steps

Now that you understand concurrent processing, explore:

- 📊 [Reports & Analysis](/guide/reports) - Generate comprehensive reports from concurrent evaluations
- 💰 [Cost Analysis](/guide/cost-analysis) - Optimize costs with concurrent processing
- 🔧 [Memory & Tools](/guide/memory-tools) - Combine concurrent processing with memory and tools
- 📈 [Batch Processing](/guide/batch-processing) - Scale concurrent operations to large datasets
