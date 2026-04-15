/**
 * Shared types for the ChannelBridge — the unified adapter layer
 * that sits between platform-specific transports (Discord, Telegram,
 * Slack, Teams, Web) and the Habitat core.
 */

import type { CoreMessage } from 'ai';

// ── Inbound message ──────────────────────────────────────────────────

/** An attachment received from any platform. */
export interface ChannelAttachment {
  /** Original filename (e.g. "photo.png"). */
  filename: string;
  /** MIME type when available (e.g. "image/png"). */
  mimeType?: string;
  /** URL or local path to fetch the file contents. */
  url: string;
}

/** A message arriving from any platform adapter. */
export interface ChannelMessage {
  /**
   * Platform-scoped channel key, e.g. "discord:123", "telegram:456", "web:sess-abc".
   * Used to key interaction caching, routing, and session directories.
   */
  channelKey: string;
  /** The user's text. */
  text: string;
  /** Optional file attachments. */
  attachments?: ChannelAttachment[];
  /** Stable user identifier (for provider analytics, not PII). */
  userId?: string;
  /**
   * Parent channel key — used for thread-based routing inheritance.
   * e.g. a Discord thread inherits its parent channel's agent binding.
   */
  parentChannelKey?: string;
}

// ── Event handlers ───────────────────────────────────────────────────

/** Callbacks the platform adapter provides to receive streaming events. */
export interface BridgeEventHandlers {
  /** Incremental text delta from the LLM. */
  onText?: (delta: string) => void;
  /** A tool call started. */
  onToolCall?: (name: string, input: unknown) => void;
  /** A tool call returned a result. */
  onToolResult?: (name: string, output: string, isError: boolean) => void;
  /** The LLM finished. The adapter should format and send `content`. */
  onDone: (result: BridgeResult) => void | Promise<void>;
  /** An error occurred during processing. */
  onError?: (error: string) => void;
}

// ── Result ───────────────────────────────────────────────────────────

/** The final result of a bridge message cycle. */
export interface BridgeResult {
  /** Full assistant response text. */
  content: string;
  /** Session id on disk. */
  sessionId: string;
  /** The channel key this was for. */
  channelKey: string;
  /** Extended reasoning if the model emitted it. */
  reasoning?: string;
}

// ── Routing ──────────────────────────────────────────────────────────

/** How a bound channel's messages are executed. */
export type ChannelRuntimeMode = 'default' | 'claude-sdk';

/** A channel → agent binding in routing.json. */
export interface ChannelBinding {
  agentId: string;
  runtime?: ChannelRuntimeMode;
  /** Discord-specific: pinned binding card message id. */
  infoMessageId?: string;
}

/** Routing configuration loaded from routing.json. */
export interface RoutingConfig {
  /** Map of channelKey → agent binding. */
  channels?: Record<string, string | ChannelBinding>;
  /** Fallback agent for unmapped channels. */
  defaultAgentId?: string;
  /** Per-platform defaults (e.g. { discord: { agentId: "jeeves" } }). */
  platformDefaults?: Record<string, { agentId: string; runtime?: ChannelRuntimeMode }>;
}

/** Result of resolving a channel's route. */
export type RouteResolution =
  | { kind: 'main' }
  | { kind: 'agent'; agentId: string; runtime: ChannelRuntimeMode };

// ── Bridge options ───────────────────────────────────────────────────

export interface ChannelBridgeOptions {
  /** Number of recent user+assistant message pairs to restore from transcript (default: 4). */
  resumeMessagePairs?: number;
  /** Platform-specific instruction appended to the stimulus (e.g. "Keep messages short"). */
  platformInstruction?: string;
}
