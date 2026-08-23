# 0031 — Tool registration is revertible, and tool sets declare needs

Status: **Accepted — not yet implemented**
Date: 2026-08-23

> Pinned down in a grilling session. Frame:
> `docs/architecture/composable-surface-2026-08.md`. This is the mechanism
> ADR the other two build on.

## Context

Tool registration in a running habitat is add-only, and it hides a live bug:

- `ToolRegistry` (`packages/habitat/src/tool-registry.ts`) has
  `addTool`/`addTools`/`addToolSet` and no removal. `Stimulus.addTool`
  (`packages/core/src/stimulus/stimulus.ts`) likewise has no counterpart.
- `remove_custom_tool` (`tools/self-modify-tools.ts`) deletes the tool's
  directory and reports it gone — but the live session keeps the tool
  callable, and `reload_tools` only re-adds (`loadToolsFromDirectory` →
  `addTools`), so the stale entry survives every reload short of a restart.
  `reload_skills` has the same shape (`registry.addSkills`, purely additive).
- `reload_tools` has no failure isolation: a `handler.ts` that throws on load
  takes the reload down with nothing restored.

Separately, availability is ad hoc. Three tool sets each hand-roll their own
"inert unless configured" check (`storageToolSet` token probing,
`remoteAgentToolSet` registering nothing when no peers,
`searchToolSet` requiring `TAVILY_API_KEY`), a fourth pattern lives in
`create_skill`'s regex that guesses whether instructions mention an API key
without a tool. None of these can *reactivate*: a secret set at runtime takes
effect at the next restart.

And the grilling established one structural fact the presentation layer
depends on: `Habitat.addToolSet` flattens tools into one map, **erasing
tool-set identity**. A running habitat cannot currently answer "which tool
sets are active" — which blocks the `/api/capabilities` endpoint of
ADR 0033 — the client discovers the habitat surface.

The discipline adopted here comes from the spatiotemporal-composability paper
(see the frame doc): teardown is derived from registration, activation from
declaration. The machinery (Cordis, effect contexts, fibers) is not adopted.

## Decisions

**D1 — The registry keeps tool-set membership.** `ToolRegistry` records, per
registered set: the `ToolSet`, the tool names it contributed, its status
(`active` | `inactive`), and — when inactive — the unsatisfied keys. The
flattened `getTools()` view remains the execution path; the per-set view is
new and is what capabilities reporting reads. Individually-added tools (the
self-modify path) live in a synthetic `custom` set so nothing escapes the
accounting.

**D2 — Registration returns its own undo.** Adding a tool records a disposer
that removes it from the registry *and* from the bound `Stimulus`; adding a
set records the composite of its tools' disposers. `Stimulus` gains
`removeTool(name)` as the paired core change. Removal is running the
disposer — there is no second, separately-maintained removal path. This is
the paper's one-line lesson applied at our smallest scope: the undo is
captured where the effect is performed.

**D3 — `remove_custom_tool` and `reload_tools` use the disposers.**
`remove_custom_tool` disposes the live registration in the same call that
deletes the directory. `reload_tools` becomes a transactional replace of the
`custom` set: snapshot the current registration, dispose it, load fresh; on
any load failure, restore the snapshot and report the error. Same for
`reload_skills` over the skills registry (which gains `removeSkills`).

**D4 — Tool sets may declare needs.** `ToolSet` gains an optional
`inject?: string[]` with a small closed key grammar:

- `secret:NAME` — satisfied when the habitat secret store (or container env)
  resolves NAME;
- `tool:NAME` — satisfied when a tool of that name is registered and active;
- `config:PATH` — satisfied when the config path is non-empty (e.g.
  `config:agents.remote-habitat` for `remoteAgentToolSet`).

A set whose `inject` is unsatisfied is **registered inactive**: it appears in
the per-set view with its missing keys, and contributes no tools. This
replaces the three hand-rolled checks with one mechanism, and — the part no
hand-rolled check can do — makes the *absence* visible: the capabilities
endpoint and the client can say "search: inactive, missing secret:TAVILY_API_KEY"
instead of the tool silently not existing.

**D5 — Reactivity is one edge, not a bus.** Setting or removing a secret
(the `secretsToolSet` write path and the web `secret-write` route)
re-evaluates every inactive/active set's `inject` and applies D2's machinery
in the right direction — activate by registering, deactivate by disposing.
That is the *only* reactive edge. We explicitly reject a general event bus
and a general dependency graph: umwelten's dynamic surface is narrow (tools,
skills, secrets), and secrets are the only dependency that observably changes
at runtime today. If `tool:NAME` edges later need reactivity, they ride the
same re-evaluation hook, not a new mechanism.

**D6 — What this deliberately does not adopt.** No Cordis, no `Γ∞`-style
effect context in core, no fibers, no lifecycle state machine. The paper's
inertial-transition machinery earns its keep when arbitrary third-party
components load concurrently with interleaved dependencies; our sets are
first-party, few, and re-evaluated synchronously on one edge. If that stops
being true, revisit — do not grow this ADR's mechanism incrementally into a
framework.

## Consequences

- The `remove_custom_tool` bug class is closed structurally, not patched: a
  removal is a disposer run, so it cannot drift from registration.
- ADR 0033's `/api/capabilities` becomes a read of existing state.
- Tool-set authors write an `inject` line instead of an availability check;
  the three existing checks are deleted when their sets migrate.
- `packages/core` gains `Stimulus.removeTool` and `SkillsRegistry.removeSkills`
  — small, but core, so they land first and alone (scope-of-changes rule).

## Implementation sequencing

1. Core: `Stimulus.removeTool`, `SkillsRegistry.removeSkills` (+ unit tests).
2. `ToolRegistry` restructure: per-set records, disposers, `custom` set;
   `getTools()` unchanged for callers.
3. `remove_custom_tool` / `reload_tools` / `reload_skills` on the disposers,
   with the transactional reload.
4. `inject` on `ToolSet`; migrate `searchToolSet`, `storageToolSet`,
   `remoteAgentToolSet`; delete their hand-rolled checks.
5. Secret-write re-evaluation hook.
