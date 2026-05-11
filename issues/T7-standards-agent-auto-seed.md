# T7: Standards Agent Auto-Seed

> Parent PRD: [Habitat Credential Catalog & Permissions Model](../../docs/architecture/habitat-permissions-prd.md)

## What to build

Automatically add a read-only "standards" agent to every habitat created by Gaia. This agent clones the org's standards repo at container boot and makes it available for reference and self-audit.

**New function `seedStandardsAgent(config, gaiaConfig)`:**
Similar to `seedOrgReadonly` in `gaia-seed.ts`. Adds a `"standards"` agent entry to the habitat config:

- `id: "standards"`, `name: "Standards"`, `kind: "repo"`, `mode: "read"`
- `gitRemote`: URL from Gaia's config (new field `standardsRepoUrl`)
- `gitBranch`: optional, from Gaia config
- Identity scope: `git-read` using the `org-readonly` scope template (already auto-seeded by `seedOrgReadonly`)
- `projectPath: "/data/agents/standards/repo"`

**Gaia config extension:**
A new top-level field in Gaia's own config: `standardsRepoUrl` (string, optional). If set, every habitat gets the standards agent. If not set, no standards agent is auto-seeded.

**Idempotent:** Rerunning seed on the same config does not add duplicates.

**Entrypoint integration:** No changes needed. The existing entrypoint.sh already iterates `config.agents[]` and clones each one with a `gitRemote` into `/data/agents/<id>/repo`. The standards agent is just another entry in that loop.

## Acceptance criteria

- [x] Gaia config supports `standardsRepoUrl` field
- [x] `seedStandardsAgent()` adds standards agent to habitat config with mode:read and git-read scope
- [x] Standards agent references the org-readonly scope template (no new token needed)
- [x] If `standardsRepoUrl` is not set, no standards agent is added
- [x] Seed is idempotent — re-running does not duplicate
- [x] `create_habitat` in Gaia automatically calls seedStandardsAgent after seedOrgReadonly
- [x] Habitat created through Gaia has standards agent in its config.json
- [x] Container entrypoint clones the standards repo into `/data/agents/standards/repo`
- [x] Unit tests: seed with URL, seed without URL, idempotency (same pattern as `gaia-seed.test.ts`)

- [x] Added optional `standardsRepoBranch` alongside `standardsRepoUrl` for branch selection
- [x] `packages/habitat` build passes; full workspace build still has pre-existing `packages/ui` TS6305/implicit-any failures
- [x] Targeted seed tests pass; full unit suite still fails on pre-existing `better-sqlite3` native module Node ABI mismatch

## Blocked by

- T2 (Gaia data dir + config management must be in place for the new `standardsRepoUrl` field)
