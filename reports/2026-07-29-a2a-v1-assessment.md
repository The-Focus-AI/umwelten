# A2A v1.0: What Changed, and What Umwelten Must Do About It

*Date: 2026-07-29 | Spec: [A2A v1.0.0](https://a2a-protocol.org/latest/specification/) (2026-04-09, Linux Foundation) | Companion: `reports/2026-07-29-mcp-spec-2026-07-28-deep-dive.md`*

---

## Overview

A2A reached **v1.0.0 on 2026-04-09** under Linux Foundation governance (150+ orgs, five
production SDKs), and — the operative fact for us — **`@a2a-js/sdk` shipped its 1.0 line in
July**: `1.0.0` on 2026-07-22, `1.0.1` on 2026-07-28. Umwelten pins `^0.3.14` (released
2026-07-09) and hardcodes `protocolVersion: "0.2.5"` on habitat agent cards. We are one SDK
major behind as of last week, and our declared protocol version is two eras stale.

**Bottom line: nothing is broken today, and no emergency change is needed** — v1.0 servers
treat unversioned requests as 0.3, our fleet is self-consistent on the 0.3.x SDK, and our
state model already matches v1.0. But a deliberate migration wave is now due, because
version-negotiating v1.0 peers will start appearing, and the `0.2.5` we stamp on cards is
already wrong for the SDK we actually run.

This supersedes the A2A claims in `reports/2026-05-07-acp-a2a-mcp-agent-protocols.md`
("Stable (v1.2, March 2026)" was incorrect — there is no v1.2; v1.0.0 of April 2026 is
current).

## What v1.0 actually changed

- **Version negotiation moved to the wire.** An `A2A-Version` service header (`Major.Minor`,
  e.g. `1.0`) accompanies requests; an absent header means **0.3**; servers answer
  mismatches with `VersionNotSupportedError`. Versioning is no longer only a card field.
- **Canonical data model is Protocol Buffers**, with three equivalent bindings: JSON-RPC 2.0
  (primary), gRPC, HTTP+JSON/REST.
- **Breaking change: the `kind` discriminator is removed** from objects (`kind: "task"`,
  `kind: "message"`, part `kind: "text"` are 0.x-era shapes).
- **Breaking change: the extended-agent-card field moved**; `GetExtendedAgentCard` is a
  first-class authenticated operation.
- **`ListTasks` exists** (filtering, pagination, status criteria) — the operation the 0.3
  SDK famously lacked.
- **Task lifecycle formalized** as submitted → working → {input-required, auth-required} →
  {completed, failed, canceled, rejected}. (`auth-required` and `rejected` were already in
  late-0.3 SDKs.)
- **Agent cards can be signed**, and **extensions are card-declared** with URIs and a
  `required: true` flag (`ExtensionSupportRequiredError` for clients that don't comply) —
  e.g. A2UI rides this mechanism.

## Umwelten impact audit (as of this branch)

| v1.0 change | Our status | Action needed |
|---|---|---|
| `A2A-Version` header | Never sent (client) nor checked (server) — we ride the 0.3 default | Add on SDK bump |
| SDK major | `@a2a-js/sdk ^0.3.14` in `packages/protocols` + `packages/habitat`; **1.0.1 available since 2026-07-28** | **The migration trigger** — bump deliberately, not casually |
| `kind` discriminator removal | We *construct* `kind:` shapes (`a2a/client.ts:180,326` message + text parts; `a2a-handler.ts` publishes `kind:"task"` / status-update events) and *read* them tolerantly (`decodeA2ASendPayload` accepts `kind` or `type`) | Producer side must follow the 1.x SDK's types when bumped; consumer side is already tolerant |
| `protocolVersion: "0.2.5"` hardcoded | `packages/habitat/src/a2a-handler.ts:174`, plus conformance fixtures (`a2a/conformance/local-agent.ts:57`, `conformance.test.ts:203`) | Stale even for 0.3.x — should reflect what the running SDK speaks; fix alongside the bump so cards, header, and SDK agree |
| Task states `auth-required` / `rejected` | **Already handled**: `TERMINAL_TASK_STATES` includes `rejected`, `INTERRUPTED_TASK_STATES` includes `auth-required` (`file-task-store.ts:30-45`); the sweep logic (ADR 0007) treats interrupted states as never-abandonable | None — the state model is v1.0-shaped today |
| `ListTasks` | Deliberately absent (`task-client.ts` header note: SDK serves no `tasks/list`); fleet ops work around it via `summarizeTasks` + file-store scans | Opportunity: adopt once the 1.x SDK serves it — directly useful to task-recovery/runbook tooling and to Gaia's fleet view |
| Signed cards / `GetExtendedAgentCard` | Not used; cards are plain JSON at `/.well-known/agent-card.json` (correct location) | Optional. Card signing is worth evaluating with ADR 0003's per-user identity work; we don't use the extended card, so the field move doesn't bite |
| Card-declared extensions with `required` | We already ship non-standard card fields (`requiredCredentials`, `credentialMode` — ADR 0004) as ad-hoc extensions | Migrate those to the formal extension mechanism (URI-identified, `required` flag) — that's the spec-sanctioned home for exactly what we invented |
| Transport bindings (gRPC/REST) | JSON-RPC only | None — JSON-RPC remains the primary binding |

Also affected when the bump happens: the **conformance harness**
(`a2a/conformance/` — cases, runner, scripted/local agents all speak 0.2.5-era shapes) and
the **agent-browser example** (`discoverAgentEndpoint` reads cards version-agnostically;
fine, but its card fixtures say `0.2.5`).

## Migration findings (bump attempted 2026-07-29, deliberately reverted)

The `^0.3.14 → ^1.0.1` bump was attempted on this branch to size the work. Findings, so the
real migration starts with a map instead of a surprise:

- **The 1.x SDK is protobuf-generated end to end.** `TaskState` is a numeric enum
  (`TASK_STATE_COMPLETED`; `taskStateFromJSON`/`taskStateToJSON` convert), `Role` is an enum,
  `Part` is a oneof (`content: { $case: "text" | "raw" | "url" | "data", value }` plus
  required `filename`/`mediaType`), fields are required-by-default, and `Task.status` is
  optional. Every place we construct or destructure `kind:`-discriminated shapes changes.
- **`compat/v0_3` is wire-only.** It exports legacy transports
  (`LegacyJsonRpcTransportHandler`, `LegacyJsonRpcTransport`, `parseLegacyAgentCard`) that
  keep 0.3 peers working, but the legacy *programming model* (kind-discriminated types,
  string task states) is not exported. The type migration cannot be dodged: ~95 type errors
  across the workspace (conformance suite 30, `a2a-handler.ts` 28, the core a2a files the
  rest).
- **The `final` flag is gone.** v1's `TaskStatusUpdateEvent` carries only
  taskId/contextId/status/metadata; the executor contract is a `kind`/`data` union
  (`AgentEvent.statusUpdate(...)` factories) with stream termination owned by the event bus
  (`finished`), not the event. Our habitat executor's load-bearing ordering — artifacts →
  terminal status with `final: false` → final message, empirically verified against live SSE
  (see `a2a-handler.ts:466-491`) — is **unrepresentable** in v1 and must be redesigned
  around the new termination model, then re-verified against a live streaming peer. This is
  the single highest-risk item.
- **`TaskStore` grows a required `list()`** (ListTasks arrives) and methods thread a
  `ServerCallContext`; the push-notification store interface changed shape too. Both file
  stores need interface work, and `FileTaskStore`'s on-disk JSON (string states) needs a
  read-path normalization (`taskStateFromJSON`) or an explicit toJSON wire format so
  existing habitat volumes keep replaying.
- **The client stack is new.** `JsonRpcTransport` no longer exists; the SDK now ships
  `Client`/`ClientFactory`/`TransportFactory` with card-driven transport selection
  (`AgentCardResolver`, `isLegacyAgentCard`). Our hand-rolled senders either adopt the
  factory stack or pin `LegacyJsonRpcTransport` from compat.

Conclusion: this is a redesign-scale migration of the A2A layer (protocols + habitat +
conformance + on-disk format), not a dependency bump. It was reverted to keep the branch
green and is scoped below as its own project, gated on the conformance harness *plus* live
SSE verification against a running habitat — the piece a keyless CI container cannot do.

## Recommended sequencing

1. **Now (this report):** record the facts; correct the May report's version claim; stop
   quoting `0.2.5` in new work.
2. **A2A Wave 1 — the SDK bump (gated on green conformance):** upgrade both packages to
   `@a2a-js/sdk ^1.0.1` in one change; follow the SDK's new types wherever we construct
   `kind:` shapes; set the card `protocolVersion` and the `A2A-Version` header from the SDK,
   not from a string literal (one source of truth — same rule as ADR 0012 applies to
   discovery surfaces); update conformance fixtures and re-run the harness against a live
   habitat before merging. This is shared runtime (`a2a-handler.ts` carries load-bearing
   event-ordering fixes) — it gets its own PR with the conformance suite as the gate.
3. **A2A Wave 2 — adopt what v1.0 gives us:** `ListTasks` in `task-client.ts` + fleet
   tooling; migrate `requiredCredentials`/`credentialMode` to formal card extensions;
   evaluate card signing alongside ADR 0003.

## Cross-references

- Labs dispatch drawing the post-convergence MCP/A2A boundary: `where-a2a-begins-and-ends`
  (labs repo, same branch).
- MCP-side companion: `reports/2026-07-29-mcp-spec-2026-07-28-deep-dive.md` — note the
  symmetry: both protocols now converge on tasks + discovery + extensions, which is why
  ADR 0012 (one task substrate) matters more, not less, after v1.0.

## Sources

- A2A v1.0 specification: https://a2a-protocol.org/latest/specification/
- Linux Foundation one-year announcement (2026-04-09): https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year
- npm registry, `@a2a-js/sdk` release history (1.0.0 → 2026-07-22, 1.0.1 → 2026-07-28,
  0.3.14 → 2026-07-09), retrieved 2026-07-29.
