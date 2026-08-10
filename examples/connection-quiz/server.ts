/**
 * Connection quiz — Umwelten-backed server.
 *
 * The quiz itself is a core Dialogue (ScriptedRoundPolicy + onTurnComplete).
 * This file is the thin HTTP surface:
 *
 *   GET  /api/health
 *   GET/POST/DELETE /api/sessions[/:id]
 *   POST /api/sessions/:id/answer   — bespoke SSE for the custom page
 *   POST /api/sessions/:id/skip
 *   POST /api/chat                 — AI SDK UI Message Stream (habitat chat UI)
 *
 *   dotenvx run -- pnpm tsx examples/connection-quiz/server.ts
 *   PORT=7431 dotenvx run -- pnpm tsx examples/connection-quiz/server.ts
 */
import "@umwelten/core/env/load.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import { UiMessageStream } from "@umwelten/habitat";
import { ConnectionQuiz } from "./quiz.js";
import { PARTNER_NAME } from "./partner.js";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 7431);
const quizzes = new Map<string, ConnectionQuiz>();

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function sessionRoot(): string {
  return (
    process.env.CONNECTION_QUIZ_DIR ??
    join(homedir(), ".umwelten", "connection-quiz")
  );
}

function defaultModel(): ModelDetails {
  return {
    provider: process.env.CONNECTION_PROVIDER ?? "ollama",
    name: process.env.CONNECTION_MODEL ?? "gemma4:26b",
  };
}

function modelFrom(value: unknown): ModelDetails {
  if (!value || typeof value !== "object") return defaultModel();
  const v = value as { name?: string; provider?: string };
  if (!v.name || !v.provider) return defaultModel();
  return { name: v.name, provider: v.provider };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

async function persist(quiz: ConnectionQuiz): Promise<void> {
  await quiz.save(join(sessionRoot(), quiz.id));
}

async function loadQuiz(id: string): Promise<ConnectionQuiz | null> {
  const cached = quizzes.get(id);
  if (cached) return cached;
  const quiz = await ConnectionQuiz.load(join(sessionRoot(), id));
  if (quiz) quizzes.set(id, quiz);
  return quiz;
}

async function listSessions(): Promise<
  Array<{ id: string; updatedAt: string; phase: string; questionIndex: number }>
> {
  try {
    const dirs = await readdir(sessionRoot());
    const rows = [];
    for (const id of dirs) {
      const quiz = await loadQuiz(id);
      if (!quiz) continue;
      const view = quiz.publicView();
      rows.push({
        id: view.id,
        updatedAt: view.updatedAt,
        phase: view.phase,
        questionIndex: view.questionIndex,
      });
    }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

function sse(res: ServerResponse): (event: unknown) => void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  return (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function serveStatic(path: string, res: ServerResponse): Promise<boolean> {
  const file = join(root, "public", path === "/" ? "index.html" : path);
  if (!file.startsWith(join(root, "public"))) {
    res.writeHead(403).end();
    return true;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": mime[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

async function handleAnswer(
  quiz: ConnectionQuiz,
  text: string,
  res: ServerResponse,
): Promise<void> {
  const send = sse(res);
  try {
    send({ type: "session", session: quiz.publicView() });
    await quiz.answer(text, (event) => send(event));
    await persist(quiz);
    send({ type: "session", session: quiz.publicView() });
    send({ type: "done" });
  } catch (error) {
    send({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  res.end();
}

/**
 * Standard habitat chat protocol. The shipped UI at packages/habitat/public
 * posts `{ id, messages: [{ role, content }] }` and consumes UiMessageStream.
 * We mint / resume a ConnectionQuiz keyed by the thread id so the same
 * conversation works from either frontend.
 */
async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  type ChatBody = {
    id?: string;
    threadId?: string;
    messages?: Array<{ role?: string; content?: unknown }>;
  };
  let body: ChatBody;
  try {
    body = await readBody(req);
  } catch {
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const lastUser = [...(body.messages ?? [])]
    .reverse()
    .find((m) => m.role === "user");
  const text =
    typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? (lastUser.content as Array<{ type?: string; text?: string }>)
            .filter((p) => p.type === "text" && p.text)
            .map((p) => p.text)
            .join("")
        : "";
  if (!text.trim()) {
    json(res, 400, { error: "No user message in request" });
    return;
  }

  const threadId = body.threadId ?? body.id ?? randomUUID();
  let quiz = await loadQuiz(threadId);
  if (!quiz) {
    quiz = ConnectionQuiz.create(threadId, defaultModel());
    quizzes.set(threadId, quiz);
    await persist(quiz);
  }

  const stream = new UiMessageStream(res);
  stream.start({ "x-umwelten-session-id": threadId });

  try {
    // Surface the current question (or companion cue) as a short preamble so
    // a UI that doesn't have the quiz rail still knows what was asked.
    const view = quiz.publicView();
    if (view.phase === "interview" && view.step === "human-open") {
      const question = view.events.filter((e) => e.role === "question").at(-1);
      if (question) {
        stream.textDelta(
          `(${question.label ?? "Question"}: ${question.text})\n\n`,
        );
      }
    }

    await quiz.answer(text, (event) => {
      if (event.type === "delta" && typeof event.delta === "string") {
        stream.textDelta(event.delta);
      } else if (event.type === "partner" && typeof event.text === "string") {
        // Ensure the final text lands even if deltas were empty.
        if (!event.text) return;
      } else if (event.type === "memory") {
        // Memory updates are quiz-page-only; the habitat UI has no rail for them.
      } else if (event.type === "error" && typeof event.message === "string") {
        stream.errorText(event.message);
      }
    });
    await persist(quiz);
    stream.finish();
  } catch (error) {
    stream.abort(error instanceof Error ? error.message : String(error));
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && !path.startsWith("/api/")) {
    if (await serveStatic(path, res)) return;
  }

  if (path === "/api/health" && method === "GET") {
    json(res, 200, {
      ok: true,
      partner: PARTNER_NAME,
      defaultModel: defaultModel(),
      sessionRoot: sessionRoot(),
      protocol: {
        quizSse: "/api/sessions/:id/answer",
        uiMessageStream: "/api/chat",
      },
    });
    return;
  }

  if (path === "/api/chat" && method === "POST") {
    await handleChat(req, res);
    return;
  }

  if (path === "/api/sessions" && method === "GET") {
    json(res, 200, { sessions: await listSessions() });
    return;
  }

  if (path === "/api/sessions" && method === "POST") {
    const body = await readBody<{ model?: ModelDetails }>(req);
    const id = randomUUID();
    const quiz = ConnectionQuiz.create(id, modelFrom(body.model));
    quizzes.set(id, quiz);
    await persist(quiz);
    json(res, 200, { session: quiz.publicView() });
    return;
  }

  const match = path.match(/^\/api\/sessions\/([^/]+)(\/.*)?$/);
  if (match) {
    const quiz = await loadQuiz(match[1]);
    if (!quiz) {
      json(res, 404, { error: "No such session." });
      return;
    }
    const sub = match[2] ?? "";

    if (sub === "" && method === "GET") {
      json(res, 200, { session: quiz.publicView() });
      return;
    }

    if (sub === "/answer" && method === "POST") {
      const body = await readBody<{ text?: string }>(req);
      await handleAnswer(quiz, body.text ?? "", res);
      return;
    }

    if (sub === "/skip" && method === "POST") {
      await quiz.skip();
      await persist(quiz);
      json(res, 200, { session: quiz.publicView() });
      return;
    }

    if (sub === "" && method === "DELETE") {
      quizzes.delete(quiz.id);
      json(res, 200, { ok: true });
      return;
    }
  }

  json(res, 404, { error: `No route for ${method} ${path}` });
}

createServer((req, res) => {
  handle(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) json(res, 500, { error: message });
    else res.end();
  });
}).listen(port, () => {
  console.log(`connection-quiz on http://localhost:${port}`);
  console.log(`  sessions → ${sessionRoot()}`);
  console.log(`  model    → ${defaultModel().provider}/${defaultModel().name}`);
  console.log(`  chat UI  → POST /api/chat (UiMessageStream)`);
});
