/**
 * The fleet panel, end to end (#408): an orchestrator host whose shell
 * carries the habitats panel (as a host-contributed entry), managing TWO
 * real child hosts on their own origins. Chromium asserts the panel lists
 * the fleet from list_habitats, mounts BOTH children's status components
 * simultaneously as foreign sub-components (isolated by origin), and
 * reconciles a stop: the stopped child's card leaves the page.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright-core";
import { createShellHandler } from "./serve-shell.js";

interface Child {
  server: Server;
  url: string;
  name: string;
}

let children: Child[] = [];
let orchestrator: Server;
let orchestratorUrl: string;
let browser: Browser;
/** Mutable fleet state the stub list_habitats reports. */
let fleet: Array<Record<string, unknown>>;
let toolCalls: Array<[string, Record<string, unknown>]>;

async function startChild(name: string): Promise<Child> {
  const shell = createShellHandler();
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Accept",
    );
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url?.startsWith("/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ status: "ok", name, tools: 1, auth: "open", model: "m" }),
      );
      return;
    }
    if (req.url?.startsWith("/mcp") && req.method === "POST") {
      // Stateless resources/read answering the status projection.
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const rpc = JSON.parse(raw) as { id: number; method: string };
      const url = `${childUrl(server)}/shell/solo/status/`;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            contents: [
              { uri: "ui://shell/status", mimeType: "text/uri-list", text: url },
            ],
          },
        }),
      );
      return;
    }
    if (await shell(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: childUrl(server), name };
}

function childUrl(server: Server): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  children = [await startChild("child-one"), await startChild("child-two")];
  fleet = children.map((c, i) => ({
    id: `child-${i + 1}`,
    name: c.name,
    status: "running",
    model: "test/model",
    url: `${c.url}/shell/`,
  }));
  toolCalls = [];

  const shell = createShellHandler({
    entries: [
      // Providers the panel and its foreign mounts need, plus the panel.
      { id: "tools", url: "./components/tools.js", provides: true },
      { id: "habitats", url: "./components/habitats.js" },
    ],
  });
  orchestrator = createServer(async (req, res) => {
    if (req.url?.startsWith("/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name: "orchestrator" }));
      return;
    }
    if (req.url?.startsWith("/mcp") && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const rpc = JSON.parse(raw) as {
        id: number;
        params: { name: string; arguments?: Record<string, unknown> };
      };
      const args = rpc.params.arguments ?? {};
      toolCalls.push([rpc.params.name, args]);
      if (rpc.params.name === "stop_habitat") {
        const target = fleet.find((h) => h.id === args.id);
        if (target) target.status = "stopped";
      }
      const text =
        rpc.params.name === "list_habitats"
          ? JSON.stringify(fleet)
          : JSON.stringify({ ok: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: { content: [{ type: "text", text }] },
        }),
      );
      return;
    }
    if (await shell(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => orchestrator.listen(0, "127.0.0.1", r));
  orchestratorUrl = `http://127.0.0.1:${(orchestrator.address() as AddressInfo).port}`;

  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => orchestrator?.close(r));
  for (const c of children) await new Promise((r) => c.server.close(r));
});

describe("the fleet, assembled", () => {
  it("lists the fleet, mounts both children's status simultaneously, and reconciles a stop", async () => {
    const page = await browser.newPage();
    await page.goto(`${orchestratorUrl}/shell/`);

    // The fleet list, from list_habitats.
    const panel = page.locator('[data-component="habitats"]');
    await panel.waitFor({ state: "visible", timeout: 10_000 });
    await expect
      .poll(() => panel.textContent(), { timeout: 10_000 })
      .toContain("child-one");
    expect(await panel.textContent()).toContain("child-two");

    // Both children mounted as foreign components at once — two iframes,
    // each on its own child origin, each rendering that child's live data.
    const foreign = page.locator('[data-component="foreign"]');
    await expect.poll(() => foreign.count(), { timeout: 15_000 }).toBe(2);
    for (let i = 0; i < 2; i++) {
      const inner = page.frameLocator(
        `[data-component="foreign"] >> nth=${i} >> iframe`,
      );
      await expect
        .poll(() => inner.locator("habitat-status").textContent(), {
          timeout: 15_000,
        })
        .toContain(`child-${i === 0 ? "one" : "two"}`);
    }

    // Stop child-two: the panel refreshes, the mount reconciles away.
    await panel.locator('[data-action="stop"][data-id="child-2"]').click();
    await expect.poll(() => foreign.count(), { timeout: 15_000 }).toBe(1);
    expect(toolCalls.map(([n]) => n)).toContain("stop_habitat");
    expect(await panel.textContent()).toContain("stopped");

    await page.close();
  }, 60_000);
});
