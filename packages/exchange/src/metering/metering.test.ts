/**
 * Metering through the real relay.
 *
 * Unit tests, not integration: no keys, no GPU, nothing beyond localhost. What
 * they assert is the thing E3 measured and ADR 0011 decided — that a request
 * which consumed real tokens is never recorded as free.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { supplierFixture } from "../store/conformance.js";
import { startMockUpstream, type MockUpstream, type UpstreamMode } from "../testing/mock-upstream.js";
import { makeTestApplication, type TestApplicationKeys } from "../testing/application-keys.js";
import { createIdentityVerifier } from "../auth/identity.js";
import { createExchangeServer, type RunningExchange } from "../server.js";

const MODEL = "gemma-4-26b";
const LONG_PROMPT = "x".repeat(40_000);

describe("metering", () => {
  let store: MemoryStore;
  let upstream: MockUpstream;
  let exchange: RunningExchange;
  let app: TestApplicationKeys;

  async function boot(mode: UpstreamMode = "ok") {
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
      // difference is the signal rather than an error (ADR 0011).
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
      // not this assertion. See ADR 0011.
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

  describe("requests that never reached a Supplier", () => {
    it("are not recorded as usage", async () => {
      // Nothing was consumed, so nothing is owed and nothing is charged.
      await boot();
      await chat({ model: "a-model-nobody-serves", messages: [] });

      expect(await store.listRequests()).toEqual([]);
    });
  });
});
