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
    opts: { wireVersion?: number; sayHello?: boolean } = {},
  ): Promise<{ ws: WebSocket; welcomed: Promise<boolean>; closeCode: Promise<number> }> {
    const url = exchange.url.replace("http:", "ws:") + CONNECT_PATH;
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${credential}` } });

    const welcomed = new Promise<boolean>((resolve) => {
      ws.on("message", (raw) => {
        const frame = JSON.parse(String(raw)) as { type: string };
        if (frame.type === "welcome") resolve(true);
        if (frame.type === "goodbye") resolve(false);
      });
      ws.on("close", () => resolve(false));
      ws.on("error", () => resolve(false));
    });

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
        }),
      );
    });

    return Promise.resolve({ ws, welcomed, closeCode });
  }

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
