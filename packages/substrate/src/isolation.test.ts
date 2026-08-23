/**
 * Isolation laws (paper §3.2.3, §5.1.2): the same key resolves to different
 * bindings in different subtrees; realm boundaries confine both resolution
 * and reactivity; isolation is itself revertible.
 */

import { describe, it, expect } from "vitest";
import { createContext } from "./context.js";
import { serviceKey } from "./services.js";
import { mount } from "./component.js";

const db = serviceKey<{ label: string }>("db");
const log = serviceKey<{ level: string }>("log");

describe("realm resolution", () => {
  it("an isolated subtree resolves the key to its own binding; the rest of the tree is untouched", async () => {
    const root = createContext();
    root.provide(db, { label: "shared" });

    const sub = root.child();
    sub.isolate(db);
    sub.provide(db, { label: "private" });

    expect(root.get(db)?.label).toBe("shared");
    expect(sub.get(db)?.label).toBe("private");
    // A grandchild of the isolated subtree inherits the override.
    expect(sub.child().get(db)?.label).toBe("private");
  });

  it("keys that were not isolated keep resolving to the tree-wide realm", () => {
    const root = createContext();
    root.provide(log, { level: "info" });

    const sub = root.child();
    sub.isolate(db);
    expect(sub.get(log)?.level).toBe("info");
  });

  it("two isolated subtrees provide and consume the same key independently", async () => {
    const root = createContext();
    const events: string[] = [];

    const makeArea = (name: string) => {
      const area = root.child();
      area.isolate(db);
      area.provide(db, { label: name });
      const fiber = mount(area, {
        inject: [db],
        apply(_ctx, view) {
          events.push(`${name}-up:${view.get(db).label}`);
          return () => events.push(`${name}-down`);
        },
      });
      return { area, fiber };
    };

    const a = makeArea("alpha");
    const b = makeArea("beta");
    await a.fiber.settled();
    await b.fiber.settled();
    expect(events.sort()).toEqual(["alpha-up:alpha", "beta-up:beta"]);
  });
});

describe("reactivity respects realms", () => {
  it("a provider leaving one realm never deactivates a declarer in another", async () => {
    const root = createContext();
    const events: string[] = [];

    // Tree-wide declarer against the tree-wide binding.
    const treeWithdraw = root.provide(db, { label: "tree" });
    const treeDecl = root.declare({
      inject: [db],
      activate: (view) => {
        events.push(`tree-up:${view.get(db).label}`);
        return () => events.push("tree-down");
      },
    });

    // Isolated declarer against the isolated binding.
    const sub = root.child();
    sub.isolate(db);
    const subProvider = sub.child();
    subProvider.provide(db, { label: "island" });
    const subDecl = sub.declare({
      inject: [db],
      activate: (view) => {
        events.push(`island-up:${view.get(db).label}`);
        return () => events.push("island-down");
      },
    });
    await treeDecl.settled();
    await subDecl.settled();
    expect(events.sort()).toEqual(["island-up:island", "tree-up:tree"]);

    // Withdraw the island's provider: only the island reacts.
    await subProvider.dispose();
    await treeDecl.settled();
    await subDecl.settled();
    expect(treeDecl.active).toBe(true);
    expect(subDecl.active).toBe(false);
    expect(events).toContain("island-down");
    expect(events).not.toContain("tree-down");

    // And the other direction: the tree's provider leaves, island stays...
    // (already down here, but the isolated declarer must not churn).
    const churnBefore = events.length;
    await treeWithdraw();
    await treeDecl.settled();
    expect(treeDecl.active).toBe(false);
    expect(events.length).toBe(churnBefore + 1); // exactly "tree-down"
  });

  it("a declaration in an isolated subtree stays inactive until ITS realm is provided", async () => {
    const root = createContext();
    root.provide(db, { label: "tree" });

    const sub = root.child();
    sub.isolate(db);
    const decl = sub.declare({
      inject: [db],
      activate: () => {},
    });
    await decl.settled();

    // The tree-wide binding exists, but this declaration's realm is empty.
    expect(decl.active).toBe(false);
    expect(decl.missing.map((k) => k.id)).toEqual(["db"]);

    sub.provide(db, { label: "island" });
    await decl.settled();
    expect(decl.active).toBe(true);
  });
});

describe("named realms", () => {
  it("two subtrees naming the same realm share a binding", async () => {
    const root = createContext();
    const left = root.child();
    const right = root.child();
    left.isolate(db, "shared-island");
    right.isolate(db, "shared-island");

    left.provide(db, { label: "from-left" });
    expect(right.get(db)?.label).toBe("from-left");

    const decl = right.declare({ inject: [db], activate: () => {} });
    await decl.settled();
    expect(decl.active).toBe(true);
  });
});

describe("isolation is revertible", () => {
  it("disposing the isolated subtree removes the override and its bindings; the tree realm is intact", async () => {
    const root = createContext();
    root.provide(db, { label: "tree" });

    const sub = root.child();
    sub.isolate(db);
    sub.provide(db, { label: "island" });
    expect(sub.get(db)?.label).toBe("island");

    await sub.dispose();
    expect(root.get(db)?.label).toBe("tree");
    // A fresh subtree resolves to the tree realm again.
    expect(root.child().get(db)?.label).toBe("tree");
  });

  it("reverting just the isolate effect restores tree-wide resolution", async () => {
    const root = createContext();
    root.provide(db, { label: "tree" });

    const sub = root.child();
    const undo = sub.isolate(db);
    expect(sub.get(db)).toBeUndefined(); // isolated, nothing provided there

    await undo();
    expect(sub.get(db)?.label).toBe("tree");
  });

  it("double-isolating the same key on one context is refused", () => {
    const root = createContext();
    const sub = root.child();
    sub.isolate(db);
    expect(() => sub.isolate(db)).toThrow(/already isolated/);
  });
});
