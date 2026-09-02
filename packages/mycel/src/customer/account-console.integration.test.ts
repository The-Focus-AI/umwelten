/**
 * The signed-in account console in a real browser. Clerk's network UI is kept
 * out of this test; its verified subject boundary is covered in handler.test.
 * Here Chromium runs the actual isolated client module against the actual
 * customer HTTP handler, including authenticated mutations and rendering.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { createAccountSurfaceHandler } from "../client-surface/serve.js";
import { Operator } from "../operator.js";
import { MemoryStore } from "../store/memory-store.js";
import { createCustomerHandler } from "./handler.js";

let browser: Browser;
let page: Page;
let server: http.Server;
let store: MemoryStore;
let origin: string;

beforeAll(async () => {
  store = new MemoryStore();
  await store.createClient({ id: "browser-client", name: "Browser Client" });
  await store.linkClientOperator({
    subject: "user_browser",
    clientId: "browser-client",
    role: "owner",
    createdAt: new Date("2026-09-01T00:00:00Z"),
  });
  await new Operator(store).createApplication({
    id: "browser-app",
    clientId: "browser-client",
  });
  await store.appendLedgerEntry({
    id: "opening-credit",
    ownerKind: "client",
    ownerKey: "browser-client",
    microDollars: 25_000_000,
    reason: "opening credit",
    createdAt: new Date("2026-09-01T00:00:00Z"),
  });

  const handler = createCustomerHandler({
    store,
    verifyOperator: async (authorization) => {
      if (authorization !== "Bearer user_browser")
        throw new Error("unauthorized");
      return { subject: "user_browser" };
    },
  });
  const account = createAccountSurfaceHandler({
    authenticationUrl: "/test-authentication.js",
  });
  const testAuthentication = `
    const authKey = { id: "mycel:account-auth" };
    export default {
      name: "test-authentication",
      apply(ctx) {
        const state = { available: true, loading: false, signedIn: true };
        ctx.provide(authKey, {
          snapshot: () => state,
          subscribe(listener) { listener(state); return () => {}; },
          getToken: async () => "user_browser",
          signIn() {}, signUp() {}, mountUserButton() {}, unmountUserButton() {},
        });
      }
    };
  `;

  server = http.createServer(async (req, res) => {
    if (await handler(req, res)) return;
    if (await account(req, res)) return;
    const path = (req.url ?? "/").split("?", 1)[0];
    if (path !== "/test-authentication.js") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    res.end(testAuthentication);
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolveClose) =>
    server?.close(() => resolveClose()),
  );
});

describe("Mycel's signed-in account console", () => {
  it("renders accounting, controls an Application, and creates a safe invite", async () => {
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(`${origin}/account/`);

    await expect
      .poll(() =>
        page.locator('[data-component="account-overview"] h1').textContent(),
      )
      .toContain("Browser Client");
    expect(await page.locator(".account-vitals").textContent()).toContain(
      "$25.00",
    );
    expect(
      await page.locator('[data-component="account-ledger"]').textContent(),
    ).toContain("opening credit");
    expect(
      await page.locator('[data-component="account-team"]').textContent(),
    ).toContain("user_browser");
    expect(
      await page.locator('[data-component="account-funding"]').textContent(),
    ).toContain("Payment funding is not active");

    const assembly = await page.evaluate<{ id: string; active: boolean }[]>(
      () => {
        const shell = (
          window as unknown as {
            __shell: {
              loader: {
                entries(): { id: string; fiber?: { active: boolean } }[];
              };
            };
          }
        ).__shell;
        return shell.loader.entries().map((entry) => ({
          id: entry.id,
          active: entry.fiber?.active === true,
        }));
      },
    );
    expect(assembly).toHaveLength(9);
    expect(assembly.every((entry) => entry.active)).toBe(true);

    await page
      .locator('[data-component="account-applications"]')
      .getByRole("button", { name: "Disable" })
      .click();
    await expect
      .poll(async () => (await store.getApplication("browser-app"))?.enabled)
      .toBe(false);
    await expect
      .poll(() =>
        page.locator('[data-component="account-applications"]').textContent(),
      )
      .toContain("Disabled");

    await page
      .locator('[data-component="account-team"]')
      .getByRole("button", { name: "Create 7-day invite" })
      .click();
    await expect
      .poll(() => page.locator(".account-invite").textContent())
      .toContain("/account/#invite=invite-mycel-");
  });
});
