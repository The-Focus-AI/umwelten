/**
 * The relay reaches a Supplier through one seam.
 *
 * These tests inject a transport that never touches the network and assert the
 * money path behaves identically to the HTTP one — because that is the property
 * dial-in depends on. A machine Supplier's Connection will satisfy this same
 * shape (ADR 0023), and if metering only works for transports that happen to be
 * HTTP, it will be discovered by charging someone wrongly.
 */

import { describe, it, expect, afterEach } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { supplierFixture } from "../store/conformance.js";
import { makeTestApplication, type TestApplicationKeys } from "../testing/application-keys.js";
import { createIdentityVerifier } from "../auth/identity.js";
import { createExchangeServer, type RunningExchange } from "../server.js";
import { Balances, endUserOwner } from "../metering/balances.js";
import type { SupplierTransport } from "./transport.js";

const MODEL = "gemma-4-26b";
const FUNDED = 1_000_000_000;

/**
 * An SSE body of the shape the relay counts, produced without a socket.
 *
 * Chunks are produced on `pull` rather than queued up front, because
 * `controller.error()` discards anything still queued — so a stream that
 * enqueued everything and then failed would deliver nothing at all, and a test
 * asserting "we charge for what arrived" would pass for the wrong reason.
 * Pulling one at a time means the tokens genuinely arrive before the drop.
 */
function streamingResponse(chunks: string[], opts: { stallAfter?: number } = {}): Response {
  const encoder = new TextEncoder();
  let sent = 0;

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (opts.stallAfter !== undefined && sent >= opts.stallAfter) {
        // A Connection dropping mid-stream is a truncated response and nothing
        // more — no buffering, no replay, no re-dispatch (ADR 0023).
        controller.error(new Error("connection lost"));
        return;
      }
      if (sent >= chunks.length) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: chunks[sent] } }] })}\n\n`,
        ),
      );
      sent += 1;
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("the Supplier transport seam", () => {
  let store: MemoryStore;
  let exchange: RunningExchange;
  let app: TestApplicationKeys;
  let balances: Balances;
  let seen: { body: Record<string, unknown> } | undefined;

  /**
   * Accepts a sync producer too — a Connection hands back a Response as soon as
   * it has framed the request, and making every test wrap that in a Promise
   * would be noise.
   */
  async function boot(
    transport: (
      ...args: Parameters<SupplierTransport>
    ) => Response | Promise<Response>,
  ) {
    seen = undefined;
    store = new MemoryStore();
    // No baseUrl at all: nothing here reaches the network, which is the point.
    await store.createSupplier(supplierFixture({ baseUrl: "" }));
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
      resolveTransport: () => async (body, signal) => {
        seen = { body };
        return transport(body, signal);
      },
    });

    balances = new Balances(store);
    await balances.grant(
      endUserOwner({ application: app.application, subject: "user-1" }),
      FUNDED,
      "test-grant",
    );
  }

  async function chat(body: Record<string, unknown> = {}) {
    return fetch(`${exchange.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await app.sign("user-1")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "hello" }],
        ...body,
      }),
    });
  }

  afterEach(async () => {
    await exchange?.close();
  });

  it("serves a request through an injected transport", async () => {
    await boot(() => streamingResponse(["one ", "two ", "three"]));

    const res = await chat({ stream: true });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("three");
  });

  it("forwards the buyer's payload unmodified", async () => {
    await boot(() => streamingResponse(["ok"]));

    await (await chat({ stream: true, temperature: 0.2 })).text();

    expect(seen?.body.model).toBe(MODEL);
    expect(seen?.body.temperature).toBe(0.2);
  });

  it("meters and charges a transport that never touched the network", async () => {
    await boot(() => streamingResponse(["one ", "two ", "three"]));

    await (await chat({ stream: true })).text();

    const [record] = await store.listRequests();
    expect(record.outcome).toBe("completed");
    expect(record.promptTokens).toBeGreaterThan(0);
    expect(record.completionTokens).toBeGreaterThan(0);
    expect(record.charge).toBeGreaterThan(0);

    const owner = endUserOwner({ application: app.application, subject: "user-1" });
    expect((await balances.get(owner)).microDollars).toBe(FUNDED - record.charge);
  });

  it("records a transport dying mid-stream as a supply failure, and still charges", async () => {
    await boot(() => streamingResponse(["one ", "two ", "three"], { stallAfter: 2 }));

    // Headers are long gone by then, so the buyer's stream simply ends short.
    await (await chat({ stream: true })).text();

    const [record] = await store.listRequests();
    expect(record.outcome).toBe("supply-failed");
    // The tokens that did arrive were produced and are owed, whoever's fault
    // the drop was — the Exchange bears the failure, not the buyer's balance
    // going unreconciled (ADR 0025).
    expect(record.completionTokens).toBeGreaterThan(0);
    expect(record.charge).toBeGreaterThan(0);
  });

  it("reports a transport that refuses to open as an upstream error", async () => {
    await boot(() => Promise.reject(new Error("no connection for that Supplier")));

    const res = await chat({ stream: true });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("upstream_error");
  });
});
