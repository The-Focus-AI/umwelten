# 0034 — Layout is a component

Status: Accepted
Date: 2026-08-26

The shell's layout is controlled the same way everything else on the shell
is: by a component on the substrate, authored and edited through the
self-assembly loop. Pinned down in a grilling session on 2026-08-26; the
decisions below are the user's, with two explicitly delegated to the
recommendation where marked.

## Decisions

**The agent drives layout.** "Put chat on the left" is a chat request, like
"build me a clock" (#405). Host authors get the same lever for free — they
ship a layout component the way Gaia ships its habitats panel. Viewer-side
drag/arrange is deferred; the one viewer control admitted is the rail
collapse toggle, because that is a preference, not an arrangement.

**The artifact is a layout component** — not shell-page code, not manifest
fields. Layout logic living in the shell page would make it the one
privileged, unreplaceable piece of an otherwise composable surface. As a
component it is revertible: dispose it and the shell falls back to the bare
auto-fill grid.

**The layout owns the placement map; panels stay region-unaware.** Panels
inject plain `shell:region` and never name a place. Moving a panel edits
exactly one artifact — the layout — never the panel. This is forced partly
by the substrate itself: a realm has one provider per key, so a layout
component cannot shadow `shell:region`; and it is right on its own terms,
because foreign and agent-authored components often cannot be edited.
Placement identity is the `data-component` attribute, normalized across the
built-ins.

**Mechanism: CSS placement for flow regions; a region may opt into being a
real container.** *(Delegated to the recommendation.)* Flow regions (main)
are grid placement on the existing region — nothing re-parents, so foreign
iframes never reload (re-parenting an iframe resets its document). A region
that needs true container behavior — the collapsible rail with its
bottom-pinned admin cluster — is a container the layout component itself
creates and owns, adopting mapped panels into it and returning them on
dispose. Foreign mounts default to flow regions, so the iframe-reload
hazard never applies by default.

**No new tools.** `create_component` is the primitive; a layout is an
ordinary component and the recipe is documentation, not tooling. If models
prove unable to author layouts reliably, a `set_layout` sugar tool can be
added later — writing the same artifact.

**A stock default layout ships**, speaking the common app-shell language:
a collapsible left `rail`, a `rail-admin` cluster pinned at its bottom, and
`main` (the familiar auto-flow grid — three columns on a wide screen).
Default placement *(delegated)*: status and quick-prompts → rail; secrets
and sessions → rail-admin; chat → main; wide panels (Gaia's habitats),
custom components, and foreign mounts → main. Collapse state is remembered
per viewer in the browser. The stock layout is a normal roster entry: the
agent can edit or replace it in chat, and removing it is the bare grid
again.

## Consequences

- `data-component` becomes a normalized convention on every built-in panel
  (status and chat gain it), since it is the placement identity.
- The stock layout is marked `provides` in the manifest — not because it
  provides a service, but because that is the existing flag for "mounts
  everywhere, projects nowhere": solo pages stay single-component (the
  layout no-ops where the full shell chrome is absent), and no
  `ui://shell/layout` resource is published.
- Mycel's client surface keeps the bare grid until it chooses to carry a
  layout entry; nothing here forces one.
- The walkthrough count changes: a default habitat shell mounts one more
  component.
