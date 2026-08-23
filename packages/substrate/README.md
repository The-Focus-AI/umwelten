# @umwelten/substrate

The composition runtime interfaces — and eventually habitat internals — grow
on (ADR 0031 — interfaces and habitat internals compose on the substrate).
Implements the model of ["A Programming Paradigm for Spatiotemporal
Composability"](https://github.com/cordiverse/paper): components perform
**revertible effects** when they load, declare the **Services** they need,
and are removed by reverting their effects.

Zero dependencies, isomorphic (Node and browser). Domain language lives in
the repo-root `CONTEXT.md` under *Substrate & composition*.

## Current state

| Mechanism | Status | Ticket |
| --- | --- | --- |
| Revertible effects on a context tree | ✅ | #395 |
| Services: provide/inject, reactive activation | ✅ | #396 |
| Component lifecycle, inertial transitions | — | #397 |
| Isolation realms | — | #398 |
| Loader: declarative entries, reconciliation, HMR | — | #399 |

## Revertible effects

```ts
import { createContext } from "@umwelten/substrate";

const ctx = createContext();

// Every mutation supplies its inverse at the point of application.
ctx.effect(() => {
  routes.set("/chat", handler);
  return () => routes.delete("/chat");
});

const child = ctx.child();   // a child's disposal is an effect of the parent
child.effect(async () => {
  const conn = await pool.acquire();
  return () => pool.release(conn);
});

await ctx.dispose();          // replays every inverse, LIFO, children first
```

Guarantees (tested in `src/context.test.ts` against the paper's laws):
recovery restores the initial state; inverses run LIFO; each runs at most
once from any path; recovery waits for in-flight async effects; a throwing
inverse doesn't halt the rest; parent disposal cascades depth-first.

## Services

```ts
import { serviceKey } from "@umwelten/substrate";

const db = serviceKey<Database>("db");

provider.provide(db, connection);          // a revertible effect

const decl = ctx.declare({
  inject: [db],
  activate(view, ctx) {                    // runs when everything is present
    const conn = view.get(db);             // committed view — stable for the
    ctx.effect(() => startPolling(conn));  //   activation's whole lifetime,
    return () => stopCleanly(conn);        //   teardown included
  },
});
decl.active; decl.missing; decl.error;     // inspectable status
```

The ordering law (the part hand-rolled systems get wrong, and the reason
this module exists): when a provider's context is disposed, its dependents
drain **before any of its inverses run** — the drain is hoisted ahead of the
whole recovery (paper §5.1.3), not buried inside one inverse where LIFO
would leave the rest unordered. Provider chains drain transitively.

What the runtime does **not** verify: that a supplied inverse actually
reverts its effect. That is the component author's obligation (paper §5.1.1).

```bash
pnpm --filter @umwelten/substrate test:run
pnpm --filter @umwelten/substrate example
```
