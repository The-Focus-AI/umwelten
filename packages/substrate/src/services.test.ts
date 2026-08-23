/**
 * The service laws (paper §3.2, and the ordering discipline of Algorithm 5):
 *  - a declaration activates only when everything it declares is present
 *  - it deactivates when anything leaves, and reactivates on return
 *  - ordering: a departing provider's dependents drain — reading their
 *    committed view — before the binding is removed
 *  - provider chains drain transitively, without deadlock
 */

import { describe, it, expect } from "vitest";
import { createContext } from "./context.js";
import { serviceKey } from "./services.js";

const db = serviceKey<{ query: (q: string) => string }>("db");
const chat = serviceKey<{ send: (m: string) => void }>("chat");

describe("provide/get", () => {
  it("binds a value and withdraws it on dispose", async () => {
    const root = createContext();
    const provider = root.child();
    provider.provide(db, { query: () => "row" });

    expect(root.get(db)?.query("x")).toBe("row");
    await provider.dispose();
    expect(root.get(db)).toBeUndefined();
  });

  it("one provider per key at a time", () => {
    const root = createContext();
    root.provide(db, { query: () => "a" });
    expect(() => root.provide(db, { query: () => "b" })).toThrow(
      /already provided/,
    );
  });

  it("withdraw then re-provide works (sequential swap)", async () => {
    const root = createContext();
    const first = root.provide(db, { query: () => "first" });
    await first();
    root.provide(db, { query: () => "second" });
    expect(root.get(db)?.query("x")).toBe("second");
  });
});

describe("reactive activation", () => {
  it("activates only when every declared service is present, in either order", async () => {
    const root = createContext();
    const log: string[] = [];

    const decl = root.declare({
      inject: [db, chat],
      activate(view) {
        log.push(`up:${view.get(db).query("ping")}`);
        return () => log.push("down");
      },
    });

    await decl.settled();
    expect(decl.active).toBe(false);
    expect(decl.missing.map((k) => k.id).sort()).toEqual(["chat", "db"]);

    root.provide(db, { query: () => "pong" });
    await decl.settled();
    expect(decl.active).toBe(false); // chat still missing

    root.provide(chat, { send: () => {} });
    await decl.settled();
    expect(decl.active).toBe(true);
    expect(decl.missing).toEqual([]);
    expect(log).toEqual(["up:pong"]);
  });

  it("declaring after the services exist activates immediately", async () => {
    const root = createContext();
    root.provide(db, { query: () => "ready" });
    const decl = root.declare({
      inject: [db],
      activate: () => {},
    });
    await decl.settled();
    expect(decl.active).toBe(true);
  });

  it("deactivates when a service leaves and reactivates when it returns", async () => {
    const root = createContext();
    const log: string[] = [];
    const withdraw = root.provide(db, { query: () => "v1" });

    const decl = root.declare({
      inject: [db],
      activate(view) {
        log.push(`up:${view.get(db).query("q")}`);
        return () => log.push("down");
      },
    });
    await decl.settled();
    expect(log).toEqual(["up:v1"]);

    await withdraw();
    await decl.settled();
    expect(decl.active).toBe(false);
    expect(log).toEqual(["up:v1", "down"]);

    root.provide(db, { query: () => "v2" });
    await decl.settled();
    expect(decl.active).toBe(true);
    expect(log).toEqual(["up:v1", "down", "up:v2"]); // fresh committed view
  });

  it("activation effects revert on deactivation, LIFO", async () => {
    const root = createContext();
    const order: string[] = [];
    const withdraw = root.provide(db, { query: () => "" });

    root.declare({
      inject: [db],
      activate(_view, ctx) {
        ctx.effect(() => () => order.push("undo-1"));
        ctx.effect(() => () => order.push("undo-2"));
        return () => order.push("undo-returned");
      },
    });

    await withdraw();
    // Returned inverse was tracked last → runs first.
    expect(order).toEqual(["undo-returned", "undo-2", "undo-1"]);
  });
});

describe("the ordering law", () => {
  it("dependents drain before the provider's binding is removed, reading the committed view", async () => {
    const root = createContext();
    const events: string[] = [];
    const connection = {
      open: true,
      query: (q: string) => q.toUpperCase(),
    };

    const provider = root.child();
    provider.provide(db, connection);
    provider.effect(() => () => {
      events.push("provider-own-effect-reverted");
    });

    const decl = root.declare({
      inject: [db],
      activate(view) {
        events.push("dependent-up");
        return () => {
          // Teardown uses the service it activated against — the law says
          // this read happens while the binding still resolves.
          events.push(`dependent-drained:${view.get(db).query("bye")}`);
        };
      },
    });
    await decl.settled();

    await provider.dispose();

    // The drain precedes the provider's WHOLE recovery (paper §5.1.3):
    // dependents finish before even the provider's own later effects
    // revert — not merely before the binding's removal.
    expect(events).toEqual([
      "dependent-up",
      "dependent-drained:BYE",
      "provider-own-effect-reverted",
    ]);
    expect(decl.active).toBe(false);
    expect(root.get(db)).toBeUndefined();
  });

  it("a provider chain drains transitively without deadlock", async () => {
    // A provides db. B declares db and, while active, provides chat.
    // C declares chat. Disposing A must drain C, then B, then remove db.
    const root = createContext();
    const events: string[] = [];

    const a = root.child();
    a.provide(db, { query: () => "ok" });

    const b = root.declare({
      inject: [db],
      activate(_view, ctx) {
        events.push("B-up");
        ctx.provide(chat, { send: () => {} });
        return () => events.push("B-down");
      },
    });
    await b.settled();

    const c = root.declare({
      inject: [chat],
      activate() {
        events.push("C-up");
        return () => events.push("C-down");
      },
    });
    await c.settled();
    expect(events).toEqual(["B-up", "C-up"]);

    await a.dispose();
    await b.settled();
    await c.settled();

    expect(events).toEqual(["B-up", "C-up", "C-down", "B-down"]);
    expect(b.active).toBe(false);
    expect(c.active).toBe(false);
    expect(root.get(db)).toBeUndefined();
    expect(root.get(chat)).toBeUndefined();
  }, 5000);

  it("a leaving binding is invisible to new reads and new declarations", async () => {
    const root = createContext();
    let sawDuringDrain: unknown = "unset";

    const provider = root.child();
    provider.provide(db, { query: () => "x" });

    const decl = root.declare({
      inject: [db],
      activate() {
        return () => {
          // Mid-drain: raw get() must already report the service gone.
          sawDuringDrain = root.get(db);
        };
      },
    });
    await decl.settled();

    await provider.dispose();
    expect(sawDuringDrain).toBeUndefined();
  });
});

describe("declaration lifecycle and failure", () => {
  it("disposing the declaring context deactivates and unregisters", async () => {
    const root = createContext();
    const log: string[] = [];
    root.provide(db, { query: () => "" });

    const owner = root.child();
    const decl = owner.declare({
      inject: [db],
      activate: () => () => log.push("down"),
    });
    await decl.settled();
    expect(decl.active).toBe(true);

    await owner.dispose();
    expect(decl.active).toBe(false);
    expect(log).toEqual(["down"]);
  });

  it("a failed activation stays inactive, reverts partial setup, and records the error", async () => {
    const root = createContext();
    const undone: string[] = [];
    root.provide(db, { query: () => "" });

    const decl = root.declare({
      inject: [db],
      activate(_view, ctx) {
        ctx.effect(() => () => undone.push("partial"));
        throw new Error("activation exploded");
      },
    });
    await decl.settled();

    expect(decl.active).toBe(false);
    expect(undone).toEqual(["partial"]);
    expect((decl.error as Error).message).toBe("activation exploded");
  });

  it("a failed activation still responds to later changes", async () => {
    const root = createContext();
    let attempts = 0;
    const withdraw = root.provide(db, { query: () => "" });

    const decl = root.declare({
      inject: [db],
      activate() {
        attempts += 1;
        if (attempts === 1) throw new Error("first time fails");
      },
    });
    await decl.settled();
    expect(decl.active).toBe(false);

    // The service cycles; the declaration recovers on the next activation.
    await withdraw();
    root.provide(db, { query: () => "" });
    await decl.settled();
    expect(decl.active).toBe(true);
    expect(decl.error).toBeUndefined();
  });
});
