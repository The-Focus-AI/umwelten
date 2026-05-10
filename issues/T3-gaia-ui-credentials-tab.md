# T3: Gaia UI — Credentials Tab

> Parent PRD: [Habitat Credential Catalog & Permissions Model](../../docs/architecture/habitat-permissions-prd.md)

## What to build

A new "Credentials" tab in the Gaia dashboard SPA that shows the credential catalog. Operators can view all credentials, their capabilities, provider, and verification status. They can add new credentials and remove existing ones through the browser.

The tab displays a table/list of credentials with columns: name, label, provider, capabilities (as badges), status (active/expired/unknown with color coding), last verified, and actions (verify, remove).

An "Add Credential" form includes fields for: name, label, provider namespace, capabilities (comma-separated or chip input), scopes, source vault reference, and optional dashboard URL.

All mutations go through the existing Gaia API routes. The credentials tab is the fourth tab in the dashboard (alongside Chat, Habitats, and Secrets — or reorder: Chat, Habitats, Credentials, Secrets).

## Acceptance criteria

- [ ] "Credentials" tab appears in Gaia dashboard navigation
- [ ] Tab shows all credentials from the catalog with name, provider, capabilities, status
- [ ] Capabilities are displayed as colored badges
- [ ] Status is color-coded: green (active), yellow (unknown), red (expired)
- [ ] "Add Credential" form accepts all fields and creates a credential via the Gaia API
- [ ] "Remove" button removes a credential with confirmation dialog
- [ ] "Verify" button updates the last-verified timestamp and status
- [ ] Tab refreshes automatically when returning to it
- [ ] Empty state shows helpful message when no credentials exist
- [ ] Works with the same auth model as the rest of the dashboard (bearer token)

## Blocked by

- T2 (credential catalog data model + Gaia tools must exist)
