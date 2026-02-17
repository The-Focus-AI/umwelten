# Umwelten

## Workflow Rules

- Use `pnpm` (never `npm`)
- Use `pnpm test:run` (never `pnpm test` — it watches)
- Run tests before building
- Use `pnpm run cli` to test CLI without building (runs via tsx)
- **ALWAYS use `dotenvx run --` prefix** when running CLI commands that need env vars (e.g. `dotenvx run -- pnpm run cli -- habitat ...`). The .env file has the API keys. Never run habitat/CLI commands without it.
- When planning, write out TASKS.md with completed/current/planned tasks and keep it up to date
- **NEVER use gemini-2 models** — always use gemini-3 (e.g. `gemini-3-flash-preview`)

**Issue tracking**: This project uses [bd (beads)](https://github.com/steveyegge/beads). Use `bd` commands instead of markdown TODOs.

**CRITICAL - BD DAEMON RULES:**
- NEVER run `bd daemon start` or any daemon commands
- NEVER enable auto-sync, auto-commit, or auto-push for beads
- The daemon creates spam commits every 5 seconds — it is FORBIDDEN
- Only use direct bd commands: `bd create`, `bd update`, `bd close`, `bd list`, etc.
- Manual `bd sync` is allowed if needed, but daemon is BANNED

## Architecture Overview

The codebase is layered bottom-up. Each layer depends only on layers below it.

```
Layer 8: CLI / UI          src/cli/  src/ui/
Layer 7: Evaluation        src/evaluation/
Layer 6: Habitat           src/habitat/
Layer 5: Memory            src/memory/
Layer 4: Context           src/context/
Layer 3: Core Runtime      src/cognition/  src/stimulus/  src/interaction/
Layer 2: Providers         src/providers/
Layer 1: Foundation        src/costs/  src/rate-limit/  src/markdown/  src/schema/  src/mcp/
```

## Module Map

### `src/cognition/` — Model Runners

How to call LLMs. Wraps Vercel AI SDK with rate limiting, cost tracking, retries.

- `types.ts` — Core types: `ModelDetails`, `ModelRoute`, `ModelResponse`, `ModelRunner` interface, `ModelOptions`
- `runner.ts` — `BaseModelRunner`: `generateText`, `streamText`, `generateObject`, `streamObject`
- `smart_runner.ts` — `SmartModelRunner`: wraps a runner with before/during/after hooks
- `models.ts` — `getAllModels()`, `searchModels()`, `findModelByIdAndProvider()`

Key: `ModelResponse` has `.content` (string), NOT `.text`.

### `src/stimulus/` — Prompt Configuration

Defines *what* to say: role, objective, instructions, tools, model options. A `Stimulus` is a config object — it doesn't run anything.

- `stimulus.ts` — `Stimulus` class with `StimulusOptions`
- `creative/` — Pre-built stimuli (cat poems, frankenstein, temperature tests)
- `coding/` — Pre-built stimuli (typescript, python, debugging)
- `analysis/` — Pre-built stimuli (PDF, image, transcription analysis)
- `templates/` — Generic template factories for analysis/coding/creative
- `tools/` — Vercel AI SDK tools: `url-tools.ts` (wget, markify, parse_feed), `pdf-tools.ts`, `audio-tools.ts`, `image-tools.ts`, `examples/math.ts`
- `skills/` — `SkillsRegistry`, `loadSkillsFromDirectory`, `loadSkillsFromGit`, `createSkillTool`
- `tools/loader.ts` — Load tools from TOOL.md + handler files in a directory

Every `Interaction` requires a `Stimulus`.

### `src/interaction/` — The Conversation

Holds messages, model, stimulus, and runner. This is where the actual conversation lives.

- `core/interaction.ts` — `Interaction` class: `chat()`, `generateText()`, `streamText()`, `generateObject()`, `compactContext()`
- `adapters/` — Read external sessions: `ClaudeCodeAdapter`, `CursorAdapter`
- `analysis/` — Analyze sessions: `SessionAnalyzer`, `SessionSearch`, `ConversationBeats`
- `persistence/` — Store/retrieve: `InteractionStore`, `SessionStore`, `SessionParser`, `SessionIndexer`
- `types/` — `NormalizedSession`, `NormalizedMessage`, `SessionSource`

Usage: `new Interaction(modelDetails, stimulus)` then `interaction.chat("message")`.

### `src/providers/` — LLM Backends

Unified access to 5 providers via `BaseProvider` (abstract class with `listModels()` and `getLanguageModel()`).

- `base.ts` — `BaseProvider` abstract class
- `google.ts` — Gemini models (needs `GOOGLE_GENERATIVE_AI_API_KEY`)
- `openrouter.ts` — OpenAI, Anthropic, etc. (needs `OPENROUTER_API_KEY`)
- `ollama.ts` — Local models (no key needed)
- `lmstudio.ts` — Local REST API (no key needed)
- `github-models.ts` — GitHub-hosted models (needs `GITHUB_TOKEN`)
- `index.ts` — `getModel()`, `validateModel()`, `getModelProvider()`, `getModelDetails()`

Access through `getModel(modelDetails)` — don't instantiate providers directly.

### `src/context/` — Context Management

Track context size and compact long conversations.

- `estimate-size.ts` — `estimateContextSize()` for token estimation
- `segment.ts` — `getCompactionSegment()` to find which messages to compact
- `registry.ts` — `registerCompactionStrategy()` / `getCompactionStrategy()` / `listCompactionStrategies()`
- `types.ts` — `CompactionStrategy` interface: `compact(input) → replacementMessages`

Used via `interaction.compactContext()`.

### `src/memory/` — Fact Extraction

Extract and store facts from conversations automatically.

- `extract_facts.ts` — Pull facts from an interaction via LLM
- `determine_operations.ts` — Decide ADD/UPDATE/DELETE for memory store
- `memory_runner.ts` — `MemoryRunner` (a `SmartModelRunner` that auto-extracts facts)
- `memory_store.ts` — `InMemoryMemoryStore`

Set `stimulus.runnerType = 'memory'` for automatic fact extraction.

### `src/habitat/` — Agent Container

The top-level system. Manages work directory, config, sessions, tools, agents, and secrets.

- `habitat.ts` — `Habitat` class (static factory: `Habitat.create()`)
- `habitat-agent.ts` — `HabitatAgent`, `buildAgentStimulus()` — sub-agents for managed projects
- `session-manager.ts` — `HabitatSessionManager` — create/list/resume sessions
- `config.ts` — Directory resolution, config loading, file utilities
- `tool-sets.ts` — Named tool collections (see Tool Sets below)
- `onboard.ts` — Interactive setup wizard
- `secrets.ts` — Encrypted secrets store (`.secrets.json` in work dir)
- `transcript.ts` — Export sessions to JSONL
- `gaia-server.ts` — HTTP server for habitat API
- `load-prompts.ts` — Load stimulus options from work dir files (CLAUDE.md, README.md, etc.)

**Tool Sets** — named collections registered on a habitat:

| ToolSet | Tools | In `standardToolSets`? |
|---------|-------|----------------------|
| `fileToolSet` | read_file, write_file, list_directory, ripgrep | No (sub-agent) |
| `timeToolSet` | current_time | No (sub-agent) |
| `urlToolSet` | wget, markify, parse_feed | No (sub-agent) |
| `agentToolSet` | list/add/update/remove agents | Yes |
| `sessionToolSet` | list/show/inspect sessions | Yes |
| `externalInteractionToolSet` | read Claude Code/Cursor history | Yes |
| `agentRunnerToolSet` | agent_clone, agent_logs, agent_status, agent_ask | Yes |
| `runProjectToolSet` | run_project (Dagger smart containers) | Yes |
| `secretsToolSet` | set/remove/list secrets | Yes |
| `searchToolSet` | web search via Tavily | Yes |

`standardToolSets` = management tools. File/time/URL tools must be registered separately via `registerCustomTools`.

**Habitat tools** (`src/habitat/tools/`):

- `file-tools.ts` — Sandboxed file ops (read, write, list, ripgrep)
- `time-tools.ts` — `currentTimeTool`
- `agent-tools.ts` — Agent CRUD
- `session-tools.ts` — Session inspection
- `external-interaction-tools.ts` — Claude Code/Cursor session reading
- `agent-runner-tools.ts` — Clone repos, read logs, check status, delegate to sub-agents
- `search-tools.ts` — Web search via Tavily (needs `TAVILY_API_KEY`)
- `secrets-tools.ts` — Manage secrets in the habitat store
- `run-project/` — Smart Dagger container execution (auto-detect project type, install deps, inject API keys)

### `src/evaluation/` — Model Evaluation Framework

Systematic model assessment and comparison.

- `api.ts` — High-level `runEvaluation(config)`, `parseModel("provider:model")`
- `base.ts` — Abstract `Evaluation` — directory and cache management
- `runner.ts` — Abstract `EvaluationRunner extends Evaluation` — adds model response caching
- `strategies/` — `SimpleEvaluation`, `MatrixEvaluation`, `BatchEvaluation`, `ComplexPipeline`
- `caching/` — Cache model responses, scores, file metadata
- `dagger/` — Container-based code execution for evaluations
- `analysis/` — `ResultAnalyzer`, `ReportGenerator` (multi-format)
- `reporter.ts` — `EvaluationReporter` (incomplete, has TODOs)
- `report-generator.ts` — `ReportGenerator` (static, Docker/code-analysis focused)

Note: there are 3 report generator classes here — this is known duplication to clean up.

### `src/costs/` — Cost Tracking

- `costs.ts` — `calculateCost()`, `estimateCost()`, `formatCostBreakdown()`, `TokenUsage`, `CostBreakdown`

Built into `BaseModelRunner` automatically.

### `src/rate-limit/` — Rate Limiting

- `rate-limit.ts` — Per-model rate limit state tracking

Built into `BaseModelRunner` automatically.

### `src/markdown/` — URL & HTML Utilities

Low-level utilities consumed by `stimulus/tools/url-tools.ts`.

- `fetch_url.ts` — `fetchUrl()` with timeout/size limits
- `url_to_markdown.ts` — `urlToMarkdown()` — fetch + convert HTML
- `from_html.ts` — `fromHtmlBuiltIn()` (Turndown), `fromHtmlViaMarkify()` (external service)
- `feed_parser.ts` — `parseFeed()` — RSS/Atom feed parsing

### `src/schema/` — Structured Output

Parse DSL strings into Zod schemas, validate model output.

- `dsl-parser.ts` — `parseDSLSchema()`, `toJSONSchema()`
- `zod-loader.ts` — `loadZodSchema()`, `convertZodToSchema()`
- `zod-converter.ts` — `parsedSchemaToZod()`
- `validator.ts` — `validateSchema()`, `createValidator()`, `coerceData()`
- `manager.ts` — `SchemaManager` singleton

### `src/mcp/` — Model Context Protocol

- `client/client.ts` — MCP client for connecting to external tool servers
- `server/server.ts` — MCP server exposing umwelten as a tool provider
- `integration/stimulus.ts` — Bridge: load MCP tools into a Stimulus
- `types/` — Transport and protocol types

### `src/reporting/` — Unified Reporter

Separate from evaluation reporters. For tool test results.

- `reporter.ts` — `Reporter` class with `fromToolTest()`, `toConsole()`, `toMarkdown()`, `toHtml()`, `toJson()`
- `adapters/` — Adapt different result types to `Report`
- `renderers/` — `ConsoleRenderer`, `MarkdownRenderer`

### `src/cli/` — Command-Line Interface

Commander-based CLI. Entry point: `src/cli/entry.ts` → `src/cli/cli.ts`.

- `cli.ts` — Main program: registers `models`, `run`, `chat`, `eval`, `sessions`, `telegram`, `habitat` commands
- `habitat.ts` — `habitat` subcommand (REPL + telegram)
- `chat.ts` / `chat-new.ts` — Interactive chat
- `eval.ts` — Evaluation runner
- `run.ts` — One-shot prompt
- `models.ts` — Model listing/search
- `tools.ts` — Tool listing
- `sessions.ts` — Session management
- `telegram.ts` — Telegram bot
- `commonOptions.ts` — Shared CLI options (--provider, --model, etc.)

### `src/ui/` — User Interfaces

- `cli/` — `CLIInterface`, `CommandRegistry`, `DefaultCommands` (chat/agent/eval commands)
- `telegram/` — `TelegramAdapter` (Telegram bot interface)
- `tui/` — React Ink TUI with browser components
- `WebInterface.ts` — Web interface

## Key Patterns

**Creating a basic interaction:**
```typescript
const stimulus = new Stimulus({ role: 'helpful assistant' });
const model: ModelDetails = { name: 'gemini-3-flash-preview', provider: 'google' };
const interaction = new Interaction(model, stimulus);
const response = await interaction.chat('Hello');
```

**Using habitat:**
```typescript
const habitat = await Habitat.create({ workDir: './my-agent' });
const interaction = await habitat.createInteraction(sessionId);
```

## Environment Variables

- `GOOGLE_GENERATIVE_AI_API_KEY` — Google Gemini (NOT `GOOGLE_API_KEY`)
- `OPENROUTER_API_KEY` — OpenRouter
- `GITHUB_TOKEN` — GitHub Models
- `TAVILY_API_KEY` — Web search tool
- `MARKIFY_URL` — Optional external HTML-to-markdown service
