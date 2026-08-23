/**
 * Component lifecycle laws (paper §4.3, Algorithm 5):
 *  - a component with no declarations activates on mount, reverts on unmount
 *  - a declaring component waits for its services, with no caller orchestration
 *  - transitions are inertial: in-flight loads complete, then chain
 *  - unmounting a parent cascades to what it mounted
 */

import { describe, it, expect } from "vitest";
import { createContext } from "./context.js";
import { serviceKey } from "./services.js";
import { mount, type ComponentSpec } from "./component.js";

const db = serviceKey<{ label: string }>("db");
const cache = serviceKey<{ size: number }>("cache");

describe("mount and unmount", () => {
  it("a component with no declarations activates immediately and unmount reverts it", async () => {
    const events: string[] = [];
    const root = createContext();

    const fiber = mount(root, {
      name: "greeter",
      apply(ctx) {
        events.push("up");
        ctx.effect(() => () => events.push("effect-undone"));
        return () => events.push("inverse");
      },
    });
    await fiber.settled();
    expect(fiber.active).toBe(true);

    await fiber.unmount();
    expect(fiber.active).toBe(false);
    expect(events).toEqual(["up", "inverse", "effect-undone"]);
  });

  it("unmount is idempotent and permanent — services returning do not revive it", async () => {
    const root = createContext();
    let activations = 0;
    const withdraw = root.provide(db, { label: "one" });

    const fiber = mount(root, {
      inject: [db],
      apply: () => {
        activations += 1;
      },
    });
    await fiber.settled();
    expect(activations).toBe(1);

    await fiber.unmount();
    await fiber.unmount();

    await withdraw();
    root.provide(db, { label: "two" });
    await fiber.settled();
    expect(fiber.active).toBe(false);
    expect(activations).toBe(1);
  });

  it("config reaches apply", async () => {
    const root = createContext();
    let received: string | undefined;
    const banner: ComponentSpec<{ text: string }> = {
      apply: (_ctx, _view, config) => {
        received = config.text;
      },
    };
    const fiber = mount(root, banner, { text: "hello" });
    await fiber.settled();
    expect(received).toBe("hello");
  });

  it("disposing the mounting context unmounts the fiber", async () => {
    const events: string[] = [];
    const root = createContext();
    const area = root.child();
    const fiber = mount(area, {
      apply: () => () => events.push("down"),
    });
    await fiber.settled();

    await area.dispose();
    expect(events).toEqual(["down"]);
    expect(fiber.active).toBe(false);
  });
});

describe("reactive lifecycle", () => {
  it("a declaring component waits, activates, deactivates, reactivates — no orchestration", async () => {
    const events: string[] = [];
    const root = createContext();

    const fiber = mount(root, {
      name: "reporter",
      inject: [db, cache],
      apply(_ctx, view) {
        events.push(`up:${view.get(db).label}:${view.get(cache).size}`);
        return () => events.push("down");
      },
    });
    await fiber.settled();
    expect(fiber.active).toBe(false);
    expect(fiber.missing.map((k) => k.id).sort()).toEqual(["cache", "db"]);

    root.provide(cache, { size: 8 });
    const withdrawDb = root.provide(db, { label: "primary" });
    await fiber.settled();
    expect(fiber.active).toBe(true);
    expect(events).toEqual(["up:primary:8"]);

    await withdrawDb();
    await fiber.settled();
    expect(fiber.active).toBe(false);

    root.provide(db, { label: "replica" });
    await fiber.settled();
    expect(events).toEqual(["up:primary:8", "down", "up:replica:8"]);
  });
});

describe("inertial transitions", () => {
  it("a withdrawal during a slow load lets the load complete, then chains the unload", async () => {
    const events: string[] = [];
    const root = createContext();
    let releaseLoad!: () => void;
    const gate = new Promise<void>((r) => {
      releaseLoad = r;
    });

    const withdraw = root.provide(db, { label: "slow" });
    const fiber = mount(root, {
      inject: [db],
      async apply(_ctx, view) {
        await gate; // a genuinely slow setup
        events.push(`loaded:${view.get(db).label}`);
        return () => events.push("unloaded");
      },
    });

    // Withdraw while the load is still in flight. Inertia: the load must
    // complete (against its committed view) before the unload runs.
    const withdrawal = withdraw();
    releaseLoad();
    await withdrawal;
    await fiber.settled();

    expect(events).toEqual(["loaded:slow", "unloaded"]);
    expect(fiber.active).toBe(false);
  });

  it("unmount during a slow load completes the load first, then unloads", async () => {
    const events: string[] = [];
    const root = createContext();
    let releaseLoad!: () => void;
    const gate = new Promise<void>((r) => {
      releaseLoad = r;
    });
    let signalStarted!: () => void;
    const started = new Promise<void>((r) => {
      signalStarted = r;
    });

    const fiber = mount(root, {
      async apply() {
        signalStarted();
        await gate;
        events.push("loaded");
        return () => events.push("unloaded");
      },
    });

    await started; // the load is genuinely in flight now
    const unmounting = fiber.unmount();
    releaseLoad();
    await unmounting;

    expect(events).toEqual(["loaded", "unloaded"]);
  });

  it("unmount before the load has begun skips it entirely — nothing was in flight", async () => {
    const events: string[] = [];
    const root = createContext();

    const fiber = mount(root, {
      async apply() {
        events.push("loaded");
        return () => events.push("unloaded");
      },
    });

    // Unmount synchronously: the queued transition finds its target gone
    // and never starts. Inertia protects in-flight transitions, not queued
    // ones.
    await fiber.unmount();
    expect(events).toEqual([]);
  });
});

describe("cascade", () => {
  it("a component that mounts sub-components unmounts them first, and a provider chain drains in order", async () => {
    const events: string[] = [];
    const root = createContext();

    const child: ComponentSpec = {
      name: "child",
      inject: [cache],
      apply(_ctx, view) {
        events.push(`child-up:${view.get(cache).size}`);
        return () => events.push("child-down");
      },
    };

    const parent = mount(root, {
      name: "parent",
      apply(ctx) {
        events.push("parent-up");
        ctx.provide(cache, { size: 4 });
        mount(ctx, child);
        return () => events.push("parent-down");
      },
    });
    await parent.settled();
    // Let the sub-mount's activation settle too.
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual(["parent-up", "child-up:4"]);

    await parent.unmount();
    // The child (dependent of the parent's provision) drains before the
    // parent's inverses — the ordering law reaching through mount.
    expect(events).toEqual([
      "parent-up",
      "child-up:4",
      "child-down",
      "parent-down",
    ]);
  });
});
