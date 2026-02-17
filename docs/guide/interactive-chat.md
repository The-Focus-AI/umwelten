# Interactive Chat

Learn how to engage in ongoing conversations with AI models using Umwelten's interactive chat feature.

## Overview

Interactive chat allows you to have extended conversations with AI models, maintaining context across multiple exchanges. This is ideal for:
- **Extended discussions**: Complex topics that require multiple back-and-forth exchanges
- **Iterative problem solving**: Refining solutions through conversation
- **Learning sessions**: Educational interactions with persistent context
- **Creative collaboration**: Building ideas through ongoing dialogue

## Getting Started

### Basic Chat Sessions

Start an interactive conversation:

```bash
# Basic chat
dotenvx run -- pnpm run cli -- chat --provider ollama --model gemma3:latest

# Chat with premium model
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview

# Chat with tools enabled
dotenvx run -- pnpm run cli -- chat --provider openrouter --model openai/gpt-4o --tools calculator,statistics
```

### Provider-Specific Examples

#### Google Models
```bash
# Fast and cost-effective chat
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview

# High-quality analytical chat
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-2.5-pro-exp-03-25

# Vision-enabled chat
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview --file ./image.jpg
```

#### Ollama Models (Local)
```bash
# General conversation
dotenvx run -- pnpm run cli -- chat --provider ollama --model gemma3:12b

# Code-focused chat
dotenvx run -- pnpm run cli -- chat --provider ollama --model codestral:latest

# Vision chat
dotenvx run -- pnpm run cli -- chat --provider ollama --model qwen2.5vl:latest --file ./screenshot.png
```

#### OpenRouter Models
```bash
# Premium quality chat
dotenvx run -- pnpm run cli -- chat --provider openrouter --model openai/gpt-4o

# Analytical chat
dotenvx run -- pnpm run cli -- chat --provider openrouter --model anthropic/claude-3.7-sonnet:thinking

# Cost-effective chat
dotenvx run -- pnpm run cli -- chat --provider openrouter --model openai/gpt-4o-mini
```

#### LM Studio (Local)
```bash
# Local model chat (ensure LM Studio server is running)
dotenvx run -- pnpm run cli -- chat --provider lmstudio --model mistralai/devstral-small-2505
```

## Chat Commands

Within a chat session, you can use special commands to control the conversation:

### Basic Commands
- `/?`: Show help and available commands
- `/reset`: Clear conversation history and start fresh
- `/history`: Display the conversation history
- `exit` or `quit`: End the chat session

### Memory Commands
- `/mem`: Show memory facts (requires `--memory` flag)
- `/mem clear`: Clear all stored memory facts
- `/mem export`: Export memory facts to a file

### Advanced Commands
- `/system <message>`: Update the system message
- `/temperature <value>`: Change the temperature setting
- `/provider <name>`: Switch to a different provider
- `/model <name>`: Switch to a different model

## Enhanced Chat Features

### Memory-Enabled Chat

Enable persistent memory to maintain context across sessions:

```bash
# Chat with memory for persistent facts
dotenvx run -- pnpm run cli -- chat --provider ollama --model gemma3:latest --memory
```

The memory system automatically:
- **Extracts important facts** from conversations
- **Maintains context** across sessions
- **Provides personalized responses** based on learned information
- **Builds knowledge** over time about your preferences and needs

#### Memory Examples
```bash
# Start a memory-enabled chat
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview --memory

# During chat, the AI will remember:
> "I'm a software developer working on a React project"
> "My name is Alex and I prefer TypeScript over JavaScript"
> "I'm learning about microservices architecture"

# In future sessions, the AI will reference this information
> "Based on our previous conversations, I know you're working on a React project..."
```

### Tool-Enabled Chat

Enhance your chat with powerful tools:

```bash
# Chat with specific tools
dotenvx run -- pnpm run cli -- chat --provider openrouter --model gpt-4o --tools calculator,statistics

# Available tools (use 'umwelten tools list' to see all)
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview --tools web_search,file_analysis
```

#### Available Tools
- **calculator**: Mathematical calculations and formulas
- **statistics**: Statistical analysis and data processing  
- **randomNumber**: Generate random numbers within ranges

#### Tool Usage Examples
```bash
# Math-focused chat
dotenvx run -- pnpm run cli -- chat --provider openrouter --model gpt-4o --tools calculator

# Data analysis chat
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview --tools statistics

# Multi-tool chat
dotenvx run -- pnpm run cli -- chat --provider ollama --model qwen3:latest --tools calculator,statistics,randomNumber
```

#### Tool Demo
Test tool functionality:
```bash
# Interactive tool demo
dotenvx run -- pnpm run cli -- tools demo

# Custom demo
dotenvx run -- pnpm run cli -- tools demo --prompt "Calculate 15 + 27, then generate a random number"
```

### File Attachments in Chat

Start a chat with file context:

```bash
# Start chat with a document
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-1.5-flash-latest --file ./document.pdf

# Start chat with an image
dotenvx run -- pnpm run cli -- chat --provider ollama --model qwen2.5vl:latest --file ./photo.jpg

# Start chat with multiple files
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview --file ./report.pdf --file ./data.csv
```

#### File Reference Examples
During chat, you can reference attached files:

```
> "Summarize the main points from the attached document"
> "What are the key findings in section 3 of the PDF?"
> "Analyze the trends shown in the attached spreadsheet"
> "Describe what you see in the image I shared"
```

## Advanced Chat Configuration

### System Messages

Set the AI's role and behavior for the entire conversation:

```bash
# Technical expert role
dotenvx run -- pnpm run cli -- chat \
  --provider google --model gemini-3-flash-preview \
  --system "You are a senior software architect with expertise in distributed systems"

# Creative writing role
dotenvx run -- pnpm run cli -- chat \
  --provider ollama --model gemma3:27b \
  --system "You are a creative writer specializing in science fiction short stories"

# Educational role
dotenvx run -- pnpm run cli -- chat \
  --provider openrouter --model anthropic/claude-3.7-sonnet:thinking \
  --system "You are a patient teacher who explains complex concepts simply"
```

### Temperature Control

Adjust creativity and randomness for the conversation:

```bash
# Very focused and deterministic (0.0-0.3)
dotenvx run -- pnpm run cli -- chat \
  --provider google --model gemini-3-flash-preview \
  --temperature 0.1

# Balanced creativity (0.4-0.7)
dotenvx run -- pnpm run cli -- chat \
  --provider ollama --model gemma3:12b \
  --temperature 0.6

# Highly creative (0.8-2.0)
dotenvx run -- pnpm run cli -- chat \
  --provider google --model gemini-3-flash-preview \
  --temperature 1.5
```

### Timeout Settings

Set appropriate timeouts for different types of conversations:

```bash
# Quick responses (default: 30 seconds)
dotenvx run -- pnpm run cli -- chat --provider ollama --model gemma3:12b --timeout 30000

# Complex analysis (longer timeout)
dotenvx run -- pnpm run cli -- chat \
  --provider google --model gemini-2.5-pro-exp-03-25 \
  --timeout 60000

# Extended processing (very long timeout)
dotenvx run -- pnpm run cli -- chat \
  --provider openrouter --model openai/gpt-4o \
  --timeout 120000
```

## Use Cases and Examples

### Educational Support

```bash
# Math tutoring session
dotenvx run -- pnpm run cli -- chat \
  --provider google --model gemini-3-flash-preview \
  --system "You are a math tutor who shows step-by-step solutions" \
  --tools calculator

# Language learning
dotenvx run -- pnpm run cli -- chat \
  --provider ollama --model gemma3:27b \
  --system "You are a Spanish language tutor. Respond in Spanish and help me practice"

# Concept explanation
dotenvx run -- pnpm run cli -- chat \
  --provider openrouter --model anthropic/claude-3.7-sonnet:thinking \
  --system "You are a patient teacher explaining complex concepts simply"
```

### Creative Collaboration

```bash
# Story writing collaboration
dotenvx run -- pnpm run cli -- chat \
  --provider ollama --model gemma3:27b \
  --system "You are a creative writing partner. Help me develop characters and plot" \
  --temperature 0.8

# Brainstorming session
dotenvx run -- pnpm run cli -- chat \
  --provider google --model gemini-3-flash-preview \
  --system "You are an innovation consultant. Help me brainstorm solutions" \
  --temperature 0.9

# Design feedback
dotenvx run -- pnpm run cli -- chat \
  --provider openrouter --model openai/gpt-4o \
  --system "You are a UX designer. Provide feedback on my design ideas"
```

### Problem Solving

```bash
# Debugging session
dotenvx run -- pnpm run cli -- chat \
  --provider ollama --model codestral:latest \
  --system "You are a senior software engineer helping with debugging" \
  --tools code_execution

# Business analysis
dotenvx run -- pnpm run cli -- chat \
  --provider google --model gemini-2.5-pro-exp-03-25 \
  --system "You are a business analyst. Help me analyze market opportunities" \
  --tools web_search

# Research assistance
dotenvx run -- pnpm run cli -- chat \
  --provider openrouter --model anthropic/claude-3.7-sonnet:thinking \
  --system "You are a research assistant. Help me find and analyze information" \
  --tools web_search
```

### Code Development

```bash
# Code review session
dotenvx run -- pnpm run cli -- chat \
  --provider ollama --model codestral:latest \
  --system "You are a senior developer conducting a code review" \
  --file ./my-code.js

# Architecture discussion
dotenvx run -- pnpm run cli -- chat \
  --provider google --model gemini-3-flash-preview \
  --system "You are a software architect. Help me design system architecture"

# Testing strategy
dotenvx run -- pnpm run cli -- chat \
  --provider openrouter --model openai/gpt-4o \
  --system "You are a QA engineer. Help me develop testing strategies"
```

## Best Practices

### Conversation Management
- **Start with context**: Provide relevant background information early
- **Be specific**: Ask clear, focused questions
- **Build on responses**: Reference previous exchanges to maintain continuity
- **Use commands effectively**: Leverage chat commands for better control

### Memory Usage
- **Enable memory for long-term projects**: Keeps context across sessions
- **Review memory regularly**: Use `/mem` to see what's been learned
- **Clear memory when needed**: Use `/mem clear` for fresh starts
- **Export important facts**: Use `/mem export` to save valuable information

### Tool Integration
- **Choose relevant tools**: Select tools that match your use case
- **Combine tools effectively**: Use multiple tools for complex tasks
- **Understand tool limitations**: Know what each tool can and cannot do
- **Provide context**: Give tools the information they need to work effectively

### Error Handling
- **Use appropriate timeouts**: Set longer timeouts for complex conversations
- **Handle interruptions gracefully**: Use `/reset` if conversation gets stuck
- **Switch providers if needed**: Use `/provider` to try different options
- **Save important conversations**: Export chat history for important discussions

## Troubleshooting

### Common Issues

1. **Conversation Context Loss**: Use memory-enabled chat or `/history` to review
2. **Slow Responses**: Increase timeout values or switch to faster models
3. **Tool Failures**: Check tool availability and provide necessary context
4. **Memory Issues**: Use `/mem clear` to reset memory if it becomes corrupted
5. **Provider Errors**: Switch providers or check API key configuration

### Debug Commands

```bash
# Test chat functionality
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview --timeout 10000

# Check available tools
dotenvx run -- pnpm run cli -- tools list

# Test memory system
dotenvx run -- pnpm run cli -- chat --provider ollama --model gemma3:latest --memory

# Verify file attachments
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview --file ./test.txt
```

## Next Steps

- Learn about [running single prompts](/guide/running-prompts) for quick tasks
- Explore [model evaluation](/guide/model-evaluation) for systematic testing
- Try [batch processing](/guide/batch-processing) for multiple files
- See [structured output](/guide/structured-output) for data extraction
