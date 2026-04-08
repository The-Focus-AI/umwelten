/**
 * Session record: unified handles and learnings types for introspection.
 */

export type SessionRecordSource = "habitat" | "claude-code";

/** Learnings bucket — one append-only *.jsonl per kind. */
export type LearningKind =
  | "facts"
  | "playbooks"
  | "preferences"
  | "open_loops"
  | "mistakes";

export const LEARNING_KINDS: readonly LearningKind[] = [
  "facts",
  "playbooks",
  "preferences",
  "open_loops",
  "mistakes",
] as const;

export const LEARNING_FILENAMES: Record<LearningKind, string> = {
  facts: "facts.jsonl",
  playbooks: "playbooks.jsonl",
  preferences: "preferences.jsonl",
  open_loops: "open_loops.jsonl",
  mistakes: "mistakes.jsonl",
};

/** Provenance for a stored learning or compaction run. */
export type LearningProvenance = {
  compactionRunId?: string;
  habitatSessionId?: string;
  discordChannelId?: string;
  claudeProjectPath?: string;
  claudeSessionUuid?: string;
  /** Relative segment filename under habitat session dir, e.g. transcript.2026-04-07T12-00-00.000Z.jsonl */
  sourceTranscriptSegment?: string;
};

/** One append-only JSONL row in a kind file. */
export type LearningRecord = {
  id: string;
  kind: LearningKind;
  createdAt: string;
  payload: Record<string, unknown>;
  provenance?: LearningProvenance;
};

/** Resolved introspection target: where to read transcripts vs where we own learnings. */
export type SessionHandle = {
  source: SessionRecordSource;
  /** Stable id for hashing paths (not necessarily equal to folder name). */
  sessionKey: string;
  /** Read-only full history: frozen Habitat segments then live, or Claude uuid jsonl. */
  transcriptReadPaths: string[];
  /** Umwelten-writable root for learnings *.jsonl files. */
  learningsRoot: string;
  habitatSessionDir?: string;
  workingDirectory?: string;
  claudeProjectPath?: string;
  claudeSessionUuid?: string;
};

/** Written as first line of a new live transcript after Habitat compaction. */
export type CompactionEventV1 = {
  type: "umwelten_compaction";
  schema: 1;
  runId: string;
  createdAt: string;
  summary: string;
  predecessorSegment: string;
  /** Optional counts of rows appended per kind in this run. */
  learningCounts?: Partial<Record<LearningKind, number>>;
};
