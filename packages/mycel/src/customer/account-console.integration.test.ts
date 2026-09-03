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
import { createBuyerHandler } from "../buyer/handler.js";
import { createModelsHandler } from "../buyer/models.js";
import { supplierFixture } from "../store/conformance.js";
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
  await store.createSupplier(
    supplierFixture({ id: "browser-supplier", displayName: "Browser Supplier" }),
  );
  await store.createSupplier(
    supplierFixture({ id: "thor", kind: "agent", displayName: "Thor" }),
  );
  await store.replaceOffers("browser-supplier", [
    {
      model: "browser-model",
      capabilities: ["chat", "streaming"],
      servingMode: "managed",
    },
  ]);
  await store.appendLedgerEntry({
    id: "opening-credit",
    ownerKind: "client",
    ownerKey: "browser-client",
    microDollars: 25_000_000,
    reason: "opening credit",
    createdAt: new Date("2026-09-01T00:00:00Z"),
  });

  const buyer = createBuyerHandler({
    store,
    resolveTransport: () => async () => {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"from Mycel"}}]}\n\ndata: [DONE]\n\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const handler = createCustomerHandler({
    store,
    completeChat: buyer.handleAs,
    supplierConnection: (supplierId) =>
      supplierId === "thor"
        ? { connectedAt: new Date("2026-09-03T15:28:00Z"), inFlight: 0 }
        : undefined,
    verifyOperator: async (authorization) => {
      if (authorization !== "Bearer user_browser")
        throw new Error("unauthorized");
      return { subject: "user_browser", role: "admin" };
    },
  });
  const account = createAccountSurfaceHandler({
    authenticationUrl: "/test-authentication.js",
  });
  const models = createModelsHandler({ store });
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
    if (await models(req, res)) return;
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
  it("chats, grants credit, controls an Application, and creates a safe invite", async () => {
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
    expect(
      await page
        .locator('[data-component="account-supplier-connections"]')
        .textContent(),
    ).toContain("Thor● Connected");

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
    expect(assembly).toHaveLength(12);
    expect(assembly.every((entry) => entry.active)).toBe(true);

    await expect
      .poll(() =>
        page.locator('[data-component="account-playground"] select').count(),
      )
      .toBe(2);
    await page
      .locator('[data-component="account-playground"] textarea')
      .fill("Hello there");
    await page
      .locator('[data-component="account-playground"]')
      .getByRole("button", { name: "Send through Mycel" })
      .click();
    await expect
      .poll(() =>
        page.locator('[data-component="account-playground"]').textContent(),
      )
      .toContain("Hello from Mycel");
    await expect
      .poll(() => store.listRequests({ applicationId: "browser-app" }))
      .toHaveLength(1);

    const beforeGrant = (
      await store.getBalance("client", "browser-client")
    ).microDollars;
    await page
      .locator('[data-component="account-admin-grant"] input[name="amount"]')
      .fill("5");
    await page
      .locator('[data-component="account-admin-grant"] input[name="reason"]')
      .fill("Browser review");
    await page
      .locator('[data-component="account-admin-grant"]')
      .getByRole("button", { name: "Grant account credit" })
      .click();
    await expect
      .poll(
        async () =>
          (await store.getBalance("client", "browser-client")).microDollars,
      )
      .toBe(beforeGrant + 5_000_000);
    const displayedBalance = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format((beforeGrant + 5_000_000) / 1_000_000);
    await expect
      .poll(() =>
        page
          .locator('[data-component="account-overview"] .account-vitals')
          .textContent(),
      )
      .toContain(displayedBalance);
    expect(
      await page.locator('[data-component="account-ledger"]').textContent(),
    ).toContain("admin grant by user_browser: Browser review");

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
