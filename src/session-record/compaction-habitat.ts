/**
 * Habitat transcript compaction: freeze current live file, start new live tail with marker line.
 */

import { rename, writeFile, access, constants } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { CompactionEventV1 } from "./types.js";

const LIVE = "transcript.jsonl";

/**
 * Rename `transcript.jsonl` → `transcript.{ISO}.jsonl`, write new live file with compaction JSONL line.
 * ISO string colons replaced for filesystem safety (matches common conventions).
 */
export async function compactHabitatTranscriptSegment(options: {
  sessionDir: string;
  summary: string;
  runId?: string;
  learningCounts?: CompactionEventV1["learningCounts"];
}): Promise<{ frozenRelative: string; livePath: string }> {
  const { sessionDir, summary, learningCounts } = options;
  const runId = options.runId ?? randomUUID();
  const livePath = join(sessionDir, LIVE);

  await access(livePath, constants.R_OK);

  const iso = new Date().toISOString().replace(/:/g, "-");
  const frozenName = `transcript.${iso}.jsonl`;
  const frozenPath = join(sessionDir, frozenName);

  await rename(livePath, frozenPath);

  const event: CompactionEventV1 = {
    type: "umwelten_compaction",
    schema: 1,
    runId,
    createdAt: new Date().toISOString(),
    summary,
    predecessorSegment: frozenName,
    learningCounts,
  };

  await writeFile(livePath, `${JSON.stringify(event)}\n`, "utf-8");

  return { frozenRelative: frozenName, livePath };
}
