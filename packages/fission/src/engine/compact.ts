/**
 * Compaction execution and measurement.
 *
 * The engine runs compaction itself rather than calling
 * `interaction.compactContext()`, for two reasons: it needs a tail of messages
 * left verbatim (core's segment always runs to the last assistant message), and
 * it needs the before/after token counts and the produced summary text recorded
 * on the turn so the browser can diff strategies later.
 *
 * NOTE: nothing here caps model output. Strategies generate to their natural
 * stop; a summary that comes back long is a fact about the strategy, and
 * truncating it would quietly corrupt every ratio in the report.
 */

import type { ModelMessage } from "ai";
import { estimateContextSize } from "@umwelten/core/context/estimate-size.js";
import { getCompactionStrategy } from "@umwelten/core/context/registry.js";
import type { ModelDetails, ModelRunner } from "@umwelten/core/cognition/types.js";
import type { CompactionRecord } from "../types.js";
import { registerFissionStrategies } from "../compaction/register.js";

export interface CompactionPlan {
  segmentStart: number;
  segmentEnd: number;
}

/**
 * Choose the slice to condense: everything from the first conversation message
 * up to `keepRecentMessages` from the end, ending on an assistant message so a
 * user turn is never cut in half.
 *
 * Returns null when there is nothing worth compacting.
 */
export function planCompaction(
  messages: ModelMessage[],
  keepRecentMessages: number,
): CompactionPlan | null {
  const start = 1; // index 0 is the stimulus system prompt
  const lastCandidate = messages.length - 1 - Math.max(0, keepRecentMessages);
  if (lastCandidate < start) return null;

  let segmentEnd = -1;
  for (let i = lastCandidate; i >= start; i--) {
    if ((messages[i] as { role?: string }).role === "assistant") {
      segmentEnd = i;
      break;
    }
  }
  if (segmentEnd < start) return null;

  // A single leftover summary message is not worth re-summarizing.
  let substantive = 0;
  for (let i = start; i <= segmentEnd; i++) {
    const role = (messages[i] as { role?: string }).role;
    if (role === "user" || role === "assistant") substantive++;
  }
  if (substantive < 2) return null;

  return { segmentStart: start, segmentEnd };
}

export interface RunCompactionOptions {
  messages: ModelMessage[];
  strategyId: string;
  keepRecentMessages: number;
  model: ModelDetails;
  runner: ModelRunner;
  strategyOptions?: Record<string, unknown>;
}

export interface CompactionOutcome {
  record: CompactionRecord;
  /** The full message array after the segment was replaced. */
  messages: ModelMessage[];
}

function summaryTextOf(messages: ModelMessage[]): string {
  return messages
    .map((m) => {
      const content = (m as { content?: unknown }).content;
      return typeof content === "string" ? content : JSON.stringify(content);
    })
    .join("\n\n");
}

/**
 * Run one compaction pass. Never throws: on strategy failure the original
 * messages come back untouched and the error is recorded on the CompactionRecord,
 * because losing a conversation to a summarizer hiccup is not an acceptable
 * failure mode.
 */
export async function runCompaction(
  options: RunCompactionOptions,
): Promise<CompactionOutcome | null> {
  registerFissionStrategies();

  const plan = planCompaction(options.messages, options.keepRecentMessages);
  if (!plan) return null;

  const started = Date.now();
  const tokensBefore = estimateContextSize(options.messages).estimatedTokens;

  const strategy = await getCompactionStrategy(options.strategyId);
  if (!strategy) {
    return {
      messages: options.messages,
      record: {
        strategyId: options.strategyId,
        segmentStart: plan.segmentStart,
        segmentEnd: plan.segmentEnd,
        replacementCount: 0,
        tokensBefore,
        tokensAfter: tokensBefore,
        ratio: 1,
        latencyMs: Date.now() - started,
        summaryText: "",
        error: `Unknown compaction strategy: ${options.strategyId}`,
      },
    };
  }

  try {
    const result = await strategy.compact({
      messages: options.messages,
      segmentStart: plan.segmentStart,
      segmentEnd: plan.segmentEnd,
      model: options.model,
      runner: options.runner,
      options: options.strategyOptions,
    });

    const next: ModelMessage[] = [
      ...options.messages.slice(0, plan.segmentStart),
      ...result.replacementMessages,
      ...options.messages.slice(plan.segmentEnd + 1),
    ];
    const tokensAfter = estimateContextSize(next).estimatedTokens;

    return {
      messages: next,
      record: {
        strategyId: strategy.id,
        segmentStart: plan.segmentStart,
        segmentEnd: plan.segmentEnd,
        replacementCount: result.replacementMessages.length,
        tokensBefore,
        tokensAfter,
        ratio: tokensBefore > 0 ? Number((tokensAfter / tokensBefore).toFixed(4)) : 1,
        latencyMs: Date.now() - started,
        summaryText: summaryTextOf(result.replacementMessages),
      },
    };
  } catch (error) {
    return {
      messages: options.messages,
      record: {
        strategyId: options.strategyId,
        segmentStart: plan.segmentStart,
        segmentEnd: plan.segmentEnd,
        replacementCount: 0,
        tokensBefore,
        tokensAfter: tokensBefore,
        ratio: 1,
        latencyMs: Date.now() - started,
        summaryText: "",
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
