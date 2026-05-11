# T11: Gaia UI — Gap Alerts + Grant/Deny Workflow

> Parent PRD: [Habitat Credential Catalog & Permissions Model](../../docs/architecture/habitat-permissions-prd.md)

## What to build

Show pending capability gaps in the Gaia dashboard and let operators grant or deny them. This ties together T10's gap detection with T5's capability binding tools.

**Gap alerts display:**
A "Gaps" section in the dashboard (either a badge on the Habitats tab or a standalone panel). Shows:

- Habitats with pending capability gaps
- Per-habitat: which capability is needed, what triggered the gap (skill inspection or runtime error), timestamp
- Severity indicator: critical (skill requires it, habitat can't function), optional (discovered via error, might be nice to have)

**Grant/deny workflow:**
For each gap, the operator can:

- **Grant**: pick a credential from the catalog that satisfies the capability, then call T5's `bind_capability`. If the habitat is running, show a warning that a rebuild is needed.
- **Deny**: dismiss the gap with an optional reason. Dismissed gaps are hidden but recorded.
- **Ignore**: mark as "not needed" if the habitat doesn't actually need this capability.

**Integration:**
The UI reads gaps from the Gaia API (extended from T10's gap storage). Granting calls through to T5's bind_capability. Denying marks the gap as dismissed in Gaia's state.

## Acceptance criteria

- [x] Dashboard shows a "Gaps" indicator (badge count or panel) — badge on Habitats tab shows pending gap count, hidden when zero
- [x] Per-habitat gap list shows capability needed, source (skill/error), timestamp — grouped by habitat, shows capability name, severity badge (critical/optional), context, timestamp
- [x] "Grant" button opens a credential picker (filtered to credentials that satisfy the capability) — `GET /api/credentials/:capability` returns matching catalog entries; picker renders select dropdown with credential name/provider/status/secret info
- [x] Granting a capability calls bind_capability and removes the gap from the pending list — `POST /api/capability-gaps/:habitatId/grant` validates credential, adds binding to config, re-seeds volume, marks gap dismissed
- [x] Warning is shown if the habitat is running (needs rebuild for credential to take effect) — response includes `needsRebuild` flag, alert shown in UI
- [x] "Deny" dismisses the gap with optional reason — `POST /api/capability-gaps/:habitatId/deny` stores dismissal in `gapDecisions` map
- [x] "Ignore" marks the gap as not-needed — `POST /api/capability-gaps/:habitatId/ignore` stores ignore in `gapDecisions` map
- [x] Empty state when no gaps exist — "No pending gaps" message when gapsData is empty
- [x] Works with both skill-inspector and runtime error gaps — runtime gaps aggregated via `fetchFromContainer` polling each habitat's `GET /api/capability-gaps`

## Blocked by

- T10 (gap detection must exist to produce gaps)
- T5 (capability binding must exist to grant)
