# T2: Credential Catalog — Data Model, File Storage, Basic CRUD Tools

> Parent PRD: [Habitat Credential Catalog & Permissions Model](../../docs/architecture/habitat-permissions-prd.md)

## What to build

Add a structured credential catalog to Gaia's data directory. The catalog stores metadata about every secret in Gaia's master vault — what each key is, what capabilities it grants, what provider it's for, and when it was last verified. No actual secret values are stored in the catalog.

**New type `CredentialEntry`:**
A credential has a stable name (e.g., "accounting-bot-read-key"), a human-readable label, a provider namespace (`intuit/quickbooks`), the capabilities it grants (e.g., `["quickbooks:read"]`), the upstream scopes (`["accounts:read"]`), an optional billing/quotas dashboard URL, a source vault reference (which 1Password item or age key), a status (active/expired/unknown), a last-verified timestamp, and an optional `refreshTokenExpiry` for OAuth-based credentials.

**New module `CredentialCatalog`:**
Loads/saves `credentials.json` alongside `registry.json` in Gaia's data directory. Supports: `add(entry)`, `remove(name)`, `get(name)`, `list()`, `listByCapability(cap)`, `listByProvider(provider)`, `verify(name)` (updates lastVerified timestamp and status).

**New Gaia tools:**
- `add_credential` — adds a credential entry to the catalog (name, provider, capabilities, scopes, source vault reference, dashboard URL)
- `list_credentials` — lists all credentials with their capabilities and status
- `remove_credential` — removes a credential by name
- `verify_credential` — marks a credential as verified (updates timestamp)

No capability binding yet (that's T4). No UI (that's T3). This slice is purely the data layer + Gaia chat-accessible tools.

## Acceptance criteria

- [x] `credentials.json` file is created in Gaia data dir on first catalog operation
- [x] Catalog supports add, remove, list, get, listByCapability, listByProvider
- [x] `add_credential` Gaia tool works (accessible via Gaia chat or MCP)
- [x] `list_credentials` shows all entries with capabilities and status
- [x] `remove_credential` removes by name
- [x] `verify_credential` updates lastVerified timestamp and status to "active"
- [x] Duplicate credential names are rejected on add
- [x] Secret values are never written to `credentials.json` (only metadata)
- [x] Unit tests: load/save, add, remove, query by capability, query by provider, idempotent add, verify
- [x] Prior art pattern: same directory structure + file management as `GaiaRegistryManager`

- [x] Add `CredentialEntry` and `CredentialStatus` types to `gaia/types.ts`
- [x] Wire `CredentialCatalog` into CLI Gaia startup
- [x] Export from `gaia/index.ts` and main habitat index
- [x] All tests pass aside from pre-existing better-sqlite3 native module failures

## Blocked by

None — can start immediately.
