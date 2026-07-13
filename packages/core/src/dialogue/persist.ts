/**
 * Persist a Dialogue's canonical event log as a session directory
 * (transcript.jsonl + meta.json) — the same layout HabitatSessionManager
 * uses, so `umwelten browse` and the sessions CLI render dialogues with no
 * changes.
 *
 * Canonical mapping: seed and human turns → `user`; model/moderator turns →
 * `assistant`. Every line is labeled `[Name]: text` — the canonical log is
 * the neutral record, not any participant's view.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { writeSessionTranscript } from "../session-record/transcript-write.js";
import { renderEventLine } from "./render.js";
import type {
  DialogueEvent,
  DialogueStopReason,
  ParticipantInfo,
} from "./types.js";

export interface DialogueMeta {
  id: string;
  created: string;
  participants: ParticipantInfo[];
  seed: string;
  policy?: string;
  stoppedBy?: DialogueStopReason;
  turns: number;
}

export function dialogueEventsToCoreMessages(
  events: ReadonlyArray<DialogueEvent>,
  participants: ReadonlyArray<ParticipantInfo>,
): ModelMessage[] {
  const kinds = new Map(participants.map((p) => [p.id, p.kind]));
  return events
    .filter((e) => e.content.trim())
    .map((e) => {
      // Seed, human turns, and ambient events are input to the dialogue
      // (user); model/moderator turns are output (assistant).
      const role =
        e.kind === "seed" ||
        e.kind === "event" ||
        kinds.get(e.participantId) === "human"
          ? ("user" as const)
          : ("assistant" as const);
      return { role, content: renderEventLine(e) };
    });
}

export async function writeDialogueSession(
  dir: string,
  events: ReadonlyArray<DialogueEvent>,
  meta: DialogueMeta,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeSessionTranscript(
    dir,
    dialogueEventsToCoreMessages(events, meta.participants),
  );
  const sessionMeta = {
    sessionId: meta.id,
    created: meta.created,
    lastUsed: new Date().toISOString(),
    type: "dialogue",
    metadata: {
      participants: meta.participants,
      seed: meta.seed,
      policy: meta.policy,
      stoppedBy: meta.stoppedBy,
      turns: meta.turns,
    },
  };
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify(sessionMeta, null, 2),
    "utf-8",
  );
}
