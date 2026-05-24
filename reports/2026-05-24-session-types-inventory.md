---
title: "Session/Adapter/Interaction Type Inventory"
date: 2026-05-24
audience: "umwelten developers"
---

# Session/Adapter/Interaction Type Inventory

This document maps every type, interface, class, and function across the interaction subsystem, clarifying the relationships between SessionMessage vs. NormalizedMessage vs. CoreMessage, SessionIndexEntry vs. NormalizedSession vs. SourceSession, and the complete flow from file storage → adapter → Interaction → runner.

---

## 1. Type Definitions Layer

### `packages/core/src/interaction/types/types.ts`

**Purpose:** Raw JSONL session format and storage index structures (Claude Code wire format).

**Exported Types & Interfaces:**

- **`SessionsIndex`** — container; fields: `version` (number), `entries` (SessionIndexEntry[])
- **`SessionSourceForEntry`** — literal union; values: "claude-code" | "cursor" | "windsurf" | "aider" | "native" | "pi" | "habitat" | "unknown"
- **`SessionIndexEntry`** — one row in sessions-index.json; fields:
  - `sessionId` (string, globally unique)
  - `fullPath?` (string, only for file-based Claude Code; omitted for adapter sources)
  - `fileMtime` (number, ms timestamp)
  - `firstPrompt` (string)
  - `messageCount` (number)
  - `created`, `modified` (ISO strings)
  - `gitBranch`, `projectPath` (strings)
  - `isSidechain` (boolean)
  - `source?` (SessionSourceForEntry, required when fullPath omitted)
- **`BaseJSONLEntry`** — base for all JSONL entries; fields: `type` (string), `uuid?`, `timestamp?`, `parentUuid?`, `isSidechain?`, `userType?`, `cwd?`, `sessionId?`, `version?`, `gitBranch?`
- **`SummaryEntry`** — `type: "summary"`; fields: `summary` (string), `leafUuid` (string)
- **`FileHistorySnapshotEntry`** — `type: "file-history-snapshot"`; fields: `messageId`, `snapshot` (FileHistorySnapshot), `isSnapshotUpdate`
- **`ProgressEntry`** — `type: "progress"`; fields: `data` (ProgressData), `parentToolUseID?`, `toolUseID?`
- **`UserMessageEntry`** — `type: "user"`; fields: `message` (ClaudeMessage), `thinkingMetadata?`, `todos?`
- **`AssistantMessageEntry`** — `type: "assistant"`; fields: `message` (ClaudeMessage), `requestId?`, `reasoning?`
- **`SessionMessage`** — union of all JSONL entry types
- **`ParsedSession`** — parsed result; fields: `metadata` (SessionIndexEntry), `messages` (SessionMessage[])
- **`SessionStats`** — aggregated metrics; fields: counts, token usage, estimated cost
- **`ToolCall`** — extracted from messages; fields: `id`, `name`, `input`, `timestamp`, `messageUuid`
- **`SessionListOptions`** — filtering options for session queries
- **`FormatOptions`** — output formatting options

---

### `packages/core/src/interaction/types/normalized-types.ts`

**Purpose:** Adapter-agnostic message and session format (common interface across Claude Code, Cursor, Pi, etc.).

**Exported Types & Interfaces:**

- **`SessionSource`** — literal union; values: "claude-code" | "cursor" | "windsurf" | "aider" | "native" | "pi" | "habitat" | "unknown"
- **`MessageRole`** — literal union; values: "user" | "assistant" | "system" | "tool"
- **`NormalizedTokenUsage`** — token counts; fields: `input?`, `output?`, `cacheRead?`, `cacheWrite?`, `total?`
- **`NormalizedMessage`** — adapter-normalized message; fields:
  - `id` (string)
  - `role` (MessageRole)
  - `content` (string)
  - `timestamp?` (ISO string)
  - `tool?` (object with `name`, `input`, `output`, `duration`, `isError`)
  - `tokens?` (NormalizedTokenUsage)
  - `model?` (string)
  - `sourceData?` (Record<string, unknown>)
- **`SessionMetrics`** — aggregated stats; fields: user/assistant/tool counts, token usage, cost
- **`NormalizedSession`** — full session from adapter; fields:
  - `id` (string, prefixed with source)
  - `source` (SessionSource)
  - `sourceId` (string, original tool ID)
  - `projectPath?`, `workspacePath?`, `gitBranch?`, `gitRepo?` (location metadata)
  - `created`, `modified` (ISO)
  - `duration?` (number, ms)
  - `messages` (NormalizedMessage[])
  - `messageCount`, `firstPrompt`
  - `metrics?` (SessionMetrics)
  - `isSidechain?` (boolean)
  - `sourceData?` (Record<string, unknown>)
- **`NormalizedSessionEntry`** — lightweight session (no messages); same fields as NormalizedSession except `messages`
- **`SessionDiscoveryOptions`** — query filters; fields: `projectPath?`, `gitBranch?`, `since?`, `until?`, `limit?`, `sortBy?`, `sortOrder?`, `includeSidechains?`
- **`SessionDiscoveryResult`** — one source's discovery result; fields: `sessions` (NormalizedSessionEntry[]), `source`, `totalCount`, `hasMore`
- **`MultiSourceDiscoveryResult`** — combined results; fields: `results` (SessionDiscoveryResult[]), `totalCount`

---

### `packages/core/src/interaction/types/domain-types.ts`

**Purpose:** Domain-level grouping and projection types (Exploration, Saved Exploration, Source Session).

**Exported Types & Interfaces:**

- **`SourceSessionKind`** — alias for SessionSource
- **`SourceSessionMetrics`** — same fields as SessionMetrics with optional totals
- **`SourceSession`** — domain object for tool-specific persisted history; fields:
  - `id` (string)
  - `source` (SourceSessionKind)
  - `sourceId` (string)
  - `title` (string)
  - `projectPath?`, `gitBranch?`, `gitRepo?` (metadata)
  - `created`, `modified` (ISO)
  - `messageCount`, `firstPrompt`
  - `metrics?` (SourceSessionMetrics)
  - `sourceData?` (Record<string, unknown>)
- **`ExplorationKind`** — literal union; values: "default" | "virtual" | "saved"
- **`ExplorationMemberKind`** — literal union; values: "reference" (only in v1)
- **`ExplorationMember`** — reference to a session; fields: `kind`, `sourceSessionId`, `source`, `label?`
- **`Exploration`** — grouping of source sessions; fields:
  - `id`, `name`
  - `kind` (ExplorationKind)
  - `members` (ExplorationMember[])
  - `created`, `modified` (ISO)
  - `memberCount`
  - `searchQuery?` (for virtual)
  - `savedPath?` (for saved)
- **`SavedExploration`** — persisted Exploration file; fields: `version`, `id`, `name`, `saved` (ISO), `members`
- **`ExplorationDiscoveryOptions`** — query filters

**Exported Functions:**

- **`createDefaultExploration(session: SourceSession): DefaultExplorationResult`** — create one default Exploration per session
- **`createVirtualExploration(query: string, sessions: SourceSession[]): Exploration`** — create virtual from search results

---

## 2. Adapter Contract & Implementations

### `packages/core/src/interaction/adapters/adapter.ts`

**Purpose:** SessionAdapter interface contract and global AdapterRegistry.

**Exported Interfaces:**

- **`SessionAdapter`** — contract for all sources; methods:
  - `readonly source: SessionSource` — identifier
  - `readonly displayName: string` — human-readable name
  - `getSourceLocation(): string` — base storage path
  - `canHandle(projectPath: string): Promise<boolean>`
  - `discoverProjects(): Promise<string[]>`
  - `discoverSessions(options?: SessionDiscoveryOptions): Promise<SessionDiscoveryResult>`
  - `getSessionEntry(sessionId: string): Promise<NormalizedSessionEntry | null>`
  - `getSession(sessionId: string): Promise<NormalizedSession | null>` — full with messages
  - `getMessages(sessionId: string): Promise<NormalizedMessage[]>`
  - `hasSessionsForProject(projectPath: string): Promise<boolean>`

**Exported Classes:**

- **`AdapterRegistry`** — global registry for all adapters; key public methods:
  - `registerFactory(source: SessionSource, factory: AdapterFactory): void`
  - `register(adapter: SessionAdapter): void`
  - `get(source: SessionSource): SessionAdapter | undefined`
  - `getAll(): SessionAdapter[]`
  - `getSources(): SessionSource[]`
  - `detectAdapters(projectPath: string): Promise<SessionAdapter[]>`
  - `getAdapterForProject(projectPath: string): Promise<SessionAdapter | undefined>`
  - `discoverAllSessions(options?: SessionDiscoveryOptions): Promise<Map<SessionSource, SessionDiscoveryResult>>`

**Exported Variables:**

- **`adapterRegistry`** — global singleton instance

**Exported Types:**

- **`AdapterFactory`** — function type; `() => SessionAdapter`

---

### `packages/core/src/interaction/adapters/claude-code-adapter.ts`

**Purpose:** SessionAdapter implementation for Claude Code JSONL files.

**Exported Classes:**

- **`ClaudeCodeAdapter implements SessionAdapter`** — reads from `~/.claude/projects/{encoded-path}/`; key methods:
  - `getSourceLocation(): string` — returns claudeDir
  - `canHandle(projectPath: string): Promise<boolean>` — checks for sessions-index.json
  - `discoverProjects(): Promise<string[]>` — lists all projects with sessions
  - `discoverSessions(options?: SessionDiscoveryOptions): Promise<SessionDiscoveryResult>`
  - `getSessionEntry(sessionId: string): Promise<NormalizedSessionEntry | null>`
  - `getSession(sessionId: string): Promise<NormalizedSession | null>` — parses JSONL + constructs NormalizedSession

---

### `packages/core/src/interaction/adapters/cursor-adapter.ts`

**Purpose:** SessionAdapter implementation for Cursor SQLite storage.

**Exported Classes:**

- **`CursorAdapter implements SessionAdapter`** — reads from `~/Library/Application Support/Cursor/User/`; key methods:
  - Same contract as SessionAdapter
  - Platform-specific storage path resolution (macOS/Windows/Linux)
  - Lexical rich-text extraction from SQLite composer data

---

### `packages/core/src/interaction/adapters/pi-adapter.ts`

**Purpose:** SessionAdapter implementation for Pi session trees (future; architecture placeholder).

---

## 3. Core Interaction & Normalization

### `packages/core/src/interaction/core/interaction.ts`

**Purpose:** Live Interaction class (model-facing conversation context) and factory from NormalizedSession.

**Exported Classes:**

- **`Interaction`** — live conversation context for runners; fields:
  - `id` (string)
  - `metadata` (object with `created`, `updated`, `source?`, `sourceId?`, `sourceData?`)
  - `messages` (CoreMessage[], from Vercel AI SDK)
  - `runner` (ModelRunner, protected)
  - `userId` (string)
  - `modelDetails` (ModelDetails)
  - `stimulus` (Stimulus)
  - `options?` (ModelOptions)
  - `outputFormat?` (ZodSchema)
  - `tools?` (Record<string, any>)
  - `maxSteps?` (number)
  - Key public methods:
    - `constructor(modelDetails: ModelDetails, stimulus: Stimulus, options?: {...})`
    - `setStimulus(stimulus: Stimulus): void`
    - `getStimulus(): Stimulus`
    - `addMessage(message: CoreMessage): void`
    - `setTools(tools: Record<string, any>): void`
    - `setMaxSteps(maxSteps: number): void`
    - `getMessages(): CoreMessage[]`
    - `compactContext(strategyId: string, options?: {...}): Promise<{segmentStart, segmentEnd, replacementCount} | null>`
    - `generateText(signal?: AbortSignal): Promise<ModelResponse>`
    - `streamText(signal?: AbortSignal, observer?: StreamObserver): Promise<ModelResponse>`
    - `generateObject(schema: ZodSchema, signal?: AbortSignal): Promise<ModelResponse>`
    - `streamObject(schema: ZodSchema, signal?: AbortSignal): Promise<ModelResponse>`
    - `toNormalizedSession(): NormalizedSession`
    - **`static fromNormalizedSession(session: NormalizedSession, modelDetails: ModelDetails, stimulus?: Stimulus): Interaction`** — factory to reconstruct from stored session

---

### `packages/core/src/interaction/core/normalize.ts`

**Purpose:** Bidirectional conversion between Interaction and NormalizedSession.

**Exported Functions:**

- **`interactionToNormalizedSession(id: string, messages: CoreMessage[], metadata: InteractionMetadata): NormalizedSession`** — flatten CoreMessage[] → NormalizedMessage[]
- **`normalizedSessionToMessages(session: NormalizedSession): {id, created, updated, source, sourceId, messages, systemContent?}`** — reverse; prepares data for Interaction.fromNormalizedSession

---

## 4. Projection

### `packages/core/src/interaction/projection/projector.ts`

**Purpose:** Bridge adapters to domain by discovering and projecting sessions into Explorations.

**Exported Functions:**

- **`projectSessions(projectPath: string, options?: ProjectionOptions): Promise<ProjectionResult>`** — discover all sessions → SourceSession → default Exploration
- **`projectSessionEntry(entry: NormalizedSessionEntry, source: SourceSessionKind): Exploration`** — single entry → default Exploration
- **`toSourceSession(entry: NormalizedSessionEntry, source: SourceSessionKind): SourceSession`** — convert NormalizedSessionEntry to domain SourceSession
- **`toSourceSessionFull(session: NormalizedSession): SourceSession`** — convert full NormalizedSession to SourceSession

**Exported Types:**

- **`ProjectionResult`** — output; fields: `explorations` (Exploration[]), `sourceSessions` (SourceSession[]), `sources` (ProjectionSourceResult[])
- **`ProjectionSourceResult`** — per-source breakdown; fields: `source`, `displayName`, `sessionCount`, `explorationCount`
- **`ProjectionOptions`** — extends SessionDiscoveryOptions; adds `registry?`

---

## 5. Persistence & Parsing

### `packages/core/src/interaction/persistence/session-parser.ts`

**Purpose:** Parse JSONL files into SessionMessage[] and extract metadata.

**Exported Functions:**

- **`parseJSONLLine(line: string): SessionMessage | null`** — parse one line
- **`parseSessionFile(filePath: string): Promise<SessionMessage[]>`** — load entire file
- **`streamParseSessionFile(filePath: string, onMessage: (msg: SessionMessage) => void | Promise<void>): Promise<void>`** — streaming parse for large files
- **`extractConversation(messages: SessionMessage[]): {user: UserMessageEntry[], assistant: AssistantMessageEntry[]}`**
- **`extractToolCalls(messages: SessionMessage[]): ToolCall[]`** — pull all tool calls
- **`extractTextContent(content: ContentBlock[] | string): string`** — flatten content blocks to text
- **`calculateTokenUsage(messages: SessionMessage[]): {input_tokens, output_tokens, cache_creation_input_tokens?, cache_read_input_tokens?}`**
- **`calculateCost(usage: TokenUsage): number`** — estimate USD
- **`summarizeSession(messages: SessionMessage[]): {userMessages, assistantMessages, toolCalls, tokenUsage, estimatedCost, duration?}`**
- **`parseSessionFileMetadata(filePath: string): Promise<SessionIndexEntry>`** — extract metadata from JSONL without full parse
- **`isSessionJsonlFilename(name: string): boolean`** — check if filename is a session (UUID.jsonl)
- **`getBeatsForSession(filePath: string): Promise<ConversationBeat[]>`** — parse and group into beats

---

### `packages/core/src/interaction/persistence/session-store.ts`

**Purpose:** File and index management for Claude Code sessions.

**Exported Functions:**

- **`getClaudeProjectPath(projectPath: string): string`** — encode project path → ~/.claude/projects/{encoded}/
- **`getSessionsIndexPath(projectPath: string): string`** — path to sessions-index.json
- **`hasSessionsIndex(projectPath: string): Promise<boolean>`**
- **`readSessionsIndex(projectPath: string): Promise<SessionsIndex>`** — parse index file
- **`getProjectSessions(projectPath: string): Promise<SessionIndexEntry[]>`** — read index entries
- **`discoverSessionFilesInProject(projectPath: string): Promise<string[]>`** — list .jsonl files on disk
- **`buildSessionEntryFromFile(filePath: string): Promise<SessionIndexEntry>`** — construct entry by streaming metadata
- **`getProjectSessionsIncludingFromDirectory(projectPath: string): Promise<SessionIndexEntry[]>`** — index + on-disk files
- **`saveAnalysisIndex(index: SessionAnalysisIndex): Promise<void>`**
- **`readAnalysisIndex(projectPath: string): Promise<SessionAnalysisIndex>`**
- **`hasAnalysisIndex(projectPath: string): Promise<boolean>`**

---

## 6. Analysis & Digestion

### `packages/core/src/interaction/analysis/analysis-types.ts`

**Purpose:** Types for LLM-powered session analysis, digestion, and indexing.

**Exported Types & Interfaces:**

- **`SessionAnalysis`** — LLM-extracted metadata; fields: `topics` (string[]), `tags`, `keyLearnings`, `summary`, `solutionType`, `codeLanguages`, `toolsUsed`, `successIndicators`, `relatedFiles`
- **`SessionMetadata`** — session contextual metadata; fields: `firstPrompt`, `gitBranch`, `created`, `duration?`, `messageCount`, `toolCallCount`, `estimatedCost`
- **`SessionAnalysisEntry`** — one row in analysis index; fields: `sessionId`, `sessionMtime`, `analyzedAt` (ISO), `analysis` (SessionAnalysis), `metadata` (SessionMetadata)
- **`SessionAnalysisIndex`** — master index; fields: `version`, `projectPath`, `lastIndexed`, `modelUsed`, counts, `entries` (SessionAnalysisEntry[])
- **`AnalysisModelDetails`** — model info; fields: `provider`, `name`
- **`DigestSegment`** — compacted chunk; fields: `index`, `messageRange`, `throughLine`, `keyFacts` (string[])
- **`DigestBeat`** — one user turn; fields: `index`, `userRequest`, `toolsUsed` (name/count), `outcome`, `narrative`, `keyFacts`
- **`DigestPhase`** — group of beats; fields: `name`, `beatRange` ([start, end]), `description`
- **`DigestFact`** — structured fact; fields: `type`, `text`
- **`SessionDigest`** — full digest output; fields: `sessionId`, `projectPath`, `projectName`, `source`, `created`, `modified`, `digestedAt`, `segments` (DigestSegment[]), `beats?`, `phases?`, `overallSummary`, `allFacts`, `analysis` (SessionAnalysis), `extractedFacts` (DigestFact[]), `metrics` (message/segment/tool counts, cost, duration)
- **`DigestIndexEntry`** — lightweight index row; fields: subset of SessionDigest without full segments
- **`DigestProjectSummary`** — project-level summary; fields: `path`, `name`, `sessionCount`
- **`DigestIndex`** — master digest index; fields: `version`, `lastUpdated`, `modelUsed`, `projects` (DigestProjectSummary[]), counts, `entries` (DigestIndexEntry[])
- **`IndexOptions`** — digest options; fields: `projectPath`, `model?`, `force?`, `batchSize?`, `verbose?`, `sessionsOverride?`
- **`DigestOptions`** — digest operations; fields: `projectPath?`, `model?`, `force?`, `batchSize?`, `verbose?`
- **`SearchOptions`** — filtering; fields: `projectPath`, `tags?`, `topic?`, `tool?`, `solutionType?`, `successIndicator?`, `branch?`, `limit?`, `json?`
- **`ScoredSearchResult`** — search hit; fields: `entry` (SessionAnalysisEntry), `score`, `matchedFields` (string[])
- **`ScoredDigestResult`** — digest search hit; fields: `entry` (DigestIndexEntry), `score`, `matchedFields`

**Exported Functions:**

- **`isSessionAnalysis(obj: unknown): obj is SessionAnalysis`** — type guard
- **`isSessionAnalysisIndex(obj: unknown): obj is SessionAnalysisIndex`** — type guard

**Exported Constants:**

- **`AnalysisSchema`** — Zod schema for LLM validation

---

### `packages/core/src/interaction/analysis/conversation-beats.ts`

**Purpose:** Group normalized messages into conversation beats (user turn + assistant/tool follow-up).

**Exported Interfaces:**

- **`ConversationBeat`** — one turn; fields:
  - `index` (number)
  - `userPreview` (string, ~2 lines)
  - `topic?` (string, first line of user message)
  - `toolCount`, `toolDurationMs` (aggregates)
  - `assistantPreview` (string, assistant reply preview)
  - `messageIds` (string[])
  - `messages` (NormalizedMessage[], full details)

**Exported Functions:**

- **`messagesToBeats(messages: NormalizedMessage[]): ConversationBeat[]`** — group normalized messages into beats
- **`formatBeatToolSummary(toolCount: number, toolDurationMs: number): string`** — human-readable tool summary ("5 tools, 2m 30s")

---

### `packages/core/src/interaction/analysis/session-digester.ts`

**Purpose:** Run full digest pipeline (compaction + beat analysis + fact extraction + LLM analysis).

**Key Exported Functions:**

- **`digestSession(entry: SessionIndexEntry, modelDetails: ModelDetails): Promise<SessionDigest>`** — main entry point; orchestrates:
  1. Parse session JSONL
  2. Convert to Interaction via adapter
  3. Use compaction strategy to produce segments
  4. Generate beats from messages
  5. Run LLM analysis on markdown conversion
  6. Extract facts via extraction engine
  7. Return full SessionDigest

**Internal Helpers:**

- **`filterBeats(...)`** — drop noise, clean IDE events
- **`NOISE_PATTERNS`** — regex for irrelevant turns
- **`stripXmlTags(...)`** — clean IDE markup

---

### `packages/core/src/interaction/analysis/session-analyzer.ts`

**Purpose:** LLM-powered metadata extraction from session markdown.

**Key Exported Functions:**

- **`analyzeSessionWithRetry(entry: SessionIndexEntry, modelDetails: ModelDetails): Promise<SessionAnalysis>`** — convert session to markdown, send to LLM with analysis prompt, validate against AnalysisSchema, retry on failure

**Internal Constants:**

- **`ANALYSIS_PROMPT`** — LLM system prompt for extraction
- **`MAX_TEXT_BLOCK_CHARS`** — truncation limit
- **`CHUNK_SIZE`** — max chars per API call

---

### `packages/core/src/interaction/analysis/extraction-engine.ts`

**Purpose:** Coordinate digest extraction across Explorations with progress streaming.

**Exported Types:**

- **`ExtractionPhase`** — literal union; values: "pending" | "digesting" | "digested" | "failed"
- **`ExtractionProgress`** — streaming event; fields: `explorationId`, `sessionId`, `phase`, `detail?`
- **`ExtractionInput`** — work item; fields: `explorationId`, `sessionId`, `modified`, `source`, `sessionEntry`
- **`DigestInfo`** — persisted metadata; fields: `digestedAt` (ISO), `schemaVersion?`
- **`ExtractionScope`** — scope detection result; fields: `undigested` (ExtractionInput[]), `stale` (ExtractionInput[])
- **`ExtractionEngineOptions`** — config; fields: `concurrency?`, `schemaVersion?`
- **`ExtractionResult`** — summary; fields: `digested`, `stale`, `failed`, `skipped` (counts)

**Exported Functions:**

- **`determineScope(inputs: ExtractionInput[], digests: Map<string, DigestInfo>, currentSchemaVersion?: number): ExtractionScope`** — partition into undigested vs. stale (modified or schema version changed)
- **`run(inputs: ExtractionInput[], digests: Map<string, DigestInfo>, modelDetails: ModelDetails, options?: ExtractionEngineOptions, onProgress?: (evt: ExtractionProgress) => void): Promise<ExtractionResult>`** — main extraction loop; yields progress events

---

## 7. Consumers (Where Adapters, Sessions, Interactions Flow)

### `packages/sessions/src/introspection/browse.ts`

**Purpose:** Browser data layer — load sessions, digests, and introspection runs.

**Key Exported Functions:**

- **`loadDigest(projectPath: string, sessionId: string): Promise<SessionDigest | null>`** — read digest JSON from `.umwelten/digests/sessions/<id>.json`
- **`saveDigest(projectPath: string, digest: SessionDigest): Promise<string>`** — persist to same path
- **`getDigestPath(projectPath: string, sessionId: string): string`** — digest file path

**Key Exported Interfaces:**

- **`SessionBrowserEntry`** — browser row; fields: `id`, `source`, `filePath`, `modifiedISO`, `modifiedMs`, `firstPrompt`, `messageCount`, `gitBranch?`, `analyzedIn` (array of runs with tally and attributed proposals)

**Current Flow:**
1. Caller calls `discoverSessionFilesInProject()` (session-store.ts)
2. For each file, calls `buildSessionEntryFromFile()` (session-store.ts)
3. Creates browser entries with FileSystemStatistics
4. On demand: loads digest from `.umwelten/digests/sessions/`

**Non-Claude-Code Support:** Currently **Claude Code only** for file paths. Adapter-based sources (Cursor, Pi) would need: (1) discovery via AdapterRegistry, (2) NormalizedSessionEntry → filePath mapping, (3) sourceData preservation for later reconstruction.

---

### `packages/ui/src/tui/introspect/browse.tsx`

**Purpose:** Terminal UI for browsing explorations, sessions, and launching digestion.

**Key Functions:**

- **`runIntrospectBrowseTui(opts: RunBrowseTuiOptions): Promise<void>`** — show browse UI
  - Options: `projectPath`, `targetPath`, `sessionsDir?`, `model` (ModelDetails), `force?`

**Current Flow:**
1. Call `buildBrowse()` from evaluation package (similar to sessions browse)
2. Call `buildExploreBrowse()` to load projections
3. Render BrowseApp (React/Ink TUI)
4. On selection: trigger digest via DashboardApp

**Current State:** Uses evaluation/introspection functions; unifies both but still Claude Code–focused.

---

### `packages/habitat/src/tools/external-interaction-tools.ts`

**Purpose:** Habitat agent tools for querying Claude Code sessions.

**Key Exported Functions:**

- **`createExternalInteractionTools(ctx: ExternalInteractionToolsContext): Record<string, Tool>`** — factory for three tools:
  1. **list** — `getProjectSessions(agent.projectPath)` → list recent sessions
  2. **show** — `parseSessionFile(entry.fullPath!)` → summary
  3. **messages** — (not shown but follows same pattern)
  4. **stats** — `summarizeSession()` → detailed metrics

**Current Flow:**
1. Tool receives `agentId`
2. Looks up agent's `projectPath`
3. Calls `getProjectSessions()` to read index (assumes **Claude Code only**)
4. If `fullPath` missing (adapter sources), **will crash**

**Current State:** **File-based only**. Adapter support requires: (1) route through AdapterRegistry, (2) call `adapter.getSession()` instead of `parseSessionFile()`, (3) unify into single `loadInteraction(sessionId, modelDetails, stimulus?)` helper.

---

### `packages/core/src/session-record/habitat-transcript-load.ts`

**Purpose:** Load Habitat transcript segments (frozen + live) for session reconstruction.

**Key Exported Functions:**

- **`loadHabitatSessionTranscriptMessages(sessionDir: string): Promise<SessionMessage[]>`** — concatenate all JSONL segment files, drop compaction markers
- **`loadRecentHabitatTranscriptCoreMessages(sessionDir: string, maxMessages: number): Promise<CoreMessage[]>`** — recent N messages as CoreMessage[]

**Current Flow:**
1. Call `listHabitatTranscriptReadPaths()` (habitat-specific)
2. For each path, call `parseSessionFile()` (generic JSONL)
3. Filter out umwelten_compaction marker lines
4. Return SessionMessage[] or CoreMessage[] (for resume)

**Current State:** **Habitat-specific**. Generic enough to work with any JSONL-based source, but would benefit from adapter integration for unified loading.

---

## Type Lineage Diagram

```
RAW FILE LAYER (Tool-specific storage)
├─ Claude Code: ~/.claude/projects/{encoded}/UUID.jsonl + sessions-index.json
├─ Cursor: ~/Library/Application Support/Cursor/User/workspaceStorage/{hash}/state.vscdb
├─ Habitat: ~/.habitat/sessions/{sessionId}/transcript.jsonl
└─ Pi: (TBD tree structure)

                    ↓ adapter.discoverSessions() / adapter.getSession()

NORMALIZED LAYER (Adapter output)
├─ SessionIndexEntry                    ← index metadata only
│   └─ adapter.getSessionEntry()  →  NormalizedSessionEntry
└─ SessionMessage[] (JSONL parse)      ← full content
    └─ adapter.getMessages()  →  NormalizedMessage[]
        └─ adapter.getSession()  →  NormalizedSession (combined)

                    ↓ projectSessions() / projector.toSourceSession()

DOMAIN LAYER (Project-level grouping)
├─ SourceSession (1:1 with NormalizedSession)
│   └─ createDefaultExploration()  →  Exploration
│                                       └─ members: ExplorationMember[] (references to SourceSession.id)
└─ Exploration (virtual or saved)
    └─ members reference one or more SourceSessions

                    ↓ Interaction.fromNormalizedSession(session, modelDetails, stimulus)
                       [also: adapter.getSession() → Interaction directly]

LIVE LAYER (Runner-facing)
├─ Interaction (flat conversation)
│   ├─ messages: CoreMessage[] (from Vercel AI SDK; replaces system + normalized)
│   ├─ stimulus: Stimulus (model options, tools)
│   └─ runner: ModelRunner (executes generateText, streamText, etc.)
└─ CoreMessage (["user" | "assistant" | "system" | "tool"], content: string | object[])

                    ↓ digest pipeline: Interaction → compaction → beats → LLM analysis

ANALYSIS LAYER
├─ ConversationBeat (one user turn + assistant/tool follow-up)
├─ SessionDigest (compacted segments + beats + phases + facts + analysis)
└─ SessionAnalysis (LLM-extracted topics, tags, learnings, solution type)
    └─ SessionAnalysisIndex (master index of SessionAnalysisEntry rows)
```

---

## Who Calls What

### Data Flow: Discovery → Loading → Interaction → Digestion

#### 1. **Session Discovery** (first-time or re-index)

| Consumer | Code | What It Does | Adapter Support? |
|----------|------|-------|---|
| `session-digester.ts` lines 27–47 | `getProjectSessionsIncludingFromDirectory()` then `adapter.getSession()` | Loads all sessions for a project, converts to Interaction for compaction | **Partial** — discovers Claude Code, but digester expects `.fullPath` |
| `external-interaction-tools.ts` lines 50–96 | `getProjectSessions()` + `parseSessionFile(entry.fullPath!)` | Lists and shows external interactions for an agent | **No** — crashes if `fullPath` undefined |
| `browse.ts` lines 45–100 | `discoverSessionFilesInProject()` + `buildSessionEntryFromFile()` | Build browser rows (sessions + run history) | **No** — file-based only |
| `browse.tsx` lines 74–80 | `buildBrowse()` → `buildExploreBrowse()` | Load projections for TUI | **No** — uses evaluation/sessions layer (Claude Code only) |

#### 2. **Session Loading** (fetch by ID)

| Consumer | Code | What It Does | Adapter Support? |
|----------|------|-------|---|
| `session-digester.ts` line 11 | `digestSession(entry, modelDetails)` — internally calls `adapter.getSession()` | Load + convert to Interaction | **Yes** — adapter-aware |
| `external-interaction-tools.ts` lines 84–98 | `parseSessionFile(entry.fullPath!)` | Load and summarize | **No** — file path required |
| `habitat-transcript-load.ts` lines 24–42 | `parseSessionFile(path)` for each segment | Load Habitat transcript | **No** — assumes Habitat dir structure |

#### 3. **Interaction Construction**

| Consumer | Code | What It Does | Adapter Support? |
|----------|------|-------|---|
| `session-digester.ts` lines 39–47 | `Interaction.fromNormalizedSession(normalized, modelDetails, stimulus)` | Create live interaction from stored session | **Yes** — works with any NormalizedSession (from adapter) |
| `habitat-transcript-load.ts` lines 48–73 | Manual CoreMessage[] construction from SessionMessage[] | Create interaction for resume | **No** — Habitat-specific reconstruction |

#### 4. **Analysis & Digestion**

| Consumer | Code | What It Does | Adapter Support? |
|----------|------|-------|---|
| `session-digester.ts` lines 50–93 | `filterBeats()`, `messagesToBeats()` | Beat generation from normalized messages | **Yes** — works with any NormalizedMessage[] |
| `session-analyzer.ts` lines 77–100+ | `analyzeSessionWithRetry()` on converted markdown | LLM analysis of session content | **Yes** — takes SessionIndexEntry (metadata-only) |
| `extraction-engine.ts` lines 99–120 | `determineScope()`, `run()` | Coordinate extraction, track stale digests | **Yes** — works with ExtractionInput (metadata) |

---

## Unification Roadmap

### Current Issues

1. **Manual source-branching** in consumers:
   - `external-interaction-tools.ts` checks `entry.fullPath` and crashes for non-Claude sources
   - `browse.ts` assumes file paths; no adapter fallback
   - `habitat-transcript-load.ts` hardcodes Habitat dir structure

2. **No unified load path**:
   - Some code calls `parseSessionFile(fullPath)` directly
   - Some calls `adapter.getSession()` (session-digester)
   - No central `loadInteraction(sessionId, modelDetails, stimulus?)` function

3. **sourceData preservation**:
   - NormalizedSessionEntry, NormalizedSession, SourceSession all carry `sourceData`
   - But consumers don't use it to reconstruct or provide adapter context

### Recommended Unification

```typescript
/**
 * Central load point: given sessionId + metadata, load as Interaction.
 * Works with all sources (Claude Code, Cursor, Pi, Habitat).
 *
 * Flow:
 *   1. Detect source from metadata or sessionId prefix
 *   2. Get adapter via adapterRegistry.get(source)
 *   3. Call adapter.getSession(sessionId)
 *   4. Optionally validate with stimulus
 *   5. Return Interaction.fromNormalizedSession(...)
 */
export async function loadInteraction(
  sessionId: string,
  modelDetails: ModelDetails,
  source?: SessionSource,
  stimulus?: Stimulus,
): Promise<Interaction> {
  const registry = adapterRegistry;
  const sourceKind = source || detectSourceFromSessionId(sessionId);

  const adapter = registry.get(sourceKind);
  if (!adapter) {
    throw new Error(`No adapter for source: ${sourceKind}`);
  }

  const normalized = await adapter.getSession(sessionId);
  if (!normalized) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  return Interaction.fromNormalizedSession(normalized, modelDetails, stimulus);
}
```

**Consumers would then simplify:**

- `external-interaction-tools.ts`: Replace `parseSessionFile(entry.fullPath!)` with `loadInteraction(entry.sessionId, modelDetails)`
- `browse.ts`: Use `loadInteraction()` for digest loading
- `habitat-transcript-load.ts`: Route through `loadInteraction()` if sourceData indicates non-file source
- `session-digester.ts`: Already correct (uses adapter.getSession); no change needed

---

## Reference: Public API Summary

### Creating an Interaction

```typescript
// From scratch (new conversation)
const interaction = new Interaction(
  modelDetails,
  new Stimulus({ role: "assistant", systemContext: "Your prompt" })
);

// From stored NormalizedSession
const interaction = Interaction.fromNormalizedSession(
  normalizedSession,
  modelDetails,
  stimulus  // optional; defaults to system context from session
);
```

### Discovering Sessions

```typescript
// Discover all sessions for a project (all sources)
const result = await adapterRegistry.discoverAllSessions({
  projectPath: "/path/to/project"
});

// Detect which adapters can handle a project
const adapters = await adapterRegistry.detectAdapters(projectPath);

// Get a specific adapter
const adapter = adapterRegistry.get("claude-code");
const sessions = await adapter.discoverSessions({ projectPath });
```

### Converting Between Formats

```typescript
// SessionMessage[] (JSONL) → NormalizedMessage[]
const normalized = sessionMessages.map(msg => normalizeMessage(msg));

// NormalizedMessage[] → ConversationBeat[]
const beats = messagesToBeats(normalized);

// NormalizedSessionEntry → SourceSession → Exploration
const sourceSession = toSourceSession(entry, "claude-code");
const exploration = createDefaultExploration(sourceSession).exploration;
```

### Analysis Pipeline

```typescript
// Full digest: compaction + beats + LLM analysis + fact extraction
const digest = await digestSession(sessionEntry, modelDetails);

// Extract analysis only (no compaction)
const analysis = await analyzeSessionWithRetry(sessionEntry, modelDetails);

// Determine which sessions need digestion
const scope = determineScope(inputs, existingDigests, schemaVersion);
await extractionEngine.run(scope.undigested, modelDetails, onProgress);
```

---

## Key Distinctions

| Type | Origin | Scope | Contains | Use For |
|------|--------|-------|----------|---------|
| **SessionMessage** | Raw JSONL | File structure | Type-discriminated union (user/assistant/summary/progress) | Parsing Claude Code .jsonl files |
| **NormalizedMessage** | Adapter output | Single message | role, content (string), tool metadata, tokens | Comparing messages across sources |
| **CoreMessage** | Vercel AI SDK | Live conversation | role, content (string &#124; object[]) | Passing to model runners |
| **SessionIndexEntry** | Index file | Metadata only | sessionId, firstPrompt, messageCount, file path | Quick listing; discovering files |
| **NormalizedSession** | Adapter output | Full session | messages[], metadata, metrics | Storing/loading complete conversation |
| **SourceSession** | Domain projection | Project-level | id, source, metrics, title | Grouping into Explorations |
| **Interaction** | Live context | Runner scope | CoreMessage[], stimulus, tools, runner | Executing against a model |
| **Exploration** | Domain grouping | Project scope | members (ExplorationMember[]) | Saving and querying related sessions |
| **SessionDigest** | Analysis output | Full session | segments, beats, phases, analysis, facts | Searching and reflecting on sessions |

---

## CONTEXT.md Language Map

From CONTEXT.md, the canonical domain language:

- **Interaction** = flat model-facing conversation (what this doc calls "Interaction")
- **Source Session** = tool-specific persisted artifact (what this doc calls "SourceSession")
- **Exploration** = grouping of Source Sessions (what this doc calls "Exploration")
- **Saved Exploration** = persisted Exploration (what this doc calls "SavedExploration")
- **Reflection** = act of creating an Interaction about other Interactions (uses digestSession + analysis)
- **Memory** = knowledge derived from Reflections (stored in FACTS.md, AGENTS.md, .umwelten/)
- **Skill Candidate** = procedure found during Reflection (stored as proposed artifact)
- **Skill** = promoted Skill Candidate (durable)

---

End of inventory.
