import type { DialogueEvent } from "./types.js";

/**
 * Single source of truth for how a dialogue event renders as a line of text.
 * This is the wire format between participants (what a model sees in its
 * perception), the moderator's digest, and the persisted canonical
 * transcript — change it here and everywhere stays in lockstep.
 *
 * - Spoken turns (seed / message / moderator) are speaker-attributed:
 *   `[Name]: text` — the same multi-speaker convention ChannelBridge uses.
 * - Ambient `event` entries (world state, operator injections) render as an
 *   unattributed parenthetical: `(text)` — something that happened, not
 *   something somebody said.
 */
export function renderEventLine(
  e: Pick<DialogueEvent, "displayName" | "content" | "kind">,
): string {
  if (e.kind === "event") return `(${e.content})`;
  return `[${e.displayName}]: ${e.content}`;
}

/** The `[Name]:` prefix a speaker's lines carry, for self-echo stripping. */
export function speakerPrefix(displayName: string): string {
  return renderEventLine({
    kind: "message",
    displayName,
    content: "",
  }).trimEnd();
}
