/**
 * Append-only learnings storage (per-kind JSONL) under a single root directory.
 */

import { mkdir, appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { LearningKind, LearningRecord } from "./types.js";
import { LEARNING_FILENAMES, LEARNING_KINDS } from "./types.js";

export class FileLearningsStore {
  constructor(private readonly learningsRoot: string) {}

  /** Ensure learnings root exists. */
  async ensureDir(): Promise<void> {
    await mkdir(this.learningsRoot, { recursive: true });
  }

  filenameForKind(kind: LearningKind): string {
    return join(this.learningsRoot, LEARNING_FILENAMES[kind]);
  }

  /**
   * Append one record (assigns id + createdAt if omitted).
   */
  async append(
    kind: LearningKind,
    partial: Omit<LearningRecord, "id" | "createdAt" | "kind"> &
      Partial<Pick<LearningRecord, "id" | "createdAt">>,
  ): Promise<LearningRecord> {
    await this.ensureDir();
    const record: LearningRecord = {
      id: partial.id ?? randomUUID(),
      kind,
      createdAt: partial.createdAt ?? new Date().toISOString(),
      payload: partial.payload,
      provenance: partial.provenance,
    };
    const line = `${JSON.stringify(record)}\n`;
    await appendFile(this.filenameForKind(kind), line, "utf-8");
    return record;
  }

  /**
   * Read all records for a kind (empty file → []).
   */
  async read(kind: LearningKind): Promise<LearningRecord[]> {
    try {
      const raw = await readFile(this.filenameForKind(kind), "utf-8");
      return parseJsonlRecords(raw, kind);
    } catch (e) {
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        (e as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return [];
      }
      throw e;
    }
  }

  async readAll(): Promise<Record<LearningKind, LearningRecord[]>> {
    const out = {} as Record<LearningKind, LearningRecord[]>;
    for (const k of LEARNING_KINDS) {
      out[k] = await this.read(k);
    }
    return out;
  }
}

function parseJsonlRecords(raw: string, expectedKind: LearningKind): LearningRecord[] {
  const rows: LearningRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as LearningRecord;
      if (o && o.kind === expectedKind && typeof o.id === "string") {
        rows.push(o);
      }
    } catch {
      /* skip bad lines */
    }
  }
  return rows;
}
