/**
 * The fission web server.
 *
 * node:http and nothing else — the point of this surface is to inspect the
 * tree, and a build step between you and that is friction nobody needs. The UI
 * is one static HTML file served from disk.
 *
 * Turns stream over SSE so the browser watches the same event sequence the CLI
 * prints: detect → fork → answer → analyse → compact.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import { FissionStore } from "../tree/store.js";
import { FissionChat } from "../engine/fission-chat.js";
import { listDetectors } from "../detect/registry.js";
import { listAllStrategies } from "../compaction/register.js";
import { buildFissionReport } from "../report/build-report.js";
import { renderReportHtml } from "../report/render-html.js";
import type { FissionConfig, TurnLabel } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface FissionServerOptions {
  port?: number;
  host?: string;
  store?: FissionStore;
  model: ModelDetails;
  analysisModel?: ModelDetails;
  systemPrompt?: string;
}

export interface FissionServerHandle {
  port: number;
  url: string;
  close(): Promise<void>;
}

interface Ctx {
  store: FissionStore;
  model: ModelDetails;
  analysisModel?: ModelDetails;
  systemPrompt?: string;
  chats: Map<string, FissionChat>;
}

async function chatFor(ctx: Ctx, treeId: string): Promise<FissionChat> {
  const existing = ctx.chats.get(treeId);
  if (existing) return existing;
  const chat = await FissionChat.open({
    treeId,
    store: ctx.store,
    model: ctx.model,
    analysisModel: ctx.analysisModel,
    systemPrompt: ctx.systemPrompt,
  });
  ctx.chats.set(treeId, chat);
  return chat;
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

function treeSnapshot(chat: FissionChat) {
  return {
    tree: chat.tree.data,
    turns: chat.tree.allTurns(),
    stats: chat.tree.stats(),
  };
}

export async function startFissionServer(
  options: FissionServerOptions,
): Promise<FissionServerHandle> {
  const ctx: Ctx = {
    store: options.store ?? new FissionStore(),
    model: options.model,
    analysisModel: options.analysisModel,
    systemPrompt: options.systemPrompt,
    chats: new Map(),
  };

  const server = createServer((req, res) => {
    handle(ctx, req, res).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) json(res, 500, { error: message });
      else res.end();
    });
  });

  const port = options.port ?? 7431;
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve) => server.listen(port, host, resolve));

  return {
    port,
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function handle(ctx: Ctx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (path === "/" || path === "/index.html") {
    const html = await readFile(join(__dirname, "ui", "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (path === "/health") {
    json(res, 200, { ok: true });
    return;
  }

  if (path === "/api/strategies" && method === "GET") {
    const strategies = await listAllStrategies();
    json(
      res,
      200,
      strategies.map((s) => ({ id: s.id, name: s.name, description: s.description })),
    );
    return;
  }

  if (path === "/api/detectors" && method === "GET") {
    json(
      res,
      200,
      listDetectors().map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        usesLlm: d.usesLlm,
      })),
    );
    return;
  }

  if (path === "/api/trees" && method === "GET") {
    const trees = await ctx.store.listTrees();
    json(
      res,
      200,
      trees.map((t) => ({
        id: t.id,
        title: t.title,
        updatedAt: t.updatedAt,
        nodeCount: Object.keys(t.nodes).length,
      })),
    );
    return;
  }

  if (path === "/api/trees" && method === "POST") {
    const body = await readBody<{ title?: string; config?: Partial<FissionConfig> }>(req);
    const chat = await FissionChat.create({
      store: ctx.store,
      model: ctx.model,
      analysisModel: ctx.analysisModel,
      systemPrompt: ctx.systemPrompt,
      title: body.title,
      config: body.config as FissionConfig | undefined,
    });
    ctx.chats.set(chat.tree.id, chat);
    json(res, 200, treeSnapshot(chat));
    return;
  }

  const treeMatch = path.match(/^\/api\/trees\/([^/]+)(\/.*)?$/);
  if (treeMatch) {
    const treeId = treeMatch[1];
    const sub = treeMatch[2] ?? "";
    const chat = await chatFor(ctx, treeId);

    if (sub === "" && method === "GET") {
      json(res, 200, treeSnapshot(chat));
      return;
    }

    if (sub === "/send" && method === "POST") {
      const body = await readBody<{ text: string; forceFork?: boolean; nodeId?: string }>(req);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
      try {
        await chat.send(body.text, {
          onEvent: send,
          forceFork: body.forceFork,
          forceNodeId: body.nodeId,
        });
        send({ type: "snapshot", ...treeSnapshot(chat) });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      res.end();
      return;
    }

    if (sub === "/active" && method === "POST") {
      const body = await readBody<{ nodeId: string }>(req);
      chat.setActiveNode(body.nodeId);
      await ctx.store.saveTree(chat.tree);
      json(res, 200, treeSnapshot(chat));
      return;
    }

    if (sub === "/fork" && method === "POST") {
      const body = await readBody<{ parentId: string; title: string; newTopic?: string }>(req);
      await chat.forkManually(body.parentId, body.title, body.newTopic);
      json(res, 200, treeSnapshot(chat));
      return;
    }

    if (sub === "/rename" && method === "POST") {
      const body = await readBody<{ nodeId: string; title: string }>(req);
      chat.tree.renameNode(body.nodeId, body.title);
      await ctx.store.saveTree(chat.tree);
      json(res, 200, treeSnapshot(chat));
      return;
    }

    if (sub === "/label" && method === "POST") {
      const body = await readBody<{ turnId: string; verdict: TurnLabel["verdict"]; note?: string }>(req);
      chat.tree.labelTurn(body.turnId, {
        verdict: body.verdict,
        note: body.note,
        at: new Date().toISOString(),
      });
      await ctx.store.rewriteTurns(chat.tree.id, chat.tree.allTurns());
      json(res, 200, treeSnapshot(chat));
      return;
    }

    if (sub === "/config" && method === "POST") {
      const body = await readBody<Partial<FissionConfig>>(req);
      chat.tree.data.config = { ...chat.tree.data.config, ...body };
      await ctx.store.saveTree(chat.tree);
      json(res, 200, treeSnapshot(chat));
      return;
    }

    if (sub === "/compact" && method === "POST") {
      const body = await readBody<{
        turnId: string;
        strategyId: string;
        keepRecentMessages?: number;
        newTopic?: string;
      }>(req);
      const record = await chat.tryCompaction(body);
      json(res, 200, { record, ...treeSnapshot(chat) });
      return;
    }

    if (sub === "/context" && method === "GET") {
      const nodeId = url.searchParams.get("nodeId") ?? chat.tree.data.activeNodeId;
      const interaction = chat.interactionFor(nodeId);
      json(res, 200, {
        live: interaction.messages,
        raw: chat.rebuildRawMessages(nodeId),
      });
      return;
    }

    if (sub === "/report" && method === "GET") {
      const report = buildFissionReport(chat.tree);
      if (url.searchParams.get("format") === "json") {
        json(res, 200, report);
        return;
      }
      const html = renderReportHtml(report);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
  }

  json(res, 404, { error: `No route for ${method} ${path}` });
}
