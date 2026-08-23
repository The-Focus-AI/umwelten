/**
 * The paper's effect laws (§3.1) as executable assertions:
 *  - track/recover round-trip: recovery restores the initial state
 *  - homomorphism: composed effects compose their inverses in reverse
 *  - dispose-once: an inverse fires at most once, from any path
 *  - cascade: a child context is recovered by its parent's disposal
 */

import { describe, it, expect } from "vitest";
import { ContextDisposedError, createContext } from "./context.js";

describe("revertible effects", () => {
  it("round-trips: tracked effects are recovered to the initial state", async () => {
    const store: Record<string, number> = { a: 1 };
    const ctx = createContext();

    ctx.effect(() => {
      store.a = 2;
      return () => {
        store.a = 1;
      };
    });
    ctx.effect(() => {
      store.b = 10;
      return () => {
        delete store.b;
      };
    });

    expect(store).toEqual({ a: 2, b: 10 });
    await ctx.dispose();
    expect(store).toEqual({ a: 1 });
  });

  it("replays inverses in LIFO order", async () => {
    const order: string[] = [];
    const ctx = createContext();
    for (const name of ["f1", "f2", "f3"]) {
      ctx.effect(() => () => {
        order.push(name);
      });
    }
    await ctx.dispose();
    expect(order).toEqual(["f3", "f2", "f1"]);
  });

  it("LIFO recovery survives effects whose state overlaps", async () => {
    // f2 overwrites what f1 wrote; only g2-before-g1 restores the start.
    let value = "initial";
    const ctx = createContext();
    ctx.effect(() => {
      const prev = value;
      value = "after-f1";
      return () => {
        value = prev;
      };
    });
    ctx.effect(() => {
      const prev = value;
      value = "after-f2";
      return () => {
        value = prev;
      };
    });
    await ctx.dispose();
    expect(value).toBe("initial");
  });

  it("an effect's disposer runs at most once, from any path", async () => {
    let undone = 0;
    const ctx = createContext();
    const dispose = ctx.effect(() => () => {
      undone += 1;
    });

    await dispose();
    await dispose();
    expect(undone).toBe(1);

    // Context recovery skips the already-disposed effect.
    await ctx.dispose();
    expect(undone).toBe(1);
  });

  it("an effect with no inverse is legal and recovery passes over it", async () => {
    const order: string[] = [];
    const ctx = createContext();
    ctx.effect(() => () => {
      order.push("g1");
    });
    ctx.effect(() => {
      /* observes, reverts nothing */
    });
    ctx.effect(() => () => {
      order.push("g3");
    });
    await ctx.dispose();
    expect(order).toEqual(["g3", "g1"]);
  });

  it("a synchronous throw in the callback tracks nothing", async () => {
    const ctx = createContext();
    expect(() =>
      ctx.effect(() => {
        throw new Error("setup failed");
      }),
    ).toThrow("setup failed");
    await ctx.dispose(); // nothing to recover, nothing throws
  });

  it("awaits an in-flight async effect before reverting it", async () => {
    const events: string[] = [];
    const ctx = createContext();
    let releaseSetup!: () => void;
    const gate = new Promise<void>((r) => {
      releaseSetup = r;
    });

    ctx.effect(async () => {
      await gate;
      events.push("setup-complete");
      return () => {
        events.push("reverted");
      };
    });

    const disposal = ctx.dispose();
    expect(events).toEqual([]); // recovery is waiting on the transition
    releaseSetup();
    await disposal;
    expect(events).toEqual(["setup-complete", "reverted"]);
  });

  it("a failed async effect has nothing to revert and does not poison recovery", async () => {
    let reverted = false;
    const ctx = createContext();
    ctx.effect(() => () => {
      reverted = true;
    });
    ctx.effect(async () => {
      throw new Error("async setup failed");
    });
    await ctx.dispose();
    expect(reverted).toBe(true);
  });

  it("a throwing inverse does not halt recovery, and the error surfaces", async () => {
    const order: string[] = [];
    const ctx = createContext();
    ctx.effect(() => () => {
      order.push("g1");
    });
    ctx.effect(() => () => {
      throw new Error("g2 failed");
    });
    ctx.effect(() => () => {
      order.push("g3");
    });

    await expect(ctx.dispose()).rejects.toThrow("g2 failed");
    expect(order).toEqual(["g3", "g1"]);
  });

  it("a disposed context refuses new effects", async () => {
    const ctx = createContext();
    await ctx.dispose();
    expect(() => ctx.effect(() => {})).toThrow(ContextDisposedError);
    expect(() => ctx.child()).toThrow(ContextDisposedError);
  });

  it("dispose is idempotent", async () => {
    let undone = 0;
    const ctx = createContext();
    ctx.effect(() => () => {
      undone += 1;
    });
    await ctx.dispose();
    await ctx.dispose();
    expect(undone).toBe(1);
  });
});

describe("context tree", () => {
  it("disposing a parent recovers its children (children before own earlier effects)", async () => {
    const order: string[] = [];
    const parent = createContext();
    parent.effect(() => () => {
      order.push("parent-effect");
    });
    const child = parent.child();
    child.effect(() => () => {
      order.push("child-effect");
    });

    await parent.dispose();
    expect(order).toEqual(["child-effect", "parent-effect"]);
    expect(child.disposed).toBe(true);
  });

  it("cascade reaches grandchildren, deepest first when built top-down", async () => {
    // Each level registers its own effect before deriving the next level,
    // the way a component sets up and then loads sub-components. LIFO then
    // recovers deepest-first.
    const order: string[] = [];
    const root = createContext();
    root.effect(() => () => order.push("root"));
    const mid = root.child();
    mid.effect(() => () => order.push("mid"));
    const leaf = mid.child();
    leaf.effect(() => () => order.push("leaf"));

    await root.dispose();
    expect(order).toEqual(["leaf", "mid", "root"]);
  });

  it("a child registered before a later effect is recovered after it (pure LIFO, no special-casing)", async () => {
    const order: string[] = [];
    const root = createContext();
    const child = root.child();
    child.effect(() => () => order.push("child"));
    root.effect(() => () => order.push("late-root-effect"));

    await root.dispose();
    // The later registration undoes first; the child is just an effect in
    // the stack, not a privileged phase.
    expect(order).toEqual(["late-root-effect", "child"]);
  });

  it("disposing a child directly detaches it from the parent", async () => {
    const order: string[] = [];
    const parent = createContext();
    const child = parent.child();
    child.effect(() => () => {
      order.push("child");
    });

    await child.dispose();
    expect(order).toEqual(["child"]);

    await parent.dispose();
    expect(order).toEqual(["child"]); // not recovered twice
  });

  it("a child records its parent", () => {
    const parent = createContext();
    const child = parent.child();
    expect(child.parent).toBe(parent);
    expect(parent.parent).toBeUndefined();
  });
});
