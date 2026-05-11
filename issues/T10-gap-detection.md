# T10: Gap Detection — Skill Inspector Capability Mapping + Runtime Endpoint

> Parent PRD: [Habitat Credential Catalog & Permissions Model](../../docs/architecture/habitat-permissions-prd.md)

## What to build

Two mechanisms for discovering what capabilities a habitat needs but doesn't have.

**Part A: Skill inspector capability mapping**

Extend the existing `inspectSkill()` in `skill-inspector.ts` to map discovered env var references to capabilities. The skill-inspector already scans SKILL.md and scripts for `process.env.NAME` and `${NAME}` references. Now, after discovering env vars, cross-reference them against the credential catalog to produce capability names.

If a skill references `QUICKBOOKS_API_KEY`, and the catalog has a credential whose env var name is `QUICKBOOKS_API_KEY` with capability `quickbooks:read`, the inspector reports: "skill 'accounting-skill' needs capability `quickbooks:read`."

The mapping requires a new interface: `SkillInspectorContext` with an optional `credentialCatalog` parameter. If no catalog is provided, the inspector works exactly as it does today (env var names only, no capability names).

**Part B: Runtime gap surfacing endpoint**

Add a `POST /api/capability-gaps` endpoint on the container server. When a habitat's tool or sub-agent hits an auth error (missing or insufficient credential), the habitat can POST a gap report: `{ capability: "quickbooks:write", context: "tried to create invoice", timestamp }`.

Gaia polls this endpoint (or the habitat includes gaps in its next A2A status response). Gaps are accumulated and surfaced in the Gaia dashboard (T11).

The habitat does not auto-escalate — it reports the gap. The operator decides.

## Acceptance criteria

- [x] `inspectSkill()` accepts optional `credentialCatalog` parameter
- [x] When catalog is provided, discovered env vars are mapped to capability names
- [x] When catalog is not provided, behavior is unchanged from today
- [x] Mapped capabilities are included in the inspector's output alongside raw env var names
- [x] `computeRequirements()` in Habitat surfaces capability gaps from skill inspection
- [x] `GET /api/manifest` includes capability gaps when a catalog is available (aggregate includes capabilityHints; catalog injection is Gaia's responsibility)
- [x] `POST /api/capability-gaps` endpoint exists on container server
- [x] Endpoint is auth-gated (same bearer token as `/api/*`)
- [x] `GET /api/capability-gaps` endpoint exists for Gaia to poll
- [x] Unit tests: skill-inspector with catalog maps env vars to capabilities, without catalog unchanged
- [x] Unit tests: mergeRequirements dedups capability hints
- [x] Unit tests: recordCapabilityGap / getCapabilityGaps store and retrieve gaps
- [ ] Gaia can list gaps per habitat (surfaced in T11 dashboard)

## Blocked by

- T2 (credential catalog must exist for the mapping)
