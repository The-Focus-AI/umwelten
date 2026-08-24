/**
 * The foreign mount, end to end (#407, ADR 0033): TWO bare hosts on
 * different origins. Host A serves its shell + /mcp resources; host B's
 * manifest mounts A's status component through the foreign-mount host.
 * Real chromium asserts: A's component renders inside B's page, inside an
 * iframe, on A's origin, with A's data — and B can reach nothing of A's
 * DOM, nor A anything of B's.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { chromium, type Browser } from "playwright-core";
import {
  createShellHandler,
  listShellComponents,
  registerShellResources,
} from "./serve-shell.js";

let hostA: Server;
let hostB: Server;
let aUrl: string;
let bUrl: string;
let browser: Browser;

beforeAll(async () => {
  // Host A: a full habitat surface — shell, /health, /mcp with resources.
  const shellA = createShellHandler();
  hostA = createServer(async (req, res) => {
    // Mirror the container-server's CORS posture — a peer's shell fetches
    // /mcp cross-origin, and the real server answers with open CORS.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url?.startsWith("/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          name: "host-a",
          tools: 3,
          auth: "open",
          model: "test/model-a",
        }),
      );
      return;
    }
    if (req.url?.startsWith("/mcp") && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const mcp = new McpServer({ name: "host-a", version: "1.0.0" });
      registerShellResources(
        mcp,
        await listShellComponents(),
        aUrl,
        "host-a",
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
      return;
    }
    if (await shellA(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => hostA.listen(0, "127.0.0.1", r));
  aUrl = `http://127.0.0.1:${(hostA.address() as AddressInfo).port}`;

  // Host B: a shell whose only entry is the foreign mount of A's status.
  const shellB = createShellHandler({
    entries: [
      {
        id: "peer-status",
        url: "./components/foreign.js",
        config: {
          title: "host-a status",
          mcp: `${aUrl}/mcp`,
          resource: "ui://shell/status",
        },
      },
    ],
  });
  hostB = createServer(async (req, res) => {
    if (req.url?.startsWith("/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name: "host-b" }));
      return;
    }
    if (await shellB(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => hostB.listen(0, "127.0.0.1", r));
  bUrl = `http://127.0.0.1:${(hostB.address() as AddressInfo).port}`;

  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => hostA?.close(r));
  await new Promise((r) => hostB?.close(r));
});

describe("a peer's component in this shell", () => {
  it("renders host A's live status inside host B's page, inside an iframe on A's origin", async () => {
    const page = await browser.newPage();
    await page.goto(`${bUrl}/shell/`);

    const card = page.locator('[data-component="foreign"]');
    await card.waitFor({ state: "visible", timeout: 10_000 });

    // The iframe points at A's solo page — A's origin, not B's.
    const iframe = card.locator("iframe");
    await iframe.waitFor({ state: "visible", timeout: 10_000 });
    expect(await iframe.getAttribute("src")).toBe(
      `${aUrl}/shell/solo/status/`,
    );

    // Inside the boundary: A's component, rendering A's live data.
    const inner = page.frameLocator('[data-component="foreign"] iframe');
    await inner.locator("habitat-status").waitFor({ timeout: 15_000 });
    await expect
      .poll(() => inner.locator("habitat-status").textContent(), {
        timeout: 15_000,
      })
      .toContain("host-a");

    // The beacon reached the host card, filtered by source.
    await expect
      .poll(() => card.locator(".note").textContent(), { timeout: 15_000 })
      .toContain("mounted from 127.0.0.1");
    await page.close();
  }, 45_000);

  it("the boundary holds: B cannot reach into A's document, and B's substrate carries nothing of A", async () => {
    const page = await browser.newPage();
    await page.goto(`${bUrl}/shell/`);
    const iframe = page.locator('[data-component="foreign"] iframe');
    await iframe.waitFor({ state: "visible", timeout: 10_000 });

    const probe = await page.evaluate(() => {
      const frame = document.querySelector(
        '[data-component="foreign"] iframe',
      ) as HTMLIFrameElement;
      let domAccess: string;
      try {
        domAccess = frame.contentDocument ? "REACHABLE" : "blocked";
      } catch {
        domAccess = "blocked";
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = (window as any).__shell.loader
        .entries()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((e: any) => e.id);
      return { domAccess, entries };
    });

    expect(probe.domAccess).toBe("blocked"); // cross-origin: structural, not policy
    expect(probe.entries).toEqual(["peer-status"]); // nothing of A leaked into B's tree
    await page.close();
  }, 45_000);

  it("unmounting the foreign host removes the iframe and its listener", async () => {
    const page = await browser.newPage();
    await page.goto(`${bUrl}/shell/`);
    await page
      .locator('[data-component="foreign"] iframe')
      .waitFor({ state: "visible", timeout: 10_000 });

    await page.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__shell.loader.apply([]),
    );
    await expect
      .poll(() => page.locator('[data-component="foreign"]').count())
      .toBe(0);
    expect(await page.locator("iframe").count()).toBe(0);
    await page.close();
  }, 45_000);
});
