/**
 * Normalized session types for multi-source support
 *
 * These types provide a common format for sessions from different AI coding tools:
 * - Claude Code (JSONL files)
 * - Cursor (SQLite state.vscdb)
 * - Windsurf (TBD)
 * - Aider (Markdown history)
 */

/**
 * Supported session sources
 */
export type SessionSource =
  | 'claude-code'
  | 'cursor'
  | 'windsurf'
  | 'aider'
  | 'native'
  | 'unknown';

/**
 * Message role - common across all AI tools
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Token usage metrics (if available from source)
 */
export interface NormalizedTokenUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

/**
 * Normalized message - common format across all sources
 *
 * Maps from:
 * - Claude Code: UserMessageEntry, AssistantMessageEntry
 * - Cursor: bubble entries from SQLite
 */
export interface NormalizedMessage {
  /** Unique message ID (from source or generated) */
  id: string;

  /** Message role */
  role: MessageRole;

  /** Plain text content (extracted from content blocks if needed) */
  content: string;

  /** ISO timestamp */
  timestamp?: string;

  /** Tool call details (when role === 'tool') */
  tool?: {
    name: string;
    input?: Record<string, unknown>;
    output?: string;
    duration?: number; // ms
    isError?: boolean;
  };

  /** Token usage for this message (if available) */
  tokens?: NormalizedTokenUsage;

  /** Model used for this message (if available) */
  model?: string;

  /** Preserve source-specific data for debugging/export */
  sourceData?: Record<string, unknown>;
}

/**
 * Session metrics - aggregated stats
 */
export interface SessionMetrics {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimatedCost?: number;
}

/**
 * Normalized session - common format across all sources
 *
 * Maps from:
 * - Claude Code: SessionIndexEntry + parsed JSONL
 * - Cursor: composerData entries from SQLite
 */
export interface NormalizedSession {
  /** Unique ID across all sources (prefixed with source) */
  id: string;

  /** Source tool that created this session */
  source: SessionSource;

  /** Original ID from the source tool */
  sourceId: string;

  /** Resolved project path (if determinable) */
  projectPath?: string;

  /** Workspace path (for workspace-scoped sources like Cursor) */
  workspacePath?: string;

  /** Git branch (if available) */
  gitBranch?: string;

  /** Git repository name (if available) */
  gitRepo?: string;

  /** Session creation timestamp (ISO) */
  created: string;

  /** Session last modified timestamp (ISO) */
  modified: string;

  /** Session duration in milliseconds */
  duration?: number;

  /** Messages in this session */
  messages: NormalizedMessage[];

  /** Total message count */
  messageCount: number;

  /** First user prompt (for display/search) */
  firstPrompt: string;

  /** Aggregated metrics */
  metrics?: SessionMetrics;

  /** Whether this is a sidechain/branch conversation */
  isSidechain?: boolean;

  /** Preserve source-specific data */
  sourceData?: Record<string, unknown>;
}

/**
 * Lightweight session entry for listing (without full messages)
 */
export interface NormalizedSessionEntry {
  id: string;
  source: SessionSource;
  sourceId: string;
  projectPath?: string;
  gitBranch?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstPrompt: string;
  metrics?: SessionMetrics;
  isSidechain?: boolean;
  /** Preserve source-specific data (e.g. fullPath for Claude Code, workspaceHash for Cursor). */
  sourceData?: Record<string, unknown>;
}

/**
 * Options for discovering sessions
 */
export interface SessionDiscoveryOptions {
  /** Filter by project path */
  projectPath?: string;

  /** Filter by git branch */
  gitBranch?: string;

  /** Filter sessions created after this date */
  since?: Date;

  /** Filter sessions created before this date */
  until?: Date;

  /** Maximum number of sessions to return */
  limit?: number;

  /** Sort field */
  sortBy?: 'created' | 'modified' | 'messageCount';

  /** Sort order */
  sortOrder?: 'asc' | 'desc';

  /** Include sidechain sessions */
  includeSidechains?: boolean;
}

/**
 * Result of session discovery
 */
export interface SessionDiscoveryResult {
  sessions: NormalizedSessionEntry[];
  source: SessionSource;
  totalCount: number;
  hasMore: boolean;
}

/**
 * Combined result from multiple sources
 */
export interface MultiSourceDiscoveryResult {
  results: SessionDiscoveryResult[];
  totalCount: number;
}
