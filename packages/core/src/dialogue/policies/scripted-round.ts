import type { DialogueEvent, DialogueState, NextTurn, TurnPolicy } from "../types.js";

export interface ScriptedRoundOptions {
  /**
   * Participant ids in the order they speak within one round, e.g.
   * `["human", "partner", "human", "partner"]`. Ids may repeat; the same
   * participant taking two non-adjacent slots is the point.
   */
  script: string[];
  /**
   * Restart the script whenever an ambient `event` entry is appended (the
   * default). Drivers that open each round by `post`ing the round's prompt as
   * an event get correct positioning for free — including after a slot is
   * abandoned mid-round, because the new prompt resets the count.
   *
   * Set false to position purely by total turns taken.
   */
  restartOnEvent?: boolean;
}

/**
 * Walk a fixed script of speakers, repeating it for each round.
 *
 * Round-robin's cousin for exchanges with a *shape*: an interview where the
 * human answers, the interviewer reflects, the human follows up, and the
 * interviewer closes is four slots over two participants, not a rotation.
 *
 * Stateless like RoundRobinPolicy — position is derived from the event log,
 * so a policy consulted intermittently (or reconstructed from a persisted
 * dialogue) resumes at the right slot instead of restarting the round.
 */
export class ScriptedRoundPolicy implements TurnPolicy {
  private readonly script: string[];
  private readonly restartOnEvent: boolean;

  constructor(options: ScriptedRoundOptions) {
    if (options.script.length === 0) {
      throw new Error("ScriptedRoundPolicy needs at least one speaker slot");
    }
    this.script = [...options.script];
    this.restartOnEvent = options.restartOnEvent ?? true;
  }

  next(state: DialogueState): NextTurn {
    const spoken = this.turnsThisRound(state);
    const slot = spoken % this.script.length;
    const speakerId = this.script[slot];

    if (!state.participants.some((p) => p.id === speakerId)) {
      throw new Error(
        `ScriptedRoundPolicy slot ${slot} names "${speakerId}", who is not in the dialogue`,
      );
    }
    // A done participant must not be handed the floor again: the script says
    // whose turn it is, and that participant has left.
    if (state.doneSignals.has(speakerId)) {
      return { stop: true, reason: `${speakerId} signaled done` };
    }
    return { speakerId };
  }

  /** Index of the slot that speaks next. */
  slotIndex(state: DialogueState): number {
    return this.turnsThisRound(state) % this.script.length;
  }

  /**
   * True when the most recent turn filled the script's last slot — the moment
   * for a driver to extract what it learned and open the next round.
   */
  justCompletedRound(state: DialogueState): boolean {
    const spoken = this.turnsThisRound(state);
    return spoken > 0 && spoken % this.script.length === 0;
  }

  /** Scripted turns taken since the current round opened. */
  private turnsThisRound(state: DialogueState): number {
    const events = state.events;
    let from = 0;
    if (this.restartOnEvent) {
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].kind === "event") {
          from = i + 1;
          break;
        }
      }
    }
    let count = 0;
    for (let i = from; i < events.length; i++) {
      if (this.isScriptedTurn(events[i])) count++;
    }
    return count;
  }

  /** Seeds, moderator notes, ambient events and outside interjections don't fill slots. */
  private isScriptedTurn(event: DialogueEvent): boolean {
    return event.kind === "message" && this.script.includes(event.participantId);
  }
}
