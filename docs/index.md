# Umwelten

A command-line tool to interact with and systematically evaluate AI models across providers.

## Overview

Umwelten is a comprehensive AI model evaluation and interaction tool that implements the "Umwelt" concept - creating a semantic framework around how models perceive and interact with their environment. It provides:

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

### Basic Usage

```bash
# List available models
umwelten models

# Run a simple prompt
umwelten run "Explain quantum computing" --model gpt-4

# Start interactive chat
umwelten chat --model gemini-2.0-flash

# Run model evaluation
umwelten eval --model gpt-4 --task coding
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

### 🛠️ MCP Integration

Model Context Protocol support:

- Tool integration and execution
- Resource reading and manipulation
- Extensible plugin architecture

## Documentation

### [Getting Started](/guide/getting-started)

Learn how to install, configure, and use Umwelten for basic tasks.

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
