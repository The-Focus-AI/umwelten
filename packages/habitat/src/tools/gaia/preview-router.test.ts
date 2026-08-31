import { createServer, request, type Server } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewRouter, type PreviewRouterContext } from "./preview-router.js";
import { previewHostname } from "./preview-address.js";
import type { GaiaHabitatEntry } from "./types.js";

const domain = "preview.test";
const openServers: Server[] = [];

function entry(port: number, overrides: Partial<GaiaHabitatEntry> = {}): GaiaHabitatEntry {
  return {
    id: "demo",
    name: "Demo",
    config: {},
    secretBindings: [],
    apiKey: "child",
    previewSuffix: "abc123",
    containerPort: 7440,
    publishedPreviews: [
      { worktreeId: "primary", branch: "main", port, ordinal: 1, status: "serving" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as GaiaHabitatEntry;
}

async function listen(server: Server): Promise<number> {
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

function context(habitat: GaiaHabitatEntry): PreviewRouterContext & {
  wake: ReturnType<typeof vi.fn>;
  activity: ReturnType<typeof vi.fn>;
} {
  return {
    entries: async () => [habitat],
    domain,
    targetHost: () => "127.0.0.1",
    wake: vi.fn(async () => ({ ok: true })),
    activity: vi.fn(async () => {}),
  };
}

function get(port: number, host: string, path = "/") {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

describe("preview router state machine", () => {
  it("distinguishes unknown, stale, dormant, and failed previews and forbids indexing", async () => {
    const habitat = entry(3000, { containerPort: undefined });
    const ctx = context(habitat);
    const port = await listen(createPreviewRouter({ context: ctx }));
    const known = previewHostname(habitat, habitat.publishedPreviews![0], domain);

    const unknown = await get(port, `other.${domain}`);
    const stale = await get(port, `demo-old-1-${habitat.previewSuffix}.${domain}`);
    const dormant = await get(port, known);
    expect([unknown.status, stale.status, dormant.status]).toEqual([404, 410, 503]);
    expect(unknown.body).toContain("Unknown preview");
    expect(stale.body).toContain("Stale preview link");
    expect(dormant.body).toContain("fetch('/__preview/wake'");
    expect(ctx.wake).not.toHaveBeenCalled();
    expect(dormant.headers["x-robots-tag"]).toContain("noindex");

    habitat.containerPort = 7440;
    habitat.publishedPreviews![0].status = "failing";
    habitat.publishedPreviews![0].error = "mise dev exited";
    const failed = await get(port, known);
    expect(failed.status).toBe(502);
    expect(failed.body).toContain("mise dev exited");
  });

  it("only wakes when browser JavaScript posts to the known dormant host", async () => {
    const habitat = entry(3000, { containerPort: undefined });
    const ctx = context(habitat);
    const port = await listen(createPreviewRouter({ context: ctx }));
    const known = previewHostname(habitat, habitat.publishedPreviews![0], domain);

    await get(port, known);
    expect(ctx.wake).not.toHaveBeenCalled();
    await new Promise<void>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path: "/__preview/wake", method: "POST", headers: { host: known } }, (res) => {
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", reject);
      req.end();
    });
    expect(ctx.wake).toHaveBeenCalledOnce();
  });
});

describe("preview router proxying", () => {
  it("streams the first response chunk before the upstream response completes", async () => {
    const upstream = createServer((_req, res) => {
      res.write("first");
      setTimeout(() => res.end("second"), 100);
    });
    const upstreamPort = await listen(upstream);
    const habitat = entry(upstreamPort);
    const ctx = context(habitat);
    const routerPort = await listen(createPreviewRouter({ context: ctx }));
    const known = previewHostname(habitat, habitat.publishedPreviews![0], domain);

    const first = await new Promise<string>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port: routerPort, headers: { host: known } }, (res) => {
        res.once("data", (chunk) => {
          resolve(String(chunk));
          res.destroy();
        });
      });
      req.on("error", reject);
      req.end();
    });
    expect(first).toBe("first");
    expect(ctx.activity).toHaveBeenCalledWith(habitat, "primary");
  });

  it("keeps an upgraded connection bidirectional", async () => {
    const upstream = createServer();
    let upstreamSocket: import("node:stream").Duplex | undefined;
    upstream.on("upgrade", (_req, socket) => {
      upstreamSocket = socket;
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
      socket.on("data", (chunk) => socket.write(chunk));
    });
    const upstreamPort = await listen(upstream);
    const habitat = entry(upstreamPort);
    const ctx = context(habitat);
    const routerPort = await listen(createPreviewRouter({ context: ctx }));
    const known = previewHostname(habitat, habitat.publishedPreviews![0], domain);

    const socket = connect(routerPort, "127.0.0.1");
    const received: Buffer[] = [];
    socket.on("data", (chunk) => received.push(chunk));
    socket.write(`GET /live HTTP/1.1\r\nHost: ${known}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
    await new Promise((resolve) => setTimeout(resolve, 30));
    socket.write("live-reload");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(Buffer.concat(received).toString()).toContain("live-reload");
    socket.destroy();
    upstreamSocket?.destroy();
  });
});
