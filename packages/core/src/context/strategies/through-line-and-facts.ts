/**
 * Through-line and facts: LLM strategy that summarizes a segment to the main narrative and key facts.
 * Omit in-call details (full tool outputs, step-by-step).
 */

import type { CoreMessage } from "ai";
import { Stimulus } from "../../stimulus/stimulus.js";
import { Interaction } from "../../interaction/core/interaction.js";
import { serializeSegment } from "../serialize-messages.js";
import type { CompactionInput, CompactionResult, CompactionStrategy } from "../types.js";

const COMPACTION_SYSTEM = `You are a summarizer for conversation context. Your job is to condense a segment of a conversation into a short, reusable summary.

Output two sections:
1. Through-line: What was this thread about? What was decided or achieved? (2-4 sentences.)
2. Key facts to remember: Preferences, names, decisions, outcomes that should be recalled later. Use bullet points.

Rules:
- Omit in-call details: full tool outputs, step-by-step actions, and verbose back-and-forth.
- Be concise. The summary will be injected as prior context for the same conversation.
- Write in the same language as the conversation.`;

export const throughLineAndFactsStrategy: CompactionStrategy = {
  id: "through-line-and-facts",
  name: "Through-line and facts",
  description: "Summarize segment to main narrative and key facts using the LLM; omit in-call details.",
  async compact(input: CompactionInput): Promise<CompactionResult> {
    const { messages, segmentStart, segmentEnd, model, runner } = input;
    if (!model || !runner) {
      return {
        replacementMessages: [
          {
            role: "system",
            content:
              "Previous context (condensed): [Compaction requires model and runner; segment omitted.]",
          },
        ],
      };
    }

    const serialized = serializeSegment(messages, segmentStart, segmentEnd);
    const stimulus = new Stimulus({
      role: "summarizer",
      objective: "condense conversation segments to through-line and key facts",
      instructions: [COMPACTION_SYSTEM],
      runnerType: "base",
    });
    const compactionInteraction = new Interaction(model, stimulus);
    compactionInteraction.addMessage({ role: "user", content: serialized });

    const response = await runner.generateText(compactionInteraction);
    const summary =
      typeof response.content === "string" ? response.content : String(response.content ?? "");

    const replacementMessages: CoreMessage[] = [
      {
        role: "system",
        content: `Previous context (condensed):\n${summary}`,
      },
    ];
    return { replacementMessages };
  },
};
