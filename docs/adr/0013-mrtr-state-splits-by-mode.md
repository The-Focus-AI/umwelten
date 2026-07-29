# 0013 — MRTR elicitation state splits by mode: blob when synchronous, Task when not

Status: Accepted
Date: 2026-07-29
Related: [0012 — One task substrate](./0012-one-task-substrate-two-protocol-projections.md),
[0007 — A2A tasks are the wake contract](./0007-a2a-tasks-as-the-wake-contract.md)

## Context

The MCP 2026-07-28 revision replaces server-initiated requests with Multi
Round-Trip Requests: a tool call returns `resultType: "input_required"`
with an `inputRequests` map, and the client retries the original call with
answers, echoing an opaque `requestState`. The spec requires servers to
treat an echoed `requestState` as attacker-controlled — integrity-protected
(HMAC/AEAD) with principal, TTL, and a request digest when it influences
anything that matters.

Umwelten has two kinds of MCP servers: mcp-serve deployments that are
genuinely stateless across instances (Vercel, fly), and habitats, which are
deliberately stateful (own volume, own task store). A single mechanism
would either force crypto-blob machinery onto servers that already have
durable state, or force server-side pending-elicitation tables onto
deployments that cannot share them across instances.

## Decision

Elicitation state lives in exactly one of two places, chosen by mode:

- **Synchronous tool calls** carry an integrity-protected `requestState`
  blob. One shared helper in `mcp-serve` (HMAC over principal + TTL +
  method/params digest, per the spec's replay guidance) is the only
  implementation; habitat servers use the same helper rather than growing
  a local variant.
- **Task-mediated operations** store pending `inputRequests` on the Task
  record (ADR 0012); the client answers via `tasks/update` and no blob is
  involved, because the Task *is* the durable state.

There is no third mechanism, and no server-side pending-elicitation table
outside the task store.

## Consequences

- Multi-instance mcp-serve deployments keep working with zero shared
  storage for interactive tools.
- A tool author chooses interactivity by choosing mode: quick
  confirmation → synchronous MRTR; anything long enough to outlive an HTTP
  exchange → return a Task and elicit through it.
- One-time-use elicitations (redemptions, irreversible approvals) must be
  task-mediated or enforce single-use server-side — the blob alone cannot
  guarantee at-most-once, as the spec itself warns.
