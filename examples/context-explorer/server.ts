/**
 * Context explorer — the app.
 *
 * Deliberately thin. Every piece of machinery it uses lives in umwelten:
 * `Interaction` runs the turn, `runFanout` runs the probes, the compaction
 * registry supplies the baselines, and `writeSessionTranscript` puts the state
 * in a session directory the rest of the tooling can already read.
 *
 * What this file adds is a socket and a page.
 *
 *   pnpm tsx examples/context-explorer/server.ts
 *   PORT=7432 pnpm tsx examples/context-explorer/server.ts
 */

import "@umwelten/core/env/load.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, mkdir, appendFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ModelMessage } from "ai";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import { estimateContextSize } from "@umwelten/core/context/estimate-size.js";
import { listCompactionStrategies } from "@umwelten/core/context/registry.js";
import { writeSessionTranscript } from "@umwelten/core/session-record/transcript-write.js";
import { webTools, mathTools } from "@umwelten/core/stimulus/tools/index.js";
import {
  runFanout,
  DEFAULT_PROBES,
  type Probe,
  type ProbeResult,
} from "@umwelten/core/interaction/reflection/fanout.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 7432);

const DEFAULT_SYSTEM_PROMPT =
  "You are a research assistant. Answer directly and look things up when it helps. Prefer specifics over hedging.";

/** One run: a live Interaction plus everything the fan-out has produced. */
interface Run {
  id: string;
  sessionDir: string;
  createdAt: string;
  answerModel: ModelDetails;
  fanoutModel: ModelDetails;
  systemPrompt: string;
  probes: Probe[];
  interaction: Interaction;
  turns: TurnRow[];
}

interface TurnRow {
  index: number;
  userText: string;
  assistantText: string;
  toolCalls: string[];
  contextTokensBefore: number;
  contextTokensAfter: number;
  answerLatencyMs: number;
  answerCostUsd?: number;
  answerPromptTokens?: number;
  fanout: ProbeResult[];
  /** Set when the user continued from one of the baselines. */
  continuedFrom?: string;
}

const runs = new Map<string, Run>();

function sessionRoot(): string {
  return process.env.CONTEXT_EXPLORER_DIR ?? join(homedir(), ".umwelten", "context-explorer");
}

function buildInteraction(run: {
  answerModel: ModelDetails;
  systemPrompt: string;
  useTools: boolean;
}): Interaction {
  const stimulus = new Stimulus({
    role: "research assistant",
    instructions: [run.systemPrompt],
    runnerType: "base",
  });
  const interaction = new Interaction(run.answerModel, stimulus);
  if (run.useTools) {
    interaction.tools = { ...webTools, ...mathTools };
    interaction.maxSteps = 8;
  }
  return interaction;
}

function runSummary(run: Run) {
  return {
    id: run.id,
    createdAt: run.createdAt,
    sessionDir: run.sessionDir,
    answerModel: run.answerModel,
    fanoutModel: run.fanoutModel,
    systemPrompt: run.systemPrompt,
    probes: run.probes,
    turns: run.turns,
    contextTokens: estimateContextSize(run.interaction.messages).estimatedTokens,
    messageCount: run.interaction.messages.length,
  };
}

/** Append one line per turn beside the transcript, for the report to read later. */
async function persist(run: Run, turn: TurnRow): Promise<void> {
  await mkdir(run.sessionDir, { recursive: true });
  await writeSessionTranscript(run.sessionDir, run.interaction.messages);
  await appendFile(
    join(run.sessionDir, "fanout.jsonl"),
    `${JSON.stringify({
      runId: run.id,
      answerModel: run.answerModel,
      fanoutModel: run.fanoutModel,
      ...turn,
    })}\n`,
    "utf8",
  );
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function modelFrom(value: unknown, fallback: ModelDetails): ModelDetails {
  if (!value || typeof value !== "object") return fallback;
  const v = value as { name?: string; provider?: string };
  if (!v.name || !v.provider) return fallback;
  return { name: v.name, provider: v.provider };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (path === "/" || path === "/index.html") {
    const html = await readFile(join(root, "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (path === "/api/strategies" && method === "GET") {
    const strategies = await listCompactionStrategies();
    json(res, 200, strategies.map((s) => ({ id: s.id, name: s.name, description: s.description })));
    return;
  }

  if (path === "/api/defaults" && method === "GET") {
    json(res, 200, {
      probes: DEFAULT_PROBES,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      answerModel: { provider: "ollama", name: "gemma4:26b" },
    });
    return;
  }

  if (path === "/api/runs" && method === "POST") {
    const body = await readBody<{
      answerModel?: ModelDetails;
      fanoutModel?: ModelDetails;
      systemPrompt?: string;
      probes?: Probe[];
      useTools?: boolean;
    }>(req);

    const answerModel = modelFrom(body.answerModel, {
      provider: "ollama",
      name: "gemma4:26b",
    });
    const id = randomUUID();
    const run: Run = {
      id,
      sessionDir: join(sessionRoot(), id),
      createdAt: new Date().toISOString(),
      answerModel,
      fanoutModel: modelFrom(body.fanoutModel, answerModel),
      systemPrompt: body.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      probes: body.probes?.length ? body.probes : DEFAULT_PROBES,
      interaction: buildInteraction({
        answerModel,
        systemPrompt: body.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        useTools: body.useTools !== false,
      }),
      turns: [],
    };
    runs.set(id, run);
    json(res, 200, runSummary(run));
    return;
  }

  const match = path.match(/^\/api\/runs\/([^/]+)(\/.*)?$/);
  if (match) {
    const run = runs.get(match[1]);
    if (!run) {
      json(res, 404, { error: "No such run. It may have been lost on restart." });
      return;
    }
    const sub = match[2] ?? "";

    if (sub === "" && method === "GET") {
      json(res, 200, runSummary(run));
      return;
    }

    if (sub === "/ask" && method === "POST") {
      const body = await readBody<{ text: string }>(req);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);

      try {
        const contextTokensBefore = estimateContextSize(run.interaction.messages).estimatedTokens;
        run.interaction.addMessage({ role: "user", content: body.text });

        const toolCalls: string[] = [];
        const started = Date.now();
        send({ type: "answer-start" });

        const response = await run.interaction.streamText(undefined, {
          onTextDelta: (delta) => send({ type: "delta", delta }),
          onToolCall: (call) => {
            toolCalls.push(call.toolName);
            send({ type: "tool-call", name: call.toolName, input: call.input });
          },
          onToolResult: (result) =>
            send({ type: "tool-result", name: result.toolName, isError: result.isError }),
        });
        const answerLatencyMs = Date.now() - started;
        const assistantText =
          typeof response.content === "string" ? response.content : String(response.content ?? "");
        send({ type: "answer", text: assistantText });

        // Snapshot the context the fan-out sees, so every probe — and the
        // answer that just ran — share the same prefix.
        const snapshot: ModelMessage[] = run.interaction.messages.slice();
        send({ type: "fanout-start", probes: run.probes.map((p) => ({ id: p.id, label: p.label, kind: p.kind })) });

        const results = await runFanout({
          messages: snapshot,
          model: run.fanoutModel,
          probes: run.probes,
          onResult: (result) => send({ type: "probe", result }),
        });

        const turn: TurnRow = {
          index: run.turns.length,
          userText: body.text,
          assistantText,
          toolCalls,
          contextTokensBefore,
          contextTokensAfter: estimateContextSize(run.interaction.messages).estimatedTokens,
          answerLatencyMs,
          answerCostUsd: response.metadata?.cost?.totalCost,
          answerPromptTokens: response.metadata?.tokenUsage?.promptTokens,
          fanout: results,
        };
        run.turns.push(turn);
        await persist(run, turn);

        send({ type: "turn-complete", run: runSummary(run) });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : String(error) });
      }
      res.end();
      return;
    }

    if (sub === "/continue-from" && method === "POST") {
      // Adopt a baseline's replacement context as the live one. This is the
      // "reset baseline" half of the fan-out — the conversation carries on from
      // the compacted state instead of the full history.
      const body = await readBody<{ turnIndex: number; probeId: string }>(req);
      const turn = run.turns[body.turnIndex];
      const probe = turn?.fanout.find((p) => p.probeId === body.probeId);
      if (!probe?.replacement) {
        json(res, 400, { error: "That probe has no context to continue from." });
        return;
      }
      run.interaction.messages = probe.replacement as ModelMessage[];
      turn.continuedFrom = body.probeId;
      await persist(run, turn);
      json(res, 200, runSummary(run));
      return;
    }

    if (sub === "/context" && method === "GET") {
      json(res, 200, { messages: run.interaction.messages });
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
}).listen(port, "127.0.0.1", () => {
  console.log(`context explorer: http://127.0.0.1:${port}`);
  console.log(`sessions:        ${sessionRoot()}`);
});
