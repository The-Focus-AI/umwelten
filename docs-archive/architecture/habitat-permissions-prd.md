# PRD: Habitat Credential Catalog & Permissions Model

## Problem Statement

Today's permission model is env-var focused: a habitat gets a list of `secretBindings` (env var names) that Gaia injects into its container. There is no semantic understanding of what those secrets grant — "this habitat has `QUICKBOOKS_API_KEY`" tells us nothing about whether it has read-only access or can create invoices. There is no per-habitat identity, no way for a habitat to discover what capabilities it lacks, no way to audit which habitats have which permissions, and no path to rotate or verify credentials at scale.

The standards repo (a sibling repository containing best-practices, skills-lock.json, and tests) has no automated path into habitats. When standards change, there is no mechanism to push those changes into running habitats and get audit reports back.

Finally, the monorepo root is cluttered with habitat deployment artifacts (Dockerfile, docker-compose.yml, entrypoint.sh) that belong inside the habitat package, and runtime artifacts (gaia-data, habitat-data, output, test-data) that need proper isolation.

## Solution

Introduce a **credential catalog** — structured metadata about every secret in Gaia's master vault, mapping each credential to named capabilities (`quickbooks:read`, `twitter:write`). Habitats declare which capabilities they need using credential *names* (not values). Gaia binds the right credential values at container start.

Add a **discovery and gap-surfacing** layer: when a habitat's code or sub-agent fails because it lacks a capability, the habitat surfaces that gap to Gaia. The Gaia operator can then grant the capability from the catalog.

Add a **standards audit** flow: Gaia auto-seeds a read-only standards agent into every habitat. When triggered (manually via A2A), the habitat pulls the latest standards, runs a self-audit, and reports findings back to Gaia.

## User Stories

1. As a Gaia operator, I want to see all credentials in my master vault with their capabilities and scopes, so that I know what permissions are available to grant.

2. As a Gaia operator, I want to create a habitat and bind specific capabilities (e.g., `github:read`, `quickbooks:read`) to it, so that the habitat only gets the credentials it needs.

3. As a Gaia operator, I want to know that if I bind `quickbooks:read` to a habitat, it physically cannot write to QuickBooks, because the credential itself is a read-only API key.

4. As a habitat, when I try to perform an operation I lack a capability for, I want to discover the gap and report it back to Gaia, so that an operator can grant the missing capability.

5. As a Gaia operator, I want to see pending capability requests from habitats in the Gaia dashboard, so that I can audit and grant or deny them.

6. As a Gaia operator, I want to rotate a credential (e.g., regenerate a QuickBooks API key), update it in the catalog once, and have all habitats using that credential pick up the new value on next restart.

7. As a Gaia operator, I want to verify that a credential is still valid by checking its quota or status, so that I can proactively fix expired or depleted keys.

8. As an org admin, I want every habitat to have a read-only standards agent cloned at boot, so that the habitat can reference org-wide best-practices.

9. As an org admin, when I push a change to the standards repo, I want to trigger a manual audit across all habitats and see a summary of findings, so that I know which habitats are compliant.

10. As a habitat, when Gaia tells me to audit against updated standards, I want to git-pull the standards agent, run a self-audit, and return a structured findings report via A2A.

11. As a developer, I want to run `docker build -t habitat .` from the habitat package directory, not the monorepo root, so that the build context is clean and focused.

12. As a developer, I want Gaia to resolve its own master secrets via fnox at container start, so that no plaintext secrets are baked into the image or checked into git.

13. As a team lead, I want to know which habitats have which capabilities at a glance, so that I can audit for over-privileged agents.

14. As a security engineer, I want credential operations (bind, unbind, verify, rotate) to be logged with attribution, so that I can audit who changed what.

15. As a Gaia operator overseeing hundreds of habitats, I want to filter habitats by capabilities (e.g., "show me all habitats with `twitter:write`") so that I can audit high-risk permissions at scale.

16. As a developer, I want a clean monorepo root that only contains library code, project docs, and tooling config — not deployment artifacts, generated reports, or scratch directories — so that I can find things quickly.

17. As a new contributor, I want `docker build -t habitat .` to work from the habitat package directory where the Dockerfile lives, so that I don't have to guess where the build context belongs.

## Implementation Decisions

### Credential Catalog

A new data structure stored in Gaia's data directory alongside `registry.json`. Each entry describes a single credential — the thing that resolves to an actual key/token — with metadata about what capabilities it grants.

The catalog is managed by Gaia; habitats never see the catalog directly. They only see the credential *names* and the resulting environment variables Gaia injects.

A credential entry has: a name (stable identifier), a human-readable label, the provider namespace (e.g., `intuit/quickbooks`), the capabilities it grants (e.g., `[quickbooks:read, quickbooks:write]`), the upstream scopes it has (e.g., `accounts:read, invoices:create`), an optional quota or billing dashboard URL, the source vault reference (which 1Password vault/item or age-encrypted file), a verification status (active/expired/unknown), a last-verified timestamp, and an optional `refreshTokenExpiry` field for OAuth-based credentials that require periodic re-authorization (e.g., QuickBooks as of Nov 2025).

The catalog supports multiple credentials with overlapping capabilities — e.g., `funny-cat-bot-key` and `finance-bot-key` both grant `twitter:write` but are different API keys for different Twitter accounts.

### Capability Model

A capability is a namespaced permission string: `provider:action`. Examples: `quickbooks:read`, `quickbooks:write`, `github:read`, `github:write`, `twitter:read`, `twitter:write`, `slack:read`, `slack:write`, `tavily:search`, `openai:chat`.

Capabilities are declared in the credential catalog — each credential lists which capabilities it grants. When a habitat is created, the operator binds capabilities to it, and Gaia resolves which credential(s) satisfy those capabilities.

A habitat's config stores capability bindings as `{ capability: "quickbooks:read", credential: "accounting-bot-read-key" }`. The credential name is the stable identifier from the catalog. The credential value is resolved at container start from Gaia's master vault and injected into the habitat's `secrets.json`.

### Capability Discovery & Gap Surfacing

Two mechanisms feed into discovery:

First, **static analysis** via the existing skill-inspector (`packages/habitat/src/identity/skill-inspector.ts`), extended to map discovered env var references to capabilities. When a skill's `SKILL.md` or scripts reference `QUICKBOOKS_API_KEY`, and that env var is declared in the credential catalog under the `quickbooks:read` capability, the inspector can report "this skill needs capability `quickbooks:read`."

Second, **runtime error surfacing**. When a tool or sub-agent operation fails because a credential is missing or insufficient, the habitat logs the failure and, on the next A2A status check, includes a "missing capability" entry. The Gaia dashboard shows gaps per habitat.

The habitat does not auto-escalate — it reports the gap. The operator decides whether to grant the capability. Once granted, Gaia re-seeds the volume with the new credential and the habitat restarts with the additional key.

### Standards Agent Auto-Seed

At habitat creation, Gaia writes a `"standards"` agent entry into the habitat's `config.json`:

- `id: "standards"`, `name: "Standards"`, `kind: "repo"`, `mode: "read"`
- `gitRemote`: URL of the standards repo (configured in Gaia's own config or as a constant)
- Identity scope: `git-read` using the org-readonly `GITHUB_TOKEN` (already auto-seeded by `seedOrgReadonly`)
- `projectPath`: `/data/agents/standards/repo`

The entrypoint.sh already handles this — it iterates `config.agents[]`, clones each one with its gitRemote into `/data/agents/<id>/repo`. The standards agent is just another entry in that loop.

Triggering an audit: Gaia has a new tool (`broadcast_standards`) that sends an A2A message to all running habitats: "git pull the standards agent. Review the latest best-practices against this habitat's project and configuration. Report findings back." Each habitat responds with a structured findings report.

### Root Directory Cleanup

The monorepo root currently contains a mix of library code, deployment artifacts, generated outputs, and scratch directories. This cleanup moves habitat-specific deployment files into the habitat package and tidies the root.

**Files moved into `packages/habitat/`:**
- `Dockerfile` — habitat container image definition
- `docker-compose.yml` — local dev Docker compose
- `entrypoint.sh` — container startup script (provisions agents, restores skills)

The Docker build context becomes `packages/habitat/` instead of the monorepo root. The `docker-compose.yml` volume references and `entrypoint.sh` paths are updated accordingly.

**Files added to `.gitignore`:**
- `habitat-data/` — runtime state from local `habitat serve` (already gitignored implicitly by volume usage, should be explicit)
- `input/` — test fixture inputs for tool tests (these are ephemeral; the test scripts generate them)
- `output/` — generated evaluation reports and logs (ephemeral, regeneratable)
- `test-data/` — transient test artifacts
- `test-output/` — transient test artifacts
- `*.tgz` — npm pack artifacts (already partially ignored, make explicit)

**Files consolidated under `docs/assets/`:**
- The 8 architecture diagram PNGs (`habitats-architecture*.png`, `habitats-business.png`, `habitats-datasheet.png`, `habitats-manifesto.png`, `habitats-poster.png`, `habitats-usecases.png`, `habitats-vs.png`, `umwelten-architecture.png`) move to `docs/assets/` where the VitePress site can reference them.

**Files that stay at root (unchanged):**
- `CHANGELOG.md`, `CLAUDE.md`, `LLM.txt` — top-level project documentation
- `FEATURES.md`, `TASKS.md`, `TESTING.md` — project-management docs (not part of the VitePress site)
- `OVERVIEW.html`, `OVERVIEW.pdf` — standalone deliverables (not part of VitePress)
- `reports/` — dated research reports (permanent artifacts)
- `LICENSE`, `README.md`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `mise.toml` — standard project files
- `knip.json`, `vitest.config.ts`, `vitest.integration.config.ts`, `.npmignore`, `.dockerignore`, `env.template`, `.gitattributes` — tooling config

### fnox Integration (Gaia's Own Secrets)

Gaia resolves its own master secrets via fnox, following the pattern documented in the standards repo's `best-practices/security.md`. A `fnox.toml` file in Gaia's data directory declares which secrets Gaia needs (e.g., `GOOGLE_GENERATIVE_AI_API_KEY`, `GITHUB_APP_PRIVATE_KEY`, provider API keys). The bootstrap token (e.g., `OP_SERVICE_ACCOUNT_TOKEN` or an age key) comes from the container environment at start.

Gaia resolves secrets once at startup and caches the master vault in memory. Habitats never call fnox or 1Password directly — Gaia is the single broker. This avoids 1Password service account rate limits (e.g., 10,000 reads/day on business plans) by keeping all 1Password calls centralized and infrequent.

For the habitat Docker image, fnox is NOT bundled — habitats get secrets from Gaia, not from their own fnox.

### No Tool-Level Enforcement (Credential-Driven Security)

The system does NOT enforce capabilities at the individual tool level. A habitat running arbitrary code (scripts, Claude SDK sub-agents) can call any API through any path. The enforcement is credential availability: if the habitat doesn't have the `quickbooks-write-key`, it physically cannot write to QuickBooks, regardless of what code runs.

Where a service supports scoped API keys, the operator creates separate read and write credentials in the catalog. Habitats are bound to the appropriate one. Where a service has a single all-access key, the operator can choose to bind only read-capability metadata (preventing discovery from recommending write) but the physical enforcement depends on the upstream service's token model.

### Module Decomposition

The following new modules will be introduced:

- **CredentialCatalog** — load/save/validate the catalog file. Query by name, capability, or provider. Verify credential status.
- **CapabilityResolver** — given a set of requested capabilities and a catalog, produce the set of credential names needed. Validate that all requested capabilities are satisfiable.
- **GapDetector** — wrap the skill-inspector and runtime error logs to produce capability gap reports. Called by the habitat's A2A handler and the Gaia dashboard API.

Existing modules modified:

- **GaiaRegistry / GaiaSecretVault** — add credential catalog storage alongside registry.json. Seed standards agent alongside org-readonly.
- **Gaia tools** — new tools for credential management, capability binding, standards broadcast, gap listing. Modified create_habitat to accept capabilities.
- **Gaia dashboard UI** — new Credentials tab showing the catalog. Capabilities column in Habitats tab. Gap alerts.
- **Container server** — new `/api/capability-gaps` endpoint that habitats can report to.
- **Entrypoint / buildSeedFiles** — resolve capabilities to credential values from Gaia's vault when writing secrets.json for a habitat.
- **HabitatConfig and related types** — add capabilities binding field. Extend AgentEntry for standards agent fields.

### Standards Repo URL Configuration

The standards repo URL is a Gaia-level configuration value, stored in Gaia's own config (not per-habitat). It defaults to a constant (e.g., the Focus.AI standards repo) but can be overridden per Gaia deployment. Every habitat created under that Gaia inherits the standards agent with that URL.

## External Research (Verified Assumptions)

The following design decisions rely on external systems. Each was verified against current documentation.

### GitHub App Installation Tokens

- **Lifetime: exactly 1 hour.** Confirmed in both official docs and community issue threads. Long-running processes must refresh tokens before expiry.
- **Commit authorship:** Bot commits can be attributed to any name/email via `git config user.name` / `git config user.email`. The standard pattern is `app-slug[bot]` + `<installation-id>+app-slug[bot]@users.noreply.github.com>`. Our per-habitat attribution (branch name, commit author, PR title) is fully supported.
- **Per-repo scoping:** Installation tokens can be scoped to specific repositories and have a subset of the app's permissions at creation time. Our "Gaia as token broker" model (Gaia generates per-repo tokens on demand) is correct.

### fnox (v1.24.0, latest as of 2026-05-06)

- **Docker integration:** `fnox export` produces env files for Docker Compose; `fnox exec -- <cmd>` wraps container entrypoints. Both patterns are supported.
- **Provider backends:** age, AWS KMS/SM, Azure Key Vault, GCP Secret Manager, 1Password, HashiCorp Vault. Our "fnox.toml in Gaia data dir" design works with any of these.
- **Profile support:** `FNOX_PROFILE=prod fnox exec --` switches environments. Gaia's prod/staging deployments can use this.

### A2A Protocol (v1.0.0)

- **Send Message supports blocking mode:** `return_immediately: false` waits until the task reaches a terminal state. Our "Gaia sends audit message to habitat, waits for structured findings response" maps directly to this.
- **Agent Cards** declare capabilities, skills, and authentication. The existing `buildAgentCard()` in `a2a-handler.ts` already implements this — we extend the card to include credential-backed capability declarations.
- **Context grouping:** The `context` field groups related tasks. Our channel-key approach (`a2a:{contextId}`) already implements this correctly.
- **Backed by 50+ industry partners** (Atlassian, Salesforce, ServiceNow, Deloitte, Accenture, McKinsey). The protocol is stable and production-grade.

### API Provider Scoped Token Support

- **QuickBooks (Intuit):** OAuth 2.0 with granular scopes. Read-only vs. read-write is scope-level. **Caveat:** Refresh tokens now have a maximum validity period (changed Nov 2025). Our credential catalog must track refresh token expiry and surface re-auth needs.
- **Twitter/X API v2:** OAuth 2.0 Bearer Token for app-only read access. OAuth 2.0 Authorization Code + PKCE for user-scoped access. Our "multiple Twitter accounts per habitat" model requires the Authorization Code flow with per-account tokens stored in the credential catalog.
- **Slack:** Bot tokens with granular scopes. Each scope is individually granted. Legacy workspace tokens being retired. Our catalog model handles this — each Slack workspace/scope combination is a separate credential entry.

### 1Password Service Accounts

- **Rate limits:** Business plans allow e.g. 10,000 reads/day per service account. Our model is safe because Gaia resolves secrets once at startup and caches; habitats never call 1Password directly.
- **Vault scoping:** Service accounts are scoped to specific vaults — they cannot access Personal/Private/Shared vaults. Our per-environment vault model (dev/staging/prod each with own vault + service account) is the recommended pattern.
- **Token storage:** The SA token (`ops_...`) must be stored outside the vault it accesses (avoids circular bootstrap). Our bootstrap model (token from GCP Secret Manager or Docker env) follows this.

## Testing Decisions

Tests should verify external behavior, not internal implementation details. For each module:

**Credential Catalog**: Unit tests for load, save, add, remove, verify, query by capability, query by name. Test idempotency (re-adding same credential). Test that credential values are never serialized in the catalog file — only metadata.

**Capability Resolution**: Unit tests for resolving capabilities to credential names, detecting unsatisfied capabilities, handling overlapping credentials (multiple credentials for the same capability).

**Standards Agent Seed**: Unit tests (similar to existing `gaia-seed.test.ts` for org-readonly) — verify the standards agent is added to config, is mode:read, has git-read scope, has correct gitRemote. Test idempotency.

**Gap Detection**: Unit tests that the gap detector correctly maps a missing env var reference to a capability name, and that runtime error patterns are parsed correctly.

**Build Seed Files**: Unit tests that when a habitat config has capability bindings, the correct credential values from the vault are included in `secrets.json`.

**Gaia Tools**: Integration tests for create_habitat with capabilities, bind_capability, unbind_capability, broadcast_standards (needs running Gaia + Docker).

**Prior art**: The existing `gaia-seed.test.ts` (tests auto-seeding of org-readonly identity into new habitats) is the pattern to follow for the standards agent seed and credential binding tests. The `vault.test.ts` tests demonstrate the vault interface pattern. The `agent-call-context.test.ts` tests demonstrate AsyncLocalStorage-based context testing.

## Out of Scope

- Per-user identity and role-based access control (e.g., Alice can view habitat X but not manage it). The current single-bearer-token model remains.
- Token lifecycle management (expiration, automatic rotation, revocation). These are manual operations via Gaia tools.
- Per-command audit logging of who did what. The bearer token authorizes access but does not attribute actions to individual users.
- The two-plane (admin/user) MCP server token-routing from the habitat-runtime spec.
- Automated scheduling of standards audits. The initial implementation is manual trigger only.
- `1password` vault backend implementation — the deferred stub remains.
- Habitats running fnox themselves. Gaia alone manages secrets.
- Export/import of credential catalog entries (though export/import of habitat capability bindings is covered).

## Further Notes

The credential catalog is the semantic layer that the existing secretBindings/env-var model has been missing. It doesn't replace secretBindings — it sits above them. `secretBindings` will still exist as the list of env var names that flow into a container, but they will be derived from capability bindings rather than configured directly.

For migration: existing habitats without capability bindings will continue to work. Their `secretBindings` are treated as raw env var names (the current behavior). The capability model is additive — new habitats use it, old ones keep working.

The standards agent pattern generalizes: any org-wide repo (coding guidelines, security policies, deployment templates) can be auto-seeded the same way. The mechanism is identical — add an agent entry with mode:read, git-read scope, and a gitRemote.
