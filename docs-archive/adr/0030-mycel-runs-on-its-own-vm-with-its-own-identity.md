# 0030 — Mycel runs on its own VM, with its own GCP identity

Status: Accepted
Date: 2026-08-10

Mycel runs on a dedicated GCE instance (`mycel-host`) with its own service
account, not as a container on `gaia-host`. Its secrets live in Google Secret
Manager, bound per-secret to that service account, and are fetched at container
start through the instance's attached identity. There is no key file, no
`.env` holding a secret, and no bootstrap token anywhere on the box.

## The problem this solves

Every container on a Docker host can reach the GCE metadata server, and
therefore assume the instance's attached service account. On one VM there is one
identity, and no arrangement of compose files divides it.

`gaia-host` runs habitat containers that execute **arbitrary agent code**. Had
Mycel stayed there, granting the instance's service account access to the money
ledger's connection string would have granted it to every agent container on the
box — not through a bug, but by construction. The separation would have been a
convention, enforced by nothing.

This is the same blast-radius argument the Exchange already makes three times
over: its own Neon project (ADR — `mycel-deployment.md` Part 1), its own compose
file, its own OpenRouter key. Each stops at a boundary the previous one implied.
The instance identity is where that reasoning was still unenforced, and it is
the boundary that matters most, because the thing on the other side of it runs
code we did not write.

## Why not Cloud Run, which is the obvious GCP answer

Mycel is stateless and holds no volume — on paper it is a textbook Cloud Run
service, and it would get per-service identity, native `--set-secrets`, and
managed TLS for free.

**ADR 0023 is what rules it out.** Machine Suppliers dial in and hold a
persistent outbound connection, and Mycel "becomes connection-stateful — it must
know which Suppliers are connected." A Supplier dialled into one instance is
invisible to another, so *connected is available; disconnected is unavailable*
stops holding the moment the platform scales. Pinning `min = max = 1` restores
it, but that is a VM bought at the price of a request-duration ceiling.

Cloud Run is right for stage 1 and wrong from stage 2 on. Putting the money
service somewhere it must be moved from is worse than putting it on a VM now.

## How secrets work here

**No bootstrap secret exists.** The instance's attached service account is
workload identity: the metadata server issues short-lived tokens, and nothing
long-lived is ever written to disk. This satisfies STD-007 §3.10 deliberately
rather than by accident, and it is strictly better than resolving through fnox
in production, which requires a long-lived 1Password service-account token to
sit in a file on the host.

- One GSM secret per value (`mycel-database-url`, `mycel-openrouter-api-key`),
  each bound to `mycel-sa` **on the secret resource**, never project-wide
  (STD-007 §3.12 — a store receives only what its target needs).
- Fetched by the container's entrypoint and held in the process environment
  only. Nothing at rest, so there is no file to leak and none to clean up.
- `.env` keeps the non-secret shape — hostname, port — and nothing else.

`upstreamCredentialEnv` is unchanged: a Supplier record still stores the *name*
of an environment variable, never a key, so a database compromise still yields
nothing spendable (`mycel-deployment.md` Part 2).

**Rotation is a new secret version plus a restart**, because secrets are read at
boot. For a service that restarts in seconds and is deployed by a human running
a script, that is a fair trade for never holding a refreshable credential.

## Where this deviates from STD-007

The standard's §3.1 requires every project to have its own 1Password vault, and
§3.3 puts a bootstrap token in a gitignored `.fnox/env`. Production Mycel has
neither, on purpose — on GCE both are strictly worse than the attached identity.

GDE-003 already sanctions this: its Pattern B is "sync to Secret Manager, no
fnox in prod". The reconciliation is that **1Password remains the source of
truth for humans and for laptops**, which have no metadata server, and GSM is
the production store. The sync runs one way. A production secret that exists
only in GSM and never in 1Password is a further step, and not one taken here.

## Consequences

- One more instance to patch, monitor and pay for. Small, and the point.
- `gaia-host`'s startup script and compose stack are untouched; Gaia keeps
  resolving its own secrets the way it does today. This ADR does not fix
  habitats' plaintext master vault — that is T12, and it is now clearly
  separate work rather than something Mycel's deploy might drag along.
- Caddy no longer fronts Mycel from the Gaia host. `mycel-host` runs its own
  ingress, and `mycel.thefocus.ai` points at *its* static IP.
- Deploying Mycel now requires being on a different box than deploying Gaia.
  That is the separate-cadence property made physical, and the runbook in
  `deploy/mycel/README.md` says which box each command belongs on.
