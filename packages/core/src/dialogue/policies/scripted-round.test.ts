import { describe, it, expect } from "vitest";
import { ScriptedRoundPolicy } from "./scripted-round.js";
import type { DialogueEvent, DialogueState, ParticipantInfo } from "../types.js";

let seq = 0;

function entry(
  participantId: string,
  kind: DialogueEvent["kind"] = "message",
): DialogueEvent {
  return {
    seq: seq++,
    participantId,
    displayName: participantId.toUpperCase(),
    kind,
    content: `entry ${seq}`,
    timestamp: new Date().toISOString(),
  };
}

function stateWith(events: DialogueEvent[], done: string[] = []): DialogueState {
  return {
    events,
    participants: roster,
    turn: events.filter((e) => e.kind === "message").length,
    doneSignals: new Set(done),
  };
}

const roster: ParticipantInfo[] = [
  { id: "human", displayName: "You", kind: "human" },
  { id: "partner", displayName: "Alex", kind: "model" },
];

const SCRIPT = ["human", "partner", "human", "partner"];

describe("ScriptedRoundPolicy", () => {
  it("walks the script in order", () => {
    const policy = new ScriptedRoundPolicy({ script: SCRIPT });
    const log: DialogueEvent[] = [];
    for (const expected of SCRIPT) {
      expect(policy.next(stateWith(log))).toEqual({ speakerId: expected });
      log.push(entry(expected));
    }
  });

  it("repeats the script for the next round", () => {
    const policy = new ScriptedRoundPolicy({ script: SCRIPT });
    const log = SCRIPT.map((id) => entry(id));
    expect(policy.next(stateWith(log))).toEqual({ speakerId: "human" });
    expect(policy.slotIndex(stateWith(log))).toBe(0);
  });

  it("restarts the round when an ambient event is posted", () => {
    const policy = new ScriptedRoundPolicy({ script: SCRIPT });
    // Round abandoned after two slots, then the driver opens a new round.
    const log = [entry("human"), entry("partner"), entry("narrator", "event")];
    expect(policy.next(stateWith(log))).toEqual({ speakerId: "human" });
    expect(policy.slotIndex(stateWith(log))).toBe(0);
  });

  it("positions by total turns when restartOnEvent is off", () => {
    const policy = new ScriptedRoundPolicy({
      script: SCRIPT,
      restartOnEvent: false,
    });
    const log = [entry("human"), entry("partner"), entry("narrator", "event")];
    expect(policy.next(stateWith(log))).toEqual({ speakerId: "human" });
    expect(policy.slotIndex(stateWith(log))).toBe(2);
  });

  it("ignores seeds, moderator notes and outside interjections", () => {
    const policy = new ScriptedRoundPolicy({ script: SCRIPT });
    const log = [
      entry("user", "seed"),
      entry("human"),
      entry("moderator", "moderator"),
      entry("observer"),
    ];
    expect(policy.next(stateWith(log))).toEqual({ speakerId: "partner" });
  });

  it("flags the end of a round only on the last slot", () => {
    const policy = new ScriptedRoundPolicy({ script: SCRIPT });
    const log: DialogueEvent[] = [];
    expect(policy.justCompletedRound(stateWith(log))).toBe(false);
    for (const id of SCRIPT.slice(0, 3)) {
      log.push(entry(id));
      expect(policy.justCompletedRound(stateWith(log))).toBe(false);
    }
    log.push(entry("partner"));
    expect(policy.justCompletedRound(stateWith(log))).toBe(true);
  });

  it("stops rather than handing the floor to a participant who is done", () => {
    const policy = new ScriptedRoundPolicy({ script: SCRIPT });
    const next = policy.next(stateWith([], ["human"]));
    expect(next).toHaveProperty("stop", true);
  });

  it("rejects a script naming someone outside the dialogue", () => {
    const policy = new ScriptedRoundPolicy({ script: ["human", "ghost"] });
    expect(() => policy.next(stateWith([entry("human")]))).toThrow(/not in the dialogue/);
  });

  it("rejects an empty script", () => {
    expect(() => new ScriptedRoundPolicy({ script: [] })).toThrow(
      /at least one speaker slot/,
    );
  });

  it("supports an asymmetric script", () => {
    const policy = new ScriptedRoundPolicy({ script: ["human", "partner", "partner"] });
    const log = [entry("human"), entry("partner")];
    expect(policy.next(stateWith(log))).toEqual({ speakerId: "partner" });
    log.push(entry("partner"));
    expect(policy.justCompletedRound(stateWith(log))).toBe(true);
    expect(policy.next(stateWith(log))).toEqual({ speakerId: "human" });
  });
});
