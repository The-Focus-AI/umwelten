/**
 * Unified Container Server
 *
 * Single HTTP server exposing multiple protocols on one port:
 *   /mcp           → MCP (Streamable HTTP) — raw tool access, no LLM
 *   /api/chat      → AI SDK UI Message Stream — web chat with LLM
 *   /api/habitat   → Habitat info
 *   /api/sessions  → Session CRUD
 *   /files/*       → Serve files from work dir (sandboxed)
 *   /health        → Health check
 *   /              → Built-in chat UI (static)
 *
 * Auth: if HABITAT_API_KEY is set, /api/* and /mcp require Bearer token.
 *       /health and static UI are always open.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Tool } from "ai";
import type { Habitat } from "./habitat.js";
import type { AgentHost } from "./types.js";
import { resolveProjectDir, saveConfig, fileExists } from "./config.js";
import { listArtifacts } from "./tools/artifact-tools.js";
import { createA2AHandler, type A2AHandler } from "./a2a-handler.js";
import { buildAgentStimulus } from "./habitat-agent.js";
import { runClaudeSDK } from "./claude-sdk-runner.js";
import { ChannelBridge } from "./bridge/channel-bridge.js";
import { WebAdapter } from "./web/WebAdapter.js";
import { devAuth } from "./web/auth/dev-auth.js";
import { bearerAuth } from "./web/auth/bearer-auth.js";
import { defaultRoutes } from "./web/routes/index.js";
import type { AuthProvider, UserContext, RouteContext, RouteHandler } from "./web/types.js";

export interface ContainerServerOptions {
  habitat: Habitat;
  port?: number;
  host?: string;
  name?: string;
  /** Optional raw request handler that runs before standard routing. Return true if handled. */
  extraRawHandler?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  /** Override the static UI directory (default: container-ui/) */
  uiDir?: string;
}

export interface StartedContainerServer {
  port: number;
  close: () => void;
}

// ── MCP tool registration ─────────────────────────────────────────

function registerAiTool(
  mcpServer: McpServer,
  toolName: string,
  aiTool: Tool,
): void {
  const description = (aiTool as any).description ?? "";
  const inputSchema = (aiTool as any).inputSchema;
  const execute = (aiTool as any).execute;
  if (typeof execute !== "function") return;

  const handler = async (params: Record<string, unknown>) => {
    const ts = new Date().toISOString();
    const argSummary = Object.entries(params)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    console.log(`[${ts}] ⚡ ${toolName}${argSummary ? " " + argSummary : ""}`);

    try {
      const result = await execute(params, {
        toolCallId: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        messages: [],
        abortSignal: new AbortController().signal,
      });
      const text =
        typeof result === "string" ? result : JSON.stringify(result, null, 2);
      console.log(`[${new Date().toISOString()}] ✓ ${toolName} (${text.length} chars)`);
      return { content: [{ type: "text" as const, text }] };
    } catch (error: any) {
      console.log(`[${new Date().toISOString()}] ✗ ${toolName}: ${error.message ?? String(error)}`);
      return {
        content: [{ type: "text" as const, text: `Error: ${error.message ?? String(error)}` }],
        isError: true,
      };
    }
  };

  (mcpServer as any).registerTool(
    toolName,
    { description, inputSchema: inputSchema ?? undefined },
    handler,
  );
}

// ── Static file serving ───────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
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

// ── Route matching ────────────────────────────────────────────────

function parseRoute(url: string): { path: string; query: Record<string, string> } {
  const [path, qs] = url.split("?", 2);
  const query: Record<string, string> = {};
  if (qs) {
    for (const pair of qs.split("&")) {
      const [k, v] = pair.split("=", 2);
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
    }
  }
  return { path: path ?? "/", query };
}

function matchRoute(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (p !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
  res.end(JSON.stringify(data));
}

// ── Main server ───────────────────────────────────────────────────

export async function startContainerServer(
  options: ContainerServerOptions,
): Promise<StartedContainerServer> {
  const { habitat, port = 7430, host = "0.0.0.0", extraRawHandler } = options;
  const serverName = options.name ?? habitat.getConfig().name ?? "habitat";

  // Tools for MCP
  const tools = habitat.getTools();
  const toolNames = Object.keys(tools);

  // Auth — bearer if HABITAT_API_KEY is set, otherwise open
  const apiKey = process.env.HABITAT_API_KEY;
  const auth: AuthProvider = apiKey ? bearerAuth(apiKey) : devAuth();

  // Chat bridge + adapter, with logging wrapper
  const bridge = new ChannelBridge(habitat, {
    platformInstruction: [
      "You are responding via a web interface. Markdown is rendered natively.",
      "Files in the work directory (/data) are served at /files/* URLs. For example, /data/project/output/image.png is viewable at /files/project/output/image.png.",
      "When you produce output files (images, reports, data), use the `publish_artifact` tool to publish them. This copies the file to /data/artifacts/ with metadata and returns the public URL.",
      "After publishing, include the artifact URL in your response using markdown: ![name](/files/artifacts/filename.png) or [name](/files/artifacts/filename.ext)",
      "Do NOT copy files to /files/ — that path is a virtual mount, not a real directory. Files are served directly from /data/.",
    ].join("\n"),
    buildAgentStimulus,
    runClaudeSdk: runClaudeSDK,
  });

  // Wrap bridge.handleMessage to log chat activity and track session
  const originalHandleMessage = bridge.handleMessage.bind(bridge);
  bridge.handleMessage = async (msg, events) => {
    const ts = () => new Date().toISOString();
    console.log(`[${ts()}] 💬 chat: "${msg.text.slice(0, 80)}${msg.text.length > 80 ? '...' : ''}"`);
    return originalHandleMessage(msg, {
      ...events,
      onReasoning: (delta) => {
        events.onReasoning?.(delta);
      },
      onToolCall: (name, input) => {
        // Update session ID for artifact tools (session exists by the time tools run)
        const sid = bridge.getChannelSessionId(msg.channelKey);
        if (sid) (habitat as any)._currentSessionId = sid;
        console.log(`[${ts()}] ⚡ ${name}`);
        events.onToolCall?.(name, input);
      },
      onToolResult: (name, output, isError) => {
        const marker = isError ? '✗' : '✓';
        console.log(`[${ts()}] ${marker} ${name}`);
        events.onToolResult?.(name, output, isError);
      },
      onDone: (result) => {
        const len = result.content?.length ?? 0;
        console.log(`[${ts()}] ✅ chat done (${len} chars)`);
        return events.onDone(result);
      },
      onError: (err) => {
        console.error(`[${ts()}] ❌ chat error: ${err}`);
        events.onError?.(err);
      },
    });
  };

  const webAdapter = new WebAdapter(bridge);

  // A2A handler — initialized lazily on first request (needs port for baseUrl)
  let a2aHandler: A2AHandler | null = null;
  async function getA2AHandler(actualPort: number): Promise<A2AHandler> {
    if (!a2aHandler) {
      const baseUrl = `http://${host === "0.0.0.0" ? "localhost" : host}:${actualPort}`;
      a2aHandler = await createA2AHandler({
        habitat,
        bridge,
        baseUrl,
        name: serverName,
      });
    }
    return a2aHandler;
  }

  // API routes
  const routes: RouteHandler[] = defaultRoutes();

  // Static UI directory
  const thisDir = fileURLToPath(new URL(".", import.meta.url));
  const uiDir = options.uiDir ?? resolve(thisDir, "container-ui");

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

      const { path, query } = parseRoute(req.url ?? "/");
      const reqStart = Date.now();

      // Log non-static requests
      const shouldLog = path.startsWith("/api/") || path === "/mcp" || path === "/a2a" || path === "/health";
      if (shouldLog) {
        console.log(`[${new Date().toISOString()}] ${req.method} ${path}`);
      }

      try {
        // ── Health (always open) ──────────────────────────────
        if (path === "/health") {
          const modelDetails = habitat.getDefaultModelDetails();
          sendJson(res, {
            status: "ok",
            name: serverName,
            tools: toolNames.length,
            auth: apiKey ? "bearer" : "open",
            model: modelDetails ? `${modelDetails.provider}/${modelDetails.name}` : null,
          });
          return;
        }

        // ── Extra raw handler (e.g. Gaia orchestrator routes) ──
        if (extraRawHandler) {
          const handled = await extraRawHandler(req, res);
          if (handled) return;
        }

        // ── A2A agent card (always open) ────────────────────
        if (path === "/.well-known/agent-card.json" && req.method === "GET") {
          const addr = httpServer.address();
          const actualPort = typeof addr === "object" && addr ? addr.port : port;
          const handler = await getA2AHandler(actualPort);
          sendJson(res, handler.agentCard);
          return;
        }

        // ── A2A endpoint ─────────────────────────────────────
        if (path === "/a2a" && req.method === "POST") {
          if (apiKey) {
            const user = await auth.authenticate(req);
            if (!user) { sendJson(res, { error: "Unauthorized" }, 401); return; }
          }
          const addr = httpServer.address();
          const actualPort = typeof addr === "object" && addr ? addr.port : port;
          const handler = await getA2AHandler(actualPort);
          const rawBody = await readBodyRaw(req);
          let parsedBody: unknown;
          try {
            parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
            return;
          }

          try {
            const result = await handler.transportHandler.handle(parsedBody);
            if (result && typeof (result as any)[Symbol.asyncIterator] === "function") {
              // Streaming response — SSE
              res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
              });
              const generator = result as AsyncGenerator<any>;
              for await (const event of generator) {
                res.write(`data: ${JSON.stringify(event)}\n\n`);
              }
              res.end();
            } else {
              // Single JSON-RPC response
              sendJson(res, result);
            }
          } catch (error) {
            console.error(`[container] A2A error: ${error instanceof Error ? error.message : String(error)}`);
            if (!res.headersSent) {
              sendJson(res, {
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal error" },
                id: null,
              }, 500);
            }
          }
          return;
        }

        // ── MCP endpoint ──────────────────────────────────────
        if (path === "/mcp") {
          // Auth check for MCP
          if (apiKey) {
            const user = await auth.authenticate(req);
            if (!user) {
              sendJson(res, { error: "Unauthorized" }, 401);
              return;
            }
          }

          if (req.method === "DELETE") {
            res.writeHead(200);
            res.end("Session terminated");
            return;
          }

          if (req.method !== "POST" && req.method !== "GET") {
            res.writeHead(405);
            res.end("Method not allowed");
            return;
          }

          let transport: StreamableHTTPServerTransport | null = null;
          try {
            const rawBody = await readBodyRaw(req);
            let parsedBody: unknown;
            try {
              parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
            } catch {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
              return;
            }

            const mcpServer = new McpServer({ name: serverName, version: "1.0.0" });
            for (const [name, tool] of Object.entries(tools)) {
              registerAiTool(mcpServer, name, tool);
            }

            transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            await mcpServer.connect(transport);
            await transport.handleRequest(req, res, parsedBody);
          } catch (error) {
            console.error(`[container] MCP error: ${error instanceof Error ? error.message : String(error)}`);
            if (!res.headersSent) {
              res.writeHead(500);
              res.end("Internal server error");
            }
          } finally {
            if (transport) {
              try { await transport.close(); } catch { /* ignore */ }
            }
          }
          return;
        }

        // ── File serving (sandboxed to work dir) ───────────────
        if (path.startsWith("/files/") && req.method === "GET") {
          if (apiKey) {
            const user = await auth.authenticate(req);
            if (!user) { sendJson(res, { error: "Unauthorized" }, 401); return; }
          }
          const relPath = decodeURIComponent(path.slice("/files/".length));
          if (relPath.includes("..") || relPath.startsWith("/")) {
            sendJson(res, { error: "Invalid path" }, 400);
            return;
          }
          const workDir = habitat.getWorkDir();
          const absPath = resolve(workDir, relPath);
          // Ensure the resolved path is within allowed roots
          const allowedRoots = habitat.getAllowedRoots();
          const inBounds = allowedRoots.some(root => absPath.startsWith(root));
          if (!inBounds) {
            sendJson(res, { error: "Path outside allowed roots" }, 403);
            return;
          }
          try {
            const fileStat = await stat(absPath);
            if (fileStat.isDirectory()) {
              sendJson(res, { error: "Cannot serve directories" }, 400);
              return;
            }
            const ext = extname(absPath).toLowerCase();
            const imgTypes: Record<string, string> = {
              ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
              ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
              ".bmp": "image/bmp", ".ico": "image/x-icon",
            };
            const textTypes: Record<string, string> = {
              ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
              ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
              ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
              ".csv": "text/csv; charset=utf-8", ".xml": "text/xml; charset=utf-8",
              ".yaml": "text/yaml; charset=utf-8", ".yml": "text/yaml; charset=utf-8",
              ".toml": "text/plain; charset=utf-8", ".log": "text/plain; charset=utf-8",
              ".ts": "text/plain; charset=utf-8", ".py": "text/plain; charset=utf-8",
            };
            const contentType = imgTypes[ext] ?? textTypes[ext] ?? "application/octet-stream";
            const body = await readFile(absPath);
            res.writeHead(200, {
              "Content-Type": contentType,
              "Content-Length": body.length,
              "Cache-Control": "no-cache",
            });
            res.end(body);
          } catch (err: any) {
            if (err.code === "ENOENT") sendJson(res, { error: "File not found" }, 404);
            else sendJson(res, { error: err.message }, 500);
          }
          return;
        }

        // ── API routes (auth required if key set) ─────────────
        if (path.startsWith("/api/")) {
          let user: UserContext | null = null;

          // GET /api/status — full container status (model, provisioning, secrets)
          if (path === "/api/status" && req.method === "GET") {
            const config = habitat.getConfig();
            const modelDetails = habitat.getDefaultModelDetails();
            const projectDir = resolveProjectDir(habitat.getWorkDir(), config);
            const projectCloned = await fileExists(join(projectDir, ".git"));
            sendJson(res, {
              name: config.name ?? "Unnamed Habitat",
              model: modelDetails ? { provider: modelDetails.provider, name: modelDetails.name } : null,
              provisioning: {
                gitUrl: config.gitUrl ?? null,
                projectCloned,
                projectDir: config.projectDir ?? "project",
              },
              tools: toolNames.length,
              requiredSecrets: (config.requiredSecrets ?? []).map(s => ({
                name: s.name,
                description: s.description,
                required: s.required,
                set: !!(habitat.getSecret(s.name)),
              })),
            });
            return;
          }

          // GET /api/settings — full config, dependencies, env vars
          if (path === "/api/settings" && req.method === "GET") {
            const config = habitat.getConfig();
            const workDir = habitat.getWorkDir();
            const projectDir = resolveProjectDir(workDir, config);

            // Read mise.toml from project dir
            let deps = "";
            try {
              deps = await readFile(join(projectDir, "mise.toml"), "utf-8");
            } catch {
              try {
                deps = await readFile(join(workDir, "mise.toml"), "utf-8");
              } catch {
                // no mise.toml
              }
            }

            // Known env var names for providers + common services
            const knownEnvVars = [
              "GOOGLE_GENERATIVE_AI_API_KEY",
              "OPENROUTER_API_KEY",
              "ANTHROPIC_API_KEY",
              "DEEPINFRA_API_KEY",
              "TOGETHER_API_KEY",
              "GITHUB_TOKEN",
              "TAVILY_API_KEY",
              "MARKIFY_URL",
              "OLLAMA_HOST",
              "HABITAT_API_KEY",
              "HABITAT_PROVIDER",
              "HABITAT_MODEL",
            ];
            // Also include any required secrets from config
            for (const s of config.requiredSecrets ?? []) {
              if (!knownEnvVars.includes(s.name)) knownEnvVars.push(s.name);
            }

            const envVars = knownEnvVars.map(name => ({
              name,
              set: !!(process.env[name] || habitat.getSecret(name)),
            }));

            sendJson(res, { config, deps, envVars });
            return;
          }

          // GET /api/artifacts — list published artifacts
          if (path === "/api/artifacts" && req.method === "GET") {
            const metas = await listArtifacts(habitat.getWorkDir());
            sendJson(res, { artifacts: metas, count: metas.length });
            return;
          }

          // POST /api/inference — attach an inference engine
          if (path === "/api/inference" && req.method === "POST") {
            if (apiKey) {
              user = await auth.authenticate(req);
              if (!user) { sendJson(res, { error: "Unauthorized" }, 401); return; }
            }
            const body = JSON.parse(await readBodyRaw(req));
            const provider = typeof body.provider === "string" ? body.provider.trim() : "";
            const model = typeof body.model === "string" ? body.model.trim() : "";
            if (!provider || !model) {
              sendJson(res, { error: "provider and model are required" }, 400);
              return;
            }
            // Save to config
            const config = habitat.getConfig();
            config.defaultProvider = provider;
            config.defaultModel = model;
            await saveConfig(habitat.configPath, config);
            await habitat.reloadConfig();
            habitat.setRuntimeModelDetails({ provider, name: model });
            // If an API key was provided, save it as a secret
            const apiKeyValue = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
            if (apiKeyValue) {
              // Determine the env var name for this provider
              const keyNames: Record<string, string> = {
                google: "GOOGLE_GENERATIVE_AI_API_KEY",
                openrouter: "OPENROUTER_API_KEY",
                anthropic: "ANTHROPIC_API_KEY",
                deepinfra: "DEEPINFRA_API_KEY",
                togetherai: "TOGETHER_API_KEY",
                github: "GITHUB_TOKEN",
              };
              const envName = keyNames[provider] ?? `${provider.toUpperCase()}_API_KEY`;
              await habitat.setSecret(envName, apiKeyValue);
            }
            sendJson(res, {
              success: true,
              provider,
              model,
              message: `Inference attached: ${provider}/${model}`,
            });
            return;
          }

          // POST /api/chat
          if (path === "/api/chat" && req.method === "POST") {
            if (apiKey) {
              user = await auth.authenticate(req);
              if (!user) {
                sendJson(res, { error: "Unauthorized" }, 401);
                return;
              }
            }
            // Guard: no model configured
            if (!habitat.getDefaultModelDetails()) {
              sendJson(res, {
                error: "No inference engine configured. Use the dashboard to attach a provider and model.",
              }, 503);
              return;
            }
            return await webAdapter.handleChat(
              req,
              res,
              user ?? { userId: "container", provider: "dev" },
            );
          }

          // Registered routes
          for (const route of routes) {
            if (route.method !== req.method) continue;
            const params = matchRoute(route.path, path);
            if (!params) continue;

            if (!route.skipAuth && apiKey) {
              user = await auth.authenticate(req);
              if (!user) {
                sendJson(res, { error: "Unauthorized" }, 401);
                return;
              }
            }

            const ctx: RouteContext = {
              habitat,
              bridge,
              user: user ?? { userId: "container", provider: "dev" },
              req,
              res,
              path,
              query,
            };
            return await route.handle(ctx, params);
          }

          sendJson(res, { error: "Not found", path }, 404);
          return;
        }

        // ── Static UI (always open) ───────────────────────────
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
        console.error("[container]", message);
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

      console.log(`[container] ${serverName} at http://${host}:${assignedPort}`);
      console.log(`[container]   /mcp         — MCP tools (${toolNames.length})`);
      console.log(`[container]   /a2a         — A2A agent endpoint`);
      console.log(`[container]   /api/chat    — LLM chat`);
      console.log(`[container]   /            — Web UI`);
      console.log(`[container]   /health      — Health check`);
      if (apiKey) {
        console.log(`[container]   Auth: Bearer token required for /api/* and /mcp`);
      } else {
        console.log(`[container]   Auth: open (set HABITAT_API_KEY to enable bearer auth)`);
      }

      resolvePromise({
        port: assignedPort,
        close: () => httpServer.close(),
      });
    });
  });
}

function readBodyRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
