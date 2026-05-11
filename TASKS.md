# Tasks

## Completed

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

- **Next: T10** — Gap Detection: Skill Inspector Capability Mapping + Runtime Endpoint (blocked by T2 — done)

## Validation

- ✅ All 7 packages compile with zero errors (`tsc --noEmit`)
- ✅ Unit tests: 76/77 files pass, 933/935 tests pass
- ⚠️ Same 2 pre-existing `better-sqlite3` native module ABI failures
