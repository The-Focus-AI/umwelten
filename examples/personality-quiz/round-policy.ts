/**
 * Turn policy for the quiz: one question, both answers, alternating who goes
 * first.
 *
 * Stateless by construction. The questions are posted into the dialogue as
 * ambient `event` entries, so the log already says everything the policy
 * needs: the most recent event marks the current question, and whoever has
 * not spoken since it is up. Nothing to keep in sync, and a policy consulted
 * out of order still lands on the right speaker.
 */

import type {
  DialogueState,
  NextTurn,
  TurnPolicy,
} from "@umwelten/core/dialogue/index.js";

export class QuestionRoundPolicy implements TurnPolicy {
  constructor(private readonly order: string[]) {}

  next(state: DialogueState): NextTurn {
    let lastQuestion = -1;
    let questionCount = 0;
    for (let i = 0; i < state.events.length; i++) {
      if (state.events[i]!.kind === "event") {
        lastQuestion = i;
        questionCount++;
      }
    }

    const spoke = new Set(
      state.events
        .slice(lastQuestion + 1)
        .filter((e) => e.kind === "message")
        .map((e) => e.participantId),
    );

    // Odd questions open with the first seat, even with the second, so
    // neither voice always sets the frame the other answers into.
    const lead =
      questionCount % 2 === 1 ? this.order : [...this.order].reverse();

    for (const id of lead) {
      if (!spoke.has(id)) return { speakerId: id };
    }
    // Both have answered; the driver posts the next question before stepping
    // again, so this only arises if it does not.
    return { speakerId: lead[0]! };
  }
}
