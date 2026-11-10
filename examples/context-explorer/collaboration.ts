/** Read-only trace API. Deliberately independent of the model runtime. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

class TraceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Each browser-controlled component is validated before joining. Reject symlinks
// beneath the configured root, including SQLite's sidecars and blob directory.
async function entry(path: string, directory = false): Promise<string> {
  const stat = await lstat(path).catch(() => {
    throw new TraceError(404, "Trace file not found.");
  });
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile())
  ) {
    throw new TraceError(404, "Trace file not found.");
  }
  return path;
}

async function database(root: string, id: string) {
  if (!UUID.test(id)) throw new TraceError(400, "Select a UUID run ID.");
  const dir = await entry(join(await realpath(root), id), true);
  const path = await entry(join(dir, "collaboration.sqlite"));
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const stat = await lstat(path + suffix).catch(() => undefined);
    if (stat && (!stat.isFile() || stat.isSymbolicLink()))
      throw new TraceError(404, "Trace file not found.");
  }
  // Lazy import keeps the original explorer usable on older Node versions.
  const { DatabaseSync } = await import("node:sqlite").catch(() => {
    throw new TraceError(
      503,
      "Collaboration inspection requires Node.js 22.13+ with node:sqlite enabled.",
    );
  });
  return { dir, db: new DatabaseSync(path, { readOnly: true }) };
}

interface Event {
  id: number;
  kind: string;
  agentId: string | null;
  data: Record<string, any>;
  causeId: number | null;
  timestamp: string;
}

function events(db: Awaited<ReturnType<typeof database>>["db"]): Event[] {
  return db
    .prepare(
      "SELECT id, kind, agentId, data, causeId, timestamp FROM events ORDER BY id",
    )
    .all()
    .map((row) => ({ ...row, data: JSON.parse(String(row.data)) }) as Event);
}

export async function collaborationResponse(
  root: string | undefined,
  path: string,
  method = "GET",
) {
  if (method !== "GET")
    throw new TraceError(405, "Collaboration traces are read-only.");
  if (!root)
    throw new TraceError(
      503,
      "Set COLLABORATION_DIR on the server to inspect collaboration runs.",
    );
  if (path === "/api/collaboration/runs") {
    const dirs = await readdir(root, { withFileTypes: true }).catch(() => {
      throw new TraceError(
        503,
        "The configured collaboration directory is unavailable.",
      );
    });
    const ids: string[] = [];
    for (const dir of dirs) {
      if (!dir.isDirectory() || !UUID.test(dir.name)) continue;
      try {
        await entry(join(root, dir.name, "collaboration.sqlite"));
        ids.push(dir.name);
      } catch {
        /* Skip incomplete runs and symlinks. */
      }
    }
    return { runs: ids.sort() };
  }
  const match = path.match(
    /^\/api\/collaboration\/runs\/([^/]+)(?:\/blobs\/([^/]+))?$/,
  );
  if (!match) throw new TraceError(404, "No such collaboration route.");
  const { db, dir } = await database(root, match[1]);
  try {
    db.exec("BEGIN"); // One consistent snapshot even while a run appends events.
    const trace = events(db);
    const artifacts = db
      .prepare(
        "SELECT path, version, hash FROM artifacts ORDER BY path, version",
      )
      .all();
    if (match[2]) {
      const hash = match[2];
      if (!HASH.test(hash)) throw new TraceError(400, "Invalid blob hash.");
      const published =
        artifacts.some((a) => a.hash === hash) ||
        trace.some(
          (e) => e.kind === "artifact.published" && e.data.hash === hash,
        );
      if (!published) throw new TraceError(404, "Artifact version not found.");
      await entry(join(dir, "blobs"), true);
      const file = await entry(join(dir, "blobs", hash));
      if ((await lstat(file)).size > 1024 * 1024)
        throw new TraceError(
          413,
          "Artifact is too large to preview (1 MiB maximum).",
        );
      const bytes = await readFile(file);
      try {
        return {
          hash,
          content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        };
      } catch {
        throw new TraceError(415, "Binary artifact; text preview unavailable.");
      }
    }
    const agents = db
      .prepare("SELECT id, state FROM agents ORDER BY id")
      .all()
      .map((row) => ({ ...JSON.parse(String(row.state)), id: row.id }));
    return { id: match[1], events: trace, agents, artifacts };
  } finally {
    db.close();
  }
}

export async function handleCollaboration(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<boolean> {
  if (!path.startsWith("/api/collaboration/")) return false;
  let status = 200;
  let body: unknown;
  try {
    body = await collaborationResponse(
      process.env.COLLABORATION_DIR,
      path,
      req.method,
    );
  } catch (error) {
    status = error instanceof TraceError ? error.status : 500;
    // Never return driver errors: they may contain server filesystem paths.
    body = {
      error:
        error instanceof TraceError
          ? error.message
          : "Unable to read collaboration trace. Check the run schema and server configuration.",
    };
  }
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
  return true;
}
