import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export interface CollaborationEvent {
  id: number;
  kind: string;
  agentId: string | null;
  data: unknown;
  causeId?: number;
  timestamp: string;
}

export interface ArtifactRecord {
  path: string;
  version: number;
  hash: string;
  content: string;
}

export interface TrainingExportOptions {
  // The caller must explicitly supply a policy for all exported fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  redact: (value: any) => any;
  includeAgent?: (agentId: string) => boolean;
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new Error("Value must be JSON serializable");
  return serialized;
}

function validatePath(path: string): void {
  if (
    !path ||
    /[\\:]/u.test(path) ||
    [...path].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe artifact path: ${path}`);
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Remove reasoning fields and structured reasoning parts, even in nested data. */
function withoutReasoning(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter(
        (item) =>
          ![
            "reasoning",
            "thinking",
            "redacted-thinking",
            "redacted_thinking",
            "redacted-reasoning",
          ].includes(String(object(item)?.type)),
      )
      .map(withoutReasoning);
  }
  const record = object(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record)
      .filter(
        ([key]) =>
          !/^(reasoning|thinking|reasoningContent|reasoning_content)$/i.test(
            key,
          ),
      )
      .map(([key, item]) => [key, withoutReasoning(item)]),
  );
}

function hasAssistantContent(messages: unknown): boolean {
  return (
    Array.isArray(messages) &&
    messages.some((message) => {
      const row = object(message);
      if (row?.role !== "assistant") return false;
      if (typeof row.content === "string") return row.content.trim().length > 0;
      return (
        Array.isArray(row.content) &&
        row.content.some((part) => {
          const content = object(part);
          return (
            (content?.type === "text" &&
              typeof content.text === "string" &&
              content.text.trim().length > 0) ||
            (content?.type === "tool-call" &&
              typeof content.toolName === "string")
          );
        })
      );
    })
  );
}

/** Durable local journal. Logical artifact paths are never used as filesystem paths. */
export class CollaborationStore {
  private readonly db: Database.Database;
  private readonly blobs: string;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.blobs = join(directory, "blobs");
    mkdirSync(this.blobs, { recursive: true, mode: 0o700 });
    this.db = new Database(join(directory, "collaboration.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL, agentId TEXT, data TEXT NOT NULL,
        causeId INTEGER, timestamp TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
        BEGIN SELECT RAISE(ABORT, 'Events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
        BEGIN SELECT RAISE(ABORT, 'Events are append-only'); END;
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runtime_owner (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), token TEXT NOT NULL, pid INTEGER NOT NULL, host TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts (
        path TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL,
        PRIMARY KEY (path, version)
      );
      CREATE TRIGGER IF NOT EXISTS artifacts_no_update BEFORE UPDATE ON artifacts
        BEGIN SELECT RAISE(ABORT, 'Artifact versions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS artifacts_no_delete BEFORE DELETE ON artifacts
        BEGIN SELECT RAISE(ABORT, 'Artifact versions are immutable'); END;
    `);
  }

  append(
    kind: string,
    agentId: string | null,
    data: unknown,
    causeId?: number,
  ): CollaborationEvent {
    const timestamp = new Date().toISOString();
    const serialized = json(data);
    const result = this.db
      .prepare(
        "INSERT INTO events (kind, agentId, data, causeId, timestamp) VALUES (?, ?, ?, ?, ?)",
      )
      .run(kind, agentId, serialized, causeId ?? null, timestamp);
    return {
      id: Number(result.lastInsertRowid),
      kind,
      agentId,
      data: JSON.parse(serialized),
      ...(causeId === undefined ? {} : { causeId }),
      timestamp,
    };
  }

  /** Exclusive cursor, always in journal order. */
  events(after = 0): CollaborationEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE id > ? ORDER BY id")
      .all(after) as Array<
      Omit<CollaborationEvent, "data" | "causeId"> & {
        data: string;
        causeId: number | null;
      }
    >;
    return rows.map(({ data, causeId, ...row }) => ({
      ...row,
      data: JSON.parse(data),
      ...(causeId === null ? {} : { causeId }),
    }));
  }

  putAgent(id: string, state: unknown): void {
    this.db
      .prepare(
        "INSERT INTO agents (id, state) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
      )
      .run(id, json(state));
  }

  /** Exclusive scheduler ownership; readers may still open the journal. Local disk only. */
  acquireRuntime(): () => void {
    const token = randomUUID();
    this.db
      .transaction(() => {
        const owner = this.db
          .prepare("SELECT * FROM runtime_owner WHERE singleton = 1")
          .get() as { pid: number; host: string } | undefined;
        if (owner) {
          if (owner.host !== hostname())
            throw new Error(
              "Run is owned by another host; shared-filesystem scheduling is unsupported",
            );
          let alive = true;
          try {
            process.kill(owner.pid, 0);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH")
              alive = false;
          }
          if (alive) throw new Error("Run already has a live scheduler");
        }
        this.db
          .prepare(
            "INSERT OR REPLACE INTO runtime_owner(singleton, token, pid, host) VALUES (1, ?, ?, ?)",
          )
          .run(token, process.pid, hostname());
      })
      .immediate();
    return () => {
      this.db.prepare("DELETE FROM runtime_owner WHERE token = ?").run(token);
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agents(): Array<{ id: string; state: any }> {
    return (
      this.db
        .prepare("SELECT id, state FROM agents ORDER BY id")
        .all() as Array<{ id: string; state: string }>
    ).map(({ id, state }) => ({ id, state: JSON.parse(state) }));
  }

  publish(
    author: string,
    path: string,
    content: string,
    expectedVersion: number,
  ): ArtifactRecord {
    validatePath(path);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
      throw new Error("Invalid expected artifact version");
    const hash = createHash("sha256").update(content).digest("hex");
    return this.db
      .transaction(() => {
        const latest = this.db
          .prepare(
            "SELECT MAX(version) AS version FROM artifacts WHERE path = ?",
          )
          .get(path) as { version: number | null };
        const current = latest.version ?? 0;
        if (current !== expectedVersion)
          throw new Error(
            `Artifact version conflict for ${path}: expected ${expectedVersion}, current ${current}`,
          );
        // Content-addressed blobs are immutable. A transaction failure may leave an unused blob.
        try {
          writeFileSync(join(this.blobs, hash), content, {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        const version = current + 1;
        this.db
          .prepare(
            "INSERT INTO artifacts (path, version, hash) VALUES (?, ?, ?)",
          )
          .run(path, version, hash);
        this.append("artifact.published", author, {
          path,
          version,
          hash,
          previousVersion: current,
        });
        return { path, version, hash, content };
      })
      .immediate();
  }

  artifact(path: string, version?: number): ArtifactRecord | undefined {
    validatePath(path);
    const row = (
      version === undefined
        ? this.db
            .prepare(
              "SELECT * FROM artifacts WHERE path = ? ORDER BY version DESC LIMIT 1",
            )
            .get(path)
        : this.db
            .prepare("SELECT * FROM artifacts WHERE path = ? AND version = ?")
            .get(path, version)
    ) as Omit<ArtifactRecord, "content"> | undefined;
    return row
      ? { ...row, content: readFileSync(join(this.blobs, row.hash), "utf8") }
      : undefined;
  }

  exportTrace(): string {
    return this.events()
      .map((event) => json(event) + "\n")
      .join("");
  }

  /** Interaction input snapshots, not provider-final wire payloads. */
  exportTraining(options: TrainingExportOptions): string {
    if (typeof options?.redact !== "function")
      throw new Error("Training export requires an explicit redactor");
    const started = new Map<string, CollaborationEvent>();
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const event of this.events()) {
      const data = object(event.data);
      if (!data || typeof data.decisionId !== "string") continue;
      const decisionId = data.decisionId;
      if (event.kind === "decision.started") {
        if (!seen.has(decisionId)) started.set(decisionId, event);
        else started.delete(decisionId); // Ambiguous duplicate identity: never guess.
        seen.add(decisionId);
        continue;
      }
      if (event.kind !== "decision.completed") continue;
      const start = started.get(decisionId);
      started.delete(decisionId);
      if (
        !start ||
        start.agentId !== event.agentId ||
        !start.agentId ||
        (options.includeAgent && !options.includeAgent(start.agentId))
      )
        continue;
      const { decisionId: _decisionId, ...input } = object(start.data)!;
      if (
        !Array.isArray(input.messages) ||
        !Array.isArray(data.messages) ||
        data.messages.length < input.messages.length ||
        !isDeepStrictEqual(
          input.messages,
          data.messages.slice(0, input.messages.length),
        )
      )
        continue;
      const metadata: Record<string, unknown> = {
        startEventId: start.id,
        completedEventId: event.id,
      };
      for (const key of [
        "taskId",
        "runId",
        "parentTaskId",
        "parentRunId",
        "parentDecisionId",
        "parentAgentId",
        "lineage",
      ]) {
        if (input[key] !== undefined || data[key] !== undefined)
          metadata[key] = input[key] ?? data[key];
      }
      const sample = withoutReasoning({
        decisionId,
        agentId: start.agentId,
        input,
        target: data.messages.slice(input.messages.length),
        metadata,
      });
      if (!hasAssistantContent(object(sample)?.target)) continue;
      const redacted = withoutReasoning(options.redact(sample));
      if (hasAssistantContent(object(redacted)?.target))
        lines.push(json(redacted));
    }
    return lines.length ? lines.join("\n") + "\n" : "";
  }

  close(): void {
    this.db.close();
  }
}
