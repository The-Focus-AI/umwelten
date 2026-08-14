/**
 * A buyer request served by a machine that dialled in — end to end.
 *
 * Real HTTP, real WebSocket upgrade, real streaming, real ledger. The only
 * fake is the machine's own runtime, because a GPU is not a test fixture.
 *
 * The machine is implemented here rather than imported from
 * `@umwelten/supplier`: that package deliberately cannot be reached from this
 * one, so a GPU box never installs a Postgres driver (CONTEXT-MAP.md). Writing
 * the agent side against the wire is therefore not duplication to be tidied
 * away — it is the test proving the wire is a contract two independent
 * implementations can meet, which is exactly what a shared module would stop
 * proving.
 */

import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import { MemoryStore } from "../store/memory-store.js";
import { supplierFixture } from "../store/conformance.js";
import { hashCredential } from "../auth/credentials.js";
import { createExchangeServer, type RunningExchange } from "../server.js";
import { createIdentityVerifier } from "../auth/identity.js";
import { makeTestApplication, type TestApplicationKeys } from "../testing/application-keys.js";
import { startMockUpstream, type MockUpstream, type UpstreamMode } from "../testing/mock-upstream.js";
import { Balances, endUserOwner } from "../metering/balances.js";
import { WIRE_VERSION, CONNECT_PATH } from "./wire.js";

const MODEL = "thor-gemma";
const CREDENTIAL = "sk-mycel-thor-e2e";

/**
 * A minimal machine: dials in, forwards work to its runtime, streams back.
 *
 * Deliberately the smallest thing that satisfies the wire, so a bug in the
 * Exchange cannot be masked by a clever agent.
 */
function machine(
  exchangeUrl: string,
  runtimeUrl: string,
  catalogue?: { offers: unknown[]; guarantees?: string[] },
) {
  const ws = new WebSocket(exchangeUrl.replace("http:", "ws:") + CONNECT_PATH, {
    headers: { authorization: `Bearer ${CREDENTIAL}` },
  });
  const inFlight = new Map<string, AbortController>();

  const send = (frame: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  };

  const welcomed = new Promise<void>((resolve) => {
    ws.on("open", () =>
      send({
        type: "hello",
        wireVersion: WIRE_VERSION,
        offers: catalogue?.offers,
        guarantees: catalogue?.guarantees,
      }),
    );
    ws.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as {
        type: string;
        id?: string;
        body?: Record<string, unknown>;
      };
      if (frame.type === "welcome") return resolve();
      if (frame.type === "cancel" && frame.id) return inFlight.get(frame.id)?.abort();
      if (frame.type !== "request" || !frame.id || !frame.body) return;
      void serve(frame.id, frame.body);
    });
  });

  async function serve(id: string, body: Record<string, unknown>): Promise<void> {
    const abort = new AbortController();
    inFlight.set(id, abort);
    try {
      const upstream = await fetch(`${runtimeUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      send({ type: "response-head", id, status: upstream.status });
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done || abort.signal.aborted) break;
        send({ type: "chunk", id, data: decoder.decode(value, { stream: true }) });
      }
      if (!abort.signal.aborted) send({ type: "end", id });
    } catch (error) {
      if (!abort.signal.aborted) {
        send({ type: "request-error", id, message: (error as Error).message });
      }
    } finally {
      inFlight.delete(id);
    }
  }

  return {
    welcomed,
    hangUp: () =>
      new Promise<void>((resolve) => {
        ws.once("close", () => resolve());
        ws.close();
      }),
  };
}

describe("a machine serves a buyer over its Connection", () => {
  let store: MemoryStore;
  let exchange: RunningExchange;
  let runtime: MockUpstream;
  let app: TestApplicationKeys;
  let thor: ReturnType<typeof machine> | undefined;

  async function boot(mode: UpstreamMode = "ok") {
    runtime = await startMockUpstream(mode);
    store = new MemoryStore();
    // An agent has no baseUrl — it has no address, which is the point.
    await store.createSupplier(
      supplierFixture({
        id: "thor",
        kind: "agent",
        baseUrl: "",
        credentialHash: hashCredential(CREDENTIAL),
      }),
    );
    await store.replaceOffers("thor", [
      { model: MODEL, capabilities: ["chat", "streaming"], servingMode: "managed" },
    ]);

    app = await makeTestApplication();
    await store.createClient({ id: "acme", name: "Acme" });
    await store.createApplication(app.application);
    exchange = await createExchangeServer({
      store,
      port: 0,
      host: "127.0.0.1",
      handshakeTimeoutMs: 200,
      verifyCaller: createIdentityVerifier({ store, makeKeySet: () => app.keySet }),
    });
    await new Balances(store).grant(
      endUserOwner({ application: app.application, subject: "user-1" }),
      1_000_000_000,
      "test-grant",
    );
  }

  async function dial() {
    thor = machine(exchange.url, runtime.baseUrl);
    await thor.welcomed;
  }

  async function chat(init: RequestInit = {}) {
    const token = await app.sign("user-1");
    return fetch(`${exchange.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      // Streaming, because that is the case worth testing over a Connection —
      // tokens crossing a socket as they are produced — and because the
      // truncation and cancellation modes only exist on the streaming path.
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
      ...init,
    });
  }

  afterEach(async () => {
    await thor?.hangUp().catch(() => {});
    thor = undefined;
    await exchange?.close();
    await runtime?.close();
  });

  it("routes the request to the machine and streams its tokens back", async () => {
    await boot();
    await dial();

    const response = await chat();
    expect(response.status).toBe(200);
    const text = await response.text();

    // The buyer got real tokens, produced on the machine, relayed over a socket
    // the machine opened. No tunnel, no inbound port, no address.
    expect(text).toContain("quick");
    expect(runtime.requests).toHaveLength(1);
  });

  it("meters and charges it exactly as a vendor request", async () => {
    await boot();
    await dial();
    const balances = new Balances(store);
    const owner = endUserOwner({ application: app.application, subject: "user-1" });
    const before = (await balances.get(owner)).microDollars;

    await (await chat()).text();

    const requests = await store.listRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].outcome).toBe("completed");
    expect(requests[0].supplierId).toBe("thor");
    expect(requests[0].completionTokens).toBeGreaterThan(0);
    // The money path did not change to accommodate a socket. That is the whole
    // point of the transport seam.
    expect((await balances.get(owner)).microDollars).toBeLessThan(before);
  });

  it("refuses the request once the machine hangs up, naming it disconnected", async () => {
    await boot();
    await dial();
    await thor!.hangUp();
    thor = undefined;
    // The Connection ending *is* the withdrawal — no window to wait out.
    await new Promise((r) => setTimeout(r, 30));

    const response = await chat();
    expect(response.status).toBe(503);

    const body = (await response.json()) as {
      considered: { supplierId: string; reason: string }[];
    };
    // Distinct from offer-stale: the catalogue is current, the machine is off.
    expect(body.considered[0]).toMatchObject({
      supplierId: "thor",
      reason: "supplier-disconnected",
    });
  });

  it("serves again the moment the machine reconnects, with no operator action", async () => {
    await boot();
    await dial();
    await thor!.hangUp();
    await new Promise((r) => setTimeout(r, 30));
    expect((await chat()).status).toBe(503);

    await dial();
    expect((await chat()).status).toBe(200);
  });

  it("records a supply failure when the machine dies mid-stream", async () => {
    await boot("dies-mid-stream");
    await dial();

    await (await chat()).text().catch(() => "");

    const [record] = await store.listRequests();
    // Our choice of Supplier, our problem — the Exchange bears it (ADR 0025).
    expect(record.outcome).toBe("supply-failed");
    // And the buyer still owes for the prompt, which was submitted and
    // processed whatever happened next.
    expect(record.promptTokens).toBeGreaterThan(0);
  });

  it("stops the machine generating when the buyer hangs up", async () => {
    await boot("never-finishes");
    await dial();

    const abort = new AbortController();
    const pending = chat({ signal: abort.signal });
    const response = await pending;
    const reader = response.body!.getReader();
    await reader.read();
    abort.abort();

    await new Promise((r) => setTimeout(r, 80));

    // The cancel travelled the whole way: buyer → Exchange → Connection →
    // machine → its runtime. Anywhere it stopped short would be GPU time spent
    // on tokens nobody receives.
    expect(runtime.sawAbort()).toBe(true);
    const [record] = await store.listRequests();
    expect(record.outcome).toBe("buyer-aborted");
  });

  it("brings its own catalogue, and a buyer can spend against it", async () => {
    // No operator publish anywhere in this test. The machine arrives, says what
    // it serves, and is immediately buyable — which is the point of the
    // catalogue riding the handshake rather than following it.
    runtime = await startMockUpstream("ok");
    store = new MemoryStore();
    await store.createSupplier(
      supplierFixture({
        id: "thor",
        kind: "agent",
        baseUrl: "",
        credentialHash: hashCredential(CREDENTIAL),
        grantedGuarantees: ["on-premise"],
      }),
    );
    app = await makeTestApplication();
    await store.createClient({ id: "acme", name: "Acme" });
    await store.createApplication(app.application);
    exchange = await createExchangeServer({
      store,
      port: 0,
      host: "127.0.0.1",
      handshakeTimeoutMs: 200,
      verifyCaller: createIdentityVerifier({ store, makeKeySet: () => app.keySet }),
    });
    await new Balances(store).grant(
      endUserOwner({ application: app.application, subject: "user-1" }),
      1_000_000_000,
      "test-grant",
    );

    expect(await store.listOffers()).toEqual([]);

    thor = machine(exchange.url, runtime.baseUrl, {
      offers: [{ model: MODEL, capabilities: ["chat", "streaming"], servingMode: "managed" }],
      guarantees: ["on-premise"],
    });
    await thor.welcomed;

    const catalogue = (await (await fetch(`${exchange.url}/v1/models`)).json()) as {
      data: { id: string }[];
    };
    expect(catalogue.data.map((m) => m.id)).toEqual([MODEL]);

    const response = await chat();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("quick");

    const [record] = await store.listRequests();
    expect(record.supplierId).toBe("thor");
    expect(record.outcome).toBe("completed");
  });

  it("counts what the machine is working on while it works", async () => {
    await boot("never-finishes");
    await dial();

    const abort = new AbortController();
    const response = await chat({ signal: abort.signal });
    await response.body!.getReader().read();

    // Only the Exchange can know this, because only the Exchange issued it.
    expect(exchange.connections.inFlight("thor")).toBe(1);

    abort.abort();
    await new Promise((r) => setTimeout(r, 80));
    expect(exchange.connections.inFlight("thor")).toBe(0);
  });
});
