/**
 * The stock layout, in a real browser (ADR 0034, #423): the shell boots
 * into the rail arrangement — status and quick-prompts in the rail, the
 * admin cluster (secrets, sessions) at its bottom, chat in main; the
 * collapse toggle works and persists per viewer; a custom component lands
 * in main untouched; an agent-authored layout replaces the stock one and
 * removing it brings the stock rail back.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { createShellHandler } from "./serve-shell.js";

let server: Server;
let baseUrl: string;
let browser: Browser;
let customDir: string;

beforeAll(async () => {
  customDir = await mkdtemp(join(tmpdir(), "shell-layout-int-"));
  const shell = createShellHandler({ customComponentsDir: customDir });
  server = createServer(async (req, res) => {
    if (req.url?.startsWith("/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ status: "ok", name: "layout-host", tools: 0, auth: "open" }),
      );
      return;
    }
    if (req.url?.startsWith("/mcp") && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const rpc = JSON.parse(raw) as { id: number };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: { content: [{ type: "text", text: JSON.stringify({ secrets: [], sessions: [] }) }] },
        }),
      );
      return;
    }
    if (await shell(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
  await rm(customDir, { recursive: true, force: true });
});

describe("the stock layout", () => {
  it("boots into the rail arrangement with the map applied", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/shell/`);

    const rail = page.locator("aside.shell-rail");
    await rail.waitFor({ state: "visible", timeout: 10_000 });

    // Rail: status + quick-prompts. Admin cluster: secrets + sessions.
    await expect
      .poll(() => rail.locator(".rail-stack habitat-status").count(), { timeout: 10_000 })
      .toBe(1);
    await expect
      .poll(() => rail.locator('.rail-stack [data-component="quick-prompts"]').count(), { timeout: 10_000 })
      .toBe(1);
    await expect
      .poll(() => rail.locator('.rail-admin [data-component="secrets"]').count(), { timeout: 10_000 })
      .toBe(1);
    await expect
      .poll(() => rail.locator('.rail-admin [data-component="sessions"]').count(), { timeout: 10_000 })
      .toBe(1);

    // Main keeps chat — and never the rail-mapped panels.
    await expect
      .poll(() => page.locator("#region habitat-chat").count(), { timeout: 10_000 })
      .toBe(1);
    expect(await page.locator("#region habitat-status").count()).toBe(0);
    await page.close();
  }, 30_000);

  it("collapse toggles and persists per viewer", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/shell/`);
    const rail = page.locator("aside.shell-rail");
    await rail.waitFor({ state: "visible", timeout: 10_000 });

    await page.locator("button.rail-toggle").click();
    await expect.poll(() => rail.isVisible()).toBe(false);

    // A fresh navigation in the same browser context remembers the choice.
    await page.goto(`${baseUrl}/shell/`);
    await page.locator("button.rail-toggle").waitFor({ timeout: 10_000 });
    expect(await page.locator("aside.shell-rail").isVisible()).toBe(false);

    await page.locator("button.rail-toggle").click();
    await expect.poll(() => page.locator("aside.shell-rail").isVisible()).toBe(true);
    await page.close();
  }, 30_000);

  it("an unmapped custom component lands in main, untouched", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/shell/`);
    await page.locator("aside.shell-rail").waitFor({ state: "visible", timeout: 10_000 });

    await writeFile(
      join(customDir, "beacon.js"),
      `export default { name: "beacon", inject: [], apply(ctx) {
         const el = document.createElement("div");
         el.dataset.component = "beacon"; el.textContent = "beacon-live";
         document.getElementById("region").appendChild(el);
         return () => el.remove();
       } };`,
    );
    await expect
      .poll(() => page.locator('#region [data-component="beacon"]').count(), { timeout: 15_000 })
      .toBe(1);
    expect(await page.locator('aside.shell-rail [data-component="beacon"]').count()).toBe(0);

    await rm(join(customDir, "beacon.js"));
    await expect
      .poll(() => page.locator('[data-component="beacon"]').count(), { timeout: 15_000 })
      .toBe(0);
    await page.close();
  }, 60_000);

  it("a custom layout replaces the stock rail; removing it restores the rail", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/shell/`);
    await page.locator("aside.shell-rail").waitFor({ state: "visible", timeout: 10_000 });

    // The agent authors its own layout: stock goes disabled, custom mounts.
    await writeFile(
      join(customDir, "layout.js"),
      `export default { name: "layout", inject: [], apply(ctx) {
         const el = document.createElement("div");
         el.dataset.component = "custom-layout-marker";
         document.body.appendChild(el);
         return () => el.remove();
       } };`,
    );
    await expect
      .poll(() => page.locator('[data-component="custom-layout-marker"]').count(), {
        timeout: 15_000,
      })
      .toBe(1);
    await expect
      .poll(() => page.locator("aside.shell-rail").count(), { timeout: 15_000 })
      .toBe(0);
    // The stock layout's disposer returned its panels to the region.
    expect(await page.locator("#region habitat-status").count()).toBe(1);

    // Removing the custom layout brings the stock rail back.
    await rm(join(customDir, "layout.js"));
    await expect
      .poll(() => page.locator("aside.shell-rail").count(), { timeout: 15_000 })
      .toBe(1);
    await expect
      .poll(() => page.locator("aside.shell-rail habitat-status").count(), { timeout: 15_000 })
      .toBe(1);
    await page.close();
  }, 60_000);
});
