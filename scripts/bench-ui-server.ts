#!/usr/bin/env node
/**
 * Local Interactive Coding-Session Eval Workbench HTTP + SSE Server
 * (`pnpm run bench:ui`, bound to `127.0.0.1:7440` by default).
 *
 * Exposes catalog discovery, multi-session launch with local-GPU queueing,
 * real-time EventSource streaming from `InteractiveCodingSession`, follow-up
 * chat inside isolated git checkouts, held-out snapshot grading, git diff
 * inspection, and clean saving of autonomous scores into the coding dataset.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  BUILTIN_CODING_EXTENSIONS,
  InteractiveCodingSession,
  type CodingSessionEvent,
  type CodingSessionRecord,
  type CodingSessionStatus,
  type CodingTaskSpec,
} from "@umwelten/evaluation";
import {
  canonicalizeThinkingEffort,
  formatModelSpecString,
  type ModelSpec,
  type ResolvedPiInvocationTarget,
  type ThinkingEffort,
} from "@umwelten/pi";
import {
  hydrateEntryWithCatalog,
  isLocalProviderName,
  loadModelMatrix,
  selectMatrixModels,
  type MatrixModelEntry,
} from "../examples/_shared/model-matrix.js";
import { createMockTargetMap } from "../examples/coding-bench/mock-solutions.js";
import {
  saveSingleRecordToCodingReport,
  type CodingBenchReportPayload,
} from "../examples/coding-bench/report-store.js";
import { loadCodingFixtures } from "../examples/coding-bench/tasks.js";
import { renderBenchUiHtml } from "./bench-ui-html.js";
import { LABS_CSS } from "./site-styles.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7440;
const SSE_PING_INTERVAL_MS = 15_000;
const CLOUD_CONCURRENCY = 2;
const LOCAL_CONCURRENCY = 1;

export interface BenchUiServerOptions {
  port?: number;
  host?: string;
  rootDir?: string;
}

export interface BenchUiServerHandle {
  url: string;
  port: number;
  host: string;
  server: Server;
  close: () => Promise<void>;
}

interface ManagedSession {
  id: string;
  taskId: string;
  title: string;
  provider: string;
  model: string;
  effort: string;
  extensionProfile: string;
  mode: "live" | "mock";
  spec: ModelSpec;
  specCosts?: ModelSpec["costs"];
  task: CodingTaskSpec;
  extensionNames: string[];
  customExtensions: string[];
  outputDir: string;
  overrideTarget?: ResolvedPiInvocationTarget;
  status: CodingSessionStatus;
  workspaceDir?: string;
  events: CodingSessionEvent[];
  initialRecord?: CodingSessionRecord;
  latestRecord?: CodingSessionRecord;
  error?: string;
  abortedBeforeStart: boolean;
  session?: InteractiveCodingSession;
  subscribers: Set<{ res: ServerResponse; heartbeat: ReturnType<typeof setInterval> }>;
}

interface LaunchBody {
  models?: string[];
  efforts?: string[];
  tasks?: string[];
  extensions?: string[];
  customExtensions?: string[];
  mode?: "live" | "mock";
}

class LaneQueue {
  private readonly active = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();

  async run<T>(lane: string, limit: number, work: () => Promise<T>): Promise<T> {
    await this.acquire(lane, limit);
    try {
      return await work();
    } finally {
      this.release(lane);
    }
  }

  private async acquire(lane: string, limit: number): Promise<void> {
    const count = this.active.get(lane) ?? 0;
    if (count < limit) {
      this.active.set(lane, count + 1);
      return;
    }
    await new Promise<void>((resolve) => {
      const queue = this.waiters.get(lane) ?? [];
      queue.push(resolve);
      this.waiters.set(lane, queue);
    });
    this.active.set(lane, (this.active.get(lane) ?? 0) + 1);
  }

  private release(lane: string): void {
    const nextCount = Math.max(0, (this.active.get(lane) ?? 1) - 1);
    this.active.set(lane, nextCount);
    const queue = this.waiters.get(lane);
    const wake = queue?.shift();
    if (wake) wake();
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(json);
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > 1_048_576) {
      throw new Error("Request body exceeds 1 MB limit");
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

function readReportIfExists(filePath: string): CodingBenchReportPayload | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as CodingBenchReportPayload;
  } catch {
    return null;
  }
}

function loadCatalogModels(rootDir: string): MatrixModelEntry[] {
  const matrixPath = path.join(rootDir, "examples", "model-watch", "models.json");
  const manifest = loadModelMatrix(matrixPath);
  const seen = new Set<string>();
  const out: MatrixModelEntry[] = [];

  for (const [groupName, grp] of Object.entries(manifest.groups)) {
    for (const item of grp.models) {
      const key = `${item.provider}:${item.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        hydrateEntryWithCatalog({
          ...item,
          enabled: item.enabled ?? true,
          group: groupName,
        }),
      );
    }
  }
  return out;
}

function toSessionSummary(s: ManagedSession) {
  return {
    id: s.id,
    taskId: s.taskId,
    title: s.title,
    provider: s.provider,
    model: s.model,
    effort: s.effort,
    extensionProfile: s.extensionProfile,
    mode: s.mode,
    status: s.status,
    workspaceDir: s.workspaceDir,
    initialRecord: s.initialRecord,
    latestRecord: s.latestRecord,
    error: s.error,
    eventsCount: s.events.length,
  };
}

function pushEvent(s: ManagedSession, event: CodingSessionEvent): void {
  s.events.push(event);
  if (event.type === "session_started") {
    s.workspaceDir = event.workspaceDir;
    s.extensionProfile = event.extensionProfile;
  } else if (event.type === "status") {
    s.status = event.status;
    if (event.error) s.error = event.error;
  } else if (event.type === "graded") {
    if (event.isInitialEval && !s.initialRecord) {
      s.initialRecord = event.record;
    }
    s.latestRecord = event.record;
  }

  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const sub of s.subscribers) {
    try {
      sub.res.write(line);
    } catch {
      // Closed sockets are removed via close handlers
    }
  }
}

function buildExtensionList(
  requested?: string[],
  custom?: string[],
  rootDir: string = process.cwd(),
): { names: string[]; customPaths: string[]; profile: string } {
  const validBuiltins = new Set<string>(BUILTIN_CODING_EXTENSIONS);
  const names = new Set<string>(["pi-default"]);
  for (const name of requested ?? []) {
    if (validBuiltins.has(name)) names.add(name);
  }
  const customPaths = (custom ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (path.isAbsolute(p) ? p : path.resolve(rootDir, p)));

  const list = [...names];
  const profileParts = [
    ...list,
    ...customPaths.map((p) => path.basename(p, path.extname(p))),
  ];
  return {
    names: list,
    customPaths,
    profile: profileParts.join("+"),
  };
}

const VALID_THINKING_EFFORTS = new Set<ThinkingEffort>([
  "off",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function isThinkingEffort(value: string): value is ThinkingEffort {
  return VALID_THINKING_EFFORTS.has(value as ThinkingEffort);
}

function isManagedClosed(s: ManagedSession): boolean {
  return s.status === "closed";
}

function isLocalSpec(spec: ModelSpec): boolean {
  return isLocalProviderName(spec.provider);
}

export async function createBenchUiServer(
  options: BenchUiServerOptions = {},
): Promise<BenchUiServerHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const requestedPort = options.port ?? DEFAULT_PORT;
  const rootDir = path.resolve(options.rootDir ?? process.cwd());

  const sessions = new Map<string, ManagedSession>();
  const laneQueue = new LaneQueue();
  let closing = false;

  const scheduleSessionRun = (managed: ManagedSession): void => {
    const isLocal = isLocalSpec(managed.spec);
    const lane = isLocal ? `local:${managed.spec.provider}` : "cloud";
    const limit = isLocal ? LOCAL_CONCURRENCY : CLOUD_CONCURRENCY;

    void laneQueue.run(lane, limit, async () => {
      if (closing || managed.abortedBeforeStart || isManagedClosed(managed)) {
        return;
      }
      try {
        const activeSession = await InteractiveCodingSession.start({
          id: managed.id,
          task: managed.task,
          spec: managed.spec,
          extensionNames: managed.extensionNames,
          customExtensionPaths: managed.customExtensions,
          outputDir: managed.outputDir,
          onEvent: (ev) => pushEvent(managed, ev),
          ...(managed.overrideTarget
            ? { overrideTarget: managed.overrideTarget }
            : {}),
        });
        managed.session = activeSession;
        managed.workspaceDir = activeSession.workspaceDir;

        if (closing || managed.abortedBeforeStart || isManagedClosed(managed)) {
          await activeSession.close();
          return;
        }

        await activeSession.runInitialEval();
        managed.initialRecord = activeSession.initialRecord;
        managed.latestRecord = activeSession.latestRecord;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pushEvent(managed, {
          type: "status",
          status: "error",
          error: message,
          timestamp: Date.now(),
        });
      }
    });
  };

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const parsedUrl = new URL(req.url ?? "/", `http://${host}`);
      const pathname = parsedUrl.pathname;

      if (method === "GET" && pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderBenchUiHtml());
        return;
      }

      if (method === "GET" && pathname === "/styles/labs.css") {
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
        res.end(LABS_CSS);
        return;
      }

      if (method === "GET" && pathname === "/api/catalog") {
        const models = loadCatalogModels(rootDir);
        const tasks = loadCodingFixtures(
          path.join(rootDir, "benchmarks", "coding-fixtures"),
        ).map((t) => ({
          id: t.id,
          title: t.title,
          difficulty: t.difficulty,
          language: t.language,
          tags: t.tags ?? [],
        }));
        const liveReport = readReportIfExists(
          path.join(rootDir, "reports", "data", "coding-bench-live.json"),
        );
        const mockReport = readReportIfExists(
          path.join(rootDir, "reports", "data", "coding-bench-mock.json"),
        );
        sendJson(res, 200, {
          models,
          tasks,
          extensions: [...BUILTIN_CODING_EXTENSIONS],
          reports: {
            live: liveReport,
            mock: mockReport,
          },
        });
        return;
      }

      if (method === "GET" && pathname === "/api/sessions") {
        sendJson(res, 200, {
          sessions: [...sessions.values()].map(toSessionSummary),
        });
        return;
      }

      if (method === "POST" && pathname === "/api/sessions") {
        const body = await readJsonBody<LaunchBody>(req);
        const rawModels = (body.models ?? []).map((s) => s.trim()).filter(Boolean);
        const rawTasks = (body.tasks ?? []).map((s) => s.trim()).filter(Boolean);
        if (rawModels.length === 0 || rawTasks.length === 0) {
          sendJson(res, 400, {
            error: "Both models[] and tasks[] must contain at least one item.",
          });
          return;
        }

        const mode: "live" | "mock" = body.mode === "mock" ? "mock" : "live";
        const rawEfforts =
          body.efforts && body.efforts.length > 0 ? body.efforts : ["default"];

        const allTasks = loadCodingFixtures(
          path.join(rootDir, "benchmarks", "coding-fixtures"),
        );
        const taskById = new Map(allTasks.map((t) => [t.id, t]));
        const selectedTasks: CodingTaskSpec[] = [];
        for (const tid of rawTasks) {
          const found = taskById.get(tid);
          if (!found) {
            sendJson(res, 400, { error: `Unknown coding fixture "${tid}"` });
            return;
          }
          selectedTasks.push(found);
        }

        const matrix = loadModelMatrix(
          path.join(rootDir, "examples", "model-watch", "models.json"),
        );
        const baseEntries = selectMatrixModels(matrix, { models: rawModels });

        const specs: MatrixModelEntry[] = [];
        const seenSpecs = new Set<string>();
        for (const entry of baseEntries) {
          for (const rawEff of rawEfforts) {
            let reasoningEffort = entry.reasoningEffort;
            if (rawEff !== "default") {
              if (!isThinkingEffort(rawEff)) {
                sendJson(res, 400, {
                  error: `Invalid thinking effort "${rawEff}"`,
                });
                return;
              }
              reasoningEffort = canonicalizeThinkingEffort(rawEff);
            }
            const candidate: MatrixModelEntry = {
              ...entry,
              ...(reasoningEffort
                ? { reasoningEffort }
                : { reasoningEffort: undefined }),
            };
            const dedup = formatModelSpecString(candidate);
            if (!seenSpecs.has(dedup)) {
              seenSpecs.add(dedup);
              specs.push(candidate);
            }
          }
        }

        const extConfig = buildExtensionList(
          body.extensions,
          body.customExtensions,
          rootDir,
        );
        const mockTargets =
          mode === "mock" ? createMockTargetMap(specs) : undefined;
        const outputDir = path.join(
          rootDir,
          "output",
          mode === "mock" ? "mock-evaluations" : "evaluations",
          "coding-bench",
          "runs",
          "001",
        );

        const created: ManagedSession[] = [];
        for (const spec of specs) {
          const overrideTarget = mockTargets?.get(formatModelSpecString(spec));
          const effortLabel = spec.reasoningEffort ?? "default";
          for (const task of selectedTasks) {
            const id = crypto.randomBytes(4).toString("hex");
            const managed: ManagedSession = {
              id,
              taskId: task.id,
              title: task.title,
              provider: spec.provider,
              model: spec.name,
              effort: effortLabel,
              extensionProfile: extConfig.profile,
              mode,
              spec,
              specCosts: spec.costs,
              task,
              extensionNames: extConfig.names,
              customExtensions: extConfig.customPaths,
              outputDir,
              ...(overrideTarget ? { overrideTarget } : {}),
              status: "idle",
              events: [],
              abortedBeforeStart: false,
              subscribers: new Set(),
            };
            sessions.set(id, managed);
            created.push(managed);
            scheduleSessionRun(managed);
          }
        }

        sendJson(res, 201, {
          sessions: created.map(toSessionSummary),
        });
        return;
      }

      const sessionMatch = pathname.match(
        /^\/api\/sessions\/([^/]+)(?:\/(events|abort|chat|grade|save))?$/,
      );
      if (sessionMatch) {
        const id = decodeURIComponent(sessionMatch[1]);
        const subRoute = sessionMatch[2];
        const managed = sessions.get(id);
        if (!managed) {
          sendJson(res, 404, { error: `Session "${id}" not found` });
          return;
        }

        if (!subRoute && method === "GET") {
          const diff =
            managed.session && managed.status !== "closed"
              ? await managed.session.getDiff().catch(() => null)
              : null;
          sendJson(res, 200, {
            ...toSessionSummary(managed),
            diff,
          });
          return;
        }

        if (!subRoute && method === "DELETE") {
          managed.abortedBeforeStart = true;
          for (const sub of managed.subscribers) {
            clearInterval(sub.heartbeat);
            sub.res.end();
          }
          managed.subscribers.clear();
          if (managed.session) {
            await managed.session.close().catch(() => {});
          }
          managed.status = "closed";
          sessions.delete(id);
          sendJson(res, 200, { ok: true, id });
          return;
        }

        if (subRoute === "events" && method === "GET") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          });
          for (const ev of managed.events) {
            res.write(`data: ${JSON.stringify(ev)}\n\n`);
          }
          const heartbeat = setInterval(() => {
            try {
              res.write(": ping\n\n");
            } catch {
              // Cleaned on close
            }
          }, SSE_PING_INTERVAL_MS);
          const entry = { res, heartbeat };
          managed.subscribers.add(entry);
          const cleanup = () => {
            clearInterval(heartbeat);
            managed.subscribers.delete(entry);
          };
          req.on("close", cleanup);
          res.on("close", cleanup);
          return;
        }

        if (subRoute === "abort" && method === "POST") {
          managed.abortedBeforeStart = true;
          if (managed.session) {
            await managed.session.abort();
          } else {
            pushEvent(managed, {
              type: "status",
              status: "aborted",
              timestamp: Date.now(),
            });
          }
          sendJson(res, 200, { ok: true, status: managed.status });
          return;
        }

        if (subRoute === "chat" && method === "POST") {
          const body = await readJsonBody<{ message?: string }>(req);
          const message = (body.message ?? "").trim();
          if (!message) {
            sendJson(res, 400, { error: "Follow-up message cannot be empty." });
            return;
          }
          if (!managed.session) {
            sendJson(res, 409, {
              error: "Session is still queued or starting.",
            });
            return;
          }
          if (managed.status === "running" || managed.status === "grading" || managed.status === "chatting") {
            sendJson(res, 409, {
              error: `Session is busy (${managed.status}). Wait or abort first.`,
            });
            return;
          }
          const result = await managed.session.sendFollowUp(message);
          sendJson(res, 200, { result });
          return;
        }

        if (subRoute === "grade" && method === "POST") {
          if (!managed.session) {
            sendJson(res, 409, { error: "Session has not started yet." });
            return;
          }
          if (managed.status === "running" || managed.status === "grading" || managed.status === "chatting") {
            sendJson(res, 409, {
              error: `Session is busy (${managed.status}).`,
            });
            return;
          }
          const record = await managed.session.grade();
          managed.latestRecord = record;
          sendJson(res, 200, { record });
          return;
        }

        if (subRoute === "save" && method === "POST") {
          const initial = managed.session?.initialRecord ?? managed.initialRecord;
          if (!initial) {
            sendJson(res, 400, {
              error: "Session has not completed its initial autonomous grade yet.",
            });
            return;
          }
          const allTasks = loadCodingFixtures(
            path.join(rootDir, "benchmarks", "coding-fixtures"),
          );
          const { outPath, payload } = saveSingleRecordToCodingReport({
            record: initial,
            mode: managed.mode,
            rootDir,
            specCosts: managed.specCosts,
            allTasks,
          });
          sendJson(res, 200, {
            savedTo: path.relative(rootDir, outPath),
            outPath,
            modelsCount: payload.models.length,
          });
          return;
        }
      }

      sendJson(res, 404, { error: `Route not found: ${method} ${pathname}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: msg });
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const boundPort =
    addr && typeof addr === "object" ? addr.port : requestedPort;
  const url = `http://${host}:${boundPort}`;

  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    for (const s of sessions.values()) {
      s.abortedBeforeStart = true;
      for (const sub of s.subscribers) {
        clearInterval(sub.heartbeat);
        sub.res.end();
      }
      s.subscribers.clear();
    }
    server.closeIdleConnections?.();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await Promise.allSettled(
      [...sessions.values()].map(async (s) => {
        if (s.session) await s.session.close();
      }),
    );
    sessions.clear();
  };

  return {
    url,
    port: boundPort,
    host,
    server,
    close,
  };
}

async function runCli(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      port: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`Usage: pnpm run bench:ui [-- --port 7440]

Starts the local Interactive Coding-Session Workbench HTTP + SSE server
bound strictly to 127.0.0.1.`);
    return;
  }

  const parsedPort = values.port ? Number(values.port) : DEFAULT_PORT;
  if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
    throw new Error(`Invalid --port value: ${values.port}`);
  }

  const handle = await createBenchUiServer({ port: parsedPort });
  console.log(`\nUmwelten Interactive Coding-Session Workbench`);
  console.log(`  URL: ${handle.url}`);
  console.log(`  Ctrl+C to stop and clean up active temporary checkouts.\n`);

  const shutdown = async () => {
    console.log("\nShutting down workbench server...");
    await handle.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runCli().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
