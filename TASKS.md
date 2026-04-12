# Tasks

## Completed

- [x] Add `@dagger.io/dagger` dependency (v0.19.9)
- [x] Create `src/evaluation/dagger/types.ts` - Type definitions for DaggerRunner
- [x] Create `src/evaluation/dagger/prompts.ts` - LLM prompt templates for container config
- [x] Create `src/evaluation/dagger/language-detector.ts` - Static configs + package detection
- [x] Create `src/evaluation/dagger/container-config-cache.ts` - Memory + disk cache with LRU eviction
- [x] Create `src/evaluation/dagger/llm-container-builder.ts` - LLM integration for dynamic config
- [x] Create `src/evaluation/dagger-runner.ts` - Main DaggerRunner class
- [x] Create `src/evaluation/dagger/index.ts` - Module exports
- [x] Update `src/evaluation/code-scorer.ts` - Import DaggerRunner
- [x] Update `src/evaluation/strategies/code-generation-evaluation.ts` - Import DaggerRunner
- [x] Move test script to `src/test/test-dagger-runner.ts`
- [x] Verify implementation works with TypeScript, Python, and other languages
- [x] Test Ruby with gems (feedjira, faraday) - Successfully ran feed_reader.rb
- [x] Deprecate old docker-runner.ts with warning
- [x] Create `docs/guide/code-execution.md` - Comprehensive documentation with examples
- [x] Update `docs/.vitepress/config.ts` - Add Code Execution to sidebar
- [x] Update `docs/index.md` - Add Code Execution feature section

## Completed: Claude Agent Monitor (Phase 1 - Session Browser)

- [x] Create session types in src/sessions/types.ts
- [x] Build session store to read sessions-index.json
- [x] Build JSONL parser for session transcripts
- [x] Build stream formatter for live stream-json output
- [x] Add sessions command to CLI (src/cli/sessions.ts)
- [x] Implement sessions list command
- [x] Implement sessions show command
- [x] Implement sessions messages command
- [x] Implement sessions tools command
- [x] Implement sessions stats command
- [x] Implement sessions format command (stdin pipe)
- [x] Implement sessions export command
- [x] Implement sessions index command (LLM-powered)
- [x] Implement sessions search command
- [x] Implement sessions analyze command
- [x] Implement sessions tui command (interactive TUI: overview, live stream, file, session by ID)

## Completed: Session TUI (Interactive Session Viewer)

- [x] Add fullscreen-ink and @inkjs/ui dependencies
- [x] Create stream-json to NormalizedMessage converter (src/ui/tui/stream-to-normalized.ts)
- [x] Create file-session reader with optional watch (src/ui/tui/file-session.ts)
- [x] Create TUI components: Message, ToolCallDetails, MessageList, SessionSidebar, ChatView
- [x] Create TUI App with state (live/file/session/overview, filter toggles h/r/u)
- [x] Add sessions tui CLI (umwelten sessions tui [file-or-session-id] -p, --file, --session)
- [x] Wire overview mode (session list from adapters), session load by ID, live stdin stream
- [x] Liveness display for live (alive/stale/ended) and file (reading/writing/ended)

## Completed: Session Browser

- [x] Browser data: load sessions (adapters) + analysis index, merge by sessionId/sourceId
- [x] searchBrowserSessions: use searchSessions when index exists, filter by firstPrompt when not
- [x] SessionCard: first message, summary, key learnings, topics, tools, solution type, success
- [x] BrowserView: search bar, scrollable list, Enter to open detail (exit + return session ID)
- [x] sessions browse CLI; after exit prints "umwelten sessions show <id>" when session selected

## Completed: Browse Conversation Viewer (Beats + Summary/Learnings)

- [x] Conversation beats: group messages into turns (user + assistant/tools until next user)
- [x] conversation-beats.ts: messagesToBeats(), formatBeatToolSummary(), ConversationBeat type
- [x] ChatDetailView: beats list with user preview, "N tools, M min", assistant preview
- [x] ChatDetailView: summary and learnings at top (when indexed), more prominent
- [x] ChatDetailView: Space to expand/collapse beat, Enter to expand message; arrow keys to move
- [x] SessionDetailPanel: more summary and learnings (200/220 chars), wrap
- [x] ChatDetailView receives full BrowserSession (analysis) for summary/learnings display

### Completed: Jeeves Session Debug and CLI (plan)

- [x] Reasoning: add `reasoning?` to AssistantMessageEntry; jeeves-jsonl + CLI capture; session-parser extractReasoning/summary
- [x] Size breakdown: SessionSizeBreakdown, computeSizeBreakdown(), SessionSummary.sizeBreakdown
- [x] SessionMessage → NormalizedMessage (session-parser); getBeatsForSession() for Jeeves transcript
- [x] Jeeves sessions CLI: list, show (sizes), beats, messages, message (inspect), pull, replay
- [x] Bot tools: sessions_show with sizeBreakdown/beatCount; sessions_inspect (single message)
- [x] umwelten sessions: --file / --session-dir for show/messages/stats (load Jeeves session by path)
- [x] Browse: SessionCard compact stats (msg · tools · $); SessionDetailPanel Stats row + beats (load messages for selected session)
- [x] Topic per beat: heuristic topic (first 50 chars) on ConversationBeat; jeeves sessions beats --topic FILTER
- [x] Replay: jeeves sessions replay &lt;pulled.json&gt; [--provider] [--model]; examples/jeeves-bot/replay.ts

---

## Completed: Index All Session Sources

- [x] Make SessionIndexEntry support adapter-based sessions (optional fullPath, source)
- [x] Add session-analyzer support for NormalizedSession (markdown + analysis)
- [x] Add createSessionMetadataFromNormalized; indexer branches on fullPath vs adapter
- [x] CLI builds sessionsOverride for all adapters (Cursor + Claude); index runs on all sources

## Completed: Habitat Module (Central Agent System)

Goal: Extract the "Habitat" concept from `examples/jeeves-bot/` into `src/habitat/` as the central system that any UI (CLI, Telegram, TUI, web) starts from. Manages work directory, sessions, config, stimulus, tools, skills, and known agents.

### New files in src/habitat/
- [x] `types.ts` — HabitatConfig, HabitatOptions, AgentEntry, HabitatSessionMetadata, OnboardingResult
- [x] `config.ts` — Parameterized config load/save, env-prefix resolution, state file management
- [x] `session-manager.ts` — HabitatSessionManager class (sessions dir, thread tracking)
- [x] `load-prompts.ts` — Generalized prompt loading from work dir (STIMULUS.md, AGENT.md, memory files)
- [x] `onboard.ts` — Generalized onboarding (config.json, STIMULUS.md, skills/, tools/)
- [x] `transcript.ts` — CoreMessage[] → JSONL transcript persistence
- [x] `tool-sets.ts` — ToolSet interface + standard tool sets (file, time, URL, agent, session, external interaction)
- [x] `tools/file-tools.ts` — Sandboxed read_file, write_file, list_directory, ripgrep
- [x] `tools/time-tools.ts` — current_time
- [x] `tools/agent-tools.ts` — agents_list, agents_add, agents_update, agents_remove
- [x] `tools/session-tools.ts` — sessions_list, sessions_show, sessions_messages, etc.
- [x] `tools/external-interaction-tools.ts` — external_interactions_list, show, messages, stats
- [x] `habitat.ts` — Main Habitat class with static create() factory, createInteraction(), stimulus/config/session management
- [x] `index.ts` — Re-exports
- [x] `habitat.test.ts` — 27 tests (create, config, agents, model defaults, sessions, stimulus, onboarding, secrets, state files)

### Jeeves refactored to thin wrapper
- [x] Created `examples/jeeves-bot/habitat.ts` — `createJeevesHabitat()` sets envPrefix='JEEVES', adds Tavily + Dagger tools
- [x] Refactored cli.ts, telegram.ts, replay.ts, sessions-cli.ts, test-telegram-stream.ts, verify-skills-load.ts to use Habitat
- [x] Refactored tools/dagger.ts to factory pattern closing over Habitat context
- [x] Deleted 11 superseded files (config.ts, stimulus.ts, session-manager.ts, load-prompts.ts, onboard.ts, jeeves-jsonl.ts, tools/files.ts, tools/time.ts, tools/agents.ts, tools/sessions.ts, tools/external-interactions.ts)

---

## Current: Session Normalization (Multi-Source Support)

Goal: Support sessions from Claude Code, Cursor, Windsurf, and other AI coding tools via a normalized format.

### Design

#### Sources to Support

| Source | Storage | Location | Scope |
|--------|---------|----------|-------|
| Claude Code | JSONL | ~/.claude/projects/{path}/ | Per-project |
| Cursor | SQLite | ~/Library/.../workspaceStorage/{hash}/ | Per-workspace |
| Windsurf | SQLite? | TBD | Per-workspace |
| Aider | Markdown | .aider.chat.history.md | Per-project |

#### Normalized Types

```typescript
type SessionSource = 'claude-code' | 'cursor' | 'windsurf' | 'aider' | 'unknown';

interface NormalizedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;

  // Tool-specific
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  toolDuration?: number;

  // Tokens (if available)
  tokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };

  sourceData?: Record<string, unknown>;  // Preserve source-specific
}

interface NormalizedSession {
  id: string;
  source: SessionSource;
  sourceId: string;

  projectPath?: string;
  workspacePath?: string;
  gitBranch?: string;

  created: string;
  modified: string;
  duration?: number;

  messages: NormalizedMessage[];
  messageCount: number;
  firstPrompt: string;

  metrics?: {
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    totalTokens?: number;
    estimatedCost?: number;
  };

  sourceData?: Record<string, unknown>;
}

interface SessionAdapter {
  source: SessionSource;
  discoverProjects(): Promise<string[]>;
  discoverSessions(projectPath: string): Promise<NormalizedSession[]>;
  getSession(sessionId: string): Promise<NormalizedSession | null>;
  getMessages(sessionId: string): Promise<NormalizedMessage[]>;
}
```

### Implementation Plan

#### Step 1: Create Normalized Types (`normalized-types.ts`)
- Define `SessionSource` union type
- Define `NormalizedMessage` interface with common fields
- Define `NormalizedSession` interface with common fields
- Define `SessionMetrics` interface for aggregated stats
- Export all types

#### Step 2: Create Adapter Interface (`adapters/adapter.ts`)
- Define `SessionAdapter` interface with methods:
  - `source: SessionSource` - identifier
  - `getSourceLocation(): string` - where data lives
  - `discoverSessions(projectPath: string): Promise<NormalizedSession[]>`
  - `getSession(sessionId: string): Promise<NormalizedSession | null>`
  - `getMessages(sessionId: string): Promise<NormalizedMessage[]>`
- Define `AdapterRegistry` for managing multiple adapters

#### Step 3: Implement ClaudeCodeAdapter (`adapters/claude-code-adapter.ts`)
- Implement `SessionAdapter` interface
- Reuse existing `session-store.ts` and `session-parser.ts` logic
- Map `SessionIndexEntry` → `NormalizedSession`
- Map `SessionMessage` → `NormalizedMessage`
- Handle tool calls, token usage, timestamps

#### Step 4: Implement CursorAdapter (`adapters/cursor-adapter.ts`)
- Add `better-sqlite3` dependency
- Find workspace storage directories
- Read `state.vscdb` SQLite databases
- Parse `composerData:*` keys for session metadata
- Parse `bubbleId:*` keys for messages
- Map to normalized format
- Resolve workspace hash to project path

#### Step 5: Create Adapter Registry (`adapters/index.ts`)
- Register available adapters
- Auto-detect source based on project path
- Provide unified access to sessions across sources

#### Step 6: Update CLI
- Add `--source` flag to `sessions list/show/messages/etc`
- Default to auto-detection
- Support `all` to show sessions from all sources

### Tasks

- [x] `umwelten-e6m` - Create normalized-types.ts with NormalizedSession and NormalizedMessage interfaces
- [x] `umwelten-z1c` - Create SessionAdapter interface in adapters/adapter.ts
- [x] `umwelten-3b4` - Implement ClaudeCodeAdapter
- [x] `umwelten-pta` - Implement CursorAdapter for SQLite session reading (uses ItemTable with aiService.prompts)
- [x] `umwelten-z6p` - Create adapter registry with auto-detection
- [x] `umwelten-5hh` - Update sessions CLI with --source flag and interleaved display

---

## Completed: Agent Runner (HabitatAgent as Stimulus + Interaction)

Goal: Enable Jeeves to manage sub-agents for external projects (twitter-feed, newsletter-feed, etc). A HabitatAgent = Stimulus (built from the managed project's files) + persistent Interaction.

### New files
- [x] `src/habitat/habitat-agent.ts` — buildAgentStimulus() + HabitatAgent class
- [x] `src/habitat/tools/agent-runner-tools.ts` — agent_clone, agent_logs, agent_status, agent_ask tools
- [x] `src/habitat/tools/agent-runner-tools.test.ts` — 16 tests (all passing)

### Modified files
- [x] `src/habitat/habitat.ts` — added habitatAgents map + getOrCreateHabitatAgent()
- [x] `src/habitat/tool-sets.ts` — added agentRunnerToolSet to standardToolSets
- [x] `src/habitat/index.ts` — export HabitatAgent, buildAgentStimulus, agentRunnerToolSet

---

## Completed: Skills Sharing + Auto-Discovery for HabitatAgents

Goal: Sub-agents (HabitatAgents) get habitat skills (shared) + agent-local skills, and `agent_clone` auto-discovers project capabilities.

- [x] `src/habitat/habitat.ts` — Add `getSkills()` method to expose loaded skills from stimulus registry
- [x] `src/stimulus/stimulus.ts` — Add `getOrCreateSkillsRegistry()` for external skill injection
- [x] `src/habitat/habitat-agent.ts` — Load habitat skills + agent-local skills into sub-agent stimulus in `buildAgentStimulus()`
- [x] `src/habitat/tools/agent-runner-tools.ts` — Add `discoverAgentCapabilities()` auto-discovery after `agent_clone` (package.json scripts, shell scripts, logs/, status files)
- [x] `src/habitat/tools/agent-runner-tools.test.ts` — Add 10 tests for `discoverAgentCapabilities`
- [x] `examples/jeeves-bot/env.example` — Clarify `~/.jeeves` default and dev pitfalls
- [x] `src/cli/habitat.ts` — New `umwelten habitat` CLI command with REPL, one-shot, /agents, /skills, /tools, /context, /compact
- [x] `src/cli/cli.ts` — Register habitat command

---

## Current: Gaia — Habitat Manager Web UI

Goal: Web-based UI for browsing habitats, inspecting sessions/agents/tools, viewing conversation beats, and jumping to specific points in session transcripts.

### Server (`src/habitat/gaia-server.ts`)
- [x] HTTP server using Node built-in `http` module (no new deps)
- [x] `GET /api/habitat` — config, agents, tools, skills, stimulus, memory
- [x] `GET /api/sessions` — list sessions with metadata
- [x] `GET /api/sessions/:id` — session summary (counts, beats, cost)
- [x] `GET /api/sessions/:id/messages` — full conversation with tool calls inline
- [x] `GET /api/sessions/:id/beats` — conversation beats (uses existing `getBeatsForSession`)
- [x] `GET /` — serves Gaia UI HTML
- [x] CORS support, EADDRINUSE error handling

### CLI (`src/cli/habitat.ts`)
- [x] `umwelten habitat web` subcommand with `--port` option
- [x] Lazy imports gaia-server (no load-time penalty for other commands)

### UI (`examples/gaia-ui/index.html`)
- [x] Dual-mode: live API data when served, mock data when opened as file
- [x] Conversation beats on habitat dashboard (clickable, jump to session message)
- [x] Insights & patterns card (mock data, will be LLM-generated later)
- [x] Session chat view with tool call expand/collapse
- [x] Ask Gaia panel with pattern-aware responses

### Completed: Ask Gaia Chat → Real LLM
- [x] `POST /api/chat` endpoint in `gaia-server.ts` — accepts `{ message, sessionId? }`, creates Interaction with habitat Stimulus+tools, streams response via LLM, persists transcript
- [x] `readBody()` helper for raw `http.createServer` JSON body parsing
- [x] Interaction cache (`Map<sessionId, { interaction, sessionDir }>`) for multi-turn conversation context
- [x] UI chat handler (`index.html`) wired to `/api/chat` when `IS_SERVED`, with thinking indicator, tool call display, sessionId tracking; mock fallback for standalone file viewing
- [x] `webAction` in `habitat.ts` persists CLI-provided `--provider`/`--model` to config for `createInteraction()` to use

### Completed: Direct Sub-Agent Chat + Tool Stripping
- [x] Strip habitat agent to management-only tools — removed file-operations, time, url-operations from `standardToolSets` (keeps agent-management, session-management, external-interactions, agent-runner)
- [x] Add `agentId` param to `POST /api/chat` — routes to sub-agent's Interaction via `getOrCreateHabitatAgent(agentId)` with full streaming SSE support
- [x] Update Ask Gaia panel to be context-aware — shows "Ask {agent name}" when agent selected, tracks separate session IDs per agent vs habitat

### Completed: Agent Lifecycle Integration Test
- [x] Fix `habitat.test.ts` regression — update assertions for management-only tools (agents_list, agent_clone, etc.); assert removed tools (read_file, write_file, etc.) are NOT present
- [x] Fix `gaia-server.ts` port 0 bug — return actual OS-assigned port from `server.address().port` instead of configured `port`
- [x] Create `agent-lifecycle.integration.test.ts` — 8-step end-to-end test with zero mocks:
  1. Agent clone via `agent_clone` tool (real git clone of `trmnl-image-agent` to temp dir)
  2. Stimulus building from cloned project files (CLAUDE.md, README.md)
  3. HabitatAgent creation & caching (identity check via `===`)
  4. Real LLM conversation (Google gemini-2.0-flash, fallback to interaction messages for tool-only responses)
  5. Tool use — LLM invokes `list_directory` with agentId scoping
  6. Dagger container execution (start/continue/discard, graceful SDK version skip)
  7. Session transcript persistence (JSONL validation with manual flush fallback)
  8. Gaia server HTTP API (habitat, sessions, chat validation, CORS, port 0)

### Completed: Smart `run_project` Tool (replaces `run_bash`)
- [x] `src/habitat/tools/run-project/types.ts` — ProjectRequirements, ExperienceMetadata, RunProjectContext, RunProjectResult types
- [x] `src/habitat/tools/run-project/experience.ts` — Experience lifecycle management (extracted from jeeves-bot/tools/dagger.ts)
- [x] `src/habitat/tools/run-project/project-analyzer.ts` — Static project analysis: detect type (npm/pip/cargo/go/shell), scan scripts for tools (imagemagick, claude-cli, chrome-driver, git, npx, curl, jq, etc.), parse CLAUDE.md and .env for env var names, in-memory cache
- [x] `src/habitat/tools/run-project/skill-provisioner.ts` — Detect skill/plugin references in scripts, map chrome-driver → chromium+perl+plugin mounts, generic plugin handling
- [x] `src/habitat/tools/run-project/index.ts` — createRunProjectTool factory: auto-detect project, provision container, inject env vars, mount skills, execute with timeout
- [x] `src/habitat/builtin-tools/run_project/` — TOOL.md + handler.ts (factory pattern)
- [x] `src/habitat/tool-sets.ts` — Added runProjectToolSet to standardToolSets
- [x] `src/habitat/onboard.ts` — Seeds run_project instead of run_bash
- [x] `src/habitat/index.ts` — Export createRunProjectTool, runProjectToolSet, RunProjectContext, ProjectRequirements
- [x] `src/evaluation/codebase/context-provider.ts` — Added 'shell' project type marker (run.sh, setup.sh, Makefile)
- [x] `examples/jeeves-bot/habitat.ts` — Switch from createRunBashTool to createRunProjectTool
- [x] `src/habitat/agent-lifecycle.integration.test.ts` — Updated to use run_project (auto-start, no explicit 'start' action)
- [x] `src/habitat/habitat.test.ts` — Added run_project assertion to built-in tools test
- [x] `examples/jeeves-bot/tools/dagger.ts` — Added @deprecated notice
- [x] Deleted `src/habitat/builtin-tools/run_bash/` (replaced by run_project)
- [x] Unit tests: 29 tests (10 experience + 19 project-analyzer) — all passing

### Completed: Habitat Secret Manager
- [x] `src/habitat/secrets.ts` — `loadSecrets()` / `saveSecrets()` for `secrets.json` (0600 perms)
- [x] `src/habitat/tools/secrets-tools.ts` — AI tools: `secrets_set`, `secrets_remove`, `secrets_list`
- [x] `src/habitat/habitat.ts` — Added `secrets` field, load on create(), `setSecret()` / `removeSecret()` / `listSecretNames()`, `getSecret()` prefers store over env; populate `process.env` from secrets on create (fills gaps, never overrides)
- [x] `src/habitat/tool-sets.ts` — Added `secretsToolSet` to `standardToolSets`
- [x] `src/habitat/index.ts` — Export `secretsToolSet`
- [x] `src/cli/habitat.ts` — `umwelten habitat secrets` subcommand (list, set, remove, `--from-op` for 1Password)
- [x] `src/habitat/secrets.test.ts` — 6 tests (load/save/permissions)
- [x] `src/habitat/habitat.test.ts` — 7 secrets tests (store priority, set/remove/list, load from disk)

### Completed: Builtin Tools Cleanup + Search ToolSet
- [x] Removed `src/habitat/builtin-tools/` directory entirely (broken copy-to-workdir pattern)
- [x] Removed `seedBuiltinTools()` from `onboard.ts` — tools/ is now user-defined only
- [x] Created `src/habitat/tools/search-tools.ts` — Tavily web search as a proper ToolSet
- [x] Added `searchToolSet` to `standardToolSets` in `tool-sets.ts`
- [x] Added `SearchToolsContext` interface to `habitat.ts`

### Completed: Git-Based Skill Provisioning for run_project
- [x] `src/habitat/tools/run-project/types.ts` — Added `SkillRepo` interface, replaced `hostMounts: HostMount[]` with `skillRepos: SkillRepo[]` in `ProjectRequirements`, added `skillRepos` to `RunProjectResult.detectedRequirements`, removed `HostMount` type
- [x] `src/habitat/tools/run-project/skill-provisioner.ts` — Rewritten: `KNOWN_SKILLS` now maps to git repos (`Focus-AI/chrome-driver`, `The-Focus-AI/nano-banana-cli`), returns `skillRepos` instead of `hostMounts`, removed `findPluginDir()` and `handleGenericPlugin()` host filesystem lookups, added `resolveSkillRepo()` for agent-declared skills, re-exports `normalizeGitUrl` from stimulus/skills/loader
- [x] `src/habitat/tools/run-project/project-analyzer.ts` — Switched from `hostMounts` to `skillRepos` accumulation with dedup
- [x] `src/habitat/tools/run-project/index.ts` — Replaced host mount loop with git clone inside container (`git clone --depth 1`), added `/tmp` cache volume (`run-project-tmp`) for multi-step pipelines, merges agent's `skillsFromGit` if present, auto-adds `git` to apt packages when skills need cloning
- [x] `src/habitat/types.ts` — Added `skillsFromGit?: string[]` to `AgentEntry`
- [x] `src/habitat/index.ts` — Exported `SkillRepo` type
- [x] `src/stimulus/skills/loader.ts` — Exported `normalizeGitUrl()` (was module-private)
- [x] `src/stimulus/skills/index.ts` — Re-exported `normalizeGitUrl`
- [x] `src/habitat/tools/run-project/skill-provisioner.test.ts` — 11 new tests (detect known/unknown/multiple plugins, resolveSkillRepo, normalizeGitUrl)
- [x] `src/habitat/tools/run-project/project-analyzer.test.ts` — 2 new tests (skill detection integration)

### Completed: Fix Normalized Session Serializer (tool results showed `undefined`)
- [x] Fixed `src/interaction/core/interaction.ts` line 495 — `toNormalizedSession()` was accessing `part.result` but AI SDK uses `part.output` (with `{ type, value }` shape). Now uses `part.result ?? part.output` and unwraps the value correctly, matching the existing pattern in `transcript.ts` `extractContentBlocks()`
- [x] Fixed same bug in user message handler (line 381)
- [x] Added 3 new tests in `interaction.test.ts`: tool results with `output` field, legacy `result` field, and plain string content
- [x] Verified: normalized session JSONL now contains full tool result JSON (zero `undefined` occurrences)

### Planned
- [ ] LLM-powered insights extraction (analyze session beats → generate patterns)
- [ ] SSE for live session updates
- [ ] Multi-habitat support (serve multiple habitats in one UI)
- [ ] Agent status polling (live status dots)

---

## Completed: Habitat as Top-Level Container

Goal: Flip the architecture so Habitat is the top-level "world" at `~/habitats` (configurable via env), and interfaces like CLI REPL, Telegram, TUI, etc. run *inside* it, sharing config, agents, skills, and sessions.

### Tool loader factory support
- [x] `src/stimulus/tools/loader.ts` — `loadToolFromPath` and `loadToolsFromDirectory` accept optional `context` param; handler default export can be a factory function `(context) => Tool`
- [x] `src/habitat/habitat.ts` — Pass `habitat` as context to `loadToolsFromDirectory` so factory-pattern tools get access to workDir, getAgent, getAllowedRoots

### Builtin tools (work-dir format)
- [x] `src/habitat/builtin-tools/search/TOOL.md` + `handler.ts` — Tavily web search (direct Tool export, reads `TAVILY_API_KEY` from env)
- [x] `src/habitat/builtin-tools/run_bash/TOOL.md` + `handler.ts` — Dagger run_bash (factory export, needs habitat context)

### Default ~/habitats + telegram subcommand
- [x] `src/cli/habitat.ts` — Default work dir `~/habitats`, sessions `~/habitats-sessions`; extract `createHabitatFromOptions()` shared helper
- [x] `src/cli/habitat.ts` — Add `umwelten habitat telegram` subcommand with `--token` option; lazy-imports TelegramAdapter

### Onboarding seeds builtin tools
- [x] `src/habitat/onboard.ts` — On first onboarding, copies builtin tools (search, run_bash) from `src/habitat/builtin-tools/` into new habitat's `tools/` directory

### Documentation
- [x] `docs/guide/habitat.md` — Comprehensive Habitat guide (overview, CLI, tools, interfaces, config, programmatic usage, migration from Jeeves)
- [x] `docs/walkthroughs/habitat-setup-walkthrough.md` — Step-by-step walkthrough (14 steps: install → onboard → persona → tools → agents → telegram)
- [x] `docs/.vitepress/config.ts` — Added Habitat to sidebar (Core Features + Walkthroughs)
- [x] `docs/index.md` — Added Habitat feature blurb, documentation link, architecture entry
- [x] `docs/guide/habitat-agents.md` — Updated paths (~/habitats), added Habitat links
- [x] `docs/guide/jeeves-bot.md` — Added note recommending `umwelten habitat`, migration info
- [x] `docs/guide/telegram-bot.md` — Added tip about `umwelten habitat telegram`
- [x] `docs/guide/habitat-testing.md` — Added tip about using `umwelten habitat` for testing
- [x] `docs/walkthroughs/index.md` — Added Habitat Setup walkthrough entry
- [x] `README.md` — Added Habitat link to documentation section

---

## Completed: Documentation Audit and Fix

Goal: Audit all docs against actual codebase and fix everything that was wrong, outdated, or fabricated.

### Systemic issues found and fixed across all docs
- `new Interaction(model, "string")` → `new Interaction(model, stimulus)` with Stimulus object (15+ occurrences)
- `interaction/interaction.js` → `interaction/core/interaction.js` (8+ occurrences)
- `gemini-2.0-flash` → `gemini-3-flash-preview` (30+ files)
- `response.structuredOutput` → `JSON.parse(response.content)` (10+ occurrences)
- `response.finishReason` references removed (doesn't exist on ModelResponse)
- `GOOGLE_API_KEY` → `GOOGLE_GENERATIVE_AI_API_KEY`
- `inputSchema` → `parameters` (correct Vercel AI SDK tool property)
- `npx umwelten` → `dotenvx run -- pnpm run cli --`
- `npm install` → `pnpm install`
- Removed fabricated classes (SimpleEvaluation, MatrixEvaluation, BatchEvaluation, ComplexPipeline, ChatInteraction, EvaluationInteraction, LiteraryAnalysisTemplate, etc.)

### Files completely rewritten (from scratch)
- [x] `docs/api/memory.md`
- [x] `docs/api/interaction-interface-pattern.md`
- [x] `docs/api/providers.md`
- [x] `docs/api/tools.md`
- [x] `docs/api/overview.md`
- [x] `docs/api/core-classes.md`
- [x] `docs/api/cli.md`
- [x] `docs/guide/getting-started.md`
- [x] `docs/index.md`
- [x] `docs/architecture/overview.md`

### Files fixed with targeted edits
- [x] `docs/api/cognition.md` — Interaction constructor fixes, import paths, model names
- [x] `docs/api/interaction.md` — import paths, model names, finishReason removed, inputSchema → parameters
- [x] `docs/api/evaluation-framework.md` — import paths, model names, ~15 constructor fixes
- [x] `docs/api/schemas.md` — import paths, model names, structuredOutput → JSON.parse
- [x] `docs/api/model-integration.md` — import paths, model names, ~9 constructor fixes, added github-models

### Bulk mechanical fixes across remaining docs
- [x] `docs/guide/` — model names, CLI patterns, import paths across 16 files
- [x] `docs/examples/` — model names, CLI patterns, import paths across 22 files
- [x] `docs/architecture/` — model names, fabricated class references across 3 files
- [x] Misc root docs — migration-guide, evaluation-architecture, MCP summary, etc.

---

## Planned

### Browse: Subconversations and learnings traceability
- [ ] Indexing: detect or tag subconversations (e.g. runs of beats between clear user prompts) for tree view
- [ ] TUI: show Session → Subconversations → Beats tree (indent or collapsible sections)
- [ ] Analysis: optional per-beat or per-subconversation learnings; link learnings to beat/subconversation in UI

### Phase 3: Agent Monitor (Scheduled Runs)
- [ ] Create monitor repo add/list/remove commands
- [ ] Create monitor task create/list/enable/disable commands
- [ ] Implement ClaudeRunner for CLI execution
- [ ] Implement DaggerSandbox for containerized runs
- [ ] Implement TaskScheduler with node-cron
- [ ] Create SQLite database for monitor state
- [ ] Implement monitor serve web dashboard
- [ ] Add SSE for live run updates
- [ ] Implement session continuation from monitor

### Completed: Jeeves skills scoped to work/session (no global cache)

- [x] Remove any ~/.umwelten directory for skills; scope all skill-from-git cloning to work (or session) dir.
- [x] Loader: loadSkillsFromGit(repo, cacheRoot) clones into cacheRoot (e.g. <workDir>/repos); no global cache; returns SkillDefinition[].
- [x] Discover skills in cloned repo: SKILL.md at root plus subdirs with SKILL.md (discoverSkillsInDirectory); one repo can contribute multiple skills.
- [x] Stimulus: add skillsCacheRoot to options; require it when skillsFromGit is set; pass to loadSkillsFromGit.
- [x] Jeeves config: add skillsCacheDir (default "repos"); stimulus sets skillsCacheRoot = join(workDir, skillsCacheDir).
- [x] README: skillsFromGit clones into work dir; skillsCacheDir; no ~/.umwelten reference.
- [x] Tests: discoverSkillsInDirectory test; loader + stimulus tests pass.

### Completed: Jeeves Bot Example

- [x] Add `examples/jeeves-bot/`: config (config.ts, config.json), file tools (read_file, write_file, list_directory, ripgrep), agent tools (list/add/update/remove), external-interaction tools (external_interactions_list, show, messages, stats), run_bash with experiences, Jeeves Stimulus, CLI runner (REPL + one-shot), Telegram runner, README.

### Completed: Work directory Jeeves config (unified work dir)

- [x] Extend config.json with optional skillsDirs, skillsFromGit, toolsDir, stimulusFile (examples/jeeves-bot/config.ts).
- [x] Add work-dir prompt loader: load STIMULUS.md (or prompts/) and AGENT.md from work dir; parse frontmatter; built-in default when missing (examples/jeeves-bot/load-prompts.ts).
- [x] Add tools directory loader: TOOL.md + optional handler.ts/handler.js or type: script (src/stimulus/tools/loader.ts); export from src/stimulus/tools/index.ts.
- [x] Refactor createJeevesStimulus to bootstrap from work dir: load prompts, register built-in tools, load work-dir tools, resolve skillsDirs relative to work dir, load skills and add skill tool (examples/jeeves-bot/stimulus.ts).
- [x] Document work-dir layout (STIMULUS.md, tools/, skills/, config.json) and that the bot can edit everything there (examples/jeeves-bot/README.md).

### Completed: Terminology refactor (Habitat model)

- [x] **Dagger**: Rename session → **experience**. `run_bash` uses `experienceId`, experience actions (start/continue/commit/discard), `-dagger-experiences` directory.
- [x] **External interactions**: Rename "sessions" (Claude Code, Cursor) → **external interactions**. Jeeves tools: `external_interactions_list`, `external_interactions_show`, `external_interactions_messages`, `external_interactions_stats`. CLI: `umwelten external-interactions` (list, show, messages, tools, stats, export, format, index, search, analyze). User-facing copy updated throughout.
- [x] **Concepts**: **Interaction** = active conversation (umwelten). **External interaction** = read-only history from other tools (Claude Code, Cursor). **Experience** = execution state (Dagger run_bash). **Habitat** = agent + tools + interactions + memory + experiences.
- [x] **Habitat / agents**: Optional `commands` on agent config (e.g. `{ "cli": "pnpm run cli", "run": "pnpm start" }`). Agents listed with `commands`. README and Jeeves docs describe Habitat model; agents frame as habitats.

### Completed: Fix REPL Crash After Tool Call + Multi-Turn Tests
- [x] Fix `args` → `input` in `runner.ts` `makeResult()` (3 locations) — AI SDK v5 expects `input`, not `args`
- [x] Add `normalizeToModelMessages()` to `generateText()`, `generateObject()`, `streamObject()` — previously only `streamText` path normalized
- [x] Harden `normalizeToModelMessages()` output validation — guard `undefined`/`null`, raw string, raw object without `type`/`value`
- [x] Add 7 new multi-turn tool-call tests to `runner.test.ts` (multi-turn simulation, legacy args, multiple rounds, output edge cases)
- [x] Add tool message validation test to `interaction.test.ts`
- [x] Rewrite `docs/walkthroughs/run-project-walkthrough.md` for natural language workflow

### Completed: Bridge Agent — Switch to Pre-compiled Go Server
- [x] Cross-compile Go binary for arm64 Linux (`GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build`)
- [x] Verify Go MCP SDK StreamableHTTPHandler responds at `/mcp` path (responds to all paths)
- [x] Update `bridge-worker.ts` — replace TypeScript server setup with Go binary mount via `dag.host().file()` + `withFile()` with `permissions: 0o755`
- [x] Change entrypoint from `["npx", "tsx", "/opt/bridge/server.ts"]` to `["/opt/bridge/bridge-server", "--port", String(port)]`
- [x] Remove unused `readFileSync` import, npm install step, tsx dependency
- [x] Add VALIDATE step to bridge-worker.ts — force-executes Dagger pipeline before starting service to catch mount/clone errors early
- [x] Add service crash detection in poll loop — stops polling immediately if Dagger service errors
- [x] Add periodic poll error logging (every 5s) with last error in timeout message
- [x] Switch worker logging from async `createWriteStream` to sync `appendFileSync` — survives worker termination
- [x] Add timestamped log filenames (`bridge-{agentId}-{ISO-timestamp}.log`) — never overwrites
- [x] Logs go to sessions dir (`habitat.sessionsDir/logs/`) not work dir
- [x] `lifecycle.ts` — increase worker timeout to 90s, track lastWorkerStep/Message for better error context
- [x] `lifecycle.ts` — delayed port release (5s) to avoid port collision between iterations
- [x] `habitat.ts` CLI — creates log directory, passes logFilePath to bridgeAgent.initialize()
- [x] Verify all existing tests pass (only pre-existing Ollama failures)

### Completed: Simplify Bridge Agent — Three Phases
- [x] Extract `SavedProvisioning` type from inline in `types.ts` to named export
- [x] Remove GITHUB_TOKEN hardcode from `lifecycle.ts`
- [x] Delete dead methods from `lifecycle.ts` (installGit, installAptPackages, setupBridgeServer, waitForBridge)
- [x] Simplify `BridgeAgent` to single `start()` method — removed `initialize()`, iteration loop, `checkProvisioningNeeds()`, `calculateNewProvisioning()`, `runSetupCommandsList()`
- [x] Replace `createBridgeAgent()` with `startBridge()` in `habitat.ts` — simpler, no iteration
- [x] Add `resolveAgentSecrets()` private helper in `habitat.ts`
- [x] Delete `agent_analyze` and `agent_heal` tools from `agent-runner-tools.ts`
- [x] Update `agent_clone` and `bridge_start` to use `startBridge()`
- [x] Update `AgentRunnerToolsContext` interface (`createBridgeAgent` → `startBridge`)
- [x] Update CLI `agent start` and REPL `/agent-start` to use `habitat.startBridge()`
- [x] Update test mock context and `bridge/index.ts` exports
- [x] Update scripts (`setup-bridge.ts`, `test-bridge-mcp.ts`)

### Completed: Fix Bridge Session Bugs
- [x] Fix `bridge_start` short-circuiting on externally-started bridges — was returning "already_running" without rebuilding with new secrets
- [x] Fix `bridge_stop` not clearing `mcpPort` from config — next `bridge_start` now starts fresh
- [x] Add `console.warn` for missing secrets in `resolveAgentSecrets()` — was silently skipping
- [x] Stop exposing secret values via `secrets_list` and `secrets_get` tools — now returns `isSet: boolean` only
- [x] Update DEFAULT_INSTRUCTIONS in `load-prompts.ts`:
  - Added ABSOLUTELY FORBIDDEN rules against creating mock/dummy/fake scripts
  - Added instruction to use `bridge_stop` then `bridge_start` after `secrets_set`
  - Added instruction to use `sessions_list`/`sessions_show` for debugging
  - Replaced `bridge_create` reference with correct `bridge_exec`/`bridge_read`/`bridge_ls`
- [x] All 16 agent-runner-tools tests pass

### Completed: Expose Bridge Provisioning + Claude Install Instructions
- [x] Expose `bridgeProvisioning` in `agents_update` tool schema — LLM can now save aptPackages, setupCommands, detectedTools
- [x] Show `hasProvisioning` and `provisioningSummary` in `agents_list` output — LLM can see when provisioning is missing
- [x] Added Claude CLI install instruction: MUST use official script (`curl -fsSL https://claude.ai/install.sh | bash`), NEVER npm
- [x] Added tool installation instruction: install real tools (jq, chromium, imagemagick, python3) not shims
- [x] Added bridge provisioning workflow instruction: after discovering tools, save via `agents_update({ bridgeProvisioning: ... })` then `bridge_stop` + `bridge_start`
- [x] Added bare container detection instruction: when `hasProvisioning=false`, warn user and offer to inspect project to discover required packages
- [x] `agents_update` merges provisioning (preserves existing fields, adds new ones, timestamps with `analyzedAt`)
- [x] TypeScript typecheck passes, all 16 agent-runner-tools tests pass

### Completed: Bridge LLM Agent Lifecycle (Diagnosis + Monitor)
- [x] `src/habitat/bridge/diagnosis-agent.ts` — LLM-based diagnosis agent with read-only bridge tools + `diagnose_complete` closure tool; `buildDiagnosisStimulus()`, `buildDiagnosisTools()`, `runDiagnosis()`
- [x] `src/habitat/bridge/monitor-agent.ts` — LLM-based monitor agent with exec + `monitor_complete` closure tool; `buildMonitorStimulus()`, `buildMonitorTools()`, `runMonitor()`
- [x] `src/habitat/tools/agent-runner-tools.ts` — Rewrote `bridge_diagnose` to use LLM diagnosis agent instead of static BridgeAnalyzer; added new `bridge_monitor` tool
- [x] `src/habitat/habitat.ts` — Added `createAgentInteraction(stimulus)` for ephemeral interactions
- [x] `src/habitat/tools/agent-runner-tools.ts` — Added `createAgentInteraction` and `getDefaultModelDetails` to `AgentRunnerToolsContext`
- [x] `src/habitat/bridge/diagnosis-agent.test.ts` — 9 tests (tool set composition, schema validation, result capture)
- [x] `src/habitat/bridge/monitor-agent.test.ts` — 11 tests (tool set with exec, schema validation, all status values)
- [x] `src/habitat/tools/agent-runner-tools.test.ts` — Added 3 `bridge_monitor` tests (42 total, all passing)
- [x] TypeScript typecheck passes, all 42 agent-runner-tools tests + 20 agent tests pass

### Completed: Split bridge_diagnose Into Read-Only + Apply
- [x] `bridge_diagnose` is now read-only — returns `{ diagnosis, proposedProvisioning, currentProvisioning }` without saving or restarting
- [x] New `bridge_apply_provisioning` tool — full-replace (not additive merge), saves config, optionally restarts bridge
- [x] Deleted `arrayUnion` and `mergeSkillRepos` helpers — no longer needed
- [x] Tightened diagnosis-agent.ts prompt: "CRITICAL: only report what you find", removed hardcoded skill→package mappings, added "Common mistakes" section
- [x] 4 new tests for `bridge_apply_provisioning` (exists, unknown agent, replace-not-merge, save-without-restart)

### Completed: Habitat Supervisor — LLM-Driven Container Lifecycle
- [x] Phase 0: Created spike script `scripts/spike-dagger-llm.ts` for validating dag.llm() with privileged env
- [x] Phase 1: Created `src/habitat/bridge/container-builder.ts` — LLM container building via dag.llm()
  - `buildContainerFromRepo()`, `buildContainerWithLLM()`, `buildContainerWithFallback()`
  - LLM decides base image, apt packages, install commands; we always add Go binary, secrets, port, entrypoint
  - Fallback heuristics when LLM fails (package.json→node:20, requirements.txt→python:3.11, etc.)
  - Rewrote `bridge-worker.ts` to use container-builder instead of hardcoded pipeline
  - Simplified `lifecycle.ts` BridgeProvisioning to just secrets + previousProvisioning
  - Simplified `agent.ts` to work with new provisioning model
- [x] Phase 2: Created `src/habitat/bridge/supervisor.ts` — BridgeSupervisor with build/health/rebuild loop
  - Added SupervisorState, SupervisorStatus types to `state.ts`
  - Health loop: HTTP poll every 10s, 3 consecutive failures → rebuild
  - Max 3 build attempts before giving up with "error" status
  - State persisted to `agents/{id}/supervisor.json` on every transition
- [x] Phase 3: Wired supervisor into habitat and tools
  - Replaced `bridgeAgents` Map with `supervisors` Map in `habitat.ts`
  - Added `getSupervisor()`, `stopAllSupervisors()` to Habitat class
  - Removed 3 tools from `agent-runner-tools.ts`: `bridge_diagnose`, `bridge_apply_provisioning`, `bridge_monitor`
  - Updated `agent-tools.ts` provisioningSummary for new SavedProvisioning fields
- [x] Phase 4: Deleted dead code
  - Deleted: `analyzer.ts`, `llm-config-builder.ts`, `llm-config-builder.test.ts`, `diagnosis-agent.ts`, `diagnosis-agent.test.ts`, `monitor-agent.ts`, `monitor-agent.test.ts`
  - Updated `bridge/index.ts` exports for supervisor, container-builder, state types
- [x] Phase 5: Updated DEFAULT_INSTRUCTIONS in `load-prompts.ts`
  - Simplified instructions: removed manual diagnosis/provisioning workflow
  - Added supervisor-aware instructions (auto-build, auto-monitor, auto-rebuild)
- [x] Phase 6: Updated types, CLI, and verified tests
  - Changed SavedProvisioning: removed aptPackages/detectedTools/projectType/skillRepos, added buildSteps/envVarNames/reasoning
  - Updated `cli/habitat.ts` for new provisioning display
  - Updated `agent-runner-tools.test.ts` — 18/18 tests pass
  - Overall: 55/68 test files pass (13 pre-existing failures, no new failures)

---

## Current: Habitat Agent/Tool Architecture Audit

### Problem Analysis

The habitat has **4 LLM agents**, each with different tool access. Several have more power than they should.

### Agent Map

#### 1. Main Habitat LLM (the REPL)
- **Created by**: `src/cli/habitat.ts` via `habitat.createInteraction()`
- **Talks to**: The user, in the REPL
- **Tools** (from `standardToolSets` in `tool-sets.ts`):
  - `agentToolSet` — list/add/update/remove agents
  - `sessionToolSet` — list/show sessions
  - `externalInteractionToolSet` — read Claude Code/Cursor history
  - `agentRunnerToolSet` — `agent_clone`, `agent_logs`, `agent_status`, `agent_ask`, `bridge_start`, `bridge_stop`, `bridge_list`, `bridge_ls`, `bridge_read`, **`bridge_exec`**, `bridge_diagnose`, `bridge_apply_provisioning`, `bridge_monitor`
  - `secretsToolSet` — set/remove/list secrets
  - `searchToolSet` — web search via Tavily
- **Does NOT have**: file tools, time tools, URL tools (those are for sub-agents only)

#### 2. Diagnosis Agent (ephemeral, per-call)
- **Created by**: `bridge_diagnose` tool → `runDiagnosis()` in `src/habitat/bridge/diagnosis-agent.ts`
- **Tools**: `bridge_read`, `bridge_ls`, `bridge_health`, `bridge_logs`, `diagnose_complete`
- **Read-only** — no exec, no write. This is correct.

#### 3. Monitor Agent (ephemeral, per-call)
- **Created by**: `bridge_monitor` tool → `runMonitor()` in `src/habitat/bridge/monitor-agent.ts`
- **Tools**: `bridge_read`, `bridge_ls`, **`bridge_exec`**, `bridge_health`, `bridge_logs`, `monitor_complete`
- **Has exec** — for `ps aux`, `which claude`, `df -h` etc. Intentional but worth noting.

#### 4. HabitatAgent (persistent sub-agent)
- **Created by**: `agent_ask` tool → `habitat.getOrCreateHabitatAgent()` → `HabitatAgent.create()` in `src/habitat/habitat-agent.ts`
- **Tools**: Gets **ALL** of the habitat's registered tools (line 121: `habitat.getTools()`)
- **Problem**: This means it has `bridge_exec`, `agent_clone`, `bridge_start`, everything the main habitat has.

### Issues to Fix

1. **`agent_clone` auto-starts bridge** (`agent-runner-tools.ts` line 158)
   - Calls `ctx.startBridge(agentId)` immediately after registering
   - User can't just register an agent without spinning up a Dagger container
   - Should just register, let user explicitly `bridge_start` when ready

2. **Main habitat LLM has `bridge_exec`** (`agent-runner-tools.ts` return object)
   - Can run arbitrary commands in the container without asking the user
   - Should be removed from default tool set or gated behind confirmation

3. **HabitatAgent gets ALL habitat tools** (`habitat-agent.ts` line 121-124)
   - `habitat.getTools()` gives it everything: exec, clone, start, secrets, etc.
   - Sub-agents should get a restricted subset (read-only bridge tools + file tools)

4. **Monitor agent has exec** (`monitor-agent.ts` line 82-95)
   - Intentional for health checks (`ps aux`, `df -h`, `which claude`)
   - Acceptable since monitor is ephemeral and purpose-built, but worth documenting

### Backlog
- [ ] Test LLM-based container configuration with valid OpenRouter API key
- [ ] Add environment variables for OpenRouter LLM configuration in Dagger
- [ ] Update existing docker-runner tests to work with DaggerRunner
- [ ] Remove deprecated docker-runner.ts in future release

## Session Introspection (Completed)

- [x] `session-digester.ts` — Core digestion engine (filterBeats, digestSession, digestAllProjects, askAboutSession, buildSessionAnalysisInteraction)
- [x] `digest-search.ts` — Cross-project search and aggregation (searchDigests, searchKnowledge, getDigestTopics, getDigestPatterns, buildOverview)
- [x] CLI commands (`sessions digest build/search/overview/stats/topics/patterns/knowledge/ask`)
- [x] Types in `analysis-types.ts` (SessionDigest, DigestBeat, DigestPhase, DigestSegment, etc.)
- [x] Tests (`digest.test.ts`) — 21 tests passing (segment splitting, beat filtering, response parsing, formatting)

### Session Introspection Backlog
- [ ] Micro-session batching (sessions with <=10 messages batched together)
- [ ] Hierarchical compaction for very long sessions
- [ ] Embeddings-based semantic search across learnings
- [ ] Integration test: digest a real session JSONL end-to-end
- [ ] Clean up digest-store.ts — consolidate fully on FileLearningsStore

---

## Planned: Architectural Refactoring

Six structural issues identified via architecture review. Each is independently shippable.
Recommended order: 5 → 3B → 1A–1C → 2A → 4A–4C → 6A–6C.

### 1. Decompose `BaseModelRunner` (runner.ts — 1,663 lines)

- [x] **1A: Extract message normalization** — Moved `normalizeToModelMessages()`, `ensureGoogleThoughtSignatures()`, `cleanProviderOptions()` into `src/cognition/message-normalizer.ts`. 190 lines.
- [x] **1B: Extract provider option builders** — Moved `buildReasoningProviderOptions()`, `buildUserProviderOptions()`, `mergeProviderOptions()` into `src/cognition/provider-options.ts`. 116 lines.
- [x] **1C: Extract usage extraction** — Moved `normalizeTokenUsage()`, `calculateCostBreakdown()` into `src/cognition/usage-extractor.ts`. 75 lines.
- [x] **1D: Extract step assembler** — Moved `makeResult`'s tool-call/step assembly into `src/cognition/step-assembler.ts`. 214 lines. Also removed dead commented-out `stream()` method.
- [x] **1E: Deduplicate option building** — Extracted shared `buildRequestOptions()` into `src/cognition/request-options.ts`. 127 lines. Zero `any` in new file.

### 2. Untangle the `Interaction` class

- [x] **2A: Extract `toNormalizedSession()`** — Moved into `src/interaction/core/normalize.ts` as `interactionToNormalizedSession()`. 251 lines.
- [x] **2B: Extract attachment handling** — Moved `addAttachmentFromPath()` into `src/interaction/core/attachments.ts`. Drops `file-type`, `fs/promises`, `path` imports from Interaction.
- [x] **2C: Extract `fromNormalizedSession()`** — Moved helper `normalizedSessionToMessages()` into same `normalize.ts` module. Static factory delegates to it.

### 3. Consolidate report generators

Four report generation surfaces exist: `evaluation/reporter.ts` (stub), `evaluation/report-generator.ts` (legacy), `evaluation/analysis/report-generator.ts` (another), `evaluation/combine/report-builder.ts` (canonical). Plus `reporting/reporter.ts` (general-purpose).

- [ ] **3A: Audit usage** — Grep all imports to determine which are actually called.
- [ ] **3B: Delete dead ones** — Remove `evaluation/reporter.ts` (stub with TODOs) and `evaluation/report-generator.ts` if unused. Update barrel exports.
- [ ] **3C: Reconcile survivors** — Merge unique capabilities from `analysis/report-generator.ts` into `combine/` or `reporting/`, or delete if subset.

### 4. Replace provider switch-statement registry

- [x] **4A: Create provider registry** — Created `src/providers/registry.ts` with `registerProvider()`, `getRegisteredProvider()`, `listRegisteredProviders()`.
- [x] **4B: Migrate `getModelProvider()` and `getModelUrl()`** — Replaced switch statements with registry lookups in `index.ts`.
- [x] **4C: Move API key resolution into providers** — Each provider entry declares its `envVar`; `getModelProvider()` resolves it generically. Removed 10 copies of the pattern.

### 5. Fix hardcoded model in MemoryRunner

- [x] **5: Accept optional `factExtractionModel`** — Added `factExtractionModel?: ModelDetails` to `MemoryRunnerConfig`. Default to `google:gemini-3-flash-preview`. Interaction passes its own model. Removed hardcoded Ollama default.

### 6. Decompose the Habitat God Object

- [ ] **6A: Extract `BridgeManager`** — Move bridge supervisor lifecycle (~240 lines) into `src/habitat/bridge-manager.ts`.
- [ ] **6B: Extract `ToolRegistry`** — Move tool registration into `src/habitat/tool-registry.ts` with `addTool`, `addTools`, `addToolSet`, `getTools`.
- [ ] **6C: Narrow context interfaces** — After 6A–6B, point tool context interfaces at the narrower objects (`BridgeManager`, `ToolRegistry`) instead of Habitat.

---

## Repo Hygiene Inventory (April 2026)

Full audit of dead code, temp files, misplaced files, and outdated artifacts.

### 🗑️ Files to DELETE (tracked in git, definitely dead)

| File | Why |
|------|-----|
| `test-stopwhen.js` | Empty file (1 space). Root-level test scratch. |
| `test-mcp.sh` | One-off manual test script. Not a real test. |
| `umwelten-architecture.png` | Root-level image. Move to `docs/` or delete if `docs/architecture/umwelten-architecture-labs.png` supersedes. |
| `BRIDGE_MULTI_AGENT_IMPLEMENTATION.md` | Points to `docs/guide/habitat-bridge.md` as canonical. Just a redirect — delete. |
| `BRIDGE_WORKFLOW.md` | Same — points to `docs/guide/habitat-bridge.md`. Delete. |
| `DOCUMENTATION_UPDATES.md` | One-time changelog from a doc audit. Not maintained. Delete. |
| `DIGEST-REPORT.md` / `DIGEST-REPORT.pdf` | Untracked one-off report output. Add to `.gitignore` or delete. |
| `.env.example` | Duplicate of `env.template`. Pick one. `env.template` has more content → delete `.env.example`. |
| `src/evaluation/reporter.ts` | Stub with 5 TODOs and no callers (knip confirms unused). |
| `src/evaluation/report-generator.ts` | Legacy Docker/code-analysis reporter. Knip confirms unused. |
| `src/evaluation/docker-runner.ts` | Explicitly `@deprecated`, replaced by DaggerRunner. |
| `src/evaluation/advanced-code-analyzer.ts` | Knip: unused file. |
| `src/evaluation/structured-feature-scorer.ts` | Knip: unused file. |
| `src/evaluation/typescript-code-extractor.ts` | Only consumer is the dead `report-generator.ts`. |
| `src/evaluation/analysis/comprehensive-analyzer.ts` | Knip: unused. |
| `src/evaluation/analysis/performance-analyzer.ts` | Knip: unused. |
| `src/evaluation/analysis/quality-analyzer.ts` | Knip: unused. |
| `src/evaluation/analysis/report-generator.ts` | Knip: unused. Third report generator. |
| `src/evaluation/analysis/index.ts` | Barrel for dead modules. |
| `src/evaluation/strategies/complex-pipeline.ts` | Knip: unused strategy. |
| `src/evaluation/strategies/index.ts` | Barrel for dead modules. |
| `src/evaluation/tool-testing/conversation-runner.ts` | Knip: unused. |
| `src/evaluation/tool-testing/tool-scoring.ts` | Knip: unused. |
| `src/evaluation/tool-testing/tool-validator.ts` | Knip: unused. |
| `src/evaluation/tool-testing/index.ts` | Barrel for dead modules. |
| `src/evaluation/types/index.ts` | Knip: unused barrel. |
| `src/evaluation/caching/index.ts` | Knip: unused barrel. |
| `src/evaluation/codebase/dagger-codebase-runner.ts` | Knip: unused. |
| `src/evaluation/codebase/index.ts` | Knip: unused barrel. |
| `src/evaluation/ranking/index.ts` | Knip: unused barrel. |
| `src/evaluation/ranking/pairwise-ranker.ts` | Knip: unused. |
| `src/evaluation/index.ts` | Knip: unused barrel (public API goes through `src/index.ts` → `api.ts`). |
| `src/evaluation/dagger/index.ts` | Knip: unused barrel. |
| `src/stimulus/templates/` (entire dir) | 4 files, zero imports outside the dir. Knip confirms all unused. |
| `src/stimulus/analysis/advanced-analysis.ts` | Knip: unused. Only referenced from dead `scripts/evaluate-batch-analysis.ts`. |
| `src/stimulus/analysis/pdf-analysis.ts` | Knip: unused. |
| `src/stimulus/coding/advanced-typescript.ts` | Knip: unused. Only from dead evaluate scripts. |
| `src/stimulus/coding/typescript.ts` | Knip: unused. |
| `src/stimulus/creative/advanced-creative.ts` | Knip: unused. |
| `src/stimulus/index.ts` | Knip: unused barrel. |
| `src/stimulus/tools/vercel-sdk-test.ts` | Test file in non-test location. Knip: unused. |
| `src/mcp/types/transport-tcp.ts` | Knip: unused. |
| `src/reporting/index.ts` | Knip: unused barrel. |
| `src/reporting/renderers/index.ts` | Knip: unused barrel. |
| `src/interaction/analysis/digest-store.ts` | Knip: unused (superseded by `session-record/learnings-store.ts`). |
| `src/habitat/bridge/bridge-worker.ts` | Knip: unused (superseded by supervisor). |
| `src/habitat/bridge/container-builder.ts` | Knip: unused (superseded by supervisor). |
| `src/habitat/bridge/index.ts` | Knip: unused barrel. |
| `src/ui/discord/index.ts` | Knip: unused barrel. |
| `src/ui/telegram/index.ts` | Knip: unused barrel. |

### 🗑️ Scripts to DELETE or archive

| File | Why |
|------|-----|
| `scripts/evaluate-advanced-typescript.ts` | References dead stimuli (`AdvancedTypeScriptStimulus`). Sep 2025. |
| `scripts/evaluate-batch-analysis.ts` | References `BatchEvaluation` (deleted class). Sep 2025. |
| `scripts/evaluate-cat-poem.ts` | References `SimpleEvaluation` (deleted class). Sep 2025. |
| `scripts/evaluate-matrix-creative.ts` | References `MatrixEvaluation` (deleted class). Sep 2025. |
| `scripts/evaluate-phase2-demo.ts` | References `ComplexPipeline` (deleted class). Sep 2025. |
| `scripts/parse-session.ts` | 4 parse-session variants — consolidate to 1 or delete all (CLI `sessions` replaces them). |
| `scripts/parse-session-all.ts` | Same. |
| `scripts/parse-session-full.ts` | Same. |
| `scripts/parse-session-raw.ts` | Same. |
| `scripts/inspect-jsonl.ts` | 2 inspect-jsonl variants. Keep one at most. |
| `scripts/inspect-jsonl2.ts` | Same. |
| `scripts/spike-dagger-llm.ts` | Spike script. Move to `spikes/` or delete. |
| `scripts/gen-report-data.mjs` | `.mjs` in a `.ts` project — likely one-off. |
| `scripts/show-rivian-results.ts` | Project-specific results viewer. |
| `scripts/filter-anthropic-models.ts` | One-off filter script. |
| `scripts/extract-all-tool-calls.ts` | One-off extraction. |
| `scripts/extract-tool-args.ts` | One-off extraction. |
| `scripts/examples/comprehensive-analysis-example.ts` | References dead classes. |
| `scripts/examples/complex-pipeline-example.ts` | References `ComplexPipeline` (dead). |
| `scripts/examples/batch-evaluation-example.ts` | References `BatchEvaluation` (dead). |
| `scripts/examples/matrix-evaluation-example.ts` | References `MatrixEvaluation` (dead). |
| `scripts/examples/simple-evaluation-example.ts` | References `SimpleEvaluation` (dead). |

### 🗑️ Spikes to archive or delete

| Path | Why |
|------|-----|
| `src/habitat/bridge/spikes/` (9 files) | Exploration scripts from Feb/Mar. Valuable history but shouldn't be in `src/`. Move to `scripts/spikes/bridge/` or delete. |

### 📦 Temp files / directories to clean (on disk, gitignored but present)

| Path | What |
|------|------|
| `docker-temp-*` (6 dirs) | Leftover Dagger temp directories. Safe to `rm -rf`. |
| `.letta/` | Letta local state. Not used by umwelten. |
| `.dagger-cache/` | Dagger cache. Can be cleaned. |
| `test-output/` | 13 leftover cache-test dirs from January. |
| `reports/` | Old output logs from January (`output.log`, `output2.log`). |
| `input/` | Local test inputs (audio, images). Gitignored. |
| `output/` | Eval outputs including `.tmp-code/`. Gitignored. |
| `examples/introspection/` | Untracked session analysis output. Add to `.gitignore` or delete. |

### ⚠️ Misplaced files

| File | Issue | Fix |
|------|-------|-----|
| `src/test/` (8 files) | Manual test scripts mixed into `src/`. Not vitest tests. | Move to `scripts/test/` or `scripts/manual-tests/`. |
| `src/test/feed_reader.rb` | Ruby file in a TypeScript source tree. | Move to `scripts/` or `test-data/`. |
| `src/schema/__tests__/fixtures/` (3 files) | Knip: unused test fixtures. | Delete if tests don't need them; verify with `pnpm test:run`. |
| `src/habitat/bridge/go-server/bridge-server` | **10.9 MB native macOS binary** tracked in git. | Should NOT be in git. Use `.gitignore` + build script. |
| `src/habitat/bridge/go-server/bridge-server-linux` | **10.6 MB Linux binary** tracked in git. | Same — use releases/artifacts, not git-tracked binaries. |

### ⚠️ Duplicate / redundant files

| Files | Issue |
|-------|-------|
| `.env.example` + `env.template` | Two env templates. `.env.example` is a subset of `env.template`. Keep one. |
| `CLAUDE.md` + `LLM.txt` | Intentional (CLAUDE.md = deep, LLM.txt = agent summary). OK — but document the relationship. |

### ⚠️ Outdated docs (tracked, should update or delete)

| File | Issue |
|------|-------|
| `docs/claude-agent-monitor.md` (381 lines) | Phase 1/2/3 plan doc. Phases 1–2 completed per TASKS.md. Convert to historical note or delete. |
| `docs/dagger_logging.md` (81 lines) | Debugging note about spike script. Delete. |
| `docs/evaluation-architecture.md` (9 lines) | Redirect stub: "This page has been consolidated." Delete. |
| `docs/migration-guide.md` (471 lines) | Migration from pre-Stimulus era (Jan 2025). Likely irrelevant for current users. Archive or delete. |
| `docs/phase-2-completion-summary.md` (241 lines) | Internal milestone summary from Jan 2025. Delete. |
| `docs/telegram-storage-metadata.md` (230 lines) | Internal analysis doc. Move to `docs/architecture/` or delete. |
| `docs/telegram-streaming-analysis.md` (123 lines) | Internal debugging analysis. Delete. |
| `docs/plans/interactive-session-tui.md` | Completed feature (per TASKS.md). Delete plan. |
| `docs/plans/session-browser.md` | Completed feature (per TASKS.md). Delete plan. |

### ⚠️ Unused dependencies (from knip)

| Package | Note |
|---------|------|
| `@google/generative-ai` | Possibly superseded by `@ai-sdk/google`. Verify. |
| `@inkjs/ui` | May be used indirectly by TUI. Verify. |
| `fullscreen-ink` | Same — TUI dependency. Verify. |
| `ora` | Spinner library. May be used in CLI. Verify. |
| `tiktoken` | Token counting. May be used by `estimate-size.ts`. Verify. |
| `@typescript-eslint/*` (2 pkgs) | ESLint plugins — may need if `pnpm lint` is used. |
| `node-addon-api` | Build dep for `better-sqlite3`. Likely needed. |
| `prettier` | Dev tool. May be used manually. |

### 📊 Summary

| Category | Count |
|----------|-------|
| Dead source files (knip confirmed) | **46** |
| Dead/broken scripts | **~20** |
| Spike files to relocate | **9** |
| Temp dirs to clean | **6 docker-temp + misc** |
| Outdated docs to delete | **~10** |
| Binary files that shouldn't be in git | **2 (21.5 MB total)** |
| Deprecated code still present | **3 files** |
| Duplicate env templates | **1** |
