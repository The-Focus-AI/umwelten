# 0006 — Owned and mounted repos: repo access is a role, not a count

Status: Accepted
Date: 2026-07-25
Related: [0004 — Gaia as a GitHub App](./0004-gaia-github-app.md), habitats
ADR 0005 (backing storage) §5, which deferred this question.

## Context

habitats ADR 0005 named the distinction that matters — a **provisioned
resource** (repo, secrets, storage: habitat-scoped, Gaia-credentialed)
versus an **attachment** (an A2A/MCP server: per-user, per-message) — and
then declared provisioned resources singular: *"at most one backing
storage… declaration mirrors git exactly… multi-folder support waits for a
real habitat that needs it."*

Restructuring operations into per-habitat repos produces that habitat
immediately. A client habitat holds its own notes, scopes and task state
while reading four or five of the client's code repos; a cross-project
rollup habitat reads fifteen and owns none.

Meanwhile umwelten already had two repo mechanisms that nobody had
reconciled: the habitat's `gitUrl` (provisioned, credentialed, read-write)
and per-agent clones declared in `config.agents[]` (plural, already
carrying a `mode: "read" | "write"` that forces a read-only tool subset).
Repo access was in turn encoded in four places — `gitUrl`, the mount list,
the registry's `github: { read, write }` mint boundary, and the App
installation list — with nothing deriving any of them from any other.
Mounting a repo without widening the read scope fails at boot with a
GitHub 404 that reads exactly like "that repo does not exist."

## Decision

Provisioned repos do not go plural. They split by **role**:

- A habitat has **at most one owned repo** — its `gitUrl`, read-write, the
  material it is responsible for.
- A habitat has **any number of mounted repos** — read-only, reference
  material, declared as agent entries with `mode: "read"`.

Scope derivation follows the same asymmetry, and this is the point of the
decision:

- **`github.read` is derived** from the declared mounts plus the owned
  repo. Mechanical, always in sync, no separate list to forget.
- **`github.write` is never derived.** It covers the owned repo only, and
  stays an explicit, human-approved declaration.

The habitat's own repo is the source of truth for both, so adding a mount
is a pull request against that repo rather than a Gaia tool call.

## Considered options

Pluralising provisioned resources (`repos: [...]`) was the obvious
alternative and was rejected: it makes every repo equally writable by
default, which is exactly the property that has to stay scarce.

## Consequences

- Closes ADR 0004's blind spot #1 by construction. Automatic derivation
  can only ever widen *read*; the exfiltration-laundering path needs write
  to a public repo, which no derivation can grant.
- Reconfiguring a habitat becomes a pull request rather than a tool call —
  better provenance, worse ergonomics. Accepted deliberately.
- Bootstrapping is circular: Gaia must clone a habitat's repo to learn the
  scopes it needs a token to clone with. Resolved by cloning the owned repo
  under ambient read, then narrowing to the derived list.
- A habitat that needs to write to a second repo is telling you it should
  be two habitats.
