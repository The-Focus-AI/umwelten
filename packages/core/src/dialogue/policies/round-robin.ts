import type { DialogueState, NextTurn, TurnPolicy } from "../types.js";

/**
 * Cycle participants in roster order (or an explicit `order` of ids),
 * skipping any participant whose latest turn signaled done. Stops when
 * every participant has signaled done.
 *
 * Stateless: the rotation point is derived from the event log, so a policy
 * that is only consulted intermittently (e.g. as the ModeratorPolicy
 * fallback) continues the rotation from whoever actually spoke last instead
 * of restarting at the first participant.
 */
export class RoundRobinPolicy implements TurnPolicy {
  constructor(private readonly order?: string[]) {}

  next(state: DialogueState): NextTurn {
    const roster = this.order ?? state.participants.map((p) => p.id);
    let lastSpeakerIndex = -1;
    for (let i = state.events.length - 1; i >= 0; i--) {
      const e = state.events[i];
      if (e.kind !== "message") continue;
      const idx = roster.indexOf(e.participantId);
      if (idx !== -1) {
        lastSpeakerIndex = idx;
        break;
      }
    }
    for (let i = 1; i <= roster.length; i++) {
      const idx = (lastSpeakerIndex + i) % roster.length;
      const id = roster[idx];
      if (!state.doneSignals.has(id)) {
        return { speakerId: id };
      }
    }
    return { stop: true, reason: "all participants signaled done" };
  }
}
