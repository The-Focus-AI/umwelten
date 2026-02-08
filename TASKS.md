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

### Backlog
- [ ] Test LLM-based container configuration with valid OpenRouter API key
- [ ] Add environment variables for OpenRouter LLM configuration in Dagger
- [ ] Update existing docker-runner tests to work with DaggerRunner
- [ ] Remove deprecated docker-runner.ts in future release
