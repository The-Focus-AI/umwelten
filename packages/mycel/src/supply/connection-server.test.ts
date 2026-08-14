/**
 * A machine actually dialling in.
 *
 * Real HTTP server, real WebSocket upgrade, real credential check — on
 * localhost, with no keys and no GPU. What these assert is the property the
 * whole of ADR 0023 rests on: the Exchange learns a machine is there because
 * the machine connected, not because it republished recently.
 */

import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import { MemoryStore } from "../store/memory-store.js";
import { supplierFixture } from "../store/conformance.js";
import { hashCredential } from "../auth/credentials.js";
import { createExchangeServer, type RunningExchange } from "../server.js";
import { WIRE_VERSION, CONNECT_PATH } from "./wire.js";

const CREDENTIAL = "sk-mycel-thor-credential";

describe("dialling in", () => {
  let store: MemoryStore;
  let exchange: RunningExchange;

  async function boot() {
    store = new MemoryStore();
    await store.createSupplier(
      supplierFixture({
        id: "thor",
        kind: "agent",
        baseUrl: "",
        credentialHash: hashCredential(CREDENTIAL),
      }),
    );
    exchange = await createExchangeServer({ store, port: 0, host: "127.0.0.1", handshakeTimeoutMs: 100 });
    return exchange;
  }

  /** Dial, say hello, resolve when the Exchange welcomes us. */
  function dial(
    credential = CREDENTIAL,
    opts: {
      wireVersion?: number;
      sayHello?: boolean;
      offers?: unknown[];
      guarantees?: string[];
    } = {},
  ): Promise<{
    ws: WebSocket;
    welcomed: Promise<boolean>;
    closeCode: Promise<number>;
    goodbye: Promise<string | undefined>;
  }> {
    const url = exchange.url.replace("http:", "ws:") + CONNECT_PATH;
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${credential}` } });

    let sawGoodbye: string | undefined;
    const welcomed = new Promise<boolean>((resolve) => {
      ws.on("message", (raw) => {
        const frame = JSON.parse(String(raw)) as { type: string; reason?: string };
        if (frame.type === "welcome") resolve(true);
        if (frame.type === "goodbye") {
          sawGoodbye = frame.reason;
          resolve(false);
        }
      });
      ws.on("close", () => resolve(false));
      ws.on("error", () => resolve(false));
    });

    const goodbye = welcomed.then(() => sawGoodbye);

    const closeCode = new Promise<number>((resolve) => {
      ws.on("close", (code) => resolve(code));
      ws.on("error", () => resolve(-1));
    });

    ws.on("open", () => {
      if (opts.sayHello === false) return;
      ws.send(
        JSON.stringify({
          type: "hello",
          wireVersion: opts.wireVersion ?? WIRE_VERSION,
          offers: opts.offers,
          guarantees: opts.guarantees,
        }),
      );
    });

    return Promise.resolve({ ws, welcomed, closeCode, goodbye });
  }

  /** A well-formed Offer, the shape the publish endpoint already accepts. */
  const offer = (overrides: Record<string, unknown> = {}) => ({
    model: "thor-gemma",
    capabilities: ["chat", "streaming"],
    servingMode: "managed",
    ...overrides,
  });

  afterEach(async () => {
    await exchange?.close();
  });

  it("holds a Connection for a machine with a good credential", async () => {
    await boot();

    const { welcomed } = await dial();
    expect(await welcomed).toBe(true);
    expect(exchange.connections.isConnected("thor")).toBe(true);
  });

  it("writes the connect to the durable log", async () => {
    await boot();
    await (await dial()).welcomed;

    const events = await store.listConnectionEvents({ supplierId: "thor" });
    expect(events.map((e) => e.event)).toEqual(["connected"]);
  });

  it("refuses an unknown credential", async () => {
    await boot();

    const { welcomed } = await dial("sk-mycel-not-a-real-credential");
    expect(await welcomed).toBe(false);
    expect(exchange.connections.isConnected("thor")).toBe(false);
  });

  it("refuses a disabled Supplier", async () => {
    await boot();
    await store.setSupplierEnabled("thor", false);

    const { welcomed } = await dial();
    expect(await welcomed).toBe(false);
  });

  it("refuses a vendor trying to dial in", async () => {
    // A vendor is dialled out to, because a public API is reachable by
    // definition. Letting one hold a Connection would have Dispatch believe in
    // a transport that will never carry work.
    store = new MemoryStore();
    await store.createSupplier(
      supplierFixture({
        id: "openrouter",
        kind: "vendor",
        credentialHash: hashCredential(CREDENTIAL),
      }),
    );
    exchange = await createExchangeServer({ store, port: 0, host: "127.0.0.1", handshakeTimeoutMs: 100 });

    const { welcomed } = await dial();
    expect(await welcomed).toBe(false);
    expect(exchange.connections.isConnected("openrouter")).toBe(false);
  });

  it("refuses a wire version it does not speak", async () => {
    await boot();

    const { welcomed, closeCode } = await dial(CREDENTIAL, { wireVersion: 99 });
    expect(await welcomed).toBe(false);
    expect(await closeCode).toBe(4003);
    expect(exchange.connections.isConnected("thor")).toBe(false);
  });

  it("registers nothing for a socket that opens and never says hello", async () => {
    await boot();
    await dial(CREDENTIAL, { sayHello: false });

    // A socket that opens and goes quiet is not a Supplier to route to.
    await new Promise((r) => setTimeout(r, 50));
    expect(exchange.connections.isConnected("thor")).toBe(false);
  });

  it("notices immediately when the machine goes away", async () => {
    await boot();
    const connection = await dial();
    expect(await connection.welcomed).toBe(true);

    const gone = new Promise<void>((resolve) => connection.ws.on("close", () => resolve()));
    connection.ws.close();
    await gone;
    await new Promise((r) => setTimeout(r, 20));

    // No window, no timeout: the Connection ending *is* the event.
    expect(exchange.connections.isConnected("thor")).toBe(false);
    const events = await store.listConnectionEvents({ supplierId: "thor" });
    expect(events.at(-1)?.event).toBe("disconnected");
    // The machine hung up on purpose, and the log says so rather than blaming
    // the network for an operator pressing Ctrl-C.
    expect(events.at(-1)?.reason).toBe("closed");
  });

  describe("the catalogue arrives with the Connection", () => {
    it("publishes what the hello carried", async () => {
      await boot();
      const { welcomed } = await dial(CREDENTIAL, { offers: [offer()] });
      expect(await welcomed).toBe(true);

      const offers = await store.listOffers();
      expect(offers.map((o) => o.model)).toEqual(["thor-gemma"]);
    });

    it("keeps the prices the operator set across a disconnect and reconnect", async () => {
      // The load-bearing one. If Offers lived and died with the Connection,
      // every closed lid would silently reset a machine to default pricing.
      await boot();
      const first = await dial(CREDENTIAL, { offers: [offer()] });
      expect(await first.welcomed).toBe(true);

      await store.setOfferPricing("thor", "thor-gemma", {
        wholesalePromptPerMillion: 0,
        wholesaleCompletionPerMillion: 0,
        retailPromptPerMillion: 42,
        retailCompletionPerMillion: 84,
      });

      await new Promise<void>((resolve) => {
        first.ws.once("close", () => resolve());
        first.ws.close();
      });
      await new Promise((r) => setTimeout(r, 20));

      const second = await dial(CREDENTIAL, { offers: [offer()] });
      expect(await second.welcomed).toBe(true);

      expect((await store.getOffer("thor", "thor-gemma"))?.retailPromptPerMillion).toBe(42);
    });

    it("drops a Model the machine no longer serves", async () => {
      // Publishing is total, exactly as on the HTTP path — which is what makes
      // re-publishing safe to repeat on every reconnect.
      await boot();
      const first = await dial(CREDENTIAL, {
        offers: [offer(), offer({ model: "thor-old" })],
      });
      expect(await first.welcomed).toBe(true);
      expect(await store.listOffers()).toHaveLength(2);

      await new Promise<void>((resolve) => {
        first.ws.once("close", () => resolve());
        first.ws.close();
      });
      await new Promise((r) => setTimeout(r, 20));

      const second = await dial(CREDENTIAL, { offers: [offer()] });
      expect(await second.welcomed).toBe(true);

      expect((await store.listOffers()).map((o) => o.model)).toEqual(["thor-gemma"]);
    });

    it("leaves stored Offers alone when the hello carries none", async () => {
      // Absent is not empty. A machine whose catalogue the operator publishes
      // by hand must be able to dial in without wiping it.
      await boot();
      await store.replaceOffers("thor", [
        { model: "operator-published", capabilities: ["chat"], servingMode: "adapted" },
      ]);

      const { welcomed } = await dial();
      expect(await welcomed).toBe(true);

      expect((await store.listOffers()).map((o) => o.model)).toEqual(["operator-published"]);
    });

    it("does not touch stored Offers when the machine disconnects", async () => {
      await boot();
      const connection = await dial(CREDENTIAL, { offers: [offer()] });
      expect(await connection.welcomed).toBe(true);

      await new Promise<void>((resolve) => {
        connection.ws.once("close", () => resolve());
        connection.ws.close();
      });
      await new Promise((r) => setTimeout(r, 20));

      // Disconnected withdraws the machine from Dispatch. It does not delete
      // what the machine sells — those are different facts with different
      // lifetimes.
      expect(await store.listOffers()).toHaveLength(1);
    });

    it("refuses a Guarantee the operator never granted", async () => {
      await boot();
      const { welcomed, closeCode, goodbye } = await dial(CREDENTIAL, {
        offers: [offer()],
        guarantees: ["gdpr-resident"],
      });

      // Refused, not downgraded. A compromised agent must not be able to
      // promote itself into eligibility for traffic the operator is liable for.
      expect(await welcomed).toBe(false);
      expect(await closeCode).toBe(4004);
      expect(await goodbye).toMatch(/gdpr-resident/);
      expect(exchange.connections.isConnected("thor")).toBe(false);
    });

    it("refuses a malformed catalogue rather than holding a Connection without one", async () => {
      await boot();
      const { welcomed, closeCode } = await dial(CREDENTIAL, {
        offers: [{ model: "thor-gemma" }],
      });

      expect(await welcomed).toBe(false);
      expect(await closeCode).toBe(4004);
      // Nothing was stored, and nothing is dispatchable — the two states stay
      // consistent even when the machine got it wrong.
      expect(await store.listOffers()).toEqual([]);
      expect(exchange.connections.isConnected("thor")).toBe(false);
    });

    it("refuses a catalogue that sets its own prices", async () => {
      // A Supplier setting its own price takes away the Exchange's routing
      // lever (ADR 0013). Same rejection as the HTTP path, because it is
      // literally the same code.
      await boot();
      const { welcomed, goodbye } = await dial(CREDENTIAL, {
        offers: [offer({ retailPromptPerMillion: 1 })],
      });

      expect(await welcomed).toBe(false);
      expect(await goodbye).toMatch(/price|retail/i);
    });
  });

  it("lets a reconnecting machine displace its own stale Connection", async () => {
    await boot();
    const first = await dial();
    expect(await first.welcomed).toBe(true);

    // thor wakes up and dials again without knowing its old socket is dead.
    const second = await dial();
    expect(await second.welcomed).toBe(true);

    expect(await first.closeCode).toBe(4000);
    expect(exchange.connections.isConnected("thor")).toBe(true);

    const events = await store.listConnectionEvents({ supplierId: "thor" });
    expect(events.map((e) => `${e.event}:${e.reason ?? ""}`)).toEqual([
      "connected:",
      "disconnected:displaced",
      "connected:",
    ]);
  });
});
