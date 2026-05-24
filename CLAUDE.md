# Umwelten

For **published / npm-style agent context** (shorter module map, task cheat sheet), read **[LLM.txt](LLM.txt)** at the repo root. This file is the maintainer-deep map.

## Workflow Rules

- Use `pnpm` (never `npm`)
- Use `pnpm test:run` for unit tests (never `pnpm test` — it watches). This is fast (~4s) and safe — no network, no LLM calls.
- Use `pnpm test:integration` for integration tests (needs API keys, local servers). These hit real LLM providers and will be slow.
- Use `pnpm test:all` to run both.
- Test files: `*.test.ts` = unit (mocked), `*.integration.test.ts` = integration (real APIs).
- Run tests before building
- Use `pnpm run cli` to test CLI without building (runs via tsx)
- **ALWAYS use `dotenvx run --` prefix** when running CLI commands that need env vars (e.g. `dotenvx run -- pnpm run cli -- habitat ...`). The .env file has the API keys. Never run habitat/CLI commands without it.
- Issue tracking is on GitHub (https://github.com/The-Focus-AI/umwelten/issues). All open work is tracked there as issues with the `ready-for-agent` label. When starting work, pick the next unassigned `ready-for-agent` issue from the top of the list. Update issue status with checkboxes and close when done.
- **NEVER use gemini-2 models** — always use gemini-3 (e.g. `gemini-3-flash-preview`)

## HARD RULES — do not violate, do not ask

These are invariants. Breaking them silently poisons benchmark data. If a
fix seems to require breaking one of these, STOP and surface the problem
instead — never work around it by weakening the rule.

### Token limits / output length

- **NEVER cap `maxOutputTokens` / `maxTokens` in the runner, `ModelRunnerConfig`, `request-options`, or any shared default.** Models must be free to generate to their natural stop (EOS or context limit). Capping silently truncates thinking-on model reasoning and invalidates every score downstream. There is **no scenario** where adding a default cap is acceptable.
- **Context windows should be set as high as the provider allows.** If a local llama.cpp is configured with `--ctx-size 0`, leave it. If a provider supports 1M tokens, use it.
- The **only** sanctioned way to limit output is setting `maxTokens` on a specific `Stimulus` instance — explicit, per-task, visible in request metadata.
- If a test or benchmark is "taking too long" or emitting "too many tokens," that is **data**, not a bug. Do not cap your way out of it. Investigate (is the model stuck in a repetition loop? does the prompt provoke runaway generation?) and report.
- Regression tests live at `packages/core/src/cognition/request-options.test.ts` — they assert that `buildRequestOptions()` does not inject any cap. Do not weaken or skip these tests.

### Scope of changes

- Do not make "wild-ass changes." If you think a subsystem is broken, describe the symptom and propose the fix before editing shared runtime code (`cognition/`, `interaction/`, `providers/`). Changes to these files affect every evaluation and every downstream benchmark.
- Never silently change a default that the existing benchmark data was collected against. If you must change such a default, the old data becomes incomparable — flag this explicitly before touching anything.

## Architecture Overview

pnpm workspace monorepo. Each package is under `packages/` and publishable independently.

```
@umwelten/core       packages/core/          — model runners, stimulus, interaction, providers, context, memory, session-record, env
@umwelten/protocols  packages/protocols/     — MCP (legacy + modern + mcp-serve OAuth framework), A2A client/server
@umwelten/sessions   packages/sessions/      — sessions/browse/introspect CLI commands + session browser data layer
@umwelten/evaluation packages/evaluation/    — EvalSuite, llm-eval/runFullEval, ranking, combine, reporting
@umwelten/habitat    packages/habitat/       — agent container, tools, Gaia, container-server (MCP+A2A+web+chat)
@umwelten/ui         packages/ui/            — Telegram, Discord, TUI (Ink) adapters
@umwelten/cli        packages/cli/           — Commander CLI entry point
umwelten             packages/umwelten/      — meta-package re-exporting everything for npm
```

Dependency DAG (no cycles):

```
@umwelten/core              ← foundation, no internal deps
@umwelten/protocols         ← core
@umwelten/sessions          ← core
@umwelten/evaluation        ← core, sessions
@umwelten/habitat           ← core, protocols, sessions
@umwelten/ui                ← core, sessions, evaluation, habitat
@umwelten/cli               ← core, sessions, evaluation, habitat, ui
umwelten (meta)             ← every package above
```

Two seams worth noting: `ui/index.ts` re-exports some habitat internals, and `cli → sessions → ui` is a runtime path that side-steps the documented `cli → ui` edge. Both are documented drift, not bugs.

Source paths below use `src/` relative to each package (e.g. `src/cognition/` means `packages/core/src/cognition/`).

## Module Map

### `src/cognition/` — Model Runners

How to call LLMs. Wraps Vercel AI SDK with rate limiting, cost tracking, retries.

- `types.ts` — Core types: `ModelDetails`, `ModelRoute`, `ModelResponse`, `ModelRunner` interface, `ModelOptions`
- `runner.ts` — `BaseModelRunner`: `generateText`, `streamText`, `generateObject`, `streamObject`
- `smart_runner.ts` — `SmartModelRunner`: wraps a runner with before/during/after hooks
- `models.ts` — `getAllModels()`, `searchModels()`, `findModelByIdAndProvider()`

Key: `ModelResponse` has `.content` (string), NOT `.text`.

**User tracking:** The runner automatically forwards `interaction.userId` to providers that support it. Set `interaction.userId` to a stable identifier (not PII) and the runner injects it into `providerOptions`:

- **OpenRouter** → `{ openrouter: { user: userId } }` — enables per-user cost analytics and abuse detection
- **Anthropic** → `{ anthropic: { metadata: { userId } } }` — enables abuse detection
- Other providers (Google, DeepInfra, Together AI, etc.) have no user tracking — the field is ignored.

### `src/stimulus/` — Prompt Configuration

Defines _what_ to say: role, objective, instructions, tools, model options. A `Stimulus` is a config object — it doesn't run anything.

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

Unified access to 8 providers via `BaseProvider` (abstract class with `listModels()` and `getLanguageModel()`).

- `base.ts` — `BaseProvider` abstract class
- `google.ts` — Gemini models (needs `GOOGLE_GENERATIVE_AI_API_KEY`)
- `openrouter.ts` — OpenAI, Anthropic, etc. (needs `OPENROUTER_API_KEY`)
- `deepinfra.ts` — DeepInfra models (needs `DEEPINFRA_API_KEY`)
- `togetherai.ts` — Together AI models (needs `TOGETHER_API_KEY`)
- `ollama.ts` — Local models (no key needed)
- `lmstudio.ts` — Local REST API (no key needed)
- `llamabarn.ts` — [LlamaBarn](https://github.com/ggml-org/LlamaBarn) local llama.cpp models via OpenAI-compatible API at `http://localhost:2276/v1` (no key needed)
- `llamaswap.ts` — [llama-swap](https://github.com/mostlygeek/llama-swap) proxy; OpenAI-compatible, default `http://localhost:8080/v1` (override with `LLAMASWAP_HOST`). Use `umwelten models llamaswap-config` to generate its YAML config from local GGUF caches.
- `llamaswap-config.ts` — pure helpers to scan GGUF caches (LM Studio, LlamaBarn, HF hub) and emit a `llama-swap` YAML. Exposed via the `umwelten models llamaswap-config` CLI command.
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

Explicit helpers for extracting and reconciling facts from conversations. `Interaction` always uses the base runner; automatic chat memory is no longer a public runner mode.

- `extract_facts.ts` — Pull facts from an interaction via LLM
- `determine_operations.ts` — Decide ADD/UPDATE/DELETE operations for a caller-managed memory store

### `src/habitat/` — Agent Container

The top-level system. Manages work directory, config, sessions, tools, agents, and secrets.

- `habitat.ts` — `Habitat` class (static factory: `Habitat.create()`, `createAgentInteraction()`)
- `habitat-agent.ts` — `HabitatAgent`, `buildAgentStimulus()` — sub-agents for managed projects
- `session-manager.ts` — `HabitatSessionManager` — create/list/resume sessions
- `config.ts` — Directory resolution, config loading, file utilities
- `tool-sets.ts` — Named tool collections (see Tool Sets below)
- `onboard.ts` — Interactive setup wizard
- `secrets.ts` — Work-dir `secrets.json` (plain JSON map, file mode 0600)
- `transcript.ts` — Export sessions to JSONL
- `gaia-server.ts` — Legacy single-habitat web UI server
- `a2a-handler.ts` — Habitat ↔ A2A adapter (`HabitatAgentExecutor`, `buildAgentCard`); the actual A2A protocol scaffolding lives in `@umwelten/server/a2a/`
- `mcp-local-server.ts` — **MCP server exposing all habitat tools over Streamable HTTP** (no OAuth, for local/container use)
- `gaia/` — **Gaia Orchestrator** — manages multiple habitat containers (see Gaia section below)
- `load-prompts.ts` — Load stimulus options from work dir files (CLAUDE.md, README.md, etc.)
- `bridge/` — Channel-bridge plumbing shared by every UI adapter (Telegram, Discord, web, Gaia):
  - `channel-bridge.ts` — `ChannelBridge` class; routes a channel/thread → habitat session → `Interaction`; injects runtime selection (base vs claude-sdk).
  - `routing.ts` — channelKey → agent resolution with fallback chain (`exact → parent → platform default → global default → main`). Reads `routing.json`; falls back to legacy `discord.json` until that migration finishes.
  - `commands.ts` — slash-command processor (reset / agents / switch / status / help).
  - `index.ts`, `types.ts` — barrel + shared types.

**Directory layout** — sessions are co-located inside the work directory:

```
workDir/
  config.json         # agent definition
  STIMULUS.md         # persona
  secrets.json        # API keys (mode 0600)
  skills/             # installed skills
  tools/              # custom tools
  sessions/           # conversation history (JSONL)
```

**MCP Server** (`mcp-local-server.ts`):

Exposes all habitat tools as MCP tools over Streamable HTTP at `/mcp`. Stateless (no session management — that's the A2A layer's job). Uses official `@modelcontextprotocol/sdk`.

```bash
# Start the MCP server (default port: 7430)
dotenvx run -- pnpm run cli habitat serve

# Connect with any MCP client
dotenvx run -- pnpm run cli mcp chat --url http://localhost:7430/mcp
```

**Tool Sets** — named collections registered on a habitat:

| ToolSet                      | Tools                                                                                              | In `standardToolSets`? |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------- |
| `fileToolSet`                | read_file, write_file, list_directory, ripgrep                                                     | Yes                    |
| `timeToolSet`                | current_time                                                                                       | Yes                    |
| `urlToolSet`                 | wget, markify, parse_feed                                                                          | Yes                    |
| `agentToolSet`               | list/add/update/remove agents                                                                      | Yes                    |
| `sessionToolSet`             | sessions\_\* list/show/messages/stats/inspect/read_file, learnings append/read, transcript compact | Yes                    |
| `externalInteractionToolSet` | read Claude Code/Cursor history                                                                    | Yes                    |
| `agentRunnerToolSet`         | agent_clone, agent_register_directory, agent_logs, agent_status, agent_ask, agent_ask_claude, agent_configure | Yes                    |
| `secretsToolSet`             | set/remove/list secrets                                                                            | Yes                    |
| `searchToolSet`              | web search via Tavily                                                                              | Yes                    |
| `selfModifyToolSet`          | create_tool, create_skill, reload, list, remove                                                    | Yes                    |

`standardToolSets` includes all tool sets. All are registered by default.

**Habitat tools** (`src/habitat/tools/`):

- `file-tools.ts` — Sandboxed file ops (read, write, list, ripgrep)
- `time-tools.ts` — `currentTimeTool`
- `agent-tools.ts` — Agent CRUD
- `session-tools.ts` — Session inspection
- `external-interaction-tools.ts` — Claude Code/Cursor session reading
- `agent-runner-tools.ts` — Clone repos, register directories as agents, read logs, check status, delegate to sub-agents via base runner (`agent_ask`) or Claude Agent SDK (`agent_ask_claude`), configure an agent's MEMORY.md
- `search-tools.ts` — Web search via Tavily (needs `TAVILY_API_KEY`)
- `secrets-tools.ts` — Manage secrets in the habitat store
- `self-modify-tools.ts` — Create/remove tools and skills at runtime

#### `src/habitat/gaia/` — Gaia Orchestrator

Manages multiple habitat containers from a single dashboard. Gaia is a **normal habitat** (runs on `startContainerServer`) with extra orchestrator tools — it gets sessions, MCP, A2A, artifacts, and tool logging for free.

- `types.ts` — `GaiaHabitatEntry`, `GaiaRegistry`, `ContainerStatus`, `GaiaOrchestratorOptions`
- `registry.ts` — `GaiaRegistryManager` — CRUD for `registry.json` in data dir
- `secrets.ts` — `GaiaSecretVault` — master secret vault + per-container filtering
- `docker.ts` — `DockerManager` — build/start/stop/logs/status via docker CLI, named volumes, port assignment
- `proxy.ts` — `proxyRequest()`, `fetchFromContainer()` — reverse proxy with Bearer auth injection
- `gaia-tools.ts` — `createGaiaToolSet()` — 14 AI SDK tools as a `ToolSet` (closure over registry/vault/docker). Speaks A2A to running containers via `fetchAgentCard()` / `sendA2AMessage()` from `@umwelten/server`.
- `routes.ts` — API route handlers mounted via `extraRawHandler` on container-server
- `ui/index.html` — Dashboard SPA (Chat, Habitats, Secrets, Create tabs)

```bash
# Start Gaia orchestrator (default port: 7420)
dotenvx run -- pnpm run cli habitat gaia -p google -m gemini-3-flash-preview

# With custom data dir
dotenvx run -- pnpm run cli habitat gaia --data-dir ./my-gaia-data -p google -m gemini-3-flash-preview
```

**Storage**: Named Docker volumes (`gaia-<id>-data`), not bind mounts. Volumes are seeded with `config.json` and `secrets.json` via one-shot Alpine containers. Registry and master secrets live in the data dir on the host.

### `@umwelten/evaluation` — Model Evaluation Framework

Systematic model assessment and comparison. **There is no `umwelten eval` CLI command** — evaluations are driven by scripts in `examples/`. The canonical primitive is `EvalSuite`; for end-to-end multi-suite runs, compose via `llm-eval/runFullEval`.

**High-level (the canonical entry):**

- `suite.ts` — **`EvalSuite`**: declarative eval runner. Define tasks + stimulus + models → get scored results + leaderboard. Two task types: `VerifyTask` (deterministic `verify()`) and `JudgeTask` (LLM judge with Zod schema). Handles caching, concurrency, AbortSignal propagation, and console output. Run with the same `--all` / `--new` / `--run N` / `--only` flags the example scripts already accept.

**llm-eval — framework layer composing EvalSuites:**

- `llm-eval/index.ts` — `runFullEval(model, opts)` runs three sub-suites against one model: language (instruction + reasoning), coding (write-from-spec + bugfix), tool-calling (multi-step tool-math). Propagates `AbortSignal` down to the AI SDK call so a watchdog can cancel cleanly.
- `llm-eval/language.ts`, `llm-eval/coding.ts`, `llm-eval/tool-calling.ts` — the three sub-suite builders.
- `llm-eval/data/` — fixtures: `coding-challenges.ts`, `instruction-tasks.ts`, `reasoning-puzzles.ts`.

**Strategies:**

- `strategies/simple-evaluation.ts` — `SimpleEvaluation` is the only live strategy. Backs `EvalSuite`.

**Ranking (post-processing):**

- `ranking/pairwise-ranker.ts` — `PairwiseRanker`: head-to-head LLM judge comparisons → Elo ratings. Swiss tournament or round-robin. Cached per-comparison.
- `ranking/elo.ts` — `expectedScore()`, `updateElo()`, `buildStandings()`
- `ranking/pairing.ts` — `allPairs()`, `swissPairs()`
- `ranking/types.ts` — `RankingEntry`, `PairwiseResult`, `RankedModel`, `RankingOutput`, `PairwiseRankerConfig`, `evaluationResultsToRankingEntries`

**Infrastructure:**

- `caching/cache-service.ts` — `EvaluationCache`: per-model response cache used by `SimpleEvaluation` and `EvalSuite`.
- `dagger/` + `dagger-runner.ts` — Container-based code execution for coding evals (consumed by model-showdown).
- `combine/` — Multi-evaluation aggregation and combined reporting (see below).
- `replay.ts` — Transcript replay used by 2-pass coding eval.
- `reporting/` — `Reporter` class + `Report` types + console/markdown renderers (was wrongly listed under core in earlier CLAUDE.md).

**Driving an evaluation — script pattern:**

```typescript
import { EvalSuite } from '@umwelten/evaluation/evaluation/suite.js';
import '@umwelten/core/env/load.js';

const suite = new EvalSuite({ name: 'my-eval', stimulus: {...}, tasks: [...], models: [...] });
await suite.run();
```

See `examples/evals/` and `examples/local-providers/` (especially `run-matrix.ts`) for live patterns. `examples/local-providers/` wraps `runFullEval` with eviction + watchdog + preflight for local-model benchmarks.

#### `src/evaluation/combine/` — Suite Aggregation

Combine results from multiple evaluations into a unified leaderboard with cost/speed analysis.

- `types.ts` — `EvalDimension`, `DimensionScore`, `ModelScorecard`, `SuiteResult`, `SuiteRunInfo`, `TaskResult`
- `loader.ts` — `loadSuite(dimensions)`, `findLatestRunDir(evalName)`, `loadDimension(dim, runDir)` — reads result JSON files, extracts scores, normalizes to percentages
- `report-builder.ts` — `buildSuiteReport(suite, options)` → `Report` with leaderboard, cost efficiency, speed, per-dimension detail tables
- `narrative-report.ts` — `buildNarrativeReport(suite, options)` → standalone markdown writeup with methodology, test descriptions, analysis, and judge explanations
- `index.ts` — Barrel exports

**Suite config pattern** — define an `EvalDimension[]` array:

```typescript
import type { EvalDimension } from "/evaluation/evaluation/combine/index.js";
export const MY_SUITE: EvalDimension[] = [
  {
    evalName: "my-eval-reasoning",
    label: "Reasoning",
    maxScore: 20,
    extractScore: (r) => r.score ?? 0,
    hasResultsSubdir: true,
  },
  {
    evalName: "my-eval-knowledge",
    label: "Knowledge",
    maxScore: 30,
    extractScore: (r) => (r.correct ? 1 : 0),
  },
];
```

**Report formats:**

- `console` — structured tables via `Reporter.toConsole()`
- `md` / `markdown` — structured markdown via `Reporter.toMarkdown()`
- `json` — structured JSON via `Reporter.toJson()`
- `narrative` — full prose writeup with methodology, per-section analysis, cost/speed breakdown

See `examples/model-showdown/` for a complete suite example.

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

- `client/client.ts` — Low-level MCP client (custom protocol implementation)
- `client/remote.ts` — **`RemoteMcpClient`**: connect to any remote MCP server over Streamable HTTP with OAuth 2.1 PKCE. File-backed token storage at `~/.umwelten/mcp-auth/`. Converts MCP tools → Vercel AI SDK tools for use with Interactions.
- `server/server.ts` — MCP server exposing umwelten as a tool provider
- `integration/stimulus.ts` — Bridge: load MCP tools into a Stimulus
- `types/` — Transport and protocol types

### `src/introspection/` — Session Browser Data Layer

Browses sessions and their **digests** (produced by `src/interaction/analysis/session-digester.ts`). There is no longer a separate "introspection" LLM pipeline — digests are the one source of session analysis, and the browser surfaces them.

- `browse.ts` — `buildBrowse()` assembles every session (claude-code + habitat) with its digest (loaded from `~/.umwelten/digests/sessions/<id>.json`). `applyFilter()` — date window, source, status, free-text search. `loadDigest()` / `saveDigest()` — digest round-trip.
- `storage.ts` — legacy run/decision log structure kept for data already on disk; not used for new work.
- `types.ts` — shared types.

TUIs in `src/ui/tui/introspect/`:

- `BrowseApp` / `runIntrospectBrowseTui` — **primary entry**. Fixed-width panes; edge-scroll. Shows digest data when present (summary, key learning, topics, tags, phases, counts). Keys: `enter` detail view, `D` run digest (streams live), `b` beats (no LLM), `v` transcript, `/` search, `q` quit.
- `detail.tsx` — per-session detail view (tabs over digest: overview, beats, phases, facts, diff-against-CLAUDE.md).
- `digest-live.tsx` — live streaming progress for the digester pipeline.

CLI in `src/cli/introspect.ts`:

- `umwelten browse` (top-level) — the primary entry.
- `umwelten introspect browse` — namespaced alias for discoverability.

### `src/reporting/` — Unified Reporter

General-purpose report rendering. Used by tool tests and evaluation suite reports.

- `reporter.ts` — `Reporter` class with `fromToolTest()`, `toConsole()`, `toMarkdown()`, `toHtml()`, `toJson()`
- `adapters/` — Adapt different result types to `Report`
- `renderers/` — `ConsoleRenderer`, `MarkdownRenderer`
- `types.ts` — `Report`, `ReportSection`, `ReportType` (`'tool-test' | 'code-generation' | 'evaluation' | 'batch' | 'suite'`)

### `src/cli/` — Command-Line Interface

Commander-based CLI. Entry point: `src/cli/entry.ts` → `src/cli/cli.ts`.

- `cli.ts` — Main program: registers `models`, `run`, `chat`, `eval`, `sessions`, `telegram`, `habitat`, `mcp` commands
- `habitat.ts` — `habitat` subcommand (REPL + telegram + discord + web)
- `mcp.ts` — `mcp` subcommand: `mcp chat` (connect to remote MCP server with OAuth, REPL or one-shot), `mcp connect`, `mcp test-tool`
- `chat.ts` — Interactive chat
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
- `discord/` — `DiscordAdapter` (Discord bot interface; channel→agent via `discord.json`)
- `tui/` — React Ink TUI with browser components
- `WebInterface.ts` — Web interface

## Key Patterns

**Creating a basic interaction:**

```typescript
const stimulus = new Stimulus({ role: "helpful assistant" });
const model: ModelDetails = {
  name: "gemini-3-flash-preview",
  provider: "google",
};
const interaction = new Interaction(model, stimulus);
const response = await interaction.chat("Hello");
```

**Using habitat:**

```typescript
const habitat = await Habitat.create({ workDir: "./my-agent" });
const interaction = await habitat.createInteraction(sessionId);
```

## CLI Quick Reference

Use the CLI at runtime — don't import TypeScript modules directly for discovery tasks.

```bash
# List/search models (use this to find model names for evaluations)
dotenvx run -- pnpm run cli models --search gpt-5
dotenvx run -- pnpm run cli models --provider openrouter --json
dotenvx run -- pnpm run cli models --provider ollama

# Run an evaluation — there is no CLI command; drive EvalSuite from a script.
# Examples:
dotenvx run -- pnpm tsx examples/evals/instruction.ts          # quick (3 models)
dotenvx run -- pnpm tsx examples/evals/instruction.ts --all    # full
dotenvx run -- pnpm tsx examples/evals/reasoning.ts --all --new
dotenvx run -- pnpm tsx examples/local-providers/run-matrix.ts # local-model harness
dotenvx run -- pnpm tsx examples/local-providers/run-one.ts ollama:gemma4:26b

# Combine multiple eval runs into a unified report — also script-driven
# (see examples/model-showdown/suite-config.ts for the EvalDimension[] pattern).

# Run a one-shot prompt
dotenvx run -- pnpm run cli run --provider google --model gemini-3-flash-preview --prompt "Hello"

# Start habitat as an MCP server (default port: 7430)
dotenvx run -- pnpm run cli habitat serve
dotenvx run -- pnpm run cli habitat serve --port 7430 --work-dir ./my-agent

# Connect to any MCP server and chat (OAuth handled automatically if server requires it)
dotenvx run -- pnpm run cli mcp chat --url http://localhost:7430/mcp
dotenvx run -- pnpm run cli mcp chat --url http://localhost:7430/mcp --one-shot "list my files"
dotenvx run -- pnpm run cli mcp chat --url https://oura-mcp.fly.dev/mcp
dotenvx run -- pnpm run cli mcp chat --url https://oura-mcp.fly.dev/mcp --one-shot "how did I sleep?"

# Start Gaia orchestrator (default port: 7420)
dotenvx run -- pnpm run cli habitat gaia -p google -m gemini-3-flash-preview

# Session browser — primary entry for session review and digest management.
# Every session (claude-code and habitat) with its digest (topics, tags, summary,
# phases, facts, metrics) shown inline. 30d default window; press 4 for all.
# Keys: enter=detail view · D=run digest (streams) · b=beats (no LLM) · v=transcript · / search · q quit
dotenvx run -- pnpm run cli browse
dotenvx run -- pnpm run cli browse --sessions-dir examples/jeeves-bot/jeeves-bot-sessions  # habitat mode

# Or via mise
mise run browse               # primary entry
mise run habitat-browse       # against a habitat's sessions
```

## Environment Variables

- `GOOGLE_GENERATIVE_AI_API_KEY` — Google Gemini (NOT `GOOGLE_API_KEY`)
- `OPENROUTER_API_KEY` — OpenRouter
- `GITHUB_TOKEN` — GitHub Models
- `FIREWORKS_API_KEY` — Fireworks.ai
- `DEEPINFRA_API_KEY` — DeepInfra
- `TOGETHER_API_KEY` — Together AI
- `TAVILY_API_KEY` — Web search tool
- `MARKIFY_URL` — Optional external HTML-to-markdown service

## Port Scheme (74xx block)

All umwelten services use the 74xx port range to avoid conflicts with common dev servers.

| Service                 | Port          | Notes                                      |
| ----------------------- | ------------- | ------------------------------------------ |
| Gaia orchestrator       | **7420**      | `habitat gaia` — multi-habitat dashboard   |
| Legacy `habitat web`    | **7421**      | `habitat web` — single-habitat web UI      |
| `habitat serve` (host)  | **7430**      | `habitat serve` — MCP + chat + web UI      |
| Managed containers      | **7440–7499** | Gaia assigns sequentially from this range  |
| Internal container port | **8080**      | Inside Docker only, never exposed directly |

## Test Suites

| Command                 | Scope                                                                       | Speed |
| ----------------------- | --------------------------------------------------------------------------- | ----- |
| `pnpm test:run`         | Unit tests only (`*.test.ts`) — no network, no LLM                          | ~4s   |
| `pnpm test:integration` | Integration tests (`*.integration.test.ts`) — needs API keys, local servers | slow  |
| `pnpm test:all`         | Both suites                                                                 | both  |
