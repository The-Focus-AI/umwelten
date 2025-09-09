---
title: Umwelten - AI Model Evaluation Tool
description: A command-line tool to interact with and systematically evaluate AI models across providers
keywords: [AI, evaluation, models, command-line, tool, providers, Google, OpenRouter, Ollama, LM Studio, GitHub Models, semantic architecture, cognition, interaction, stimulus, memory system, MCP integration, structured output, Zod, TypeScript]
---

# Umwelten

A command-line tool to interact with and systematically evaluate AI models across providers.

## Overview

An "Umwelt" is the perceptual world in which an organism exists - its unique sensory bubble that defines how it experiences reality. We use the plural "Umwelten" because every AI model, tool, and agent creates its own distinct perceptual environment, shaped by its training, capabilities, and context.

Umwelten is a comprehensive AI model evaluation and interaction tool that implements the "Umwelt" concept - creating a semantic framework around how models perceive and interact with their environment.  

It provides:

- **Multi-Provider Support**: Google, OpenRouter, Ollama, LM Studio, GitHub Models
- **Semantic Architecture**: Cognition, Interaction, and Stimulus frameworks
- **Evaluation Framework**: Systematic model assessment and comparison
- **Memory System**: Persistent conversation memory and fact extraction
- **MCP Integration**: Model Context Protocol for tool integration
- **Structured Output**: Zod-based schema validation and type safety

## Quick Start

### Installation

```bash
npm install -g umwelten
# or
pnpm add -g umwelten
```

### 🆕 New Interaction + Interface Pattern

The modern way to use Umwelten with pre-configured interactions and clean interfaces:

```bash
# Interactive chat with tools (new pattern)
pnpm tsx src/cli/cli.ts chat-new -p ollama -m llama3.2:latest

# Tools demonstration with weather, calculator, file analysis
pnpm tsx scripts/tools.ts -p ollama -m llama3.2:latest --prompt "What's the weather in New York?"

# Programmatic usage
pnpm tsx scripts/new-pattern-example.ts
```

**Benefits:**
- ✅ Pre-configured interactions (Chat, Evaluation, Agent)
- ✅ Multiple interfaces (CLI, Web, Agent)
- ✅ Built-in tools and memory
- ✅ Same API works across environments

### Traditional CLI Usage

```bash
# List available models
umwelten models

# Run a simple prompt
umwelten run "Explain quantum computing like I'm 8" --model gpt-oss:latest --provider ollama

# Start interactive chat
umwelten chat --model gemini-2.0-flash --provider google

# Run model evaluation across 3 providers with concurrently
dotenvx run -- umwelten eval run \
  --prompt "Make a space invader game in a single html file" \
  --models "ollama:gemma3:27b,google:gemini-2.0-flash,ollama:qwen3:latest" \
  --id "space-game" \
  --ui --concurrent --resume
```

## Core Features

### 🧠 Semantic Architecture

Umwelten implements a semantic framework based on the "Umwelt" concept:

- **Cognition**: Model reasoning and thinking processes
- **Interaction**: Model-environment exchanges
- **Stimulus**: Environmental inputs that trigger responses

### 🔌 Multi-Provider Support

Connect to multiple AI providers seamlessly:

- **Google**: Gemini models via Google AI Studio
- **OpenRouter**: Access to OpenAI, Anthropic, and more
- **Ollama**: Local model execution
- **LM Studio**: Local REST API models
- **GitHub Models**: Free access to AI models during preview

### 📊 Evaluation Framework

Systematically evaluate and compare models:

- Custom evaluation scripts
- Batch processing capabilities
- Performance metrics and cost analysis
- Structured output validation

### 🧠 Memory System

Persistent memory across interactions:

- Conversation history management
- Fact extraction and storage
- Knowledge retrieval and context
- Privacy controls

### 🛠️ Tool Calling

Simplified tool integration using Vercel AI SDK:

- Mathematical operations (calculator, statistics)
- Random number generation
- Custom tool development
- Seamless model integration

### 🔄 Real-Time Streaming

Advanced streaming capabilities for interactive applications:

- **Object Streaming**: Real-time structured data with `streamObject`
- **Text Streaming**: Live text chunks with `streamText`
- **Partial Updates**: Immediate feedback with `partialObjectStream`
- **Performance Optimized**: No hanging or timeout issues

### 🔌 MCP Integration

Model Context Protocol support:

- External tool integration and execution
- Resource reading and manipulation
- Extensible plugin architecture

## Documentation

### [Getting Started](/guide/getting-started)

Learn how to install, configure, and use Umwelten for basic tasks.

### [Tool Calling](/guide/tool-calling)

Learn how to use and create tools to enhance AI model capabilities.

### [API Reference](/api/overview)

Comprehensive TypeScript API documentation for building custom integrations.

### [Examples](/examples/)

Real-world examples and use cases for different scenarios.

### [Migration Guide](/migration/)

Guidance for migrating from other tools and upgrading between versions.

## Architecture

```
src/
├── cognition/          # Model runners and cognitive processes
├── interaction/        # Model-environment interactions
├── stimulus/           # Environmental inputs and triggers
├── providers/          # AI provider implementations
├── evaluation/         # Model evaluation framework
├── memory/             # Memory and knowledge storage
├── cli/                # Command-line interface
└── mcp/                # Model Context Protocol
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/The-Focus-AI/umwelten/blob/main/CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](https://github.com/The-Focus-AI/umwelten/blob/main/LICENSE) for details.

## Support

- **GitHub Issues**: [Report bugs and request features](https://github.com/The-Focus-AI/umwelten/issues)
- **Documentation**: [Full documentation](https://umwelten.thefocus.ai/)
- **Discussions**: [Community discussions](https://github.com/The-Focus-AI/umwelten/discussions)
