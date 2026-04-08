/**
 * Load full Habitat session transcript: frozen `transcript.*.jsonl` segments then live `transcript.jsonl`.
 */

import type { CoreMessage } from "ai";
import type { SessionMessage } from "../interaction/types/types.js";
import type { UserMessageEntry, AssistantMessageEntry } from "../interaction/types/types.js";
import { parseSessionFile } from "../interaction/persistence/session-parser.js";
import { listHabitatTranscriptReadPaths } from "./transcript-segments.js";

function isUmweltenCompactionLine(msg: SessionMessage): boolean {
  return (
    msg != null &&
    typeof msg === "object" &&
    "type" in msg &&
    (msg as { type?: string }).type === "umwelten_compaction"
  );
}

/**
 * Concatenate parsed messages from all segment files in read order.
 * Drops `umwelten_compaction` marker lines so summaries stay aligned with real turns.
 */
export async function loadHabitatSessionTranscriptMessages(
  sessionDir: string,
): Promise<SessionMessage[]> {
  const paths = await listHabitatTranscriptReadPaths(sessionDir);
  const all: SessionMessage[] = [];
  for (const p of paths) {
    try {
      const chunk = await parseSessionFile(p);
      for (const m of chunk) {
        if (!isUmweltenCompactionLine(m)) {
          all.push(m);
        }
      }
    } catch {
      /* missing or invalid segment */
    }
  }
  return all;
}

/**
 * Last N user+assistant text-only CoreMessages for resume-after-restart (Telegram/Discord).
 * Mirrors compact transcript shape across frozen segments + live file.
 */
export async function loadRecentHabitatTranscriptCoreMessages(
  sessionDir: string,
  maxMessages: number,
): Promise<CoreMessage[]> {
  const raw = await loadHabitatSessionTranscriptMessages(sessionDir);
  const messages: CoreMessage[] = [];
  for (const entry of raw) {
    if (entry.type === "user") {
      const content = (entry as UserMessageEntry).message.content;
      if (typeof content === "string") {
        messages.push({ role: "user", content });
      }
    } else if (entry.type === "assistant") {
      const content = (entry as AssistantMessageEntry).message.content;
      if (typeof content === "string") {
        messages.push({ role: "assistant", content });
      }
    }
  }
  if (messages.length === 0) return [];
  const recent = messages.slice(-maxMessages);
  while (recent.length > 0 && recent[0].role !== "user") {
    recent.shift();
  }
  return recent;
}
