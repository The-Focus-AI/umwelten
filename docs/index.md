---
title: Umwelten - AI Model Interaction and Evaluation
description: A command-line tool to interact with and systematically evaluate AI models across providers
keywords: [AI, evaluation, models, command-line, tool, providers, Google, OpenRouter, Ollama, LM Studio, GitHub Models, semantic architecture, cognition, interaction, stimulus, memory system, MCP integration, structured output, Zod, TypeScript, habitat, agents]
---

# Umwelten

A command-line tool to interact with and systematically evaluate AI models across providers.

## Overview

An "Umwelt" is the perceptual world in which an organism exists - its unique sensory bubble that defines how it experiences reality. We use the plural "Umwelten" because every AI model, tool, and agent creates its own distinct perceptual environment, shaped by its training, capabilities, and context.

Umwelten provides:

- **Habitat**: The top-level container for agents — tools, skills, sessions, memory, and sub-agents in one place. Run as CLI, Telegram bot, or web UI.
- **Multi-Provider Support**: Google, OpenRouter, Ollama, LM Studio, GitHub Models
- **Semantic Architecture**: Cognition, Interaction, and Stimulus frameworks
- **Evaluation Framework**: Systematic model assessment and comparison
- **Memory System**: Persistent conversation memory and fact extraction
- **MCP Integration**: Model Context Protocol for tool integration
- **Structured Output**: Zod-based schema validation and type safety

## Quick Start

### Installation

```bash
git clone https://github.com/The-Focus-AI/umwelten.git
cd umwelten
pnpm install
pnpm build
```

Set up your environment:
```bash
cp env.template .env
# Edit .env with your API keys
```

### CLI Usage

All CLI commands need `dotenvx run --` to load API keys from `.env`:

```bash
# List available models
dotenvx run -- pnpm run cli -- models --provider google

# Run a simple prompt
dotenvx run -- pnpm run cli -- run --provider google --model gemini-3-flash-preview "Explain quantum computing"

# Interactive chat
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview

# Chat with memory
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview --memory

# Run evaluation across providers
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Make a space invader game in a single html file" \
  --models "ollama:gemma3:27b,google:gemini-3-flash-preview,ollama:qwen3:latest" \
  --id "space-game" \
  --ui --concurrent --resume
```

### Habitat (Agent Environment)

Start a full agent environment with tools, sessions, and sub-agents:

```bash
# Start the habitat REPL
dotenvx run -- pnpm run cli -- habitat

# Start as a Telegram bot
dotenvx run -- pnpm run cli -- habitat telegram

# Launch the web UI
dotenvx run -- pnpm run cli -- habitat web
```

## Core Features

### Semantic Architecture

Umwelten implements a semantic framework based on the "Umwelt" concept:

- **Cognition**: Model runners (`BaseModelRunner`) that execute AI requests — `generateText`, `streamText`, `generateObject`, `streamObject`
- **Interaction**: Conversation state management — messages, model config, and high-level methods like `chat()`
- **Stimulus**: Configuration for AI behavior — role, objective, instructions, tools, temperature

### Multi-Provider Support

Connect to multiple AI providers seamlessly:

- **Google**: Gemini models via Google AI Studio
- **OpenRouter**: Access to OpenAI, Anthropic, and more
- **Ollama**: Local model execution
- **LM Studio**: Local REST API models
- **GitHub Models**: Free access to AI models during preview

### Evaluation Framework

Systematically evaluate and compare models:

- Custom evaluation scripts via `EvaluationRunner`
- Batch processing capabilities
- Performance metrics and cost analysis
- Structured output validation
- Code execution scoring with Dagger containers

### Code Execution

Execute generated code safely in isolated containers:

- Multi-language support (TypeScript, Python, Ruby, Go, Rust, and more)
- Automatic package detection and installation
- LLM-assisted container configuration via [Dagger](https://dagger.io/)
- Configuration caching for fast repeated runs

### Memory System

Persistent memory across interactions:

- Conversation history management
- Fact extraction and storage
- Knowledge retrieval and context
- Privacy controls

### Tool Calling

Tool integration using Vercel AI SDK:

- Define tools with Zod schemas and `tool()` from `ai`
- Tool sets in Habitat (file operations, search, secrets, code execution, agent management)
- Custom tool development via `tools/` directory
- Multi-step tool use with `maxToolSteps`

### Real-Time Streaming

Streaming capabilities for interactive applications:

- **Object Streaming**: Real-time structured data with `streamObject`
- **Text Streaming**: Live text chunks with `streamText`

### MCP Integration

Model Context Protocol support:

- External tool integration and execution
- Resource reading and manipulation
- Extensible plugin architecture

## Documentation

### [Getting Started](/guide/getting-started)

Learn how to install, configure, and use Umwelten for basic tasks.

### [Habitat](/guide/habitat)

Set up a complete agent environment with tools, skills, sub-agents, and multiple interfaces (CLI, Telegram, web).

### [Tool Calling](/guide/tool-calling)

Learn how to use and create tools to enhance AI model capabilities.

### [API Reference](/api/overview)

Comprehensive TypeScript API documentation for building custom integrations.

### [Code Execution](/guide/code-execution)

Run generated code in secure, isolated containers with automatic package management.

### [Examples](/examples/)

Real-world examples and use cases for different scenarios.

## Architecture

```
src/
├── habitat/            # Top-level agent container (config, tools, sessions, agents, secrets)
├── cognition/          # Model runners (BaseModelRunner) and cognitive processes
├── interaction/        # Conversation state and model-environment interactions
├── stimulus/           # Stimulus config, templates, skills, and tool loading
├── context/            # Context size tracking and compaction strategies
├── providers/          # AI provider implementations (Google, OpenRouter, Ollama, etc.)
├── evaluation/         # Evaluation framework, strategies, caching, Dagger code execution
├── memory/             # Memory and knowledge storage
├── cli/                # Command-line interface
├── mcp/                # Model Context Protocol
├── costs/              # Cost calculation per provider/model
├── schema/             # Schema utilities
├── rate-limit/         # Rate limiting
├── reporting/          # Report generation
├── markdown/           # Markdown processing
└── ui/                 # TUI components (session browser, chat views)
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/The-Focus-AI/umwelten/blob/main/CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](https://github.com/The-Focus-AI/umwelten/blob/main/LICENSE) for details.

## Support

- **GitHub Issues**: [Report bugs and request features](https://github.com/The-Focus-AI/umwelten/issues)
- **Documentation**: [Full documentation](https://umwelten.thefocus.ai/)
- **Discussions**: [Community discussions](https://github.com/The-Focus-AI/umwelten/discussions)
