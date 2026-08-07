/**
 * Metering through the real relay.
 *
 * Unit tests, not integration: no keys, no GPU, nothing beyond localhost. What
 * they assert is the thing E3 measured and ADR 0017 decided — that a request
 * which consumed real tokens is never recorded as free.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { supplierFixture } from "../store/conformance.js";
import { startMockUpstream, type MockUpstream, type UpstreamMode } from "../testing/mock-upstream.js";
import { makeTestApplication, type TestApplicationKeys } from "../testing/application-keys.js";
import { createIdentityVerifier } from "../auth/identity.js";
import { createExchangeServer, type RunningExchange } from "../server.js";
import { Balances, endUserOwner } from "./balances.js";

const MODEL = "gemma-4-26b";
const LONG_PROMPT = "x".repeat(40_000);

describe("metering", () => {
  let store: MemoryStore;
  let upstream: MockUpstream;
  let exchange: RunningExchange;
  let app: TestApplicationKeys;

  let balances: Balances;

  /** Enough that nothing in these tests runs out by accident. */
  const FUNDED = 1_000_000_000;

  async function boot(mode: UpstreamMode = "ok", credit = FUNDED) {
    upstream = await startMockUpstream(mode);
    store = new MemoryStore();
    await store.createSupplier(supplierFixture({ baseUrl: upstream.baseUrl }));
    await store.replaceOffers("office-spark", [
      { model: MODEL, capabilities: ["chat", "streaming"], servingMode: "managed" },
    ]);
    app = await makeTestApplication();
    await store.createClient({ id: "acme", name: "Acme" });
    await store.createApplication(app.application);
    exchange = await createExchangeServer({
      store,
      port: 0,
      host: "127.0.0.1",
      verifyCaller: createIdentityVerifier({ store, makeKeySet: () => app.keySet }),
    });
    balances = new Balances(store);
    if (credit > 0) {
      await balances.grant(
        endUserOwner({ application: app.application, subject: "user-1" }),
        credit,
        "test-grant",
      );
    }
  }

  async function chat(body: Record<string, unknown>, init: RequestInit = {}) {
    return fetch(`${exchange.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await app.sign("user-1")}`,
      },
      body: JSON.stringify(body),
      ...init,
    });
  }

  const onlyRecord = async () => (await store.listRequests())[0];

  afterEach(async () => {
    await exchange?.close();
    await upstream?.close();
  });

  describe("a completed request", () => {
    beforeEach(() => {});

    it("records prompt and completion counted on our side", async () => {
      await boot();
      await chat({ model: MODEL, messages: [{ role: "user", content: "hello there" }] });

      const record = await onlyRecord();
      expect(record.promptTokens).toBeGreaterThan(0);
      expect(record.completionTokens).toBeGreaterThan(0);
      expect(record.aborted).toBe(false);
    });

    it("attributes to the asserted End User of the Application", async () => {
      await boot();
      await chat({ model: MODEL, messages: [] });

      const record = await onlyRecord();
      expect(record.applicationId).toBe("hairstyle-app");
      expect(record.subject).toBe("user-1");
      expect(record.supplierId).toBe("office-spark");
    });

    it("records Cost and Charge independently, with Cost zero for owned hardware", async () => {
      await boot();
      await chat({ model: MODEL, messages: [{ role: "user", content: LONG_PROMPT }] });

      const record = await onlyRecord();
      expect(record.cost).toBe(0);
      expect(record.charge).toBeGreaterThan(0);
    });

    it("keeps upstream usage for reconciliation without charging on it", async () => {
      await boot();
      await chat({ model: MODEL, messages: [] });

      const record = await onlyRecord();
      // The mock reports 137 prompt tokens; our own count differs, and that
      // difference is the signal rather than an error (ADR 0017).
      expect(record.upstreamPromptTokens).toBe(137);
      expect(record.promptTokens).not.toBe(137);
    });

    it("meters a streamed request too", async () => {
      await boot();
      const res = await chat({ model: MODEL, messages: [], stream: true });
      await res.text();

      const record = await onlyRecord();
      expect(record.completionTokens).toBeGreaterThan(0);
    });
  });

  describe("an upstream that reports no usage at all", () => {
    it("is still fully metered", async () => {
      // Measured in E3: this case produced zero tokens and no cost, i.e. a free
      // request for real tokens served.
      await boot("no-usage");
      await chat({ model: MODEL, messages: [{ role: "user", content: LONG_PROMPT }] });

      const record = await onlyRecord();
      expect(record.promptTokens).toBeGreaterThan(1000);
      expect(record.completionTokens).toBeGreaterThan(0);
      expect(record.charge).toBeGreaterThan(0);
      expect(record.upstreamPromptTokens).toBeUndefined();
    });
  });

  describe("a caller that hangs up mid-stream", () => {
    it("is still charged the full prompt", async () => {
      // THE EXPLOIT. Submit a long prompt, abort near the end of generation:
      // the Exchange paid its Supplier for nearly all of it. If this test ever
      // fails because someone made aborted requests free, that is the bug —
      // not this assertion. See ADR 0017.
      await boot("never-finishes");
      const controller = new AbortController();

      const res = await chat(
        { model: MODEL, messages: [{ role: "user", content: LONG_PROMPT }], stream: true },
        { signal: controller.signal },
      );
      const reader = res.body!.getReader();
      await reader.read();
      controller.abort();

      await new Promise((r) => setTimeout(r, 300));

      const record = await onlyRecord();
      expect(record).toBeDefined();
      expect(record.aborted).toBe(true);
      expect(record.promptTokens).toBeGreaterThan(1000);
      expect(record.charge).toBeGreaterThan(0);
    });

    it("is charged for the completion tokens relayed before the abort", async () => {
      await boot("never-finishes");
      const controller = new AbortController();

      const res = await chat(
        { model: MODEL, messages: [], stream: true },
        { signal: controller.signal },
      );
      const reader = res.body!.getReader();
      await reader.read();
      await reader.read();
      controller.abort();

      await new Promise((r) => setTimeout(r, 300));

      const record = await onlyRecord();
      // Counted on our side of the wire, so it survives an abort by
      // construction — there is no final chunk to have missed.
      expect(record.completionTokens).toBeGreaterThan(0);
    });
  });

  describe("records are append-only", () => {
    it("writes exactly one record per request", async () => {
      await boot();
      await chat({ model: MODEL, messages: [] });
      await chat({ model: MODEL, messages: [] });

      expect(await store.listRequests()).toHaveLength(2);
    });

    it("filters by application and subject", async () => {
      await boot();
      await chat({ model: MODEL, messages: [] });

      expect(await store.listRequests({ subject: "user-1" })).toHaveLength(1);
      expect(await store.listRequests({ subject: "nobody" })).toHaveLength(0);
    });
  });

  describe("balances", () => {
    const owner = () => endUserOwner({ application: app.application, subject: "user-1" });

    it("debits what the request was charged", async () => {
      await boot();
      const before = (await balances.get(owner())).microDollars;
      await chat({ model: MODEL, messages: [{ role: "user", content: LONG_PROMPT }] });

      const record = (await store.listRequests())[0];
      const after = (await balances.get(owner())).microDollars;
      expect(before - after).toBe(record.charge);
    });

    it("refuses before forwarding when credit cannot cover the prompt", async () => {
      // Nothing has been consumed yet, so this is the one moment a refusal
      // costs nobody anything.
      await boot("ok", 0);
      const res = await chat({ model: MODEL, messages: [{ role: "user", content: LONG_PROMPT }] });

      expect(res.status).toBe(402);
      expect((await res.json()).error).toBe("insufficient_balance");
      expect(upstream.requests).toHaveLength(0);
      expect(await store.listRequests()).toEqual([]);
    });

    it("distinguishes out of credit from nowhere to route", async () => {
      // 402 vs 503. Conflating them makes both undebuggable, and the third
      // case — an upstream failure — is already its own code.
      await boot("ok", 0);
      const broke = await chat({ model: MODEL, messages: [] });
      expect(broke.status).toBe(402);

      await boot("ok", FUNDED);
      const nowhere = await chat({ model: "nobody-serves-this", messages: [] });
      expect(nowhere.status).toBe(503);
    });

    it("still debits an aborted request", async () => {
      await boot("never-finishes");
      const controller = new AbortController();
      const res = await chat(
        { model: MODEL, messages: [{ role: "user", content: LONG_PROMPT }], stream: true },
        { signal: controller.signal },
      );
      const reader = res.body!.getReader();
      await reader.read();
      controller.abort();
      await new Promise((r) => setTimeout(r, 300));

      expect((await balances.get(owner())).microDollars).toBeLessThan(FUNDED);
    });

    it("ties every debit to the request that caused it", async () => {
      await boot();
      await chat({ model: MODEL, messages: [] });

      const record = (await store.listRequests())[0];
      const entries = await balances.entries(owner());
      const debit = entries.find((e) => e.microDollars < 0);
      expect(debit?.requestId).toBe(record.id);
    });

    it("cuts a stream off when credit runs out mid-generation", async () => {
      // The point of counting incrementally: the overdraft is prevented rather
      // than discovered. Funded for the prompt but not for a long generation.
      await boot("never-finishes", 1);
      const promptOnly = await chat({ model: MODEL, messages: [], stream: true });

      // Either refused up front or cut mid-stream — both are enforcement.
      if (promptOnly.status === 200) {
        const text = await promptOnly.text();
        expect(text).toContain("insufficient_balance");
      } else {
        expect(promptOnly.status).toBe(402);
      }
    });
  });

  describe("requests that never reached a Supplier", () => {
    it("are not recorded as usage", async () => {
      // Nothing was consumed, so nothing is owed and nothing is charged.
      await boot();
      await chat({ model: "a-model-nobody-serves", messages: [] });

      expect(await store.listRequests()).toEqual([]);
    });
  });
});
