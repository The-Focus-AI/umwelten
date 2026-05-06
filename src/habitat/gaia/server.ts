/**
 * Gaia Orchestrator Server — manages multiple habitat containers.
 *
 * Single HTTP server exposing:
 *   /api/habitats/*   → registry + docker lifecycle + proxy
 *   /api/secrets/*    → master secret vault
 *   /api/docker/*     → image management
 *   /api/chat         → Gaia's own chat (AI SDK Message Stream)
 *   /health           → health check
 *   /                 → Dashboard UI
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "ai";
import { GaiaRegistryManager } from "./registry.js";
import { GaiaSecretVault } from "./secrets.js";
import { DockerManager } from "./docker.js";
import { handleGaiaRoute } from "./routes.js";
import { createGaiaChatTools } from "./gaia-chat.js";
import type { GaiaOrchestratorOptions } from "./types.js";

// ── Static file serving ───────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function serveStatic(
  staticRoot: string,
  urlPath: string,
  res: ServerResponse,
): Promise<boolean> {
  let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  if (rel.includes("..")) return false;
  const abs = resolve(staticRoot, rel);
  try {
    const s = await stat(abs);
    if (s.isDirectory()) {
      const indexAbs = resolve(abs, "index.html");
      const idx = await stat(indexAbs).catch(() => null);
      if (!idx) return false;
      const body = await readFile(indexAbs);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(body);
      return true;
    }
    const body = await readFile(abs);
    const ext = extname(abs).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ── Chat handling ─────────────────────────────────────────────

/**
 * Handle Gaia's own chat via AI SDK UI Message Stream Protocol.
 * Uses a lightweight Stimulus + Interaction setup.
 */
async function handleGaiaChat(
  req: IncomingMessage,
  res: ServerResponse,
  tools: Record<string, Tool>,
  provider?: string,
  model?: string,
): Promise<void> {
  if (!provider || !model) {
    sendJson(res, { error: "Gaia chat requires --provider and --model" }, 503);
    return;
  }

  const { Stimulus } = await import("../../stimulus/stimulus.js");
  const { Interaction } = await import("../../interaction/core/interaction.js");

  const body = JSON.parse(await readBody(req));
  const messages = body.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  const userText = typeof lastMessage?.content === "string"
    ? lastMessage.content
    : lastMessage?.content?.map((p: any) => p.text).join("") ?? "";

  if (!userText) {
    sendJson(res, { error: "No message" }, 400);
    return;
  }

  const stimulus = new Stimulus({
    role: "Gaia, the habitat orchestrator",
    objective: "Manage habitat containers — create, start, stop, query, and configure them. You can also manage the master secret vault and delegate tasks to running habitats via A2A.",
  });
  for (const [name, tool] of Object.entries(tools)) {
    stimulus.addTool(name, tool);
  }

  const modelDetails = { provider, name: model };
  const interaction = new Interaction(modelDetails, stimulus);

  // Add conversation history (exclude last user message — we add it ourselves)
  for (const msg of messages.slice(0, -1)) {
    if (msg.role === "user" || msg.role === "assistant") {
      interaction.addMessage({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      });
    }
  }

  // Stream response using AI SDK data stream protocol
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Vercel-AI-Data-Stream": "v1",
  });

  try {
    interaction.addMessage({ role: "user", content: userText });
    const response = await interaction.streamText(undefined, {
      onTextDelta: (delta) => {
        // AI SDK data stream format: "0:text\n"
        res.write(`0:${JSON.stringify(delta)}\n`);
      },
      onToolCall: (call: { toolCallId: string; toolName: string; input: unknown }) => {
        // Tool call start: "9:{...}\n"
        const toolCall = { toolCallId: call.toolCallId, toolName: call.toolName, args: call.input };
        res.write(`9:${JSON.stringify(toolCall)}\n`);
      },
      onToolResult: (result: { toolCallId: string; toolName: string; output: unknown; isError: boolean }) => {
        // Tool result: "a:{...}\n"
        const toolResult = { toolCallId: result.toolCallId, result: typeof result.output === "string" ? result.output : JSON.stringify(result.output) };
        res.write(`a:${JSON.stringify(toolResult)}\n`);
      },
    });

    // Finish message
    const finishData = { finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0 } };
    res.write(`d:${JSON.stringify(finishData)}\n`);
  } catch (err: any) {
    // Error in stream
    const errData = { error: err.message ?? "Unknown error" };
    res.write(`3:${JSON.stringify(errData.error)}\n`);
  }

  res.end();
}

// ── Main server ───────────────────────────────────────────────

export interface StartedGaiaOrchestrator {
  port: number;
  close: () => void;
}

export async function startGaiaOrchestrator(
  options: GaiaOrchestratorOptions,
): Promise<StartedGaiaOrchestrator> {
  const {
    port = 7420,
    host = "0.0.0.0",
    dataDir: rawDataDir = "./gaia-data",
    provider,
    model,
  } = options;

  const dataDir = resolve(rawDataDir);
  await mkdir(dataDir, { recursive: true });

  // Resolve project root for Docker builds
  const thisDir = fileURLToPath(new URL(".", import.meta.url));
  const projectRoot = resolve(thisDir, "..", "..", "..");

  // Initialize components
  const registry = new GaiaRegistryManager(dataDir);
  await registry.load();

  const vault = new GaiaSecretVault(dataDir);
  await vault.load();

  const docker = new DockerManager(dataDir, projectRoot);
  await docker.ensureNetwork().catch(() => {}); // OK if Docker unavailable

  // Gaia chat tools
  const tools = createGaiaChatTools({ registry, vault, docker });

  // Route context
  const routeCtx = { registry, vault, docker };

  // UI directory
  const uiDir = resolve(thisDir, "ui");

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      // CORS
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, PUT, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = req.url ?? "/";
      const path = url.split("?")[0] ?? "/";

      try {
        // Health check
        if (path === "/health") {
          const dockerAvail = await docker.isDockerAvailable().catch(() => false);
          sendJson(res, {
            status: "ok",
            role: "gaia-orchestrator",
            habitats: registry.list().length,
            secrets: vault.listNames().length,
            docker: dockerAvail,
            chat: !!(provider && model),
          });
          return;
        }

        // Gaia's own chat
        if (path === "/api/chat" && req.method === "POST") {
          await handleGaiaChat(req, res, tools, provider, model);
          return;
        }

        // API routes (registry, docker, secrets, proxy)
        if (path.startsWith("/api/")) {
          const handled = await handleGaiaRoute(routeCtx, req, res);
          if (handled) return;
          sendJson(res, { error: "Not found", path }, 404);
          return;
        }

        // Static UI
        if (req.method === "GET") {
          const served = await serveStatic(uiDir, path, res);
          if (served) return;

          // SPA fallback
          if (!extname(path)) {
            const fell = await serveStatic(uiDir, "/", res);
            if (fell) return;
          }
        }

        sendJson(res, { error: "Not found", path }, 404);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[gaia]", message);
        if (!res.headersSent) {
          sendJson(res, { error: message }, 500);
        } else {
          res.end();
        }
      }
    },
  );

  return new Promise((resolvePromise) => {
    httpServer.listen(port, host, () => {
      const addr = httpServer.address();
      const assignedPort = typeof addr === "object" && addr ? addr.port : port;

      console.log(`[gaia] Orchestrator at http://${host}:${assignedPort}`);
      console.log(`[gaia]   /api/habitats  — habitat management`);
      console.log(`[gaia]   /api/secrets   — master secret vault`);
      console.log(`[gaia]   /api/chat      — Gaia chat${provider ? ` (${provider}/${model})` : " (disabled — no model)"}`);
      console.log(`[gaia]   /              — Dashboard UI`);
      console.log(`[gaia]   /health        — Health check`);
      console.log(`[gaia] Data: ${dataDir}`);
      console.log(`[gaia] Habitats: ${registry.list().length}`);

      resolvePromise({
        port: assignedPort,
        close: () => httpServer.close(),
      });
    });
  });
}
