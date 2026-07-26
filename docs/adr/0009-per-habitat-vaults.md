# 0009 — One vault per habitat, resolved by Gaia

Status: Accepted
Date: 2026-07-25
Related: [0006 — Owned and mounted repos](./0006-owned-and-mounted-repos.md),
[0004 — Gaia as a GitHub App](./0004-gaia-github-app.md), habitats ADR 0005
(backing storage)

## Context

A habitat's secrets arrive in three distinct ways, and only one of them was
modelled badly.

**Operator-provided values** reach a container through Gaia's master vault
plus `secretBindings`, a list of *names* filtered out of one flat global
namespace. **User-authorized values** never enter a vault at all — the
habitat runs its own OAuth at a declared `connectPath`, mints the token
into its own store, and rotates it there. **The contract** between them is
already declared per habitat, in `config.json.requiredSecrets[]`: name,
label, whether it is required, and `type: "secret" | "oauth"`.

The flat global namespace is the broken part. Because Gaia's vault is one
name-to-value map, and because the capability resolver welds the env var
name to the vault key (`capability-resolver.ts`: *"the credential name
doubles as the vault key and env var name"*), two habitats cannot both see
`DATABASE_URL` with different values. The Twitter habitat already declares
`DATABASE_URL` in its `requiredSecrets`, so the collision is not
hypothetical — it arrives with the second habitat that needs a database.

Every other repo in the organization already solved this. `fnox.toml`
declares a 1Password vault per project and maps env var names to items
within it, with profile blocks that swap the vault for dev, preview and
prod. Namespacing is by vault, not by key prefix.

## Decision

**Each habitat gets its own 1Password vault**, declared by a `fnox.toml` in
its own repo alongside `config.json` (ADR 0006 already makes that repo the
source of truth for the habitat's environment). `DATABASE_URL` in one
habitat's vault and in another's are different items with the same name.
No aliases, no prefixes, no global namespace.

**Gaia resolves it.** Gaia holds the service account that reads habitat
vaults, executes each habitat's `fnox.toml` on the host, and injects the
resolved values. The existing invariant stands: habitats never call fnox,
and no container holds a vault credential.

The two manifests stay separate because they describe different things:
`fnox.toml` says *where an operator-provided value comes from*;
`requiredSecrets[]` says *what this habitat needs and how each item is
obtained* — including items that have no vault entry at all because a user
mints them by authorizing.

## Considered options

Aliasing the env var name to a globally-unique vault key
(`DATABASE_URL` ← `upperhand-database-url`) was considered and rejected:
it reimplements namespacing in a naming convention when the tooling
already namespaces by vault.

Per-habitat 1Password service-account tokens injected into containers were
the better-looking isolation story and were rejected on threat model. It
places a live vault credential inside a container running LLM-driven tools
against untrusted input, where a prompt injection can enumerate and dump
the vault. Gaia reading habitat vaults adds nothing to its blast radius —
it already holds the GitHub App private key and writes every child's
secrets file, so it can already read everything those vaults contain. It
also keeps rotation to one credential rather than N, and keeps the vault
reachable when a habitat is dormant.

## Consequences

- Creating a habitat now includes creating its vault. Provisioning is a
  fleet operation, not a text edit.
- Gaia's service account becomes a rotation-critical credential covering
  every habitat vault. It belongs in the same tier as the App private key.
- Profiles give dev/preview/prod isolation per habitat by swapping vaults,
  the mechanism already stubbed in the habitats repo.
- Still open: a third `type: "provisioned"` on `requiredSecrets`, for
  values that are neither pasted nor user-authorized but created while
  building the environment — a Neon branch, a picked Drive folder. Proposed,
  not decided.
