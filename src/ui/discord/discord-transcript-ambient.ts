/**
 * Detect prior assistant participation in a session transcript (JSONL on disk).
 * Used to restore "ambient" thread/DM unlock after a bot process restart.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Returns true if `transcript.jsonl` under `sessionDir` contains at least one
 * assistant message row (any content shape).
 */
export async function transcriptJsonlHasAssistant(
  sessionDir: string,
): Promise<boolean> {
  const transcriptPath = join(sessionDir, "transcript.jsonl");
  const content = await readFile(transcriptPath, "utf-8").catch(() => "");
  if (!content.trim()) {
    return false;
  }
  for (const line of content.trim().split("\n")) {
    try {
      const entry = JSON.parse(line) as { message?: { role?: string } };
      if (entry.message?.role === "assistant") {
        return true;
      }
    } catch {
      /* skip bad line */
    }
  }
  return false;
}
