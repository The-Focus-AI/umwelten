/**
 * Compaction types: input to strategies, result, and strategy interface.
 */

import type { CoreMessage } from "ai";
import type { ModelDetails, ModelRunner } from "../cognition/types.js";

export interface CompactionInput {
  /** Full context (strategy can see system if needed). */
  messages: CoreMessage[];
  /** Index of first message to condense (1 = first message after system). */
  segmentStart: number;
  /** Index of last message to condense (inclusive). */
  segmentEnd: number;
  /** Current conversation model (for LLM strategies). */
  model?: ModelDetails;
  /** Current conversation runner (for LLM strategies). */
  runner?: ModelRunner;
  /** Strategy-specific options (e.g. maxSummaryTokens). */
  options?: Record<string, unknown>;
}

export interface CompactionResult {
  /** Messages to replace the segment (often a single summary message). */
  replacementMessages: CoreMessage[];
}

export interface CompactionStrategy {
  /** Stable id for registration and CLI (e.g. through-line-and-facts). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** One line for help/UI. */
  description: string;
  /** Condense the segment; may use input.runner and input.model for LLM. */
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
