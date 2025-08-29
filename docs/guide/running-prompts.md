# Running Prompts

Learn how to run individual prompts and engage in interactive conversations with AI models using Umwelten.

## Overview

Umwelten provides two main ways to interact with AI models:
- **Single Prompts**: Run one-off prompts with the `run` command
- **Interactive Chat**: Engage in ongoing conversations with the `chat` command

Both support multiple providers, file attachments, and various configuration options.

## Single Prompt Execution

### Basic Usage

Run a simple prompt with any model:

```bash
umwelten run --provider ollama --model gemma3:latest "Explain the concept of quantum entanglement."
```

### Provider-Specific Examples

#### Google Models
```bash
# Gemini 2.0 Flash (fast and cost-effective)
umwelten run --provider google --model gemini-2.0-flash "Write a summary of renewable energy trends in 2024"

# Gemini 2.5 Pro (highest quality)
umwelten run --provider google --model gemini-2.5-pro-exp-03-25 "Analyze the implications of artificial general intelligence"
```

#### Ollama Models (Local)
```bash
# Gemma3 models
umwelten run --provider ollama --model gemma3:12b "Compare Python and JavaScript for web development"

# Code-specific models
umwelten run --provider ollama --model codestral:latest "Write a function to implement binary search in TypeScript"

# Vision models
umwelten run --provider ollama --model qwen2.5vl:latest "Describe this image" --file ./photo.jpg
```

#### OpenRouter Models
```bash
# GPT-4o (premium quality)
umwelten run --provider openrouter --model openai/gpt-4o "Provide a detailed business analysis of the current AI market"

# Claude 3.7 Sonnet
umwelten run --provider openrouter --model anthropic/claude-3.7-sonnet:thinking "Analyze the ethical implications of AI in healthcare"
```

#### LM Studio (Local)
```bash
# Local model (ensure LM Studio server is running)
umwelten run --provider lmstudio --model mistralai/devstral-small-2505 "Help me debug this Python code"
```

## Interactive Chat

### Basic Chat Sessions

Start an interactive conversation:

```bash
# Basic chat
umwelten chat --provider ollama --model gemma3:latest

# Chat with premium model
umwelten chat --provider google --model gemini-2.0-flash

# Chat with tools enabled
umwelten chat --provider openrouter --model openai/gpt-4o --tools calculator,statistics
```

### Chat Commands

Within a chat session, you can use special commands:

- `/?`: Show help and available commands
- `/reset`: Clear conversation history and start fresh
- `/mem`: Show memory facts (requires `--memory` flag)
- `/history`: Display the conversation history
- `exit` or `quit`: End the chat session

### Enhanced Chat Features

#### Memory-Enabled Chat
```bash
# Chat with memory for persistent facts
umwelten chat --provider ollama --model gemma3:latest --memory
```

The memory system automatically:
- Extracts important facts from conversations
- Maintains context across sessions
- Provides personalized responses based on learned information

#### Tool-Enabled Chat
```bash
# Chat with specific tools
umwelten chat --provider openrouter --model gpt-4o --tools calculator,statistics

# Available tools (use 'umwelten tools list' to see all)
umwelten chat --provider google --model gemini-2.0-flash --tools web_search,file_analysis
```

#### File Attachments in Chat
```bash
# Start chat with a file
umwelten chat --provider google --model gemini-1.5-flash-latest --file ./document.pdf

# During chat, reference the attached file
> "Summarize the main points from the attached document"
> "What are the key findings in section 3 of the PDF?"
```

## Advanced Prompt Configuration

### System Messages

Set the AI's role and behavior:

```bash
# Technical expert role
umwelten run \
  --provider google --model gemini-2.0-flash \
  --system "You are a senior software architect with expertise in distributed systems" \
  "Design a scalable microservices architecture for an e-commerce platform"

# Creative writing role
umwelten run \
  --provider ollama --model gemma3:27b \
  --system "You are a creative writer specializing in science fiction short stories" \
  "Write a story about first contact with an alien civilization"
```

### Temperature Control

Adjust creativity and randomness:

```bash
# Very focused and deterministic (0.0-0.3)
umwelten run \
  --provider google --model gemini-2.0-flash \
  --temperature 0.1 \
  "Write technical documentation for this API endpoint"

# Balanced creativity (0.4-0.7)
umwelten run \
  --provider ollama --model gemma3:12b \
  --temperature 0.6 \
  "Brainstorm innovative solutions for urban transportation"

# Highly creative (0.8-2.0)
umwelten run \
  --provider google --model gemini-2.0-flash \
  --temperature 1.5 \
  "Write an abstract poem about the nature of consciousness"
```

### Timeout Settings

Set appropriate timeouts for different types of prompts:

```bash
# Quick responses (default: 30 seconds)
umwelten run --provider ollama --model gemma3:12b "What is 2+2?"

# Complex analysis (longer timeout)
umwelten run \
  --provider google --model gemini-2.5-pro-exp-03-25 \
  --timeout 60000 \
  "Provide a comprehensive analysis of global climate change impacts"

# Extended processing (very long timeout)
umwelten run \
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
umwelten run \
  --provider google --model gemini-2.0-flash \
  --file ./photo.jpg \
  "Describe what you see in this image"

# Technical image analysis
umwelten run \
  --provider ollama --model qwen2.5vl:latest \
  --file ./screenshot.png \
  "Identify the user interface elements and their functions"

# Multiple images
umwelten run \
  --provider google --model gemini-2.0-flash \
  --file ./before.jpg --file ./after.jpg \
  "Compare these two images and describe the differences"
```

### Document Analysis

```bash
# PDF summarization
umwelten run \
  --provider google --model gemini-2.0-flash \
  --file ./research-paper.pdf \
  "Summarize the key findings and methodology of this research paper"

# Document question-answering
umwelten run \
  --provider google --model gemini-2.5-pro-exp-03-25 \
  --file ./contract.pdf \
  "What are the main obligations of each party in this contract?"
```

## Use Cases and Examples

### Content Creation

```bash
# Blog post writing
umwelten run \
  --provider google --model gemini-2.0-flash \
  --system "You are a technology blogger with expertise in AI and machine learning" \
  "Write a 500-word blog post about the future of AI in healthcare"

# Social media content
umwelten run \
  --provider ollama --model gemma3:12b \
  --temperature 0.8 \
  "Create 5 engaging LinkedIn posts about productivity tips for remote workers"
```

### Code Assistance

```bash
# Code review
umwelten run \
  --provider ollama --model codestral:latest \
  --system "You are a senior software engineer conducting a code review" \
  --file ./my-function.py \
  "Review this Python function and suggest improvements"

# Code explanation
umwelten run \
  --provider openrouter --model openai/gpt-4o \
  --file ./complex-algorithm.js \
  "Explain how this algorithm works and its time complexity"
```

### Research and Analysis

```bash
# Market research
umwelten run \
  --provider google --model gemini-2.5-pro-exp-03-25 \
  --system "You are a market research analyst" \
  "Analyze the current trends in the electric vehicle market and provide insights for the next 5 years"

# Academic research assistance
umwelten run \
  --provider openrouter --model anthropic/claude-3.7-sonnet:thinking \
  --file ./research-data.pdf \
  "Identify the key themes and gaps in this literature review"
```

### Educational Support

```bash
# Concept explanation
umwelten run \
  --provider ollama --model gemma3:27b \
  --system "You are a patient teacher explaining complex concepts simply" \
  "Explain quantum mechanics to a high school student"

# Problem solving
umwelten run \
  --provider google --model gemini-2.0-flash \
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
umwelten models list --provider google

# Check available models
umwelten models list --provider ollama

# Test simple prompt first
umwelten run --provider google --model gemini-2.0-flash "Hello, world!"
```

## Next Steps

- Try [model evaluation](/guide/model-evaluation) for systematic testing
- Explore [interactive chat](/guide/interactive-chat) for extended conversations
- Learn [batch processing](/guide/batch-processing) for multiple files
- See [structured output](/guide/structured-output) for data extraction