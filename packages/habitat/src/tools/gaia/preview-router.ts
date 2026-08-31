import http, {
  createServer,
  type IncomingMessage,
  type RequestOptions,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { DEFAULT_PREVIEW_DOMAIN, resolvePreviewHostname } from "./preview-address.js";
import type { GaiaHabitatEntry, GaiaRegistry } from "./types.js";

const NO_INDEX = "noindex, nofollow, noarchive";

export interface PreviewRouterContext {
  entries(): Promise<readonly GaiaHabitatEntry[]>;
  domain: string;
  targetHost(entry: GaiaHabitatEntry): string;
  wake(entry: GaiaHabitatEntry): Promise<{ ok: boolean; detail?: string }>;
  activity(entry: GaiaHabitatEntry, worktreeId: string): Promise<void>;
}

export interface PreviewRouterOptions {
  context: PreviewRouterContext;
  port?: number;
  host?: string;
}

function hostname(req: IncomingMessage): string {
  return (req.headers.host ?? "").split(":", 1)[0];
}

function noIndex(res: ServerResponse): void {
  res.setHeader("X-Robots-Tag", NO_INDEX);
  res.setHeader("Cache-Control", "no-store");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function html(res: ServerResponse, status: number, title: string, body: string): void {
  noIndex(res);
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta name="robots" content="${NO_INDEX}"><title>${escapeHtml(title)}</title><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main>`);
}

function dormantPage(res: ServerResponse): void {
  noIndex(res);
  res.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Retry-After": "3" });
  res.end(`<!doctype html><meta name="robots" content="${NO_INDEX}"><title>Preview is waking</title><main><h1>This preview is asleep</h1><p>Waking its Habitat…</p></main><script>fetch('/__preview/wake',{method:'POST'}).then(()=>setTimeout(()=>location.reload(),1500))</script>`);
}

function upstreamOptions(
  ctx: PreviewRouterContext,
  entry: GaiaHabitatEntry,
  port: number,
  req: IncomingMessage,
): RequestOptions {
  return {
    hostname: ctx.targetHost(entry),
    port,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      "x-forwarded-host": req.headers.host,
      "x-forwarded-proto": "https",
    },
  };
}

async function routeRequest(
  ctx: PreviewRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  noIndex(res);
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"status":"ok"}');
    return;
  }
  if (req.url === "/robots.txt") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("User-agent: *\nDisallow: /\n");
    return;
  }

  const resolution = resolvePreviewHostname(hostname(req), await ctx.entries(), ctx.domain);
  if (resolution.kind === "unknown") {
    html(res, 404, "Unknown preview", "This preview address is not registered.");
    return;
  }
  if (resolution.kind === "stale") {
    html(res, 410, "Stale preview link", "This project has moved on from that branch or service.");
    return;
  }
  if (req.url === "/__preview/wake" && req.method === "POST") {
    if (!resolution.dormant) {
      res.writeHead(204);
      res.end();
      return;
    }
    const outcome = await ctx.wake(resolution.entry);
    res.writeHead(outcome.ok ? 202 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify(outcome));
    return;
  }
  if (resolution.dormant) {
    dormantPage(res);
    return;
  }
  void ctx.activity(resolution.entry, resolution.preview.worktreeId).catch(() => {});
  if (resolution.preview.status === "stopped") {
    noIndex(res);
    res.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Retry-After": "2" });
    res.end(`<!doctype html><meta name="robots" content="${NO_INDEX}"><title>Preview is restarting</title><main><h1>Preview is restarting</h1></main><script>setTimeout(()=>location.reload(),1500)</script>`);
    return;
  }
  if (resolution.preview.status === "failing") {
    html(res, 502, "Preview service failed", resolution.preview.error ?? "The project service is not running.");
    return;
  }

  await new Promise<void>((resolve) => {
    const upstream = http.request(
      upstreamOptions(ctx, resolution.entry, resolution.preview.port, req),
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, {
          ...upstreamRes.headers,
          "x-robots-tag": NO_INDEX,
        });
        upstreamRes.pipe(res);
        upstreamRes.on("end", resolve);
      },
    );
    upstream.on("error", (error) => {
      if (!res.headersSent) html(res, 502, "Preview unavailable", error.message);
      else res.destroy(error);
      resolve();
    });
    req.pipe(upstream);
  });
}

async function routeUpgrade(
  ctx: PreviewRouterContext,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<void> {
  const resolution = resolvePreviewHostname(hostname(req), await ctx.entries(), ctx.domain);
  if (
    resolution.kind !== "target" ||
    resolution.dormant ||
    resolution.preview.status === "failing" ||
    resolution.preview.status === "stopped"
  ) {
    socket.end("HTTP/1.1 503 Service Unavailable\r\nX-Robots-Tag: noindex\r\nConnection: close\r\n\r\n");
    return;
  }
  void ctx.activity(resolution.entry, resolution.preview.worktreeId).catch(() => {});
  const upstream = http.request(
    upstreamOptions(ctx, resolution.entry, resolution.preview.port, req),
  );
  upstream.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    socket.write(
      `HTTP/1.1 ${upstreamRes.statusCode ?? 101} Switching Protocols\r\nX-Robots-Tag: ${NO_INDEX}\r\n${Object.entries(upstreamRes.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\r\n")}\r\n\r\n`,
    );
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
}

export function createPreviewRouter(options: PreviewRouterOptions): Server {
  const server = createServer((req, res) => {
    void routeRequest(options.context, req, res).catch((error) => {
      if (!res.headersSent) html(res, 500, "Preview router error", error instanceof Error ? error.message : String(error));
      else res.destroy(error instanceof Error ? error : undefined);
    });
  });
  server.on("upgrade", (req, socket, head) => {
    void routeUpgrade(options.context, req, socket, head).catch(() => socket.destroy());
  });
  return server;
}

export function registryFileEntries(dataDir: string): () => Promise<readonly GaiaHabitatEntry[]> {
  let cached: readonly GaiaHabitatEntry[] | undefined;
  return async () => {
    try {
      const registry = JSON.parse(await readFile(join(dataDir, "registry.json"), "utf8")) as GaiaRegistry;
      cached = registry.habitats;
      return cached;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  };
}

export async function startPreviewRouter(options: {
  dataDir: string;
  gaiaUrl: string;
  wakeKey: string;
  activityKey: string;
  domain?: string;
  port?: number;
  host?: string;
}): Promise<{ server: Server; port: number }> {
  const gaiaUrl = options.gaiaUrl.replace(/\/$/, "");
  const call = async (path: string, key: string, body: unknown) => {
    const response = await fetch(`${gaiaUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, detail: response.ok ? undefined : await response.text() };
  };
  const context: PreviewRouterContext = {
    entries: registryFileEntries(options.dataDir),
    domain: options.domain ?? DEFAULT_PREVIEW_DOMAIN,
    targetHost: (entry) => `gaia-${entry.id}`,
    wake: (entry) => call("/internal/preview/wake", options.wakeKey, { id: entry.id }),
    activity: async (entry, worktreeId) => {
      await call("/internal/preview/activity", options.activityKey, { id: entry.id, worktreeId });
    },
  };
  const server = createPreviewRouter({ context });
  const port = options.port ?? 7431;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, options.host ?? "0.0.0.0", () => resolve());
  });
  return { server, port };
}
