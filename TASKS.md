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

### Tasks (bd tracked)

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

### Backlog
- [ ] Test LLM-based container configuration with valid OpenRouter API key
- [ ] Add environment variables for OpenRouter LLM configuration in Dagger
- [ ] Update existing docker-runner tests to work with DaggerRunner
- [ ] Remove deprecated docker-runner.ts in future release
