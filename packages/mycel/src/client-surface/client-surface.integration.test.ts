/**
 * The Client surface, end to end (#409): a REAL Exchange server (MemoryStore,
 * dial-in socket and all) serves the Shell; Chromium loads it and the
 * read-only components render live Exchange state — health from /health,
 * the catalogue from /v1/models, straight from a seeded Offer.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { createExchangeServer, type RunningExchange } from "../server.js";
import { MemoryStore } from "../store/memory-store.js";

let exchange: RunningExchange;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  const store = new MemoryStore();
  await store.setup();
  await store.createSupplier({
    id: "sup-1",
    displayName: "Test Supplier",
    kind: "vendor",
    grantedGuarantees: [],
    credentialHash: "0".repeat(64),
    baseUrl: "http://127.0.0.1:1/v1",
    enabled: true,
    createdAt: new Date(),
  });
  await store.replaceOffers("sup-1", [
    {
      model: "gemma-4-26b",
      capabilities: ["chat"],
      servingMode: "managed",
      contextTokens: 32768,
    },
  ]);

  exchange = await createExchangeServer({ store, port: 0, host: "127.0.0.1" });
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await exchange?.close();
});

describe("the Exchange's client surface, assembled", () => {
  it("the hostname root lands a browser on the shell", async () => {
    await page.goto(`http://127.0.0.1:${exchange.port}/`);
    expect(new URL(page.url()).pathname).toBe("/shell/");
  });

  it("health renders live store reachability", async () => {
    const health = page.locator("exchange-health");
    await health.waitFor({ state: "visible", timeout: 10_000 });
    await expect
      .poll(() => health.textContent(), { timeout: 10_000 })
      .toContain("ok");
  });

  it("models renders the seeded catalogue with its price", async () => {
    const models = page.locator('[data-component="models"]');
    await expect
      .poll(() => models.textContent(), { timeout: 10_000 })
      .toContain("gemma-4-26b");
    const text = await models.textContent();
    expect(text).toContain("/M"); // a price per million tokens is quoted
    expect(text).toContain("32768");
  });

  it("solo projection works here too — the contract came over whole", async () => {
    await page.goto(`http://127.0.0.1:${exchange.port}/shell/solo/health/`);
    const health = page.locator("exchange-health");
    await expect
      .poll(() => health.textContent(), { timeout: 10_000 })
      .toContain("ok");
  });
});
