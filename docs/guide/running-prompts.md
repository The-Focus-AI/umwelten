# Running Prompts

Learn how to run individual prompts with AI models using Umwelten.

## Overview

Umwelten provides a powerful way to execute single prompts with AI models using the `run` command. This is ideal for:
- **One-off tasks**: Quick questions, analysis, or content generation
- **Batch processing**: Running the same prompt across multiple files
- **Testing and evaluation**: Systematic model testing and comparison
- **Automation**: Scripted interactions with AI models

The `run` command supports multiple providers, file attachments, and various configuration options.

## Basic Usage

Run a simple prompt with any model:

```bash
dotenvx run -- pnpm run cli -- run --provider ollama --model gemma3:latest "Explain the concept of quantum entanglement."
```

### Provider-Specific Examples

#### Google Models
```bash
# Gemini 2.0 Flash (fast and cost-effective)
dotenvx run -- pnpm run cli -- run --provider google --model gemini-3-flash-preview "Write a summary of renewable energy trends in 2024"

# Gemini 2.5 Pro (highest quality)
dotenvx run -- pnpm run cli -- run --provider google --model gemini-2.5-pro-exp-03-25 "Analyze the implications of artificial general intelligence"
```

#### Ollama Models (Local)
```bash
# Gemma3 models
dotenvx run -- pnpm run cli -- run --provider ollama --model gemma3:12b "Compare Python and JavaScript for web development"

# Code-specific models
dotenvx run -- pnpm run cli -- run --provider ollama --model codestral:latest "Write a function to implement binary search in TypeScript"

# Vision models
dotenvx run -- pnpm run cli -- run --provider ollama --model qwen2.5vl:latest "Describe this image" --file ./photo.jpg
```

#### OpenRouter Models
```bash
# GPT-4o (premium quality)
dotenvx run -- pnpm run cli -- run --provider openrouter --model openai/gpt-4o "Provide a detailed business analysis of the current AI market"

# Claude 3.7 Sonnet
dotenvx run -- pnpm run cli -- run --provider openrouter --model anthropic/claude-3.7-sonnet:thinking "Analyze the ethical implications of AI in healthcare"
```

#### LM Studio (Local)
```bash
# Local model (ensure LM Studio server is running)
dotenvx run -- pnpm run cli -- run --provider lmstudio --model mistralai/devstral-small-2505 "Help me debug this Python code"
```

## Advanced Prompt Configuration

### System Messages

Set the AI's role and behavior:

```bash
# Technical expert role
dotenvx run -- pnpm run cli -- run \
  --provider google --model gemini-3-flash-preview \
  --system "You are a senior software architect with expertise in distributed systems" \
  "Design a scalable microservices architecture for an e-commerce platform"

# Creative writing role
dotenvx run -- pnpm run cli -- run \
  --provider ollama --model gemma3:27b \
  --system "You are a creative writer specializing in science fiction short stories" \
  "Write a story about first contact with an alien civilization"
```

### Temperature Control

Adjust creativity and randomness:

```bash
# Very focused and deterministic (0.0-0.3)
dotenvx run -- pnpm run cli -- run \
  --provider google --model gemini-3-flash-preview \
  --temperature 0.1 \
  "Write technical documentation for this API endpoint"

# Balanced creativity (0.4-0.7)
dotenvx run -- pnpm run cli -- run \
  --provider ollama --model gemma3:12b \
  --temperature 0.6 \
  "Brainstorm innovative solutions for urban transportation"

# Highly creative (0.8-2.0)
dotenvx run -- pnpm run cli -- run \
  --provider google --model gemini-3-flash-preview \
  --temperature 1.5 \
  "Write an abstract poem about the nature of consciousness"
```

### Timeout Settings

Set appropriate timeouts for different types of prompts:

```bash
# Quick responses (default: 30 seconds)
dotenvx run -- pnpm run cli -- run --provider ollama --model gemma3:12b "What is 2+2?"

# Complex analysis (longer timeout)
dotenvx run -- pnpm run cli -- run \
  --provider google --model gemini-2.5-pro-exp-03-25 \
  --timeout 60000 \
  "Provide a comprehensive analysis of global climate change impacts"

# Extended processing (very long timeout)
dotenvx run -- pnpm run cli -- run \
  --provider openrouter --model openai/gpt-4o \
  --timeout 120000 \
  "Write a detailed business plan for a sustainable technology startup"
```

## File Attachments

### Supported File Types

- **Images**: JPG, PNG, WebP, GIF
- **Documents**: PDF
- **Text**: TXT, MD (depending on model)

### Image Analysis

```bash
# Basic image description
dotenvx run -- pnpm run cli -- run \
  --provider google --model gemini-3-flash-preview \
  --file ./photo.jpg \
  "Describe what you see in this image"

# Technical image analysis
dotenvx run -- pnpm run cli -- run \
  --provider ollama --model qwen2.5vl:latest \
  --file ./screenshot.png \
  "Identify the user interface elements and their functions"

# Multiple images
dotenvx run -- pnpm run cli -- run \
  --provider google --model gemini-3-flash-preview \
  --file ./before.jpg --file ./after.jpg \
  "Compare these two images and describe the differences"
```

### Document Analysis

```bash
# PDF summarization
dotenvx run -- pnpm run cli -- run \
  --provider google --model gemini-3-flash-preview \
  --file ./research-paper.pdf \
  "Summarize the key findings and methodology of this research paper"

# Document question-answering
dotenvx run -- pnpm run cli -- run \
  --provider google --model gemini-2.5-pro-exp-03-25 \
  --file ./contract.pdf \
  "What are the main obligations of each party in this contract?"
```

## Use Cases and Examples

### Content Creation

```bash
# Blog post writing
dotenvx run -- pnpm run cli -- run \
  --provider google --model gemini-3-flash-preview \
  --system "You are a technology blogger with expertise in AI and machine learning" \
  "Write a 500-word blog post about the future of AI in healthcare"

# Social media content
dotenvx run -- pnpm run cli -- run \
  --provider ollama --model gemma3:12b \
  --temperature 0.8 \
  "Create 5 engaging LinkedIn posts about productivity tips for remote workers"
```

### Code Assistance

```bash
# Code review
dotenvx run -- pnpm run cli -- run \
  --provider ollama --model codestral:latest \
  --system "You are a senior software engineer conducting a code review" \
  --file ./my-function.py \
  "Review this Python function and suggest improvements"

# Code explanation
dotenvx run -- pnpm run cli -- run \
  --provider openrouter --model openai/gpt-4o \
  --file ./complex-algorithm.js \
  "Explain how this algorithm works and its time complexity"
```

### Research and Analysis

```bash
# Market research
dotenvx run -- pnpm run cli -- run \
  --provider google --model gemini-2.5-pro-exp-03-25 \
  --system "You are a market research analyst" \
  "Analyze the current trends in the electric vehicle market and provide insights for the next 5 years"

# Academic research assistance
dotenvx run -- pnpm run cli -- run \
  --provider openrouter --model anthropic/claude-3.7-sonnet:thinking \
  --file ./research-data.pdf \
  "Identify the key themes and gaps in this literature review"
```

### Educational Support

```bash
# Concept explanation
dotenvx run -- pnpm run cli -- run \
  --provider ollama --model gemma3:27b \
  --system "You are a patient teacher explaining complex concepts simply" \
  "Explain quantum mechanics to a high school student"

# Problem solving
dotenvx run -- pnpm run cli -- run \
  --provider google --model gemini-3-flash-preview \
  --system "You are a math tutor who shows step-by-step solutions" \
  "Solve this calculus problem: Find the derivative of x^3 + 2x^2 - 5x + 1"
```

## Model Selection Guide

### For Speed and Efficiency
- **Google Gemini 2.0 Flash**: Best balance of speed and quality
- **Google Gemini 1.5 Flash 8B**: Fastest responses, good for simple tasks
- **Ollama Gemma3:12b**: Fast local processing, no API costs

### For Highest Quality
- **Google Gemini 2.5 Pro**: Best for complex reasoning and analysis
- **OpenRouter GPT-4o**: Premium quality for critical tasks
- **OpenRouter Claude 3.7 Sonnet**: Excellent for analytical tasks

### For Cost Optimization
- **Ollama Models**: Free local processing (requires local setup)
- **Google Gemini 2.0 Flash**: Very cost-effective for most tasks
- **OpenRouter GPT-4o-mini**: Good quality at lower cost than GPT-4o

### For Specialized Tasks
- **Vision**: Google Gemini 2.0 Flash, Ollama qwen2.5vl:latest
- **Code**: Ollama codestral:latest, OpenRouter GPT-4o
- **Long Context**: Google Gemini models (up to 2M tokens)
- **Creative Writing**: Models with higher temperature settings

## Best Practices

### Prompt Engineering
- **Be Specific**: Include details about desired format, length, and style
- **Provide Context**: Use system messages to set role and expertise level
- **Use Examples**: Include examples of desired output when helpful
- **Iterate**: Refine prompts based on initial results

### System Message Guidelines
- **Set Clear Roles**: "You are a [role] with expertise in [domain]"
- **Define Constraints**: Specify output format, length, or style requirements
- **Establish Context**: Provide relevant background information
- **Set Tone**: Professional, casual, academic, creative, etc.

### Temperature Selection
- **0.0-0.3**: Factual information, technical documentation, precise tasks
- **0.4-0.7**: General conversation, balanced creativity and accuracy
- **0.8-1.2**: Creative writing, brainstorming, open-ended exploration
- **1.3-2.0**: Highly creative tasks, experimental content generation

### Error Handling
- **Set Appropriate Timeouts**: Longer for complex tasks
- **Handle Rate Limits**: Use different providers or reduce frequency
- **Validate Outputs**: Check responses for accuracy and completeness
- **Retry Logic**: Be prepared to retry with adjusted parameters

## Troubleshooting

### Common Issues

1. **Connection Errors**: Check internet connection and API keys
2. **Rate Limiting**: Reduce request frequency or switch providers
3. **Timeout Errors**: Increase timeout values for complex prompts
4. **Invalid Responses**: Adjust temperature or rephrase prompts
5. **File Attachment Issues**: Check file size and format compatibility

### Debug Commands

```bash
# Test connection to provider
dotenvx run -- pnpm run cli -- models list --provider google

# Check available models
dotenvx run -- pnpm run cli -- models list --provider ollama

# Test simple prompt first
dotenvx run -- pnpm run cli -- run --provider google --model gemini-3-flash-preview "Hello, world!"
```

## Next Steps

- Try [interactive chat](/guide/interactive-chat) for extended conversations
- Explore [model evaluation](/guide/model-evaluation) for systematic testing
- Learn [batch processing](/guide/batch-processing) for multiple files
- See [structured output](/guide/structured-output) for data extraction