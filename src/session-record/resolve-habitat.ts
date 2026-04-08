import { basename } from "node:path";
import type { SessionHandle } from "./types.js";
import { listHabitatTranscriptReadPaths } from "./transcript-segments.js";

/**
 * Habitat: learnings live next to `meta.json` / transcripts in `sessionDir`.
 */
export async function resolveHabitatSessionHandle(
  sessionDir: string,
): Promise<SessionHandle> {
  const id = basename(sessionDir);
  const transcriptReadPaths = await listHabitatTranscriptReadPaths(sessionDir);
  return {
    source: "habitat",
    sessionKey: `habitat:${id}`,
    transcriptReadPaths,
    learningsRoot: sessionDir,
    habitatSessionDir: sessionDir,
  };
}
