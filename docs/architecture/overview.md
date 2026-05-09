# Architecture Overview

## High-Level Architecture

![Umwelten Systems Architecture](./umwelten-architecture-labs.png)

The umwelten project implements a **stimulus-centric evaluation and interaction system** for testing and interacting with AI models. The architecture is built around the concept of "Umwelt" - the perceptual world that models operate within.

## Core Philosophy

### Infrastructure-First Approach

- **Reusable Infrastructure**: Generic evaluation strategies, stimulus templates, and tool integrations
- **Composable Components**: Simple building blocks that can be combined for complex evaluations
- **Clear Separation**: Infrastructure vs. specific test implementations

### Stimulus-Centric Design

- **Stimulus as Primary Unit**: All cognitive testing revolves around `Stimulus` objects that define role, objective, instructions, tools, and temperature
- **Template System**: Generic, reusable stimulus definitions for common tasks (creative writing, coding, analysis)
- **Tool Integration**: Seamless integration of tools via Vercel AI SDK `tool()` definitions

## Key Components

### 1. Interfaces (`packages/cli/src/`, `src/ui/`)

User-facing surfaces attach to one [`Habitat`](@umwelten/habitat/habitat.ts): REPL and composers in [`packages/cli/src/habitat.ts`](@umwelten/cli/habitat.ts); Telegram ([`packages/ui/src/telegram/`](@umwelten/ui/telegram/)), Discord ([`packages/ui/src/discord/`](@umwelten/ui/discord/)), TUI ([`packages/ui/src/tui/`](@umwelten/ui/tui/)), and web ([`packages/habitat/src/web/`](@umwelten/habitat/web/)) all drive the same [`ChannelBridge`](@umwelten/habitat/bridge/channel-bridge.ts). See the [Habitat interfaces guide](../guide/habitat-interfaces.md) and the [Web interface guide](../guide/web.md).

### 2. Habitat (`packages/habitat/src/`)

The top-level container for agents — the "world" an agent lives in.

- **Habitat class**: Factory-created via `Habitat.create()`, manages config, sessions, agents, tools, secrets
- **Tool Sets**: Modular tool collections — agent management, session management, secrets, search
- **HabitatAgent**: Sub-agent system with its own Stimulus built from cloned project files
- **Session Management**: Persistent sessions with JSONL transcript storage
- **Secrets**: Work-dir `secrets.json` (plain JSON key/value map, file mode 0600)
- **Gaia Server**: HTTP API for web UI access to habitat data

### 3. Cognition (`packages/core/src/cognition/`)

Model runners that execute AI requests.

- **BaseModelRunner**: Core runner with `generateText`, `streamText`, `generateObject`, `streamObject` — all return `Promise<ModelResponse>`
- **ModelResponse**: Standardized response with `content`, `metadata` (tokenUsage, cost, provider, model), optional `reasoning`
- **Model Validation**: `validateModel()` queries provider APIs to verify model availability

### 4. Interaction (`packages/core/src/interaction/`)

Conversation state management between user and model.

- **Interaction class**: Holds message history, model config, and Stimulus reference. High-level methods: `chat()`, `generateText()`, `streamText()`, `generateObject()`, `streamObject()`
- **Session Persistence**: Save/load conversations with `toNormalizedSession()`
- **File Attachments**: Attach files to messages for multi-modal interactions

### 5. Stimulus (`packages/core/src/stimulus/`)

Configuration that shapes AI behavior.

- **Stimulus class**: Defines `role`, `objective`, `instructions`, `output`, `tools`, `temperature`, `maxTokens`, `maxToolSteps`
- **Templates**: Pre-built stimulus configs in `templates/`, `creative/`, `coding/`, `analysis/`
- **Skills**: Loaded from git repos or local directories — each skill is a `SKILL.md` with instructions
- **Tool Loading**: Load tools from `tools/` directory (TOOL.md + handler.ts pattern)

### 6. Evaluation Framework (`packages/evaluation/src/evaluation/`)

Systematic model assessment and comparison.

- **EvalSuite**: High-level declarative API — define tasks with prompts and scoring, get cached execution, judging, and leaderboard output. Two scoring modes: VerifyTask (deterministic) and JudgeTask (LLM judge with Zod schema). See [Creating Evaluations](../guide/creating-evaluations.md)
- **EvaluationRunner**: Abstract base class — extend and implement `getModelResponse()` for custom cached runners
- **Strategies**: `SimpleEvaluation` (1 prompt × N models, used by EvalSuite internally), `MatrixEvaluation` (placeholder variables × cartesian product), `BatchEvaluation` (N items × N models)
- **Caching**: Model response caching, file caching, and score caching to avoid redundant API calls
- **Code Execution**: DaggerRunner for running generated code in isolated containers
- **Suite Combine** (`combine/`): Aggregate multiple evaluations into a unified leaderboard with narrative reports. See [Model Showdown](../walkthroughs/model-showdown.md)
- **Pairwise Ranking** (`ranking/`): Post-processing module for head-to-head LLM-judge comparisons with Elo ratings. Supports swiss tournament and round-robin pairing. See [Pairwise Ranking Guide](../guide/pairwise-ranking.md)

### 7. Provider Integration (`packages/core/src/providers/`)

AI provider implementations using Vercel AI SDK.

- **Supported**: Google, OpenRouter, Ollama, LM Studio, GitHub Models, Fireworks, MiniMax
- **Factory Pattern**: `createGoogleProvider()`, `createOpenRouterProvider()`, etc.
- **Cost Tracking**: Per-provider cost calculation via `packages/core/src/costs/`

### 8. Memory System (`packages/core/src/memory/`)

Persistent memory across interactions.

- Conversation history management
- Fact extraction and storage
- Knowledge retrieval and context

### 9. Context Management (`packages/core/src/context/`)

Context window tracking and management.

- Token counting and context size estimation
- Compaction strategies for long conversations

## Directory Structure

```
src/
├── cli/                  # umwelten CLI (habitat, eval, sessions, …)
├── ui/                   # Telegram, Discord, web, TUI adapters
├── habitat/              # Top-level agent container
│   ├── tools/            # Tool set implementations
│   │   ├── run-project/  # Dagger-based code execution
│   │   ├── search-tools.ts
│   │   ├── secrets-tools.ts
│   │   ├── agent-runner-tools.ts
│   │   └── ...
│   ├── habitat.ts        # Main Habitat class
│   ├── habitat-agent.ts  # Sub-agent system
│   ├── gaia-server.ts    # HTTP API for web UI
│   ├── session-manager.ts
│   ├── tool-sets.ts      # Standard tool set definitions
│   ├── onboard.ts        # First-run onboarding
│   └── secrets.ts        # Secret management
├── cognition/            # Model runners
│   ├── runner.ts         # BaseModelRunner
│   └── types.ts          # ModelResponse, ModelRunner, ModelDetails
├── interaction/          # Conversation state
│   └── core/
│       └── interaction.ts  # Interaction class
├── stimulus/             # Stimulus system
│   ├── stimulus.ts       # Stimulus class
│   ├── templates/        # Generic stimulus templates
│   ├── tools/            # Tool loading from directories
│   ├── skills/           # Skill loading from git/local
│   ├── creative/         # Creative writing stimuli
│   ├── coding/           # Code generation stimuli
│   └── analysis/         # Analysis task stimuli
├── evaluation/           # Evaluation framework
│   ├── suite.ts          # EvalSuite — recommended high-level API
│   ├── runner.ts         # EvaluationRunner base class
│   ├── strategies/       # SimpleEvaluation, MatrixEvaluation, BatchEvaluation
│   ├── ranking/          # PairwiseRanker — head-to-head Elo ranking
│   ├── combine/          # Multi-evaluation suite aggregation and reports
│   ├── caching/          # Response and file caching
│   ├── dagger/           # DaggerRunner for code execution
│   └── api.ts            # CLI-facing evaluation API
├── providers/            # AI provider integrations
├── memory/               # Memory and knowledge storage
├── context/              # Context size tracking and compaction
├── costs/                # Cost calculation per provider/model
├── cli/                  # Command-line interface
├── mcp/                  # Model Context Protocol
├── schema/               # Schema utilities
├── rate-limit/           # Rate limiting
├── reporting/            # Report generation
├── markdown/             # Markdown processing
├── ui/                   # TUI components (session browser)
└── test-utils/           # Test helpers
```

## Design Principles

### 1. Simplicity Over Complexity

- Start with minimal implementations
- Add complexity only when necessary
- Prefer composition over inheritance

### 2. Reusability

- Generic templates for common tasks
- Composable evaluation strategies
- Shared tool integrations and skill system

### 3. Extensibility

- Clear patterns for adding new capabilities
- Plugin architecture for tools and providers
- Skill system for sharing capabilities between agents

### 4. Maintainability

- Clear separation of concerns
- Well-documented interfaces
- Comprehensive test coverage

## Next Steps

1. **Try the CLI**: Use the command-line interface

   ```bash
   # List models
   pnpm run cli -- models --provider google

   # Run a prompt
   pnpm run cli -- run --provider google --model gemini-3-flash-preview "Hello, world!"

   # Interactive chat
   pnpm run cli -- chat --provider google --model gemini-3-flash-preview --memory
   ```

2. **Start a Habitat**: Set up a full agent environment

   ```bash
   pnpm run cli -- habitat
   ```

3. **Create Your First Evaluation**: Follow the [getting started guide](../guide/getting-started.md)
4. **Customize Templates**: Modify existing stimulus templates for your needs
5. **Add New Tools**: Create tools in a `tools/` directory using the TOOL.md + handler.ts pattern

## Related Documentation

- [Getting Started](../guide/getting-started.md)
- [Habitat Guide](../guide/habitat.md)
- [API Overview](../api/overview.md)
- [Evaluation Framework](../api/evaluation-framework.md)
- [CLI Reference](../api/cli.md)
