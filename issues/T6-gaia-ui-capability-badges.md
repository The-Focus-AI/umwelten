# T6: Gaia UI — Capability Badges in Habitats Tab + Filter

> Parent PRD: [Habitat Credential Catalog & Permissions Model](../../docs/architecture/habitat-permissions-prd.md)

## What to build

Extend the Habitats tab in the Gaia dashboard to show capability badges on each habitat entry. Add a filter that lets operators find habitats by capability (e.g., "show me all habitats with `twitter:write`").

**Habitat entry display:**
Each habitat row shows its capability badges (colored, with the credential name on hover/tooltip). Badges use the same color scheme as the Credentials tab. A habitat with no capabilities shows a muted "no capabilities" indicator.

**Filter bar:**
A multi-select filter at the top of the Habitats tab. Operator can filter by capability — the list shows all unique capabilities across all habitats. Selecting a capability filters the habitat list to only those that have it. Multiple selections are AND (habitat must have all selected capabilities).

**Audit view:**
A "high risk" toggle that filters to habitats with write-level capabilities (any capability ending in `:write`).

This slice is purely UI — it reads data already available from existing Gaia API endpoints (the `list_habitats` tool response and agent endpoints exposed at `/api/agents`).

## Acceptance criteria

- [x] Each habitat in the Habitats tab shows capability badges (name + credential on hover)
- [x] Badges are color-coded by provider namespace
- [x] Habitats with no capabilities show a muted indicator
- [x] Filter bar allows selecting one or more capabilities
- [x] Filtering updates the habitat list in real time (client-side filter)
- [x] "High risk" toggle filters to `:write` capabilities only
- [x] Filter persists across tab switches during the session
- [x] Empty state when no habitats match the filter

- [x] Enhance `/api/habitats` endpoint with `_credMeta` provider/status metadata
- [x] Add `catalog` to `GaiaRouteContext` and wire it into CLI startup
- [x] TypeScript clean; tests pass aside from pre-existing better-sqlite3 failures

## Blocked by

- T5 (Gaia tools for capability bindings must exist so habitats actually have capabilities to display)
