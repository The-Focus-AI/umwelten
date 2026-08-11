/**
 * The registry decides three things, and all three are testable without a
 * socket: who is connected, what happens when the same machine dials twice, and
 * what gets written down about it.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { ConnectionRegistry, type Channel } from "./connections.js";

/** A socket stand-in. Nothing here opens a port. */
function fakeChannel() {
  const listeners: (() => void)[] = [];
  let closed = false;
  const channel: Channel = {
    close: () => {
      closed = true;
    },
    onClose: (listener) => listeners.push(listener),
  };
  return {
    channel,
    get closed() {
      return closed;
    },
    /** The far end going away on its own — a lid closing, a process dying. */
    dropFromFarEnd: () => listeners.forEach((l) => l()),
  };
}

describe("the Connection registry", () => {
  let store: MemoryStore;
  let registry: ConnectionRegistry;
  let id = 0;

  beforeEach(() => {
    store = new MemoryStore();
    id = 0;
    registry = new ConnectionRegistry({ store, newId: () => `event-${++id}` });
  });

  it("is empty before anything dials in", () => {
    // Boot state, and it is the correct one: nothing is connected, because
    // nothing is. There is no column to disagree with this.
    expect(registry.connectedSupplierIds().size).toBe(0);
    expect(registry.isConnected("thor")).toBe(false);
  });

  it("holds a Connection once a machine dials in", async () => {
    await registry.connect("thor", fakeChannel().channel);

    expect(registry.isConnected("thor")).toBe(true);
    expect([...registry.connectedSupplierIds()]).toEqual(["thor"]);
  });

  it("stops holding it the moment the far end goes away", async () => {
    const socket = fakeChannel();
    await registry.connect("thor", socket.channel);

    socket.dropFromFarEnd();
    // No timeout, no window: the Connection ending is the event.
    await Promise.resolve();

    expect(registry.isConnected("thor")).toBe(false);
  });

  describe("when the same machine dials in twice", () => {
    it("keeps the newer Connection and hangs up the older", async () => {
      const first = fakeChannel();
      const second = fakeChannel();

      await registry.connect("thor", first.channel);
      await registry.connect("thor", second.channel);

      // The second socket is provably alive — packets just arrived on it. The
      // first is only presumed alive, which is what a slept laptop looks like.
      expect(first.closed).toBe(true);
      expect(second.closed).toBe(false);
      expect(registry.isConnected("thor")).toBe(true);
    });

    it("does not let the displaced socket's own close evict the replacement", async () => {
      const first = fakeChannel();
      const second = fakeChannel();

      await registry.connect("thor", first.channel);
      await registry.connect("thor", second.channel);
      // The old socket finally notices it is dead and fires its close.
      first.dropFromFarEnd();
      await Promise.resolve();

      expect(registry.isConnected("thor")).toBe(true);
    });

    it("records the displacement as its own reason", async () => {
      await registry.connect("thor", fakeChannel().channel);
      await registry.connect("thor", fakeChannel().channel);

      const events = await store.listConnectionEvents({ supplierId: "thor" });
      expect(events.map((e) => [e.event, e.reason])).toEqual([
        ["connected", undefined],
        ["disconnected", "displaced"],
        ["connected", undefined],
      ]);
    });
  });

  describe("the connection log", () => {
    it("records a connect and the disconnect that follows it", async () => {
      const socket = fakeChannel();
      await registry.connect("thor", socket.channel);
      socket.dropFromFarEnd();
      await Promise.resolve();

      const events = await store.listConnectionEvents({ supplierId: "thor" });
      expect(events.map((e) => e.event)).toEqual(["connected", "disconnected"]);
      expect(events[1].reason).toBe("transport-error");
    });

    it("keeps one machine's history separate from another's", async () => {
      await registry.connect("thor", fakeChannel().channel);
      await registry.connect("odin", fakeChannel().channel);

      expect(await store.listConnectionEvents({ supplierId: "thor" })).toHaveLength(1);
      expect(await store.listConnectionEvents()).toHaveLength(2);
    });

    it("distinguishes a deliberate shutdown from a machine going away", async () => {
      await registry.connect("thor", fakeChannel().channel);
      await registry.closeAll();

      const [, disconnect] = await store.listConnectionEvents({ supplierId: "thor" });
      expect(disconnect.reason).toBe("shutdown");
    });

    it("does not record a disconnect for a machine that was never connected", async () => {
      await registry.disconnect("never-dialled", "closed");

      expect(await store.listConnectionEvents()).toEqual([]);
    });
  });

  describe("in-flight requests", () => {
    it("counts up and back down", async () => {
      await registry.connect("thor", fakeChannel().channel);

      const done = registry.trackInFlight("thor");
      expect(registry.inFlight("thor")).toBe(1);

      done();
      expect(registry.inFlight("thor")).toBe(0);
    });

    it("counts several at once, because one Connection serves many requests", async () => {
      await registry.connect("thor", fakeChannel().channel);

      const a = registry.trackInFlight("thor");
      const b = registry.trackInFlight("thor");
      expect(registry.inFlight("thor")).toBe(2);

      a();
      expect(registry.inFlight("thor")).toBe(1);
      b();
      expect(registry.inFlight("thor")).toBe(0);
    });

    it("ignores a release called twice", async () => {
      await registry.connect("thor", fakeChannel().channel);

      const done = registry.trackInFlight("thor");
      done();
      done();

      // Every exit path in the relay releases, and some of them overlap — a
      // buyer hanging up mid-stream runs both the abort path and the finally.
      expect(registry.inFlight("thor")).toBe(0);
    });

    it("reports zero for a machine that is not connected", () => {
      expect(registry.inFlight("thor")).toBe(0);
      // And tracking against one is a no-op rather than a crash: the Connection
      // can go away between Dispatch selecting it and the relay starting.
      expect(() => registry.trackInFlight("thor")()).not.toThrow();
    });
  });
});
