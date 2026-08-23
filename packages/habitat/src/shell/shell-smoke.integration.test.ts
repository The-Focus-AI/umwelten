/**
 * The shell, end to end in a real browser — mounted on a BARE node http
 * server, not the container. That is the point: the shell binds to the
 * serving contract alone, so any host that answers the contract's paths
 * (plus whatever endpoints its components call — /health here) hosts it.
 *
 * Integration test: launches the preinstalled chromium via playwright-core.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright-core";
import { createShellHandler } from "./serve-shell.js";

let server: Server;
let browser: Browser;
let baseUrl: string;

beforeAll(async () => {
  const shell = createShellHandler();
  server = createServer(async (req, res) => {
    if (req.url?.startsWith("/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          name: "smoke-habitat",
          tools: 7,
          auth: "open",
          model: "test/model-1",
        }),
      );
      return;
    }
    if (await shell(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // PLAYWRIGHT_CHROMIUM points at a system chromium when the environment
  // pre-installs one whose build differs from playwright-core's pin (the
  // remote runner ships /opt/pw-browsers/chromium). Unset, playwright
  // resolves its own browsers as usual.
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
});

describe("the shell assembles itself in a browser", () => {
  it("boots, loads the manifest, mounts the status component, renders live data", async () => {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await page.goto(`${baseUrl}/shell`);

    // The status component is a mounted custom element...
    const card = page.locator("habitat-status");
    await card.waitFor({ state: "visible", timeout: 10_000 });

    // ...rendering data fetched from the host, not placeholders.
    await expect
      .poll(async () => card.textContent(), { timeout: 10_000 })
      .toContain("smoke-habitat");
    expect(await card.textContent()).toContain("test/model-1");

    // The shell reports the assembly honestly.
    const statusLine = await page.locator("#shell-status").textContent();
    expect(statusLine).toContain("1 component mounted");

    // The loader is live page state, not a build artifact.
    const entries = await page.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__shell.loader.entries().map((e: any) => ({
        id: e.id,
        active: e.fiber?.active,
      })),
    );
    expect(entries).toEqual([{ id: "status", active: true }]);

    expect(pageErrors).toEqual([]);
    await page.close();
  }, 30_000);

  it("unmounting through the loader reverts the component from the live page", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/shell`);
    await page.locator("habitat-status").waitFor({ state: "visible" });

    await page.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__shell.loader.apply([]),
    );

    await expect
      .poll(() => page.locator("habitat-status").count())
      .toBe(0);
    await page.close();
  }, 30_000);
});
