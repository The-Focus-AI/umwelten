/**
 * topic-carryover — query-conditioned compaction for seeding a fork.
 *
 * When a turn spins off into its own thread, the child does not need the
 * parent's story. It needs the handful of things from the parent that the new
 * subject actually depends on: who the user is, what they are working on, the
 * decisions still in force. Everything else is noise the child would pay for on
 * every subsequent turn.
 *
 * The distinguishing feature is `options.newTopic` — the drifting message
 * itself. Compaction here is conditioned on where the conversation is going,
 * not just on where it has been. With no newTopic supplied it degrades to a
 * general-purpose brief.
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

export const CARRYOVER_HEADER = "Carried over from the previous thread";

const CARRYOVER_INSTRUCTIONS = `You write a handoff brief when a conversation splits into a new thread.

You get the previous thread and, usually, the message that started the new one. Write only what the new thread genuinely needs from the old one.

Include:
- Standing context about the person and their situation that stays true regardless of subject.
- Decisions, constraints, and preferences still in force.
- Anything the old thread established that the new message depends on or refers to.

Exclude:
- The old thread's narrative, its problem-solving steps, and its resolved details.
- Anything the new message does not need. Brevity is the point: a shorter correct brief beats a longer complete one.

Format as short bullets under a single "Carried over" heading. If genuinely nothing needs to carry over, say exactly: "Nothing from the previous thread applies."`;

export const topicCarryoverStrategy: CompactionStrategy = {
  id: "topic-carryover",
  name: "Topic carry-over",
  description:
    "Query-conditioned handoff brief for a spun-off thread: keeps only what the new topic depends on. Pass options.newTopic.",
  async compact(input: CompactionInput): Promise<CompactionResult> {
    const { messages, segmentStart, segmentEnd, model, runner } = input;
    const newTopic =
      typeof input.options?.newTopic === "string" ? input.options.newTopic : undefined;

    if (!model || !runner) {
      return {
        replacementMessages: [
          {
            role: "system",
            content: `${CARRYOVER_HEADER}: [unavailable — compaction needs a model and runner]`,
          },
        ],
      };
    }

    const serialized = serializeSegment(messages, segmentStart, segmentEnd);
    const prompt = newTopic
      ? `## Previous thread\n${serialized}\n\n## The message that started the new thread\n${newTopic}\n\nWrite the handoff brief for the new thread.`
      : `## Previous thread\n${serialized}\n\nWrite a general handoff brief; the new thread's subject is not yet known.`;

    const stimulus = new Stimulus({
      role: "handoff writer",
      objective: "carry only what a new thread needs from an old one",
      instructions: [CARRYOVER_INSTRUCTIONS],
      runnerType: "base",
    });
    const interaction = new Interaction(model, stimulus);
    interaction.addMessage({ role: "user", content: prompt });

    const response = await runner.generateText(interaction);
    const brief =
      typeof response.content === "string" ? response.content : String(response.content ?? "");

    const replacementMessages: ModelMessage[] = [
      {
        role: "system",
        content: `${CARRYOVER_HEADER}:\n${brief}`,
      },
    ];
    return { replacementMessages };
  },
};
