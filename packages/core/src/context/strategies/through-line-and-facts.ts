import { summarize } from "./summarize.js";
import type { CompactionStrategy } from "../types.js";

export const throughLineAndFactsStrategy: CompactionStrategy = {
  id: "through-line-and-facts",
  name: "Through-line and facts",
  description:
    "Summarize segment to main narrative and key facts using the LLM; omit in-call details.",
  compact: (input) =>
    summarize(
      input,
      `Output two sections:
1. Through-line: What was this thread about? What was decided or achieved? (2-4 sentences.)
2. Key facts to remember: Preferences, names, decisions, outcomes that should be recalled later. Use bullet points.
Omit verbose back-and-forth and full tool outputs, but retain important evidence references.
Be concise and write in the same language as the conversation.`,
    ),
};
