/**
 * Optional context to inject after Habitat compaction or when reloading a session from disk.
 * Not used on every model call — callers prepend these messages explicitly.
 */

import { readFile } from "node:fs/promises";
import type { CoreMessage } from "ai";

import type { CompactionEventV1, LearningKind } from "./types.js";
import { LEARNING_KINDS } from "./types.js";
import { FileLearningsStore } from "./learnings-store.js";
import { listHabitatTranscriptReadPaths } from "./transcript-segments.js";

async function collectCompactionEventsFromSessionDir(
  sessionDir: string,
): Promise<CompactionEventV1[]> {
  const paths = await listHabitatTranscriptReadPaths(sessionDir);
  const out: CompactionEventV1[] = [];
  for (const p of paths) {
    let raw: string;
    try {
      raw = await readFile(p, "utf-8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as { type?: string };
        if (o?.type === "umwelten_compaction") {
          out.push(o as CompactionEventV1);
        }
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

function cap(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… [truncated ${s.length - max} chars]`;
}

/**
 * Build system messages with compaction summaries + serialized learnings (capped).
 * Prepend to an Interaction (or merge with replayed transcript) after reload/compaction.
 */
export async function buildHabitatIntrospectionContextMessages(options: {
  sessionDir: string;
  /** Defaults to sessionDir (Habitat). Use SessionHandle.learningsRoot for Claude mirror paths. */
  learningsRoot?: string;
  maxCompactionBlocks?: number;
  maxLearningsChars?: number;
  maxTotalChars?: number;
}): Promise<CoreMessage[]> {
  const learningsRoot = options.learningsRoot ?? options.sessionDir;
  const maxCompaction = options.maxCompactionBlocks ?? 12;
  const maxLearnings = options.maxLearningsChars ?? 24_000;
  const maxTotal = options.maxTotalChars ?? 40_000;

  const events = await collectCompactionEventsFromSessionDir(options.sessionDir);
  const store = new FileLearningsStore(learningsRoot);
  const learnings = await store.readAll();

  const parts: CoreMessage[] = [];

  const slice = events.slice(-maxCompaction);
  if (slice.length > 0) {
    const text = slice
      .map(
        (e, i) =>
          `### Compaction ${i + 1} (${e.createdAt})\n${e.summary}` +
          (e.learningCounts
            ? `\n_Learning counts:_ ${JSON.stringify(e.learningCounts)}`
            : ""),
      )
      .join("\n\n");
    parts.push({
      role: "system",
      content: cap(`## Prior segment summaries (compaction)\n\n${text}`, maxTotal),
    });
  }

  const rows: { kind: LearningKind; line: string }[] = [];
  for (const k of LEARNING_KINDS) {
    for (const r of learnings[k]) {
      rows.push({ kind: k, line: JSON.stringify(r) });
    }
  }
  if (rows.length > 0) {
    const blob = rows.map((r) => r.line).join("\n");
    parts.push({
      role: "system",
      content: cap(`## Session learnings (JSONL rows)\n\n${blob}`, maxLearnings),
    });
  }

  return parts;
}
