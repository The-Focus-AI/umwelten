# Tasks

## Completed

- T12: fnox Integration for Gaia's Own Secrets — `FnoxResolver` class in `packages/habitat/src/gaia/fnox.ts`: detects fnox CLI, writes `fnox.toml` template on first Gaia boot, resolves secrets via `fnox export --format json`, falls back to `.env`/process.env when fnox not installed, detects bootstrap tokens (`OP_SERVICE_ACCOUNT_TOKEN`, `FNOX_AGE_KEY`, `FNOX_AGE_KEY_FILE`). Wired into Gaia CLI startup (`packages/cli/src/habitat.ts`): template written on first boot, secrets resolved before vault loading, vault populated with resolved secrets, mode logged to console. Habitats never call fnox — Gaia is the sole broker. fnox is NOT bundled into the habitat Docker image (habitat container uses `fnox exec --` in entrypoint, not bundled fnox). 26 unit tests (`fnox.test.ts`) covering all modes (fnox available, unavailable, env fallback, missing bootstrap token, export failure fallback).
- T11: Gaia UI — Gap Alerts + Grant/Deny Workflow — added `GET /api/capability-gaps` (aggregates gaps from running habitats via `fetchFromContainer`), `GET /api/credentials/:capability` (lists matching credentials), `POST /api/capability-gaps/:habitatId/grant` (validates + binds capability + marks gap dismissed), `POST /api/capability-gaps/:habitatId/deny` and `/ignore` (in-memory dismissals) to Gaia routes; built gaps panel UI in Habitats tab with badge count, per-habitat gap list (capability, severity, context, timestamp), credential picker (fetches matching credentials from catalog), Grant/Deny/Ignore buttons, needs-rebuild warning, and empty state
- T10: Gap Detection — extended `inspectSkill()` with optional `InspectorCatalog` parameter to cross-reference discovered env vars against credential catalog entries, producing `CapabilityHint` entries; added `CapabilityHint` and `CapabilityGap` types to `AgentRequirements`; updated `mergeRequirements()` to dedup hints; modified `computeRequirements()` to accept optional catalog; added `recordCapabilityGap()` and `getCapabilityGaps()` to Habitat; added `POST /api/capability-gaps` and `GET /api/capability-gaps` endpoints to container-server
- T9: Gaia UI — Standards Audit Panel — extracted `runStandardsAudit()` from `broadcast_standards` tool, added `POST /api/standards-audit` SSE endpoint and `GET /api/standards-audit/latest`, built audit panel UI in the Habitats tab with summary bar, expandable per-habitat results, per-habitat audit buttons, empty state, and ephemeral in-memory storage
- T8: Standards Broadcast Tool — `broadcast_standards` Gaia tool sends A2A audit messages to habitats with standards agents, collects per-habitat findings
- T7: Standards Agent Auto-Seed — implemented `seedStandardsAgent()`, wired into Gaia `create_habitat`
- Converted monorepo to source-first (no build): all 7 packages now use `noEmit: true`, no `dist/`, no `composite`
- Removed all build scripts from package.json; `habitat` build is now just `tsc` (type-check)
- Moved `container-ui` → `public/` in packages/habitat; updated container-server to serve from `public/`
- Added `types.d.ts` with `declare module` shims for `streammark` and `turndown`
- Ran `.tsx` → `.ts` / `.tsx` restoration for packages/ui (JSX files kept as `.tsx`)
- Fixed package.json exports with extensionless `types` + explicit `.ts` entries for 3 non-JSX files
- Added `jsx: "react-jsx"` to cli/umwelten tsconfigs (needed for transitive `.tsx` resolution)
- Cleaned `.tsbuildinfo` and `dist/` directories

## Current

- No tasks currently in progress

## Validation

- ✅ All 7 packages compile with zero errors (`tsc --noEmit`)
- ✅ Unit tests: 76/77 files pass, 940/942 tests pass
- ⚠️ Same 2 pre-existing `better-sqlite3` native module ABI failures
