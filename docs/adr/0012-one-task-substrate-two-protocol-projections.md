# 0012 — One task substrate, projected to both A2A and MCP

Status: Accepted
Date: 2026-07-29
Related: [0007 — A2A tasks are the wake contract](./0007-a2a-tasks-as-the-wake-contract.md),
[0005 — UI resources over A2A and MCP](./0005-ui-resources-over-a2a-and-mcp.md)

## Context

The MCP 2026-07-28 revision moved tasks into an official extension
(`io.modelcontextprotocol/tasks`): a server may answer a tool call with a
durable task handle, the client polls `tasks/get`, mid-flight input arrives
via `tasks/update`, and cancellation is cooperative. That is structurally
the A2A task lifecycle this project standardized in ADR 0007 — polling
`tasks/get`, non-blocking send, habitat-owned state, sweep on boot.

With both protocols now speaking a task idiom, a habitat could grow two
task subsystems: the existing `FileTaskStore` behind `/a2a`, and a fresh
store behind `/mcp` for the extension. See
`reports/2026-07-29-mcp-spec-2026-07-28-deep-dive.md` for the full spec
analysis.

## Decision

There is **one task substrate per habitat**. A long-running operation
(`agent_ask`, `agent_converse`, provisioning, rollups) creates one task
record in the habitat's task store. The A2A handler serves that record via
A2A `tasks/get` on `/a2a`; the MCP tasks extension serves the **same
record** via the extension's `tasks/get`/`tasks/update` on `/mcp`. Status
vocabularies are mapped at the protocol edge (A2A `working`/`completed`/
`canceled` ↔ MCP `working`/`input_required`/`completed`/`failed`/
`cancelled`); the stored record, TTL, and sweep behavior are shared.

This mirrors the tool-definition rule (one `ToolSpec` projected to every
surface, STD-010 §3.2) applied to task state, and keeps ADR 0007's wake
contract as the single answer to "what is this habitat doing."

## Consequences

- The MCP tasks extension is implemented as a projection layer over
  `FileTaskStore`, not a new subsystem; `tasks/update` input responses are
  written back into the shared record for the executor to consume.
- Anything the sweep (`sweepAbandonedTasks`) decides applies to both
  protocol surfaces at once — an MCP poller and an A2A poller can never
  see two different truths about one operation.
- MCP task ids and A2A task ids draw from the same id space; a handle
  minted on one surface is resolvable on the other where auth allows.
