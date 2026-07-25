/**
 * rolling-summary — compaction designed to run every single turn.
 *
 * The existing through-line-and-facts strategy assumes it runs occasionally
 * over a long segment. Run it every turn and it re-summarizes its own previous
 * summary, which degrades: each pass paraphrases the last, details drop out in
 * an order nobody chose, and the summary drifts away from the transcript.
 *
 * This strategy is written for the repeated case. It is told the segment may
 * already begin with a summary it produced, and its job is to *update* that
 * record rather than describe it. The fixed section headers give the model a
 * shape to preserve, which is what keeps successive passes stable.
 */

import type { ModelMessage } from "ai";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import { serializeSegment } from "@umwelten/core/context/serialize-messages.js";
import type {
  CompactionInput,
  CompactionResult,
  CompactionStrategy,
} from "@umwelten/core/context/types.js";

export const ROLLING_SUMMARY_HEADER = "Conversation state (rolling summary)";

const ROLLING_INSTRUCTIONS = `You maintain a rolling state record for an ongoing conversation.

The input may already start with a state record you wrote earlier, followed by newer exchanges. Update the record to account for the new material. Do not summarize your own previous summary — carry its content forward and revise it.

Output exactly these four sections, in this order, with these headings:

## Through-line
What this thread is about and where it has got to. 2-4 sentences.

## Established
Facts, decisions, values, and preferences that remain true. Bullets. Keep every one that is still relevant, including ones carried from the previous record. Drop only what has been superseded, and when something is superseded, keep the current value.

## Open loops
What is still unresolved or was promised but not delivered. Bullets. Empty if none.

## Recent detail
The last exchange in enough detail that a follow-up like "why?" or "do that again" still makes sense. 1-3 sentences.

Rules:
- Never invent. If something is unclear, leave it out.
- Omit tool mechanics and full tool output; keep only results that mattered.
- Write in the conversation's language.`;

export const rollingSummaryStrategy: CompactionStrategy = {
  id: "rolling-summary",
  name: "Rolling summary",
  description:
    "Stable four-section state record (through-line / established / open loops / recent detail) built to be re-run every turn without degrading.",
  async compact(input: CompactionInput): Promise<CompactionResult> {
    const { messages, segmentStart, segmentEnd, model, runner } = input;
    if (!model || !runner) {
      return {
        replacementMessages: [
          {
            role: "system",
            content: `${ROLLING_SUMMARY_HEADER}: [unavailable — compaction needs a model and runner]`,
          },
        ],
      };
    }

    const serialized = serializeSegment(messages, segmentStart, segmentEnd);
    const stimulus = new Stimulus({
      role: "conversation state keeper",
      objective: "maintain an updatable rolling record of a conversation",
      instructions: [ROLLING_INSTRUCTIONS],
      runnerType: "base",
    });
    const interaction = new Interaction(model, stimulus);
    interaction.addMessage({ role: "user", content: serialized });

    const response = await runner.generateText(interaction);
    const summary =
      typeof response.content === "string" ? response.content : String(response.content ?? "");

    const replacementMessages: ModelMessage[] = [
      {
        role: "system",
        content: `${ROLLING_SUMMARY_HEADER}:\n${summary}`,
      },
    ];
    return { replacementMessages };
  },
};
