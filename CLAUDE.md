# Umwelten

For **published / npm-style agent context** (shorter module map, task cheat sheet), read **[LLM.txt](LLM.txt)** at the repo root. For the **domain glossary** (Interaction, Source Session, Exploration, Reflection, Memory, Project Fact, Saved Exploration), read **[CONTEXT.md](CONTEXT.md)** — that file defines the language this codebase uses and is the ground truth when prose and code disagree on naming.

This file is the maintainer-deep map.

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

- `core/interaction.ts` — `Interaction` class: `generateText()`, `streamText()`, `generateObject()`, `streamObject()`, `compactContext()`, `setCheckpoint()` / `getCheckpoint()`, plus `toNormalizedSession()` / `fromNormalizedSession()` round-tripping.
- `adapters/` — Read external sessions: `ClaudeCodeAdapter`, `CursorAdapter`, `PiAdapter`. Dispatcher: `load-interaction.ts` (`loadInteraction(sessionId, model, stimulus?)`, source detection, `summarizeNormalizedSession`).
- `analysis/` — Session analysis: `SessionAnalyzer` (legacy single-pass), `session-digester.ts` (modern multi-stage: compaction + analysis + beats + phases + facts), `extraction-engine.ts`, `digest-persistence.ts` (canonical home of `loadDigest`/`saveDigest`/`getDigestPath`), `digest-search.ts`, `session-search.ts`, `ConversationBeats`.
- `persistence/` — Two stores under one name: `InteractionStore` (small generic JSONL save/load) and the Claude-Code-specific stack (`SessionStore`, `SessionParser`, `SessionIndexer`).
- `types/normalized-types.ts` — `NormalizedSession`, `NormalizedMessage`, `SessionSource`.
- `types/domain-types.ts` — `Exploration`, `SourceSession`, `SavedExploration`, `applyExploreFilter`, the Exploration Browser types. See **CONTEXT.md** at the repo root for the canonical domain language.

**Exploration / knowledge pipeline** (lives in core but is its own coherent feature surface; see CONTEXT.md for the terms):

- `projection/` — Project a `NormalizedSession` → `SourceSession` → default `Exploration`. `projectSessions(projectPath)` walks every registered adapter.
- `reflection/` — `buildReflectiveInteraction(explorations, question, opts)` constructs an Interaction whose system prompt is a "reflective analyst" plus exploration context. Not a new runner — just a configured Interaction.
- `promotion/` — `classifyReflectionAnswer(text)` returns one of 8 `PromotionTarget`s (`agent-instruction`, `project-fact`, `domain-language`, `adr`, `skill`, `artifact`, `saved-reflection`, `user-model`). `PromotionRouter.promote(decision)` writes via the matching `knowledge/` helper.
- `knowledge/` — Seven file writers: `AGENTS.md`, `FACTS.md`, `user-model.md` (marker-managed sections), `.umwelten/reflections/`, `.umwelten/artifacts/`, `.umwelten/candidates/`, `.umwelten/explorations/`. Plus `SavedExplorationStore`.

Consumed by `@umwelten/sessions/introspect` (projection) and `@umwelten/cli/knowledge` (reflection + promotion). The pipeline is a candidate for splitting out into `@umwelten/knowledge` later — see Wave H in `docs/architecture/system-map-2026-05.md`.

Usage: `new Interaction(modelDetails, stimulus)` then `interaction.streamText()` / `generateText()` etc. There is no `chat()` method on `Interaction`; the CLI/REPL wraps `streamText` plus an observer.

### `src/providers/` — LLM Backends

Unified access to 12 providers via `BaseProvider` (abstract class with `listModels()` and `getLanguageModel()`).

- `base.ts` — `BaseProvider` abstract class
- `google.ts` — Gemini models (needs `GOOGLE_GENERATIVE_AI_API_KEY`)
- `openrouter.ts` — OpenAI, Anthropic, etc. (needs `OPENROUTER_API_KEY`)
- `deepinfra.ts` — DeepInfra models (needs `DEEPINFRA_API_KEY`)
- `togetherai.ts` — Together AI models (needs `TOGETHER_API_KEY`)
- `fireworks.ts` — Fireworks.ai models (needs `FIREWORKS_API_KEY`)
- `minimax.ts` — MiniMax models (needs `MINIMAX_API_KEY`)
- `nvidia.ts` — NVIDIA-hosted models (needs `NVIDIA_API_KEY`)
- `lunaroute.ts` — [LunaRoute](https://lunaroute.com) hosted inference router for open-weight models. OpenAI-compatible gateway at `https://gw.lunaroute.com/v1` (needs `LUNAROUTE_API_KEY`; override base with `LUNAROUTE_BASE_URL`). Served model IDs carry variant suffixes (e.g. `glm-5.2-nvfp4`) — check `umwelten models --provider lunaroute`
- `github-models.ts` — GitHub-hosted models (needs `GITHUB_TOKEN`)
- `ollama.ts` — Local models (no key needed)
- `lmstudio.ts` — Local REST API (no key needed)
- `llamabarn.ts` — [LlamaBarn](https://github.com/ggml-org/LlamaBarn) local llama.cpp models via OpenAI-compatible API at `http://localhost:2276/v1` (no key needed)
- `llamaswap.ts` — [llama-swap](https://github.com/mostlygeek/llama-swap) proxy; OpenAI-compatible, default `http://localhost:8080/v1` (override with `LLAMASWAP_HOST`). Use `umwelten models llamaswap-config` to generate its YAML config from local GGUF caches.
- `llamaswap-config.ts` — pure helpers to scan GGUF caches (LM Studio, LlamaBarn, HF hub) and emit a `llama-swap` YAML. Exposed via the `umwelten models llamaswap-config` CLI command.
- `local-fetch.ts` — shared HTTP helpers for local providers (Ollama, LM Studio, LlamaBarn, llama-swap).
- `registry.ts` — `registerProvider`, `getRegisteredProvider`, `listRegisteredProviders`.
- `index.ts` — `getModel()`, `validateModel()`, `getModelProvider()`, `getModelDetails()`.

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

### `src/dialogue/` — Agent Dialogues

Turn-orchestrated conversations between 2+ named Participants (see **Dialogue** in CONTEXT.md). One canonical event log of typed entries — spoken turns plus ambient `event` world input; each model participant keeps a private Interaction view (own turns = assistant, others' = one batched user message rendered per event kind). Persists as a `dialogue` session; habitat dialogues are readable by `umwelten browse`, persona-only ones live under `~/.umwelten/dialogues/`.

- `dialogue.ts` — `Dialogue` orchestrator: `step()` / `run()` / `post()` (spoken interjection or `kind: "event"`), stop conditions (maxTurns default 8, anyDone/allDone, abort signal, until predicate)
- `types.ts` — `Participant` (with `onDialogueStart`/`onDialogueEnd`), `DialogueEvent`, `TurnPolicy`, `StopConditions`, `DialogueObserver`
- `render.ts` — `renderEventLine()`: single source of truth for the `[Name]: text` / `(event)` wire format shared by participants, moderator, and persistence
- `participants/interaction-participant.ts` — wraps any Interaction; structured `bow_out` done tool (trailing `<done/>` honored as fallback), self-prefix strip, tool-only-turn retry, opt-in `historyWindow` (bounded view, own turns stored as self-narration)
- `participants/human-participant.ts` — human seat via `getInput` callback
- `policies/round-robin.ts`, `policies/moderator.ts` — stateless round-robin default (rotation derived from the event log); moderator model picks speakers via `generateObject`
- `persist.ts` — canonical transcript.jsonl + meta.json (`type: "dialogue"`, participant roster in metadata)

Surfaces: `umwelten converse` CLI (agents + personas + `--moderator`), habitat `agent_converse` tool, `examples/dialogue-debate/`. Habitat adapter: `packages/habitat/src/dialogue/habitat-agent-participant.ts` (dialogue-scoped Interactions, `withAgentCall` recursion bounding). Docs: `docs/guide/agent-dialogues.md`.

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
- `a2a-handler.ts` — Habitat ↔ A2A adapter (`HabitatAgentExecutor`, `buildAgentCard`); the actual A2A protocol scaffolding lives in `@umwelten/protocols/a2a/`
- `mcp-local-server.ts` — **MCP server exposing all habitat tools over Streamable HTTP** (no OAuth, for local/container use)
- `gaia/` — **Gaia Orchestrator** — manages multiple habitat containers (see Gaia section below)
- `load-prompts.ts` — Load stimulus options from work dir files (CLAUDE.md, README.md, etc.)
- `bridge/` — Channel-bridge plumbing shared by every UI adapter (Telegram, Discord, web, Gaia):
  - `channel-bridge.ts` — `ChannelBridge` class; routes a channel/thread → habitat session → `Interaction`; injects runtime selection (base loop vs registered RuntimeRunners: built-in `claude-sdk`/`pi` plus any `config.runtimes`-declared CLI via `cli-runner.ts` — codex preset, or anything mise installs; each declared runtime gets a scoped env of only its listed secrets).
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
| `agentRunnerToolSet`         | agent_clone, agent_register_directory, agent_logs, agent_status, agent_ask, agent_ask_claude, agent_converse, agent_configure | Yes                    |
| `secretsToolSet`             | set/remove/list secrets                                                                            | Yes                    |
| `searchToolSet`              | web search via Tavily                                                                              | Yes                    |
| `storageToolSet`             | drive_list/search/fetch/put/export/changes over the habitat's backing-storage Drive folder (habitats ADR 0005); inert unless a token source is configured | Yes                    |
| `selfModifyToolSet`          | create_tool, create_skill, reload, list, remove                                                    | Yes                    |
| `remoteAgentToolSet`         | ask_remote_agent — A2A to peers declared with kind `remote-habitat` (registers nothing when none)  | Yes                    |

`standardToolSets` includes all tool sets. All are registered by default.

**Habitat tools** (`src/habitat/tools/`):

- `file-tools.ts` — Sandboxed file ops (read, write, list, ripgrep)
- `time-tools.ts` — `currentTimeTool`
- `agent-tools.ts` — Agent CRUD
- `session-tools.ts` — Session inspection
- `external-interaction-tools.ts` — Claude Code/Cursor session reading
- `agent-runner-tools.ts` — Clone repos, register directories as agents, read logs, check status, delegate to sub-agents via base runner (`agent_ask`) or Claude Agent SDK (`agent_ask_claude`), run multi-turn dialogues between agents (`agent_converse`), configure an agent's MEMORY.md
- `search-tools.ts` — Web search via Tavily (needs `TAVILY_API_KEY`)
- `storage-tools.ts` — Backing-storage Drive tools (habitats ADR 0005): token via Gaia `POST /storage/token` relay (`GAIA_URL` + `HABITAT_API_KEY`) or direct `GOOGLE_DRIVE_ACCESS_TOKEN`; size-capped scratch cache in `storage-cache/`
- `secrets-tools.ts` — Manage secrets in the habitat store
- `self-modify-tools.ts` — Create/remove tools and skills at runtime
- `remote-agent-tools.ts` — `ask_remote_agent`: A2A `message/send` to remote habitats declared in `config.agents[]` (kind `remote-habitat`, URL/token via `a2aUrl`/`a2aUrlSecret`/`a2aTokenSecret`)

#### `src/habitat/gaia/` — Gaia Orchestrator

Manages multiple habitat containers from a single dashboard. Gaia is a **normal habitat** (runs on `startContainerServer`) with extra orchestrator tools — it gets sessions, MCP, A2A, artifacts, and tool logging for free.

- `types.ts` — `GaiaHabitatEntry`, `GaiaRegistry`, `ContainerStatus`, `GaiaOrchestratorOptions`
- `registry.ts` — `GaiaRegistryManager` — CRUD for `registry.json` in data dir
- `secrets.ts` — `GaiaSecretVault` — master secret vault + per-container filtering
- `docker.ts` — `DockerManager` — build/start/stop/logs/status via docker CLI, named volumes, port assignment
- `proxy.ts` — `proxyRequest()`, `fetchFromContainer()` — reverse proxy with Bearer auth injection
- `gaia-tools.ts` — `createGaiaToolSet()` — 14 AI SDK tools as a `ToolSet` (closure over registry/vault/docker). Speaks A2A to running containers via `fetchAgentCard()` / `sendA2AMessage()` from `@umwelten/protocols`.
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

### `src/session-record/` — Session Storage Substrate

Unified **session handles**, **learnings** (typed append-only JSONL), and **transcript compaction** so habitat traffic and Claude Code sessions share one save/load interface for derived knowledge — without writing into Anthropic's `~/.claude` JSONL files. Heavily consumed by habitat (`bridge/channel-bridge.ts`, `tools/session-tools.ts`), Discord/Telegram adapters (transcript resume), and the digester.

- `types.ts` — `SessionHandle`, `LearningKind` / `LearningRecord`, `CompactionEventV1`.
- `learnings-store.ts` — `FileLearningsStore`, append-only `.jsonl` per kind: `facts`, `skill_candidates`, `preferences`, `open_loops`, `mistakes`.
- `transcript-segments.ts` — list frozen + live segments.
- `transcript-write.ts` — write `CoreMessage[]` → Claude-style JSONL.
- `habitat-transcript-load.ts` — replay.
- `context-merge.ts` — `buildHabitatIntrospectionContextMessages` prepends compaction summaries + learnings as system messages.
- `compaction-habitat.ts` — freeze the live tail, start a new live segment with an `umwelten_compaction` marker.
- `resolve-habitat.ts` / `resolve-claude.ts` — produce a `SessionHandle`.

**Layering note**: this lives in core only because extracting it from habitat broke a `habitat ↔ ui` cycle (`transcript-write.ts:5-7` documents the trade-off). Core therefore knows habitat-specific filesystem conventions. Long-term either accept that ("core hosts the cross-cutting session substrate") or hoist into a `@umwelten/session-record` package. See `docs/architecture/session-record-introspection.md` for the deeper design.

### `src/env/` — dotenv side-effect loader

- `load.ts` — Walks up from cwd to find the nearest `.env`, calls `dotenv.config()` once (idempotent). Invoked at module-load time so importing `@umwelten/core/env/load.js` is enough to ensure API keys are in `process.env`. `cli/entry.ts` and most `examples/*` scripts import it for side-effect.

### `src/schema/` — Structured Output

Parse DSL strings into Zod schemas, validate model output.

- `dsl-parser.ts` — `parseDSLSchema()`, `toJSONSchema()`
- `zod-loader.ts` — `loadZodSchema()`, `convertZodToSchema()`
- `zod-converter.ts` — `parsedSchemaToZod()`
- `validator.ts` — `validateSchema()`, `createValidator()`, `coerceData()`
- `manager.ts` — `SchemaManager` singleton

### `@umwelten/protocols` — MCP + A2A

External-protocol implementations. Split by role:

- `mcp/client/client.ts` — Legacy hand-rolled MCP client (custom JSON-RPC). Used by one debug CLI subcommand; pending sunset.
- `mcp/client/remote.ts` — **`RemoteMcpClient`**: connect to any remote MCP server over Streamable HTTP with OAuth 2.1 PKCE. File-backed token storage at `~/.umwelten/mcp-auth/`. Converts MCP tools → Vercel AI SDK tools for use with Interactions.
- `mcp/server/server.ts` — Legacy MCP server (pending sunset alongside the legacy client).
- `mcp/integration/stimulus.ts` — Bridge: load MCP tools into a Stimulus.
- `mcp/types/` — Transport and protocol types.
- `mcp-serve/` — **Modern OAuth-backed MCP server framework**. `createMcpServer()` + pluggable `UpstreamOAuthProvider` / `McpToolRegistrar` / `McpServeStore` interfaces. `NeonStore` (Postgres) ships as the production store. Powers Twitter-MCP, Oura-MCP, and similar standalone servers.
- `a2a/server.ts`, `a2a/client.ts` — A2A protocol scaffolding. Small + sharp, no habitat coupling.

### Session browser — split between sessions, core, and ui

The session browser data layer lives in **two places** (extracted in commit d74fc26 to break a `ui ↔ sessions` cycle):

- `@umwelten/sessions/introspection/browse.ts` — `buildExploreBrowse()` assembles every session (claude-code + habitat) with its digest. `loadDigest()` / `saveDigest()` / `getDigestPath()` round-trip digests on disk. `applyExploreFilter()` (re-exported from core) does date window + source + status + free-text filtering.
- `@umwelten/sessions/introspection/storage.ts`, `types.ts` — supporting types and a legacy `IntrospectionRun` / `DecisionLogEntry` data model kept around because `buildExploreBrowse()` still reads on-disk data with the older shape.
- `@umwelten/core/interaction/analysis/digest-persistence.ts` — the canonical home of `loadDigest`/`saveDigest`/`getDigestPath` (the sessions package re-exports them).
- `@umwelten/core/interaction/types/domain-types.ts` — `Exploration`, `SourceSession`, `applyExploreFilter`, and the rest of the Exploration browser type system. (Domain language defined in `CONTEXT.md` at the repo root.)

TUIs in `@umwelten/ui/src/tui/introspect/`:

- `DashboardApp.tsx` + `browse.tsx` — **primary entry**. Replaces the older session-first `BrowseApp` (deleted in commit d435363).
- `detail.tsx` — per-session detail view (tabs over digest: overview, beats, phases, facts, diff-against-CLAUDE.md).
- `digest-live.tsx` — live streaming progress for the digester pipeline.
- `beats.tsx` — pure-deterministic beats view (no LLM).

CLI entry points (registered by `@umwelten/sessions`, mounted by `@umwelten/cli`):

- `umwelten browse` (top-level) — the primary entry.
- `umwelten introspect browse` — namespaced alias.
- `umwelten sessions ...` — list / show / messages / tools / stats / format / digest / habitat subcommands.

### `@umwelten/evaluation/src/reporting/` — Unified Reporter

General-purpose report rendering. Lives in evaluation (it consumes evaluation-shaped results); imported by tool tests and suite reports.

- `reporter.ts` — `Reporter` class with `fromToolTest()`, `toConsole()`, `toMarkdown()`, `toHtml()`, `toJson()`
- `adapters/` — Adapt different result types to `Report`
- `renderers/` — `ConsoleRenderer`, `MarkdownRenderer`
- `types.ts` — `Report`, `ReportSection`, `ReportType` (`'tool-test' | 'code-generation' | 'evaluation' | 'batch' | 'suite'`)

### `@umwelten/cli` — Command-Line Interface

Commander-based CLI. Entry point: `cli/entry.ts` → `cli/cli.ts`.

Registered top-level commands (`cli.ts`):

- `models` — list/search models across providers, `--view info|costs`, JSON output, `llamaswap-config` generator.
- `run` — one-shot prompt (`--prompt`, `--attach`, `--object`, `--stats`).
- `chat` — interactive REPL via `@umwelten/ui/cli/CLIInterface` (the non-habitat REPL — see the `@umwelten/ui` section below for the deliberate split between `CLIInterface` and `repl.ts`).
- `converse` — run a Dialogue between 2+ agents/personas (`--agent`, `--persona "Name=prompt"`, `--moderator`, `--max-turns`, `--json`). Persists as a `dialogue` session; see `docs/guide/agent-dialogues.md`.
- `sessions` — sessions tree (list/show/messages/tools/stats/format/digest plus the `habitat` subtree). Registered by `@umwelten/sessions`.
- `habitat` — habitat REPL + subcommands: `local`/`here`, `telegram`, `discord`, `web` (legacy Gaia), `secrets {list,set,remove}`, `serve` (MCP+chat+web), `gaia` (orchestrator), `chat` (A2A client). The Telegram and Discord bots live here; the previous top-level `umwelten telegram` standalone command was retired in Wave E.
- `mcp` — MCP client/server ops: `mcp connect`, `mcp chat` (remote MCP with OAuth), `mcp test-tool`, `mcp read-resource`, `mcp create-server` (debug), `mcp list`.
- `introspect` / `browse` — session browser (registered by `@umwelten/sessions`). `browse` is the canonical entry; `introspect browse` is the namespaced alias.
- `knowledge` — Exploration / knowledge-promotion CLI (reflection → promotion → knowledge writers).
- `tools` — `tools list` + `tools demo`.

There is **no** `eval` command. Evaluations are script-driven (`examples/evals/`, `examples/local-providers/`).

- `commonOptions.ts` — `addCommonOptions` for `-p`/`-m` etc. Currently consumed by `run.ts`/`chat.ts`/`tools.ts`; the bigger subcommands (`habitat`, `mcp`, `knowledge`) define their own.

### `@umwelten/ui` — User Interfaces

**Two REPL loops live here by design, not by accident — pick the one whose contract fits your caller:**

- `cli/repl.ts` — **habitat-aware**, the modern stack. `runRepl({ interaction, store, habitat })` resolves slash commands from `habitat.getSlashCommands()`, propagates `AbortController` so Escape / Ctrl+C cancels in-flight `streamText`, and persists the session to an `InteractionStore` after every turn. Used by `umwelten habitat` and its `local` / `here` subcommands. ~180 LoC, function-style.
- `cli/CLIInterface.ts` + `cli/CommandRegistry.ts` + `cli/DefaultCommands.ts` — **non-habitat**, stateful-class style. `new CLIInterface(commandRegistry).startChat(interaction)`. Pluggable `CommandRegistry` with `/help`, `/reset`, `/history`, `/stats`, `/info`, `/toggle-stats`, `/exit` from `DefaultCommands`; per-turn response stats tracking; separate `startChat` / `startEvaluation` / `startAgent` entry points. Used by `umwelten chat`, one `sessions` subcommand, and the `simple-agent` / `bare-bones-memory` example apps — none of which have a `Habitat`. ~760 LoC across the three files.

The split is deliberate: a single primitive would need to be either (a) habitat-required everywhere (which breaks the example apps that exist precisely to demonstrate the non-habitat path), or (b) habitat-optional with all the framework's nice-to-haves (stats, custom registry) gated behind feature flags. Until there's a real reason to converge, keep them parallel. When a new REPL caller arrives, the test is `do you have a Habitat?` — yes → `runRepl`; no → `CLIInterface`.
- `telegram/TelegramAdapter.tsx` — grammy-based Telegram bot; per-`chatId` `Interaction` map; optional `ChannelBridge` injection.
- `discord/DiscordAdapter.tsx` — discord.js bot (god-component, candidate for Wave G splitting).
- `discord/discord-backfill.ts`, `discord-message-gate.ts`, `discord-transcript-ambient.ts` — ambient-listening, gating, missed-message backfill.
- `tui/` — React Ink TUI: live/file/session viewer (`tui/index.tsx`), browser components (`tui/browser/`), reusable Ink primitives (`tui/components/`), introspect tree (`tui/introspect/{DashboardApp,browse,detail,beats,digest-live}.tsx`).
- `tui/theme.ts` — **the TUI color palette.** Use `theme.*` tokens (`accent`, `userValue`, `pending`, `error`, `success`, role colors, border colors) instead of Ink color names, and spread `secondary` for labels/metadata instead of `color="gray"` (gray is unreadable on several terminal themes; `dimColor` adapts). Never `color="blue"` for assistant text.

## Key Patterns

**Creating a basic interaction:**

```typescript
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";

const stimulus = new Stimulus({ role: "helpful assistant" });
const model: ModelDetails = { name: "gemini-3-flash-preview", provider: "google" };

const interaction = new Interaction(model, stimulus);
interaction.addMessage({ role: "user", content: "Hello" });
const response = await interaction.streamText();
console.log(response.content);
```

**Loading a session from any source (Claude Code / Cursor / Pi / habitat):**

```typescript
import { loadInteraction } from "@umwelten/core/interaction/adapters/load-interaction.js";

const interaction = await loadInteraction(sessionId, model, stimulus);
```

**Using habitat:**

```typescript
import { Habitat } from "@umwelten/habitat";

const habitat = await Habitat.create({ workDir: "./my-agent" });
const interaction = await habitat.createInteraction({ sessionId });
```

**Running an evaluation:**

```typescript
import { EvalSuite } from "@umwelten/evaluation/evaluation/suite.js";

const suite = new EvalSuite({ name: "my-eval", stimulus: {...}, tasks: [...], models: [...] });
await suite.run();
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
- `MINIMAX_API_KEY` — MiniMax
- `NVIDIA_API_KEY` — NVIDIA-hosted models
- `LUNAROUTE_API_KEY` — LunaRoute hosted router (`LUNAROUTE_BASE_URL` overrides `https://gw.lunaroute.com/v1`)
- `TAVILY_API_KEY` — Web search tool
- `MARKIFY_URL` — Optional external HTML-to-markdown service
- `LLAMASWAP_HOST` — Override the default `http://localhost:8080/v1` for llama-swap

Loaded automatically by `@umwelten/core/env/load.js` (side-effect import at module-load time). Every package that consumes core gets `.env` for free.

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

## Publishing artifacts (shareable URLs)

When you generate an HTML report / walkthrough / mockup / static bundle and need
to hand a human a stable, shareable link, publish it to **TheFocus.AI Artifacts**
(`artifacts.thefocus.ai`) — a CLI-first publishing service. **Do not self-host it
on a subdomain** (don't stand up nginx/Caddy for it); use the service.

```bash
# single file, a directory (entry page = index.html), or stdin:
npx @the-focus-ai/artifacts publish ./report.html
npx @the-focus-ai/artifacts publish ./dist
cat report.html | npx @the-focus-ai/artifacts publish -
# → prints an unlisted URL like https://artifacts.thefocus.ai/a/Ab3xY9kQ
npx @the-focus-ai/artifacts remove https://artifacts.thefocus.ai/a/Ab3xY9kQ --yes
```

- **Auth:** non-interactive sessions set `THEFOCUS_ARTIFACTS_TOKEN=tfai_pub_…`;
  a human can instead run `npx @the-focus-ai/artifacts login` (browser).
- **Revision window:** re-run the same `publish` shortly after to hotfix the
  **same** URL. URLs are unlisted (not private) — never put secrets in a publication.
- The service self-documents: read `https://artifacts.thefocus.ai/llms.txt` first.
- **Don't confuse domains:** `artifacts.thefocus.ai` is this Vercel service;
  `*.habitats.thefocus.ai` is the pancake/Caddy habitat host (see the Gaia runbook).
- **From a habitat:** expose this as a `publish_artifact` tool that shells to the
  CLI with `THEFOCUS_ARTIFACTS_TOKEN` from habitat secrets (same pattern as
  `search-tools.ts` + `exec-tools.ts`), complementing the local `artifact-tools.ts`
  (which serves on the habitat's own `/files/artifacts/…` URL).
