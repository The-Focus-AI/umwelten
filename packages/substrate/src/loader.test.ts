/**
 * Loader laws (paper §5.2, Algorithm 10 simplified): reconciliation touches
 * only changed entries; disabled unmounts and remembers; a failed
 * replacement leaves the running component untouched.
 */

import { describe, it, expect } from "vitest";
import { createContext } from "./context.js";
import { serviceKey } from "./services.js";
import { Loader, type ImportModule } from "./loader.js";
import type { ComponentSpec } from "./component.js";

const ping = serviceKey<string>("ping");

function specLogging(
  events: string[],
  name: string,
): ComponentSpec<unknown> {
  return {
    name,
    apply(_ctx, _view, config) {
      events.push(`${name}-up${config ? `:${JSON.stringify(config)}` : ""}`);
      return () => events.push(`${name}-down`);
    },
  };
}

/** A fake module source: url → versioned specs, recording import counts. */
function fakeModules(
  modules: Record<string, (generation: number) => unknown>,
) {
  const imports: string[] = [];
  const importModule: ImportModule = async (url, generation) => {
    imports.push(`${url}@${generation}`);
    const make = modules[url];
    if (!make) throw new Error(`no such module: ${url}`);
    const result = make(generation);
    if (result instanceof Error) throw result;
    return { default: result };
  };
  return { imports, importModule };
}

describe("reconciliation", () => {
  it("realizes added entries, retires removed ones, leaves the rest untouched", async () => {
    const events: string[] = [];
    const root = createContext();
    const loader = new Loader(root);

    const a = { id: "a", component: specLogging(events, "a") };
    const b = { id: "b", component: specLogging(events, "b") };
    await loader.apply([a, b]);
    expect(events).toEqual(["a-up", "b-up"]);
    const fiberB = loader.entries().find((e) => e.id === "b")?.fiber;

    await loader.apply([b]); // a leaves, b stays
    expect(events).toEqual(["a-up", "b-up", "a-down"]);
    // Untouched means the same fiber, not an equivalent one.
    expect(loader.entries().find((e) => e.id === "b")?.fiber).toBe(fiberB);
  });

  it("disabled unmounts; re-enabling remounts with full recovery between", async () => {
    const events: string[] = [];
    const root = createContext();
    const loader = new Loader(root);
    const spec = specLogging(events, "x");

    await loader.apply([{ id: "x", component: spec }]);
    await loader.apply([{ id: "x", component: spec, disabled: true }]);
    expect(events).toEqual(["x-up", "x-down"]);
    expect(loader.entries()[0].fiber).toBeUndefined();

    await loader.apply([{ id: "x", component: spec }]);
    expect(events).toEqual(["x-up", "x-down", "x-up"]);
  });

  it("a config change rebuilds the entry with the new payload", async () => {
    const events: string[] = [];
    const root = createContext();
    const loader = new Loader(root);
    const spec = specLogging(events, "cfg");

    await loader.apply([{ id: "c", component: spec, config: { n: 1 } }]);
    await loader.apply([{ id: "c", component: spec, config: { n: 2 } }]);
    expect(events).toEqual(['cfg-up:{"n":1}', "cfg-down", 'cfg-up:{"n":2}']);

    // Same config again: no churn.
    await loader.apply([{ id: "c", component: spec, config: { n: 2 } }]);
    expect(events).toHaveLength(3);
  });

  it("loaded components participate in services like any other", async () => {
    const root = createContext();
    const loader = new Loader(root);
    const seen: string[] = [];

    await loader.apply([
      {
        id: "provider",
        component: {
          apply: (ctx) => void ctx.provide(ping, "pong"),
        },
      },
      {
        id: "consumer",
        component: {
          inject: [ping],
          apply: (_ctx, view) => void seen.push(view.get(ping)),
        },
      },
    ]);
    const consumer = loader.entries().find((e) => e.id === "consumer");
    await consumer?.fiber?.settled();
    expect(seen).toEqual(["pong"]);
  });

  it("disposing the loader's context retires everything", async () => {
    const events: string[] = [];
    const root = createContext();
    const area = root.child();
    const loader = new Loader(area);
    await loader.apply([
      { id: "a", component: specLogging(events, "a") },
      { id: "b", component: specLogging(events, "b") },
    ]);

    await area.dispose();
    expect(events).toEqual(["a-up", "b-up", "b-down", "a-down"]);
  });
});

describe("modules and hot replacement", () => {
  it("loads a module entry via import, versioned per generation", async () => {
    const events: string[] = [];
    const { imports, importModule } = fakeModules({
      "app://widget": (g) => specLogging(events, `widget-v${g}`),
    });
    const root = createContext();
    const loader = new Loader(root, { importModule });

    await loader.apply([{ id: "w", url: "app://widget" }]);
    expect(imports).toEqual(["app://widget@1"]);
    expect(events).toEqual(["widget-v1-up"]);
  });

  it("reload re-imports and swaps the running fiber", async () => {
    const events: string[] = [];
    const { imports, importModule } = fakeModules({
      "app://widget": (g) => specLogging(events, `widget-v${g}`),
    });
    const root = createContext();
    const loader = new Loader(root, { importModule });
    await loader.apply([{ id: "w", url: "app://widget" }]);

    await loader.reload("w");
    expect(imports).toEqual(["app://widget@1", "app://widget@2"]);
    expect(events).toEqual(["widget-v1-up", "widget-v1-down", "widget-v2-up"]);
  });

  it("a broken replacement leaves the old component running and records the error", async () => {
    const events: string[] = [];
    let broken = false;
    const { importModule } = fakeModules({
      "app://widget": (g) =>
        broken ? new Error("syntax error") : specLogging(events, `v${g}`),
    });
    const root = createContext();
    const loader = new Loader(root, { importModule });
    await loader.apply([{ id: "w", url: "app://widget" }]);
    expect(events).toEqual(["v1-up"]);

    broken = true;
    await loader.reload("w");

    const status = loader.entries()[0];
    expect((status.error as Error).message).toBe("syntax error");
    expect(status.fiber?.active).toBe(true); // v1 never went down
    expect(events).toEqual(["v1-up"]);

    // The fix lands; the next reload swaps cleanly.
    broken = false;
    await loader.reload("w");
    expect(events).toEqual(["v1-up", "v1-down", "v3-up"]);
  });

  it("a module that fails on first load errors that entry alone", async () => {
    const events: string[] = [];
    const { importModule } = fakeModules({
      "app://bad": () => new Error("cannot import"),
      "app://good": (g) => specLogging(events, `good-v${g}`),
    });
    const root = createContext();
    const loader = new Loader(root, { importModule });

    await loader.apply([
      { id: "bad", url: "app://bad" },
      { id: "good", url: "app://good" },
    ]);
    const byId = Object.fromEntries(loader.entries().map((e) => [e.id, e]));
    expect((byId.bad.error as Error).message).toBe("cannot import");
    expect(byId.good.fiber?.active).toBe(true);
    expect(events).toEqual(["good-v1-up"]);
  });

  it("a module without a default component export is a load error", async () => {
    const { importModule } = fakeModules({
      "app://not-a-component": () => ({ notASpec: true }),
    });
    const root = createContext();
    const loader = new Loader(root, { importModule });
    await loader.apply([{ id: "n", url: "app://not-a-component" }]);
    expect(String(loader.entries()[0].error)).toMatch(/default-export/);
  });
});
