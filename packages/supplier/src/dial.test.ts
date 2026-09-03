/**
 * The agent side of dialling in.
 *
 * The socket is faked so these stay fast and deterministic — the real one is
 * exercised end to end from the Exchange's side. What matters here is the loop:
 * a dropped link is the routine case, not a failure, because this is a laptop
 * and laptops close.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import {
  dialIn,
  WIRE_VERSION,
  type DialEvent,
  type DialOptions,
  type DialSocket,
} from "./dial.js";

/** A socket whose lifecycle the test drives. */
function scriptedSocket() {
  const listeners: {
    open: (() => void)[];
    message: ((data: string) => void)[];
    ping: (() => void)[];
    close: ((code?: number, reason?: string) => void)[];
    error: ((error: Error) => void)[];
  } = { open: [], message: [], ping: [], close: [], error: [] };

  const sent: string[] = [];
  let terminations = 0;
  const socket: DialSocket = {
    send: (data) => sent.push(data),
    close: () => listeners.close.forEach((l) => l(1000, "closed")),
    terminate: () => {
      terminations += 1;
      listeners.close.forEach((l) => l(1006, "heartbeat timeout"));
    },
    onOpen: (l) => listeners.open.push(l),
    onMessage: (l) => listeners.message.push(l),
    onPing: (l) => listeners.ping.push(l),
    onClose: (l) => listeners.close.push(l),
    onError: (l) => listeners.error.push(l),
  };

  return {
    socket,
    sent,
    get terminations() {
      return terminations;
    },
    open: () => listeners.open.forEach((l) => l()),
    ping: () => listeners.ping.forEach((l) => l()),
    welcome: () =>
      listeners.message.forEach((l) =>
        l(
          JSON.stringify({
            type: "welcome",
            wireVersion: WIRE_VERSION,
            supplierId: "thor",
          }),
        ),
      ),
    goodbye: (reason: string) =>
      listeners.message.forEach((l) =>
        l(JSON.stringify({ type: "goodbye", reason })),
      ),
    drop: (code = 1006) => listeners.close.forEach((l) => l(code, "gone")),
  };
}

/** Run the dial loop for a scripted sequence of sockets, then stop it. */
async function runDial(
  script: ((socket: ReturnType<typeof scriptedSocket>) => void)[],
  opts: {
    minBackoffMs?: number;
    offers?: DialOptions["offers"];
    guarantees?: string[];
  } = {},
) {
  const events: DialEvent[] = [];
  const controller = new AbortController();
  const sockets: ReturnType<typeof scriptedSocket>[] = [];
  let attempt = 0;

  const done = dialIn({
    exchangeUrl: "https://mycel.example",
    credential: "sk-mycel-thor",
    minBackoffMs: opts.minBackoffMs ?? 1,
    maxBackoffMs: 64,
    offers: opts.offers,
    guarantees: opts.guarantees,
    signal: controller.signal,
    onEvent: (e) => events.push(e),
    sleep: async () => {},
    connect: () => {
      const socket = scriptedSocket();
      sockets.push(socket);
      const step = script[Math.min(attempt, script.length - 1)];
      attempt += 1;
      // Drive it on the next tick, after dialIn has wired its listeners.
      queueMicrotask(() => {
        step(socket);
        if (attempt >= script.length) controller.abort();
      });
      return socket.socket;
    },
  });

  await done;
  return { events, sockets };
}

/** The shape the agent hands in, straight from `toOfferDrafts`. */
function draft(): NonNullable<DialOptions["offers"]>[number] {
  return {
    model: "thor-gemma",
    capabilities: ["chat"],
    servingMode: "managed",
    headroom: [],
  };
}

describe("dialling in", () => {
  afterEach(() => vi.useRealTimers());

  it("says hello with the wire version as soon as the socket opens", async () => {
    const { sockets } = await runDial([
      (s) => {
        s.open();
        s.welcome();
        s.drop();
      },
    ]);

    const hello = JSON.parse(sockets[0].sent[0]) as Record<string, unknown>;
    expect(hello.type).toBe("hello");
    expect(hello.wireVersion).toBe(WIRE_VERSION);
  });

  it("carries the catalogue in the hello, not a frame after it", async () => {
    // Availability and catalogue land together, so the Exchange never believes
    // a machine is there without knowing what it serves.
    const offers = [draft()];
    const { sockets } = await runDial(
      [
        (s) => {
          s.open();
          s.welcome();
          s.drop();
        },
      ],
      { offers, guarantees: ["on-premise"] },
    );

    const hello = JSON.parse(sockets[0].sent[0]) as Record<string, unknown>;
    expect(hello.offers).toEqual(offers);
    expect(hello.guarantees).toEqual(["on-premise"]);
  });

  it("republishes on reconnect without anything re-measuring", async () => {
    // The drafts are handed in once and sent again on every attempt, so a
    // flapping link costs no probe.
    const offers = [draft()];
    const { sockets } = await runDial(
      [
        (s) => {
          s.open();
          s.welcome();
          s.drop();
        },
        (s) => {
          s.open();
          s.welcome();
          s.drop();
        },
      ],
      { offers },
    );

    expect(sockets).toHaveLength(2);
    for (const socket of sockets) {
      expect(
        (JSON.parse(socket.sent[0]) as { offers: unknown }).offers,
      ).toEqual(offers);
    }
  });

  it("omits the catalogue entirely when it has none to publish", async () => {
    // Absent, not empty. An empty array would wipe Offers the operator
    // published on this machine's behalf.
    const { sockets } = await runDial([
      (s) => {
        s.open();
        s.welcome();
        s.drop();
      },
    ]);

    expect(JSON.parse(sockets[0].sent[0])).not.toHaveProperty("offers");
  });

  it("does not report connected for a socket that opens but is never welcomed", async () => {
    // An open socket is not yet a Connection. The Exchange has not accepted the
    // credential at that point, and a machine that assumed otherwise would
    // report itself available while being refused.
    const { events } = await runDial([
      (s) => {
        s.open();
        s.drop();
      },
    ]);

    expect(events.some((e) => e.type === "connected")).toBe(false);
  });

  it("reconnects after the link drops", async () => {
    const { events, sockets } = await runDial([
      (s) => {
        s.open();
        s.welcome();
        s.drop();
      },
      (s) => {
        s.open();
        s.welcome();
        s.drop();
      },
    ]);

    expect(sockets).toHaveLength(2);
    expect(events.filter((e) => e.type === "connected")).toHaveLength(2);
  });

  it("terminates a silent half-open socket so the dial loop can reconnect", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const first = scriptedSocket();
    const events: DialEvent[] = [];

    const done = dialIn({
      exchangeUrl: "https://mycel.example",
      credential: "sk-mycel-thor",
      heartbeatTimeoutMs: 75,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
      connect: () => first.socket,
      sleep: async () => controller.abort(),
    });

    first.open();
    first.welcome();
    await vi.advanceTimersByTimeAsync(76);
    await done;

    expect(first.terminations).toBe(1);
    expect(events).toContainEqual({
      type: "disconnected",
      code: 1006,
      reason: "heartbeat timeout",
    });
    expect(events.some((event) => event.type === "retrying")).toBe(true);
  });

  it("keeps a connection alive while Exchange pings arrive", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const first = scriptedSocket();

    const done = dialIn({
      exchangeUrl: "https://mycel.example",
      credential: "sk-mycel-thor",
      heartbeatTimeoutMs: 75,
      signal: controller.signal,
      connect: () => first.socket,
    });

    first.open();
    first.welcome();
    await vi.advanceTimersByTimeAsync(50);
    first.ping();
    await vi.advanceTimersByTimeAsync(50);
    expect(first.terminations).toBe(0);

    controller.abort();
    await done;
  });

  it("backs off further each time it fails to connect at all", async () => {
    const { events } = await runDial(
      [(s) => s.drop(), (s) => s.drop(), (s) => s.drop(), (s) => s.drop()],
      { minBackoffMs: 2 },
    );

    const waits = events
      .filter((e) => e.type === "retrying")
      .map((e) => e.inMs);
    // Doubling, so an Exchange that is down is not hammered by every machine
    // on every tick.
    expect(waits.slice(0, 3)).toEqual([4, 8, 16]);
  });

  it("resets the backoff after a Connection that actually lived", async () => {
    const { events } = await runDial(
      [
        (s) => s.drop(),
        (s) => s.drop(),
        (s) => {
          s.open();
          s.welcome();
          s.drop();
        },
        (s) => s.drop(),
      ],
      { minBackoffMs: 2 },
    );

    const waits = events
      .filter((e) => e.type === "retrying")
      .map((e) => e.inMs);
    // A machine up for hours that drops once should come straight back, not
    // wait out an outage from last week.
    expect(waits[2]).toBe(2);
  });

  it("surfaces a stated refusal rather than a bare close", async () => {
    const { events } = await runDial([
      (s) => {
        s.open();
        s.goodbye("wire version 1 required");
        s.drop(4003);
      },
    ]);

    expect(events).toContainEqual({
      type: "refused",
      reason: "wire version 1 required",
    });
  });

  it("stops when told to, and does not dial again", async () => {
    const { sockets } = await runDial([
      (s) => {
        s.open();
        s.welcome();
        s.drop();
      },
    ]);

    // The abort fires with the last scripted socket; nothing further is dialled.
    expect(sockets).toHaveLength(1);
  });
});
