/**
 * Serving over a held Connection.
 *
 * The machine is faked at the Channel — these assert the multiplexing and the
 * endings, both of which are pure logic and neither of which needs a socket.
 * What matters is that the relay cannot tell this from a vendor's `fetch`: the
 * money path was written against a `Response` and must stay that way.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ConnectionRegistry, type Channel } from "./connections.js";
import { MemoryStore } from "../store/memory-store.js";
import { createConnectionTransport } from "./connection-transport.js";
import { supplierFixture } from "../store/conformance.js";

/** A machine that answers only when the test tells it to. */
function fakeMachine() {
  const messageListeners: ((frame: string) => void)[] = [];
  const closeListeners: ((clean: boolean) => void)[] = [];
  const sent: Record<string, unknown>[] = [];

  const channel: Channel = {
    close: () => closeListeners.forEach((l) => l(true)),
    send: (frame) => sent.push(JSON.parse(frame) as Record<string, unknown>),
    onMessage: (listener) => messageListeners.push(listener),
    onClose: (listener) => closeListeners.push(listener),
  };

  const reply = (frame: Record<string, unknown>) =>
    messageListeners.forEach((l) => l(JSON.stringify(frame)));

  return {
    channel,
    sent,
    /** What the Exchange pushed down, in order. */
    requests: () => sent.filter((f) => f.type === "request"),
    cancels: () => sent.filter((f) => f.type === "cancel"),
    head: (id: string, status = 200) => reply({ type: "response-head", id, status }),
    chunk: (id: string, data: string) => reply({ type: "chunk", id, data }),
    end: (id: string) => reply({ type: "end", id }),
    fail: (id: string, message: string) => reply({ type: "request-error", id, message }),
    drop: () => closeListeners.forEach((l) => l(false)),
  };
}

async function readAll(response: Response): Promise<string> {
  return await response.text();
}

describe("relaying over a Connection", () => {
  let registry: ConnectionRegistry;
  let machine: ReturnType<typeof fakeMachine>;
  const supplier = supplierFixture({ id: "thor", kind: "agent", baseUrl: "" });

  beforeEach(async () => {
    registry = new ConnectionRegistry({ store: new MemoryStore() });
    machine = fakeMachine();
    await registry.connect("thor", machine.channel);
  });

  function transportFor(ids: string[] = ["req-1", "req-2", "req-3"]) {
    let next = 0;
    return createConnectionTransport({
      registry,
      newId: () => ids[next++] ?? `req-${next}`,
      responseHeadTimeoutMs: 50,
    })(supplier);
  }

  it("pushes the buyer's body down the Connection unmodified", async () => {
    const transport = transportFor();
    const body = { model: "thor-gemma", messages: [{ role: "user", content: "hi" }] };
    void transport(body, new AbortController().signal).catch(() => {});
    await Promise.resolve();

    // The Exchange adds nothing. A Supplier that received a rewritten payload
    // would serve something the buyer did not ask for.
    expect(machine.requests()[0]).toMatchObject({ type: "request", id: "req-1", body });
  });

  it("returns a Response as soon as the machine reports a status", async () => {
    const transport = transportFor();
    const pending = transport({ model: "m" }, new AbortController().signal);
    await Promise.resolve();

    machine.head("req-1", 200);
    const response = await pending;
    expect(response.status).toBe(200);
  });

  it("relays a non-2xx from the runtime as itself", async () => {
    // The runtime answering 400 is the runtime answering. Turning that into a
    // transport failure would lose the buyer's actual error.
    const transport = transportFor();
    const pending = transport({ model: "m" }, new AbortController().signal);
    await Promise.resolve();

    machine.head("req-1", 400);
    machine.end("req-1");
    expect((await pending).status).toBe(400);
  });

  it("streams tokens as they arrive rather than buffering them", async () => {
    const transport = transportFor();
    const pending = transport({ model: "m" }, new AbortController().signal);
    await Promise.resolve();
    machine.head("req-1");

    const response = await pending;
    const reader = response.body!.getReader();

    machine.chunk("req-1", "one");
    // Readable before the response is finished — the relay counts completion
    // tokens per chunk and enforces Balance mid-generation, and neither works
    // against a body that only materialises at the end.
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("one");

    machine.chunk("req-1", "two");
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toBe("two");

    machine.end("req-1");
    expect((await reader.read()).done).toBe(true);
  });

  it("keeps concurrent requests on one Connection from interleaving", async () => {
    const transport = transportFor();
    const signal = new AbortController().signal;
    const first = transport({ model: "m" }, signal);
    await Promise.resolve();
    const second = transport({ model: "m" }, signal);
    await Promise.resolve();

    machine.head("req-1");
    machine.head("req-2");
    const [a, b] = [await first, await second];

    // Deliberately out of order, because a real machine will not answer in the
    // order it was asked.
    machine.chunk("req-2", "BBB");
    machine.chunk("req-1", "aaa");
    machine.chunk("req-2", "BBB");
    machine.end("req-2");
    machine.chunk("req-1", "aaa");
    machine.end("req-1");

    expect(await readAll(b)).toBe("BBBBBB");
    expect(await readAll(a)).toBe("aaaaaa");
  });

  it("ends the buyer's stream where the tokens stopped when the machine goes away", async () => {
    const transport = transportFor();
    const pending = transport({ model: "m" }, new AbortController().signal);
    await Promise.resolve();
    machine.head("req-1");
    const response = await pending;

    machine.chunk("req-1", "partial");
    machine.drop();

    // No buffering, no replay, no re-dispatch. The body errors, which the relay
    // already records as a supply failure — the same shape as a vendor's
    // connection dying mid-response (ADR 0025).
    await expect(readAll(response)).rejects.toThrow(/connection closed/);
  });

  it("fails the request rather than the body when the machine dies before answering", async () => {
    const transport = transportFor();
    const pending = transport({ model: "m" }, new AbortController().signal);
    await Promise.resolve();

    machine.drop();
    // Nothing was consumed, so this must surface as a transport failure and not
    // as an empty successful response.
    await expect(pending).rejects.toThrow(/connection closed/);
  });

  it("surfaces a machine that could not reach its own runtime", async () => {
    const transport = transportFor();
    const pending = transport({ model: "m" }, new AbortController().signal);
    await Promise.resolve();

    machine.fail("req-1", "ECONNREFUSED localhost:4000");
    await expect(pending).rejects.toThrow(/ECONNREFUSED/);
  });

  it("tells the machine to stop when the buyer hangs up", async () => {
    const transport = transportFor();
    const abort = new AbortController();
    const pending = transport({ model: "m" }, abort.signal);
    await Promise.resolve();
    machine.head("req-1");
    await pending;

    abort.abort();

    // Left unsent, the machine keeps burning GPU seconds producing tokens
    // nobody will receive and nobody will pay for.
    expect(machine.cancels()).toEqual([{ type: "cancel", id: "req-1" }]);
  });

  it("counts what is in flight, and stops counting when each one ends", async () => {
    const transport = transportFor();
    const signal = new AbortController().signal;
    // Caught, not discarded: the second one is failed deliberately below, and
    // an unobserved rejection is noise that hides a real one later.
    const swallow = () => {};
    void transport({ model: "m" }, signal).catch(swallow);
    await Promise.resolve();
    void transport({ model: "m" }, signal).catch(swallow);
    await Promise.resolve();

    // The Exchange pushes, so it is the only party that can know this.
    expect(registry.inFlight("thor")).toBe(2);

    machine.head("req-1");
    machine.end("req-1");
    expect(registry.inFlight("thor")).toBe(1);

    machine.fail("req-2", "runtime died");
    // Counted down on a failure exactly as on a clean finish, or the number
    // drifts upward for as long as the process lives.
    expect(registry.inFlight("thor")).toBe(0);
  });

  it("refuses when the machine is not connected at all", async () => {
    await registry.disconnect("thor", "closed");
    const transport = transportFor();

    // Dispatch should not have chosen it, so this is a race rather than a
    // routing mistake — but nothing was consumed either way.
    await expect(transport({ model: "m" }, new AbortController().signal)).rejects.toThrow(
      /not connected/,
    );
  });
});
