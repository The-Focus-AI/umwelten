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

- [ ] Gaia config supports `standardsRepoUrl` field
- [ ] `seedStandardsAgent()` adds standards agent to habitat config with mode:read and git-read scope
- [ ] Standards agent references the org-readonly scope template (no new token needed)
- [ ] If `standardsRepoUrl` is not set, no standards agent is added
- [ ] Seed is idempotent — re-running does not duplicate
- [ ] `create_habitat` in Gaia automatically calls seedStandardsAgent after seedOrgReadonly
- [ ] Habitat created through Gaia has standards agent in its config.json
- [ ] Container entrypoint clones the standards repo into `/data/agents/standards/repo`
- [ ] Unit tests: seed with URL, seed without URL, idempotency (same pattern as `gaia-seed.test.ts`)

## Blocked by

- T2 (Gaia data dir + config management must be in place for the new `standardsRepoUrl` field)
