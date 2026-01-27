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

## Planned

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

### Completed: Jeeves Bot Example

- [x] Add `examples/jeeves-bot/`: config (config.ts, config.json), file tools (read_file, write_file, list_directory), agent tools (list/add/update/remove), session tools (sessions_list, show, messages, stats), Jeeves Stimulus, CLI runner (REPL + one-shot), Telegram runner, README.

### Backlog
- [ ] Test LLM-based container configuration with valid OpenRouter API key
- [ ] Add environment variables for OpenRouter LLM configuration in Dagger
- [ ] Update existing docker-runner tests to work with DaggerRunner
- [ ] Remove deprecated docker-runner.ts in future release
