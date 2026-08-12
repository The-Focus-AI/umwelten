/**
 * The agent side of dialling in.
 *
 * The socket is faked so these stay fast and deterministic — the real one is
 * exercised end to end from the Exchange's side. What matters here is the loop:
 * a dropped link is the routine case, not a failure, because this is a laptop
 * and laptops close.
 */

import { describe, it, expect } from "vitest";
import { dialIn, WIRE_VERSION, type DialEvent, type DialSocket } from "./dial.js";

/** A socket whose lifecycle the test drives. */
function scriptedSocket() {
  const listeners: {
    open: (() => void)[];
    message: ((data: string) => void)[];
    close: ((code?: number, reason?: string) => void)[];
    error: ((error: Error) => void)[];
  } = { open: [], message: [], close: [], error: [] };

  const sent: string[] = [];
  const socket: DialSocket = {
    send: (data) => sent.push(data),
    close: () => listeners.close.forEach((l) => l(1000, "closed")),
    onOpen: (l) => listeners.open.push(l),
    onMessage: (l) => listeners.message.push(l),
    onClose: (l) => listeners.close.push(l),
    onError: (l) => listeners.error.push(l),
  };

  return {
    socket,
    sent,
    open: () => listeners.open.forEach((l) => l()),
    welcome: () =>
      listeners.message.forEach((l) =>
        l(JSON.stringify({ type: "welcome", wireVersion: WIRE_VERSION, supplierId: "thor" })),
      ),
    goodbye: (reason: string) =>
      listeners.message.forEach((l) => l(JSON.stringify({ type: "goodbye", reason }))),
    drop: (code = 1006) => listeners.close.forEach((l) => l(code, "gone")),
  };
}

/** Run the dial loop for a scripted sequence of sockets, then stop it. */
async function runDial(
  script: ((socket: ReturnType<typeof scriptedSocket>) => void)[],
  opts: { minBackoffMs?: number } = {},
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

describe("dialling in", () => {
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

  it("backs off further each time it fails to connect at all", async () => {
    const { events } = await runDial(
      [(s) => s.drop(), (s) => s.drop(), (s) => s.drop(), (s) => s.drop()],
      { minBackoffMs: 2 },
    );

    const waits = events.filter((e) => e.type === "retrying").map((e) => e.inMs);
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

    const waits = events.filter((e) => e.type === "retrying").map((e) => e.inMs);
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

    expect(events).toContainEqual({ type: "refused", reason: "wire version 1 required" });
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
