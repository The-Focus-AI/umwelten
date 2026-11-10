/**
 * Compaction types: input to strategies, result, and strategy interface.
 */

import type { ModelMessage } from "ai";
import type { ModelDetails, ModelRunner } from "../cognition/types.js";
import type { TokenUsage } from "../costs/costs.js";

export interface CompactionInput {
  /** Full context (strategy can see system if needed). */
  messages: ModelMessage[];
  /** First message of a complete user turn (0 is allowed without a leading system message). */
  segmentStart: number;
  /** Last message of a complete turn (inclusive); bounds cannot split tool round-trips. */
  segmentEnd: number;
  /** Current conversation model (for LLM strategies). */
  model?: ModelDetails;
  /** Current conversation runner (for LLM strategies). */
  runner?: ModelRunner;
  /** Strategy-specific options:
   * truncate: keepTurns, non-negative safe integer (default 2), within the selected segment.
   * LLM strategies: maxSummaryTokens, positive safe integer; task-handoff defaults to 2048.
   * Sets per-call Stimulus.maxTokens and rejects replacement text over ceil(chars / 4).
   * This is an estimate, not exact token accounting. Through-line has no default cap.
   */
  options?: Record<string, unknown>;
}

export interface CompactionResult {
  /** Messages to replace the segment (often a single summary message). */
  replacementMessages: ModelMessage[];
  /** Summarizer generation usage, when reported; not the replacement size. */
  usage?: TokenUsage;
  /** ceil(replacement summary UTF-16 characters / 4), including its label. Not a tokenizer count. */
  estimatedSummaryTokens?: number;
}

export interface CompactionStrategy {
  /** Stable id for registration and CLI (e.g. through-line-and-facts). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** One line for help/UI. */
  description: string;
  /** Condense the segment; built-ins throw on unsafe bounds or summary failure, without mutating input. */
  compact(input: CompactionInput): Promise<CompactionResult>;
}

export interface ContextSizeEstimate {
  messageCount: number;
  characterCount: number;
  estimatedTokens: number;
}

export interface CompactionSegment {
  start: number;
  end: number;
}
