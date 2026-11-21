# 0035 — Project previews run in the habitat, discovered rather than declared

Status: Accepted
Date: 2026-08-08
Related: [0004 — Gaia as a GitHub App](./0004-gaia-github-app.md),
[0006 — Owned and mounted repos](./0006-owned-and-mounted-repos.md),
[0007 — A2A Tasks as the wake contract](./0007-a2a-tasks-as-the-wake-contract.md),
[0008 — Fleet topology](./0008-fleet-topology.md), and
[0009 — One vault per habitat](./0009-per-habitat-vaults.md)

This ADR was accepted as ADR 0023 on the unmerged
`claude/gaia-integration-gaps-9q50zk` branch. Main already uses 0023 for
Supplier dial-in, so the decision lands here under the next available number.
Issue [#367](https://github.com/The-Focus-AI/umwelten/issues/367) contains the
full product specification and testing plan.

## Context

A project Habitat owns an application repository. Its coding agent can edit,
build, and open a pull request, but the project cannot currently publish a live
development server: the Habitat's one address already carries A2A, MCP, chat,
and health traffic.

The required loop is seconds rather than a commit, push, and remote build.
Projects are not uniform, and the standards corpus defines `mise dev` as the
development loop for both served applications and non-serving libraries.
Ports therefore cannot be safely declared in a second configuration surface.

## Decisions

**The project runs inside its Habitat.** After provisioning, a supervisor runs
`mise dev` in each active worktree. It discovers TCP listeners from `/proc`,
scoped to the process tree, instead of requiring `ss` or `lsof` in the image.

**The command is conventional and ports are discovered.** No preview field is
added to `habitat.json`. A clean task that opened no port is a normal
non-serving project and is not restarted. A server exit or failed task restarts
with backoff. A loopback-only listener is an explicit configuration error.

**One standalone router owns the preview wildcard.** Gaia remains off the
application request path. The router has no Docker socket, GitHub App key, or
vault access; it resolves cached registry data and proxies streaming HTTP and
websocket upgrades directly to the serving Habitat.

**Addresses identify project, branch, port ordinal, and Habitat.** Ordinals
follow ascending port number, not process startup order. The primary checkout
uses its current branch like every other worktree, so switching branches changes
its address rather than silently retargeting an existing link. Long DNS labels
are truncated with a hash, and every Habitat has a stable random suffix.

**Preview links are public capabilities.** They are unguessable, shareable with
people who have no account, marked no-index, and served under the separate flat
wildcard `*.preview.crepusculardiphthong.com`. A known Habitat suffix with a
branch or ordinal no longer cached is a stale link, distinct from an unknown
host.

**Dormant projects wake through an interstitial.** Browser JavaScript calls a
narrow, rate-limited, wake-only Gaia capability and reloads. Merely fetching the
HTML does not wake a Habitat, which keeps ordinary crawlers from spending
compute. The existing coalescing waker handles concurrent first visits.

**Preview traffic is activity.** The existing reaper uses the later of agent
and preview traffic with the existing idle threshold. There is no second sleep
policy.

**Logs are diagnostic and ephemeral.** Each worktree has a bounded in-memory
tail. The supervisor replaces every resolved non-empty secret value before logs
can reach either the agent or a public failure page.

**Branches use Git worktrees.** The primary checkout is never removed.
Secondary worktrees share the object store, stop their server when idle, and are
removed after a longer abandonment window. Every cleanup is reported.

**The agent hands over links only after serving begins.** Serving means announce
the address; failure means keep diagnosing; a clean no-service result means say
that the project has nothing to serve. Public error pages are fallbacks for a
link whose service later breaks, not the normal first experience.

## Consequences

- Registry entries gain a runtime-only random suffix and cached preview set so
  dormant Habitats remain resolvable and declaration re-application cannot
  rotate shared links.
- Wildcard TLS requires DNS-01 and a Caddy build containing the preview zone's
  DNS provider plugin; per-host certificates would exceed issuance limits.
- Phase 1 is single-tenant. Customer code additionally requires a real sandbox
  boundary, removal of Gaia's Docker socket from model reach, per-tenant secret
  isolation, and a revisit of public wake and preview cookie scope.
- Repo creation becomes an audited Gaia operation with explicit write access to
  exactly the new private Owned repo. Write scope is never derived.
