/**
 * The front end evolves using itself (#410): a dev Exchange serves a
 * components directory; Chromium watches the surface grow. A component
 * file written there (what the mycel-owning agent's `create_component`
 * does) appears live without a rebuild or reload, an edit hot-replaces
 * it, a BROKEN edit rolls back visibly — the old version keeps rendering
 * while the shell status line names the failure — and a fix recovers.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { createExchangeServer, type RunningExchange } from "../server.js";
import { MemoryStore } from "../store/memory-store.js";

let exchange: RunningExchange;
let browser: Browser;
let componentsDir: string;

beforeAll(async () => {
  componentsDir = await mkdtemp(join(tmpdir(), "mycel-evolve-"));
  const store = new MemoryStore();
  await store.setup();
  exchange = await createExchangeServer({
    store,
    port: 0,
    host: "127.0.0.1",
    componentsDir,
  });
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await exchange?.close();
  await rm(componentsDir, { recursive: true, force: true });
});

const uptimeSource = (label: string) => `
  import { serviceKey } from "../substrate/index.js";
  const regionKey = serviceKey("shell:region");
  export default {
    name: "uptime",
    inject: [regionKey],
    apply(ctx, view) {
      const el = document.createElement("div");
      el.className = "shell-card";
      el.dataset.component = "uptime";
      el.innerHTML = "<h2>uptime</h2><p>${label}</p>";
      view.get(regionKey).appendChild(el);
      return () => el.remove();
    },
  };
`;

describe("the mycel surface, evolving", () => {
  it("grows, hot-replaces, survives a broken edit visibly, and recovers", async () => {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${exchange.port}/shell/`);
    await page.locator("exchange-health").waitFor({ state: "visible", timeout: 10_000 });

    // 1. Created (the agent's create_component is exactly this file write):
    // the card appears on the live page — no rebuild, no reload.
    await writeFile(join(componentsDir, "uptime.js"), uptimeSource("since v1"));
    const card = page.locator('[data-component="uptime"]');
    await card.waitFor({ state: "visible", timeout: 15_000 });
    expect(await card.textContent()).toContain("since v1");

    // 2. Edited: mtime moves → version moves → the loader hot-replaces it.
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(componentsDir, "uptime.js"), uptimeSource("since v2"));
    await expect
      .poll(() => card.textContent(), { timeout: 15_000 })
      .toContain("since v2");

    // 3. Broken edit: the import fails, so the OLD version keeps rendering
    // (rollback) while the shell status line names the failure (visible).
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(
      join(componentsDir, "uptime.js"),
      "export default { this is not javascript",
    );
    await expect
      .poll(() => page.locator("#shell-status").textContent(), { timeout: 15_000 })
      .toContain("custom:uptime");
    expect(await card.textContent()).toContain("since v2"); // still up

    // 4. Fixed: the next version stamp reloads cleanly and the error clears.
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(componentsDir, "uptime.js"), uptimeSource("since v3"));
    await expect
      .poll(() => card.textContent(), { timeout: 15_000 })
      .toContain("since v3");
    await expect
      .poll(() => page.locator("#shell-status").textContent(), { timeout: 15_000 })
      .not.toContain("custom:uptime");

    await page.close();
  }, 90_000);
});
