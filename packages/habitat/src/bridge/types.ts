/**
 * Shared types for the ChannelBridge — the unified adapter layer
 * that sits between platform-specific transports (Discord, Telegram,
 * Slack, Teams, Web) and the Habitat core.
 */

import type { CoreMessage } from 'ai';
import type { ModelResponse } from '@umwelten/core/cognition/types.js';
import type { AgentEntry, NativeSessionRef } from '../types.js';

/** Model-run metadata (token usage, provider, model, cost) — core doesn't export the type directly. */
export type BridgeResponseMetadata = ModelResponse['metadata'];

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
   * Display name of the speaker, when known (e.g. from a verified A2A grant).
   * Used to label turns in multi-speaker threads.
   */
  displayName?: string;
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
  /** Incremental reasoning/thinking delta from the LLM. */
  onReasoning?: (delta: string) => void;
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
  /**
   * Response metadata from the model run (token usage, provider, model,
   * cost) when the default Interaction runtime produced the response.
   * Non-default runtimes (claude-sdk, pi) don't surface this yet.
   * When the tool-call follow-up turn produced the final text, this is
   * the follow-up turn's metadata (per-run, not cumulative).
   */
  metadata?: BridgeResponseMetadata;
}

// ── Runtime seam (#118) ──────────────────────────────────────────────

/**
 * How a bound channel's messages are executed.
 *
 * - `default`    — the base Interaction tool-loop; full transcript written.
 * - `claude-sdk` — Claude Agent SDK subprocess against the agent's project.
 * - `pi`         — pi agentic runtime (runner lands in #122; the mode is
 *                  part of the contract now so routing/config don't churn).
 *
 * Non-default modes dispatch through a registered RuntimeRunner.
 */
export type ChannelRuntimeMode = 'default' | 'claude-sdk' | 'pi';

/** What a RuntimeRunner gets to work with, beyond the prompt itself. */
export interface RuntimeContext {
  /** The agent the channel is bound to (cwd source for subprocess runtimes). */
  agent: AgentEntry;
  /** Habitat session id the run is recorded under. */
  sessionId: string;
  /** Habitat session directory (transcript + meta.json live here). */
  sessionDir: string;
  /** The originating channel key (e.g. "discord:123"). */
  channelKey: string;
}

/** Outcome of a RuntimeRunner.run — the PRD #113 contract shape. */
export interface RuntimeResult {
  /** Final assistant text for the channel. */
  content: string;
  /** Whether the run completed successfully. */
  success: boolean;
  /** Error details when success is false. */
  errors?: string[];
  /**
   * Link to the runtime's native session (id + on-disk log), recorded in
   * the habitat session's metadata so the full tool-call trace is
   * reachable from the Source Session envelope.
   */
  nativeSessionRef?: NativeSessionRef;
}

/**
 * The contract every non-default runtime implements (#118). The bridge
 * dispatches through this seam — adding a runtime means registering a
 * runner, not touching the bridge, the transcript writer, or A2A.
 */
export interface RuntimeRunner {
  run(
    prompt: string,
    ctx: RuntimeContext,
    events: BridgeEventHandlers,
  ): Promise<RuntimeResult>;
}

// ── Routing ──────────────────────────────────────────────────────────

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
