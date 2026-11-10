/**
 * Truncate: non-LLM strategy that replaces the segment with a short placeholder.
 */

import type { ModelMessage } from "ai";
import { requireCompleteTurns } from "../segment.js";
import type {
  CompactionInput,
  CompactionResult,
  CompactionStrategy,
} from "../types.js";

export const truncateStrategy: CompactionStrategy = {
  id: "truncate",
  name: "Truncate",
  description:
    "Omit older turns while retaining the last keepTurns complete turns; no LLM.",
  async compact(input: CompactionInput): Promise<CompactionResult> {
    const keepTurns = input.options?.keepTurns ?? 2;
    if (
      typeof keepTurns !== "number" ||
      !Number.isSafeInteger(keepTurns) ||
      keepTurns < 0
    ) {
      throw new Error("keepTurns must be a non-negative safe integer");
    }
    const turns = requireCompleteTurns(
      input.messages,
      input.segmentStart,
      input.segmentEnd,
    );
    if (keepTurns >= turns.length) {
      return {
        replacementMessages: input.messages.slice(
          input.segmentStart,
          input.segmentEnd + 1,
        ),
      };
    }
    const retainedStart =
      keepTurns === 0
        ? input.segmentEnd + 1
        : turns[turns.length - keepTurns].start;
    const replacementMessages: ModelMessage[] = [
      {
        role: "user",
        content: `(Earlier conversation omitted; last ${keepTurns} turns retained.)`,
      },
      ...input.messages.slice(retainedStart, input.segmentEnd + 1),
    ];
    return { replacementMessages };
  },
};
