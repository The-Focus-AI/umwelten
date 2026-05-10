# T9: Gaia UI — Standards Audit Panel

> Parent PRD: [Habitat Credential Catalog & Permissions Model](../../docs/architecture/habitat-permissions-prd.md)

## What to build

Add a standards audit panel to the Gaia dashboard Habitats tab (or as a standalone section). Shows the results of the most recent `broadcast_standards` run — which habitats were audited, which passed, which had findings.

**Audit results display:**
A collapsible section or modal that shows:
- Last audit timestamp and who triggered it
- Summary bar: X passed, Y findings, Z unresponsive, W skipped
- Per-habitat list with status icon (✅ pass, ⚠️ findings, ❌ unresponsive, ⬜ skipped)
- Expanding a habitat shows detailed findings: compliant items, non-compliant items with severity (info/warn/critical), and suggested remediations
- "Re-audit" button that triggers `broadcast_standards` for a single habitat or all

The panel polls or refreshes after triggering an audit. Results from the most recent audit persist until the next one overwrites them.

**Storage:**
Audit results are ephemeral — stored in Gaia's memory during the session, not persisted to disk. If Gaia restarts, audit history is lost (full persistence of audit history is out of scope).

## Acceptance criteria

- [ ] Audit panel appears in the Gaia dashboard (in Habitats tab or as standalone)
- [ ] "Audit All" button triggers `broadcast_standards` for all running habitats
- [ ] Per-habitat "Audit" button triggers for a single habitat
- [ ] Results update in real-time as each habitat responds (or show a progress indicator)
- [ ] Summary bar shows counts: passed, findings, unresponsive, skipped
- [ ] Expanding a habitat shows detailed findings with severity badges
- [ ] Empty state before any audit has been run: "No audits yet. Run one to check compliance."
- [ ] Panel gracefully handles the "no habitats with standards agent" case

## Blocked by

- T8 (broadcast_standards tool must exist for the UI to call)
