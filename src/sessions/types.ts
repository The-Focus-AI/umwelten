/**
 * Type definitions for Claude Code session storage format
 * Based on ~/.claude/projects/<project>/sessions-index.json and *.jsonl files
 */

/**
 * Sessions index file structure
 */
export interface SessionsIndex {
  version: number;
  entries: SessionIndexEntry[];
}

/**
 * Single session entry in the sessions index
 */
export interface SessionIndexEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}

/**
 * Base properties shared by all JSONL entries
 */
export interface BaseJSONLEntry {
  type: string;
  uuid?: string;
  timestamp?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  sessionId?: string;
  version?: string;
  gitBranch?: string;
}

/**
 * Summary entry in JSONL transcript
 */
export interface SummaryEntry extends BaseJSONLEntry {
  type: 'summary';
  summary: string;
  leafUuid: string;
}

/**
 * File history snapshot entry
 */
export interface FileHistorySnapshot {
  messageId: string;
  trackedFileBackups: Record<string, unknown>;
  timestamp: string;
}

export interface FileHistorySnapshotEntry extends BaseJSONLEntry {
  type: 'file-history-snapshot';
  messageId: string;
  snapshot: FileHistorySnapshot;
  isSnapshotUpdate: boolean;
}

/**
 * Progress entry (e.g., hook execution)
 */
export interface ProgressData {
  type: string;
  hookEvent?: string;
  hookName?: string;
  command?: string;
  [key: string]: unknown;
}

export interface ProgressEntry extends BaseJSONLEntry {
  type: 'progress';
  data: ProgressData;
  parentToolUseID?: string;
  toolUseID?: string;
}

/**
 * Content blocks in messages
 */
export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string | unknown;
  is_error?: boolean;
}

export type ContentBlock = TextContent | ToolUseContent | ToolResultContent;

/**
 * Token usage information
 */
export interface CacheCreation {
  ephemeral_5m_input_tokens?: number;
  ephemeral_1h_input_tokens?: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: CacheCreation;
  service_tier?: 'standard' | 'pro';
}

/**
 * Thinking metadata
 */
export interface ThinkingMetadata {
  level: string;
  disabled: boolean;
  triggers: string[];
}

/**
 * Claude API message structure
 */
export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
  model?: string;
  id?: string;
  type?: 'message';
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: TokenUsage;
}

/**
 * User message entry in JSONL transcript
 */
export interface UserMessageEntry extends BaseJSONLEntry {
  type: 'user';
  message: ClaudeMessage;
  thinkingMetadata?: ThinkingMetadata;
  todos?: unknown[];
}

/**
 * Assistant message entry in JSONL transcript
 */
export interface AssistantMessageEntry extends BaseJSONLEntry {
  type: 'assistant';
  message: ClaudeMessage;
  requestId?: string;
}

/**
 * Union type for all possible JSONL entry types
 */
export type SessionMessage =
  | SummaryEntry
  | FileHistorySnapshotEntry
  | ProgressEntry
  | UserMessageEntry
  | AssistantMessageEntry;

/**
 * Parsed session data with metadata and messages
 */
export interface ParsedSession {
  metadata: SessionIndexEntry;
  messages: SessionMessage[];
}

/**
 * Statistics for a session
 */
export interface SessionStats {
  sessionId: string;
  messageCount: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCost: number;
}

/**
 * Tool call extracted from session
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  timestamp: string;
  messageUuid: string;
}

/**
 * Options for filtering sessions
 */
export interface SessionListOptions {
  projectPath?: string;
  gitBranch?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  sortBy?: 'created' | 'modified' | 'messageCount';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Options for formatting session output
 */
export interface FormatOptions {
  format: 'json' | 'markdown' | 'text';
  includeToolResults?: boolean;
  includeProgress?: boolean;
  includeFileHistory?: boolean;
  colorize?: boolean;
}
