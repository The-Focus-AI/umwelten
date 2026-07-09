import { z } from "zod";
import type { Interaction } from "../../interaction/core/interaction.js";
import { renderEventLine } from "../render.js";
import type { DialogueState, NextTurn, TurnPolicy } from "../types.js";
import { RoundRobinPolicy } from "./round-robin.js";

const ModeratorDecisionSchema = z.object({
  action: z.enum(["speak", "stop"]),
  speaker: z
    .string()
    .optional()
    .describe("Participant id (or display name) who should speak next"),
  reason: z.string().optional().describe("Why, especially when stopping"),
});

export const MODERATOR_INSTRUCTIONS = [
  "You moderate a conversation between several participants.",
  "Each round you receive the new messages and decide who should speak next, or whether the conversation has run its course.",
  "Stop when the participants are repeating themselves, have reached agreement, or the topic is exhausted.",
];

/**
 * Model-as-director turn policy: a moderator Interaction reads the new
 * events each round and picks the next speaker or ends the dialogue.
 * Falls back to round-robin when the moderator's decision is unusable.
 */
export class ModeratorPolicy implements TurnPolicy {
  private cursor = 0;
  private readonly fallback = new RoundRobinPolicy();

  constructor(private readonly interaction: Interaction) {}

  async next(state: DialogueState): Promise<NextTurn> {
    const roster = state.participants
      .map((p) => `${p.id} ("${p.displayName}")`)
      .join(", ");
    const newEvents = state.events.slice(this.cursor);
    this.cursor = state.events.length;
    const update =
      newEvents
        .filter((e) => e.content.trim())
        .map((e) => renderEventLine(e))
        .join("\n\n") || "(no new messages)";

    this.interaction.addMessage({
      role: "user",
      content:
        `${update}\n\nParticipants: ${roster}.\n` +
        `Decide who should speak next, or whether the conversation should stop.`,
    });

    try {
      const response = await this.interaction.generateObject(
        ModeratorDecisionSchema,
      );
      const decision = ModeratorDecisionSchema.parse(
        JSON.parse(response.content),
      );
      if (decision.action === "stop") {
        return {
          stop: true,
          reason: decision.reason ?? "moderator ended the dialogue",
        };
      }
      const speaker = state.participants.find(
        (p) => p.id === decision.speaker || p.displayName === decision.speaker,
      );
      if (speaker && !state.doneSignals.has(speaker.id)) {
        return { speakerId: speaker.id };
      }
    } catch {
      // unusable decision — fall through to round-robin
    }
    return this.fallback.next(state);
  }
}
