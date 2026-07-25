/**
 * recent-window — deterministic keep-the-last-N-turns compaction.
 *
 * No model call, so it is free and instant. It exists as the floor of the
 * comparison: any LLM strategy that can't beat "just keep the last two
 * exchanges verbatim" isn't earning its latency. Unlike `truncate`, which
 * throws the segment away entirely, this keeps the tail intact — which is
 * usually all a short follow-up needs.
 */

import type { ModelMessage } from "ai";
import { serializeSegment } from "@umwelten/core/context/serialize-messages.js";
import type {
  CompactionInput,
  CompactionResult,
  CompactionStrategy,
} from "@umwelten/core/context/types.js";

export const recentWindowStrategy: CompactionStrategy = {
  id: "recent-window",
  name: "Recent window",
  description:
    "Keep the last N messages of the segment verbatim and drop the rest. No LLM, no cost, no latency.",
  async compact(input: CompactionInput): Promise<CompactionResult> {
    const keepMessages = Math.max(
      1,
      (input.options?.keepMessages as number | undefined) ?? 4,
    );
    const { messages, segmentStart, segmentEnd } = input;

    const segmentLength = segmentEnd - segmentStart + 1;
    if (segmentLength <= keepMessages) {
      // Nothing to drop; hand the segment back unchanged.
      return {
        replacementMessages: messages.slice(segmentStart, segmentEnd + 1),
      };
    }

    const keepStart = segmentEnd - keepMessages + 1;
    const droppedCount = keepStart - segmentStart;
    const droppedChars = serializeSegment(messages, segmentStart, keepStart - 1).length;

    const replacementMessages: ModelMessage[] = [
      {
        role: "system",
        content: `(${droppedCount} earlier message(s), ~${droppedChars} characters, dropped without summarization. The most recent ${keepMessages} message(s) follow verbatim.)`,
      },
      ...messages.slice(keepStart, segmentEnd + 1),
    ];
    return { replacementMessages };
  },
};
