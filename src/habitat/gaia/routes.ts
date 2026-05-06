/**
 * Gaia API route handlers.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { GaiaRegistryManager } from "./registry.js";
import type { GaiaSecretVault } from "./secrets.js";
import type { DockerManager } from "./docker.js";
import { proxyRequest } from "./proxy.js";
import { buildSeedFiles } from "./gaia-tools.js";

export interface GaiaRouteContext {
  registry: GaiaRegistryManager;
  vault: GaiaSecretVault;
  docker: DockerManager;
}

interface RouteMatch {
  params: Record<string, string>;
  query: Record<string, string>;
}

function parseUrl(url: string): { path: string; query: Record<string, string> } {
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

function matchRoute(pattern: string, path: string): Record<string, string> | null {
  // Handle wildcard patterns like /api/habitats/:id/files/*
  const hasWildcard = pattern.endsWith("/*");
  const cleanPattern = hasWildcard ? pattern.slice(0, -2) : pattern;

  const patternParts = cleanPattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);

  if (!hasWildcard && patternParts.length !== pathParts.length) return null;
  if (hasWildcard && pathParts.length < patternParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (p !== pathParts[i]) {
      return null;
    }
  }

  if (hasWildcard) {
    params["*"] = pathParts.slice(patternParts.length).join("/");
  }

  return params;
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

/**
 * Handle Gaia API routes. Returns true if the route was handled.
 */
export async function handleGaiaRoute(
  ctx: GaiaRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const { path, query } = parseUrl(req.url ?? "/");
  const method = req.method ?? "GET";

  // ── Registry routes ──────────────────────────────────────────

  // GET /api/habitats — list all habitats with status
  if (path === "/api/habitats" && method === "GET") {
    const entries = ctx.registry.list();
    const results = await Promise.all(
      entries.map(async (entry) => {
        const status = await ctx.docker.getStatus(entry.id);
        return { ...entry, apiKey: undefined, containerStatus: status };
      }),
    );
    sendJson(res, { habitats: results });
    return true;
  }

  // POST /api/habitats — create new habitat
  if (path === "/api/habitats" && method === "POST") {
    const body = JSON.parse(await readBody(req));
    try {
      const entry = await ctx.registry.create(body);
      // Seed the Docker volume with config + secrets
      await ctx.docker.seedVolume(entry.id, buildSeedFiles(entry, ctx.vault));
      sendJson(res, entry, 201);
    } catch (err: any) {
      sendJson(res, { error: err.message }, 400);
    }
    return true;
  }

  // GET /api/habitats/:id
  let params = matchRoute("/api/habitats/:id", path);
  if (params && method === "GET") {
    const entry = ctx.registry.get(params.id);
    if (!entry) { sendJson(res, { error: "Not found" }, 404); return true; }
    const status = await ctx.docker.getStatus(entry.id);
    sendJson(res, { ...entry, apiKey: undefined, containerStatus: status });
    return true;
  }

  // PUT /api/habitats/:id
  params = matchRoute("/api/habitats/:id", path);
  if (params && method === "PUT") {
    const body = JSON.parse(await readBody(req));
    try {
      const entry = await ctx.registry.update(params.id, body);
      sendJson(res, entry);
    } catch (err: any) {
      sendJson(res, { error: err.message }, 400);
    }
    return true;
  }

  // DELETE /api/habitats/:id
  params = matchRoute("/api/habitats/:id", path);
  if (params && method === "DELETE") {
    await ctx.docker.stopContainer(params.id).catch(() => {});
    const removed = await ctx.registry.remove(params.id);
    if (!removed) { sendJson(res, { error: "Not found" }, 404); return true; }
    sendJson(res, { removed: true, id: params.id });
    return true;
  }

  // ── Docker lifecycle ─────────────────────────────────────────

  // POST /api/habitats/:id/start
  params = matchRoute("/api/habitats/:id/start", path);
  if (params && method === "POST") {
    const entry = ctx.registry.get(params.id);
    if (!entry) { sendJson(res, { error: "Not found" }, 404); return true; }
    try {
      await ctx.docker.seedVolume(entry.id, buildSeedFiles(entry, ctx.vault));
      const port = await ctx.docker.startContainer(entry, "", ctx.registry.list());
      await ctx.registry.update(params.id, { containerPort: port });
      sendJson(res, { started: true, port });
    } catch (err: any) {
      sendJson(res, { error: err.message }, 500);
    }
    return true;
  }

  // POST /api/habitats/:id/stop
  params = matchRoute("/api/habitats/:id/stop", path);
  if (params && method === "POST") {
    const entry = ctx.registry.get(params.id);
    if (!entry) { sendJson(res, { error: "Not found" }, 404); return true; }
    await ctx.docker.stopContainer(params.id);
    await ctx.registry.update(params.id, { containerPort: undefined });
    sendJson(res, { stopped: true });
    return true;
  }

  // POST /api/habitats/:id/rebuild
  params = matchRoute("/api/habitats/:id/rebuild", path);
  if (params && method === "POST") {
    const entry = ctx.registry.get(params.id);
    if (!entry) { sendJson(res, { error: "Not found" }, 404); return true; }
    await ctx.docker.stopContainer(params.id).catch(() => {});
    await ctx.docker.seedVolume(entry.id, buildSeedFiles(entry, ctx.vault));
    const port = await ctx.docker.startContainer(entry, "", ctx.registry.list());
    await ctx.registry.update(params.id, { containerPort: port });
    sendJson(res, { rebuilt: true, port });
    return true;
  }

  // GET /api/habitats/:id/logs
  params = matchRoute("/api/habitats/:id/logs", path);
  if (params && method === "GET") {
    const tail = parseInt(query.tail ?? "100", 10);
    const logs = await ctx.docker.getLogs(params.id, tail);
    sendJson(res, { logs });
    return true;
  }

  // ── Proxy to running containers ──────────────────────────────

  // Map /api/habitats/:id/<target> → /<targetPath> on container
  const proxyRoutes: Array<{ pattern: string; target: string }> = [
    { pattern: "/api/habitats/:id/health", target: "/health" },
    { pattern: "/api/habitats/:id/chat", target: "/api/chat" },
    { pattern: "/api/habitats/:id/mcp", target: "/mcp" },
    { pattern: "/api/habitats/:id/a2a", target: "/a2a" },
    { pattern: "/api/habitats/:id/agent-card", target: "/.well-known/agent-card.json" },
    { pattern: "/api/habitats/:id/status", target: "/api/status" },
    { pattern: "/api/habitats/:id/sessions", target: "/api/sessions" },
    { pattern: "/api/habitats/:id/artifacts", target: "/api/artifacts" },
    { pattern: "/api/habitats/:id/files/*", target: "/files/" },
  ];

  for (const route of proxyRoutes) {
    params = matchRoute(route.pattern, path);
    if (params) {
      const entry = ctx.registry.get(params.id);
      if (!entry) { sendJson(res, { error: "Not found" }, 404); return true; }
      const targetPath = route.target === "/files/"
        ? `/files/${params["*"] ?? ""}`
        : route.target;
      await proxyRequest(entry, targetPath, req, res);
      return true;
    }
  }

  // ── Master secrets ───────────────────────────────────────────

  // GET /api/secrets
  if (path === "/api/secrets" && method === "GET") {
    const names = ctx.vault.listNames();
    const entries = ctx.registry.list();
    const secretUsage = names.map((name) => ({
      name,
      usedBy: entries
        .filter((e) => e.secretBindings.includes(name))
        .map((e) => e.id),
    }));
    sendJson(res, { secrets: secretUsage });
    return true;
  }

  // POST /api/secrets
  if (path === "/api/secrets" && method === "POST") {
    const body = JSON.parse(await readBody(req));
    if (!body.name || !body.value) {
      sendJson(res, { error: "name and value required" }, 400);
      return true;
    }
    await ctx.vault.set(body.name, body.value);
    sendJson(res, { set: true, name: body.name });
    return true;
  }

  // DELETE /api/secrets/:name
  params = matchRoute("/api/secrets/:name", path);
  if (params && method === "DELETE") {
    const removed = await ctx.vault.remove(params.name);
    sendJson(res, { removed, name: params.name });
    return true;
  }

  // ── Docker image ─────────────────────────────────────────────

  // POST /api/docker/build
  if (path === "/api/docker/build" && method === "POST") {
    try {
      const output = await ctx.docker.buildImage();
      sendJson(res, { success: true, output: output.slice(-2000) });
    } catch (err: any) {
      sendJson(res, { error: err.message }, 500);
    }
    return true;
  }

  // GET /api/docker/status
  if (path === "/api/docker/status" && method === "GET") {
    const available = await ctx.docker.isDockerAvailable();
    const imageExists = available ? await ctx.docker.imageExists() : false;
    sendJson(res, { dockerAvailable: available, imageExists });
    return true;
  }

  return false;
}
