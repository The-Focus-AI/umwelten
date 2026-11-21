# 0007 — A2A tasks are the wake contract, and habitats own their task state

Status: Accepted
Date: 2026-07-25
Related: [0003 — Per-user A2A identity](./0003-per-user-a2a-identity.md),
[0008 — Fleet topology](./0008-fleet-topology.md)

## Context

A fleet of roughly twenty habitats cannot keep every container running: the
runtime plane is one `e2-standard-4` (16 GB, no swap) that moved off a
7.6 GB box precisely because of OOM kills. Habitats must go dormant when
idle and wake when asked.

Waking is slow. `entrypoint.sh` runs, on every start, a pull of the owned
repo, `mise install`, `pnpm install --prod`, a clone plus `mise install`
per mounted repo, and a skills restore — so wake time scales with mount
count, and the rollup habitat is the slowest waker in the fleet. A
synchronous ask cannot absorb that.

Nor is wake the only slow thing. A changelog rolled up across every client
habitat and reconciled against its statement of work is inherently long —
many A2A calls, each an LLM turn, plus a synthesis pass — and exceeds any
sane HTTP timeout with every container already warm. Token caps are not
available as a mitigation; capping output is forbidden by the project's
hard rules because it silently corrupts results.

A2A already models all of this. `message/send` returns a **Task** in a
non-terminal state; `returnImmediately` hands control back at once;
progress arrives by polling `tasks/get`, subscribing, or a webhook. The
habitat executor already emits a correct lifecycle, and the SDK's request
handler already serves `tasks/get`, `tasks/list` and `tasks/cancel`.

Two things blocked using any of it. The task store was in-memory, so state
died with the container — fatal when the reaper is the thing stopping it.
And every A2A client in the estate hand-rolled its JSON-RPC: two senders in
umwelten built on raw `fetch` and `node:http`, a third path using the SDK
for streaming only, and a fourth, entirely separate implementation in the
SaaS with no SDK dependency at all. None could poll a task.

## Decision

1. **A task is the unit of asking.** Callers use `returnImmediately` and
   track progress through the task lifecycle. A dormant habitat is not a
   special case — it is a task that takes longer to reach `working`.
2. **Task state is durable and lives on the habitat's volume.** The
   habitat serving `tasks/get` is the one that must be able to read it, and
   habitat-to-habitat traffic never involves the SaaS.
3. **Task, Run and Source Session stay separate**, correlated by
   `contextId` and `taskId`. The SaaS's `runs` table is a projection for
   cost, attribution and audit — not the task store — even though its
   shape is nearly identical.
4. **Clients standardise on `@a2a-js/sdk/client`.** No Focus-owned client
   package: the SaaS's client is Clerk- and Postgres-shaped and must stay
   on its side of ADR 0003. What is genuinely shared is the wire protocol,
   which the SDK already implements. A **conformance suite** running both
   clients against a live habitat is the shared artifact instead.

## Considered options

Holding the HTTP request at Gaia's proxy while the container boots was
simpler and needed no protocol change. Rejected because it solves only
wake, not long work — the rollup would still time out — and would have to
be unwound as soon as it did.

Reusing the SaaS `runs` table as the task store was tempting given how
closely it already matches. Rejected: it inverts the dependency (habitats
are downstream of the SaaS by design) and leaves habitat-to-habitat calls
with no durable task state at all.

## Consequences

- A reaped container can run a crash-recovery sweep on next boot and mark
  abandoned tasks failed with a real reason. Only possible because the
  state is where the habitat can see it.
- The reaper must refuse to stop a habitat holding non-terminal tasks.
- There is no fleet-wide "what is running now" view without fanning out,
  and dormant habitats cannot answer. That view comes from the SaaS's
  projection, which makes habitat-to-SaaS reporting load-bearing for
  observability — or the view is quietly incomplete.
- `auth-required` becomes available as a first-class parking state for work
  that needs a specific person's credentials, rather than a failure.
