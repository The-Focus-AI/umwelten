/**
 * The buyer surface, driven end to end against a mock Supplier.
 *
 * These run over a real socket rather than fabricated request objects, because
 * what is under test here is *relaying* — streaming, aborts, upstream failures
 * — and a fake response object cannot tell you whether chunks arrived
 * incrementally or all at once.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { supplierFixture } from "../store/conformance.js";
import { startMockUpstream, type MockUpstream, type UpstreamMode } from "../testing/mock-upstream.js";
import { createExchangeServer, type RunningExchange } from "../server.js";
import { selectOffer } from "./handler.js";
import type { Offer } from "../types.js";

const MODEL = "gemma-4-26b";

describe("buyer surface", () => {
  let store: MemoryStore;
  let upstream: MockUpstream;
  let exchange: RunningExchange;

  async function boot(mode: UpstreamMode = "ok") {
    upstream = await startMockUpstream(mode);
    store = new MemoryStore();
    await store.createSupplier(
      supplierFixture({ baseUrl: upstream.baseUrl, upstreamCredentialEnv: "MOCK_KEY" }),
    );
    await store.replaceOffers("office-spark", [
      { model: MODEL, capabilities: ["chat", "streaming"], servingMode: "managed" },
    ]);
    exchange = await createExchangeServer({ store, port: 0, host: "127.0.0.1" });
  }

  async function chat(body: unknown, init: RequestInit = {}) {
    return fetch(`${exchange.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...init,
    });
  }

  beforeEach(async () => {
    process.env.MOCK_KEY = "upstream-secret";
  });

  afterEach(async () => {
    delete process.env.MOCK_KEY;
    await exchange?.close();
    await upstream?.close();
  });

  describe("non-streaming", () => {
    it("returns an OpenAI-compatible response", async () => {
      await boot();
      const res = await chat({ model: MODEL, messages: [{ role: "user", content: "hi" }] });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.object).toBe("chat.completion");
      expect(json.choices[0].message.content).toContain("quick brown fox");
    });

    it("forwards to the supplier that published the offer", async () => {
      await boot();
      await chat({ model: MODEL, messages: [] });

      expect(upstream.requests).toHaveLength(1);
      expect(upstream.requests[0].path).toBe("/v1/chat/completions");
      expect(upstream.requests[0].body.model).toBe(MODEL);
    });

    it("presents the supplier's upstream credential", async () => {
      await boot();
      await chat({ model: MODEL, messages: [] });

      // Read from the env var the Supplier names — the secret is never stored
      // in the database.
      expect(upstream.requests[0].auth).toBe("Bearer upstream-secret");
    });
  });

  describe("streaming", () => {
    it("relays chunks as they arrive rather than buffering", async () => {
      await boot();
      const res = await chat({ model: MODEL, messages: [], stream: true });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let reads = 0;
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reads += 1;
        text += decoder.decode(value);
      }

      // More than one read is the whole assertion: a single read means the
      // response was buffered and handed over at the end, which is not
      // streaming whatever the content-type claims.
      expect(reads).toBeGreaterThan(1);
      expect(text).toContain("[DONE]");
    });

    it("stops generation upstream when the caller hangs up", async () => {
      await boot("never-finishes");
      const controller = new AbortController();
      const res = await chat(
        { model: MODEL, messages: [], stream: true },
        { signal: controller.signal },
      );

      const reader = res.body!.getReader();
      await reader.read();
      controller.abort();

      // The upstream is still generating until it notices the socket closed.
      await new Promise((r) => setTimeout(r, 250));
      expect(upstream.sawAbort()).toBe(true);
    });
  });

  describe("failures are distinguishable", () => {
    it("reports no eligible offer with its own code", async () => {
      await boot();
      const res = await chat({ model: "a-model-nobody-serves", messages: [] });

      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("no_eligible_offer");
    });

    it("does not select a disabled offer", async () => {
      await boot();
      await store.setOfferEnabled("office-spark", MODEL, false);

      const res = await chat({ model: MODEL, messages: [] });
      expect((await res.json()).error).toBe("no_eligible_offer");
    });

    it("does not select an offer from a disabled supplier", async () => {
      await boot();
      await store.setSupplierEnabled("office-spark", false);

      const res = await chat({ model: MODEL, messages: [] });
      expect((await res.json()).error).toBe("no_eligible_offer");
    });

    it("surfaces an upstream error instead of disguising it as success", async () => {
      await boot("error");
      const res = await chat({ model: MODEL, messages: [] });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("upstream_error");
      expect(json.upstreamStatus).toBe(500);
      expect(json.supplierId).toBe("office-spark");
    });

    it("rejects a body with no model", async () => {
      await boot();
      const res = await chat({ messages: [] });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_body");
    });

    it("rejects invalid JSON", async () => {
      await boot();
      const res = await fetch(`${exchange.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_json");
    });

    it("refuses a non-POST", async () => {
      await boot();
      const res = await fetch(`${exchange.url}/v1/chat/completions`);
      expect(res.status).toBe(405);
    });
  });

  describe("the server itself", () => {
    it("reports health, including whether the store answers", async () => {
      await boot();
      const res = await fetch(`${exchange.url}/health`);
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe("ok");
    });

    it("404s an unknown path rather than hanging", async () => {
      await boot();
      const res = await fetch(`${exchange.url}/nope`);
      expect(res.status).toBe(404);
    });
  });
});

describe("selectOffer", () => {
  // Kept as a pure function so #296 can replace the body — guarantee filter,
  // capability filter, ranking by Charge — without touching the handler.
  const offer = (overrides: Partial<Offer>): Offer => ({
    supplierId: "s",
    model: MODEL,
    capabilities: ["chat"],
    servingMode: "managed",
    headroom: [],
    wholesalePromptPerMillion: 0,
    wholesaleCompletionPerMillion: 0,
    retailPromptPerMillion: 1,
    retailCompletionPerMillion: 1,
    enabled: true,
    publishedAt: new Date(),
    ...overrides,
  });

  it("finds an enabled offer for the model", () => {
    expect(selectOffer([offer({})], MODEL)?.model).toBe(MODEL);
  });

  it("ignores other models", () => {
    expect(selectOffer([offer({ model: "other" })], MODEL)).toBeUndefined();
  });

  it("ignores a disabled offer", () => {
    expect(selectOffer([offer({ enabled: false })], MODEL)).toBeUndefined();
  });
});
