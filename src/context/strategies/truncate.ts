/**
 * Truncate: non-LLM strategy that replaces the segment with a short placeholder.
 */

import type { CoreMessage } from "ai";
import type { CompactionInput, CompactionResult, CompactionStrategy } from "../types.js";

export const truncateStrategy: CompactionStrategy = {
  id: "truncate",
  name: "Truncate",
  description: "Replace segment with a one-line placeholder; no LLM.",
  async compact(input: CompactionInput): Promise<CompactionResult> {
    const keepTurns = (input.options?.keepTurns as number) ?? 2;
    const replacementMessages: CoreMessage[] = [
      {
        role: "system",
        content: `(Earlier conversation omitted; last ${keepTurns} turns retained.)`,
      },
    ];
    return { replacementMessages };
  },
};
