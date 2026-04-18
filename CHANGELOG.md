# Changelog

## Unreleased

### Features

- **`umwelten/mcp-serve` subpath export** — expose the hosted-MCP-server library (OAuth 2.1 server, Streamable HTTP transport, Neon-backed per-user token storage) as an importable subpath. Enables downstream projects like `examples/oura-mcp` and `examples/twitter-mcp` to build self-contained Docker images without referencing the umwelten monorepo source tree.
- **LlamaBarn provider** — local llama.cpp via the [LlamaBarn](https://github.com/ggml-org/LlamaBarn) macOS menu bar app. OpenAI-compatible endpoint at `http://localhost:2276/v1`, no API key needed. Surfaces loaded/sleeping/unloaded model state and parses `ctx-size` from the preset for accurate context length. Override host with `LLAMABARN_HOST` or `createLlamaBarnProvider(url)`.
- **llama-swap provider** — OpenAI-compatible provider for the [llama-swap](https://github.com/mostlygeek/llama-swap) proxy. Default endpoint `http://localhost:8080/v1`, override with `LLAMASWAP_HOST` or `createLlamaSwapProvider(url)`.
- **llama-swap config generator** — `src/providers/llamaswap-config.ts` and `umwelten models llamaswap-config` scan local GGUF caches (LM Studio, LlamaBarn, `~/.cache/huggingface/hub`, `~/.cache/llama.cpp`), dedupe by normalized alias, and emit a llama-swap YAML config. Follows symlinks so HF hub snapshot dirs are discovered. Supports custom scan paths, TTL, context size, `llama-server` binary path, and extra args.
- **Local-providers example** (`examples/local-providers/`) — head-to-head benchmark suite (speed, instruction, reasoning, coding, tool-math, soul.md file-artifact maintenance) across Ollama, LM Studio, LlamaBarn, and llama-swap, with optional frontier-reference comparison. Includes a catalog script that discovers shared models across runtimes, a memory-spike tracer (`memory-spike.ts`) using `vmmap --summary` for accurate RSS on macOS, and a smoke test (`smoke.ts`) that measures cold-load + warm-response times per `(runtime, shared-family)` pair with active per-runtime eviction (Ollama `keep_alive:0`, llama-swap `/unload`, LlamaBarn `pkill`).

## 0.4.6 (2026-03-14)

### Features

- **Pairwise Elo Ranking** (`src/evaluation/ranking/`): New post-processing module for ranking model responses via head-to-head LLM-judge comparisons with Bradley-Terry Elo ratings.
  - `PairwiseRanker` class — orchestrates judge interactions, supports swiss tournament and round-robin pairing modes
  - Pure Elo math — `expectedScore()`, `updateElo()`, `buildStandings()`
  - Pairing strategies — `allPairs()` (round-robin, shuffled), `swissPairs()` (adjacent by rating)
  - Position bias mitigation via random A/B presentation flip
  - Incremental caching — comparisons saved after each matchup, re-runs are instant
  - `evaluationResultsToRankingEntries()` bridge from `EvaluationResult` to ranking entries
  - 21 unit tests (no API keys needed)

### Refactors

- **elo-rivian.ts**: Rewritten from ~460 lines to ~150 lines using the new `PairwiseRanker`

### Documentation

- New guide: [Pairwise Ranking](/docs/guide/pairwise-ranking.md) — configuration, pairing modes, judge instructions, caching, Elo math
- New API reference: [Pairwise Ranking API](/docs/api/pairwise-ranking.md) — full type and function reference
- New example: [Pairwise Ranking Example](/docs/examples/pairwise-ranking.md) — walkthrough with standalone and framework integration patterns
- Updated: architecture overview, evaluation framework docs, model evaluation guide, creating evaluations guide, reports guide, examples index, matrix evaluation example, CLAUDE.md module map

## 0.4.5 (2026-02-26)

### Features

- **MiniMax provider** support
- **TezLab MCP chat** example with remote transport support
- **Local workspace Habitat agents** — workspace-first agent registration
- **Car wash test** evaluation and walkthrough
- **Fireworks.ai provider** integration
- **Native thinking** for Google Gemini models
- **Habitat Bridge** system for containerized agent execution via Dagger
  - Multi-agent bridge management with port pool
  - MCP SDK server/client with StreamableHTTP transport
  - LLM-driven supervisor replacing hardcoded analysis
  - Go MCP server implementation
  - Persistent logging, health checks, secret injection
  - Agent discovery for MCP health monitoring
- **Habitat improvements**: secrets tools, search (Tavily), run-project (Dagger), Gaia HTTP server, session metadata, agent discovery
- **Habitat CLI** with REPL and Telegram subcommand
- **Agent auto-discovery** and skills sharing for sub-agents
- **Skills registry** with `getOrCreateSkillsRegistry` for external skill injection
- **Factory-pattern tool handlers** with context support
- **Escape key** to abort streaming responses
- **Context management** system with compaction strategies
- **Telegram bot** adapter with media file storage and message logging
- **URL tools** (wget, markify) with built-in HTML conversion
- **Feed parser** for RSS/Atom/XML parsing

### Fixes

- Normalize input/output token usage for costs
- Auto-load `.env` for CLI and tests
- Security: update glob and fast-xml-parser for vulnerabilities
- Bridge: deterministic container builds, worker termination, health checks, error handling
- Session message display and tool install guidance

### Documentation

- Comprehensive Habitat guide, setup walkthrough, and bridge documentation
- Module map and architecture overview in CLAUDE.md
- Bridge system workflow procedures and walkthroughs
- Full documentation audit against codebase

## 0.4.1 (2026-01-26)

### Fixes

- Use `content` instead of `text` for `ModelResponse`
- Let pnpm version come from `packageManager` field
- Add trusted publishing workflow for npm

## 0.4.0 (2026-01-25)

### Features

- **Stimulus-centric evaluation architecture** — complete rewrite of evaluation framework
  - `SimpleEvaluation`, `MatrixEvaluation`, `BatchEvaluation`, `ComplexPipeline` strategies
  - Codebase evaluation types with context provider, change extractor, and Dagger runner
  - Multi-step tool conversation testing framework
- **Dagger-based code execution** replacing Docker for isolated code running
  - TypeScript, Python, Ruby, Rust, Go support
  - LLM integration for automated evaluation
- **Sessions system** — multi-source session support
  - LLM-powered indexing and semantic search
  - `sessions show`, `messages`, `stats`, `tools`, `export`, `format` commands
  - Claude Code and Cursor session adapters
- **Unified Reporter** system with console, markdown, HTML, JSON renderers
- **Gemini 3 Flash** and **2.5 Flash** pricing and provider updates
- **Google models** pagination and version-based sorting

### Fixes

- Resolve TypeScript build errors across the codebase
- Improve test reports with timing, cost, and per-model sections

### Documentation

- Code execution examples, tool conversation examples, reasoning streaming examples
- Comprehensive code execution guide for DaggerRunner
- Evaluation examples updated for new API structure

## 0.3.3 (2026-01-13)

### Features

- Enhanced CLI interface with command system and statistics display

## 0.3.2 (2026-01-12)

### Refactors

- Replace `ai-sdk-ollama` with `ollama-ai-provider-v2`

## 0.3.1 (2026-01-12)

### Refactors

- **Stimulus-driven architecture** for Interaction system

## 0.3.0 (2026-01-10)

### Features

- **Vercel AI SDK tool calling** — migrate tools to AI SDK `tool()` pattern
- **Real-time object streaming** with `partialObjectStream`
- **Interactive chat** documentation and improvements
- **Dynamic context window detection** for Ollama models
- **Short report option** for `eval report` command

### Fixes

- Correct OpenRouter cost calculations
- Fix GitHub Models provider integration

### Refactors

- Migrate from tool registry to direct tool integration
- Implement new Interaction and interface pattern

## 0.2.1 (2026-01-08)

### Features

- **GitHub Models provider** with OpenAI-compatible SDK integration
- **Schema validation system** — DSL parser, Zod converter, validator
- **Batch processing** for evaluations via CLI
- **Concurrent evaluation** processing with configurable limits
- **Interactive UI mode** for evaluations (React/Ink terminal UI)
- **Evaluation listing** command
- **Report generation** from evaluation results
- **VitePress documentation** site

### Refactors

- Replace schema-based runner with function evaluation

## 0.2.0 (2026-01-04)

### Features

- **AI-powered code evaluation** system
  - Multi-language support: TypeScript, Python, Rust, Go
  - Ollama evaluation pipeline with reasoning extraction
- **PDF identification** script
- **LM Studio provider** integration
- **MCP client and server** frameworks
- **Chat command** with memory and interactive commands
- **Rate limit handling** with exponential backoff

### Refactors

- Upgrade to Vercel AI SDK v5
- Restructure from monorepo to single package
- Implement `Conversation` class with file attachment support
- Standardize cost calculations to per-million-token display
- Simplify model identification and unify types

## 0.1.0 (2025-12-20)

- Initial release
- Multi-provider model runner (Google, OpenRouter, Ollama)
- Basic CLI with `run` and `models` commands
- Cost tracking per provider/model
- Evaluation framework foundation
