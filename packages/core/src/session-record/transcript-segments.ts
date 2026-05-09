/**
 * List Habitat transcript segments in read order: frozen `transcript.*.jsonl` then live `transcript.jsonl`.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { access, constants } from "node:fs/promises";

const LIVE = "transcript.jsonl";

function isFrozenSegment(name: string): boolean {
  if (name === LIVE) return false;
  return name.startsWith("transcript.") && name.endsWith(".jsonl");
}

/**
 * Ordered paths for full read: lexicographically sorted frozen segments, then live file if present.
 */
export async function listHabitatTranscriptReadPaths(
  sessionDir: string,
): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(sessionDir);
  } catch {
    return [];
  }

  const frozen = names.filter(isFrozenSegment).sort();
  const paths = frozen.map((n) => join(sessionDir, n));

  const livePath = join(sessionDir, LIVE);
  try {
    await access(livePath, constants.R_OK);
    paths.push(livePath);
  } catch {
    /* no live transcript */
  }

  return paths;
}
