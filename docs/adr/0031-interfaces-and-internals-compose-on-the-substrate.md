# 0031 — Interfaces and habitat internals compose on `@umwelten/substrate`

Status: **Accepted — not yet implemented**
Date: 2026-08-23

> Pinned down in a grilling session, 2026-08-23 (one question per round, every
> decision the user's). An earlier draft of this number was written without
> that session and was removed; where the two disagree, this one is the record.

## Context

We want interfaces that assemble themselves: a base UI system habitats use,
with Gaia and Mycel's client surface built as assemblies of the same parts,
and habitats — Gaia included, it is just a habitat — able to author their own
components at runtime. The model is "A Programming Paradigm for Spatiotemporal
Composability" (cordiverse/paper): components perform revertible effects when
they load, declare the services they need, and activate or deactivate as those
services appear and leave; removal reverts everything.

## Decisions

**D1 — We implement the paper ourselves.** No dependency on Cordis. The paper
is effectively a complete spec (its algorithms are printed in it); our core
stays small, typed our way, and fully understood — a requirement, since
agent-authored components run on it.

**D2 — It goes all the way down, staged.** The destination is the paper's
thesis: UI panels *and* habitat internals (tool sets, connectors, runtimes)
are components on one context tree. The UI proves the runtime first — all new
code, nothing to regress — then internals migrate onto it.

**D3 — It lives in `@umwelten/substrate`.** A new foundation package: zero
internal deps, isomorphic (Node and browser). Mycel's server keeps its
deliberate zero-internal-deps posture; only its hosted client surface
(ADR 0026 — mycel hosts its own client surface) consumes the substrate.

**D4 — V1 scope.** Revertible effects, reactive coeffects (provide/inject
with activate/deactivate), component lifecycle with inertial transitions,
the declarative loader with reconciliation and HMR, and **isolation** (the
same service key resolving to different bindings in different subtrees —
needed the moment one page shows more than one habitat, and unretrofittable
without changing the resolution path). **Interception is deferred**: it is
the access-control lever, needed when untrusted components run outside an
iframe, not before.

**D5 — Web components are the component contract.** A component is an ES
module that registers its effects and services with the substrate and defines
custom elements; shadow DOM gives style isolation for free. No build step may
sit in the loading path — that is what lets an agent-authored module land in
a running page. The substrate prescribes composition, never a view library;
a component may use one internally.

**D6 — Every habitat self-assembles, Gaia included.** One framework, one
shell, no separate Gaia build. Peer-mounting — showing another habitat's
components — is a general substrate capability any habitat can use; Gaia is
merely its first heavy user, a habitat whose job is mounting many peers.

**D7 — Old surface is replaced, not patched.** Nothing here is in production.
No interim mechanisms are added to the current tool registry or web UI to
tide them over; known defects in the old machinery (e.g. `remove_custom_tool`
leaving live sessions holding deleted tools) die when their subsystem moves
onto the substrate. Clean and simple beats compatible.

## Sequencing

1. `@umwelten/substrate` core, tested against the paper's laws (track/recover
   round-trips, LIFO teardown, activation ordering, loader confluence).
2. The habitat shell and its own components — the first assembly, replacing
   `packages/habitat/public/index.html`.
3. Self-assembly: `create_component` (sibling of `create_tool`), components
   in `workDir/components/`, live via the loader's HMR.
4. Peer-mounting (with ADR 0032's projection and ADR 0033's trust line);
   Gaia's dashboard becomes an assembly of it.
5. Mycel's client surface as an assembly.
6. Habitat internals migrate onto the substrate.
