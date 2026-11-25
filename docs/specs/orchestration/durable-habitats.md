---
kind: spec
id: durable-habitats
title: Host-Agnostic Durable Habitats and Multi-Agent Host
layer: orchestration
version: 2
uses:
  - standards/per-speaker-agent-identity@1
---

## Intent

Run each Habitat's conversations, forks, tasks, schedules, and UI state inside a host-agnostic `@earendil-works/pi-durable` `Harness` (`Storage` + optional `ExecutionEnv`), allowing dozens of API-only or repo-backed Habitats to share a single Node runtime while isolating client deployments behind a trusted perimeter gateway for credential injection, LLM/HTTP proxying, and correlated audit tracing.

## Invariants

- **[mounted-repo-read-only-boundary]** (*NEVER*): Coding tools (`write`, `edit`) **NEVER** modify files inside a Mounted read-only repository or outside the Habitat's allowed Owned and Mounted roots; writes succeed only inside the Owned repository and Habitat work directory.
- **[zero-container-api-habitats]**: Opening a `DurableHabitat` with `env: undefined` omits filesystem and shell tools completely while keeping custom HTTP/MCP tools, `ui://` resources, and durable tasks active.
- **[zero-secret-habitat-runtime]** (*NEVER*): Production client Habitats **NEVER** hold raw upstream LLM provider keys or external SaaS/MCP OAuth secrets in their process environment; all LLM and external HTTP/MCP traffic traverses the trusted `perimeter-gateway` over an internal-only network with no direct internet egress.
- **[perimeter-correlated-audit-trace]** (*NEVER*): The `perimeter-gateway` **NEVER** forwards an LLM completion or outbound HTTP/MCP request without recording a correlated audit span (`trace_id`, `habitat_id`, `speaker_id`, status, latency, and secret-redaction count) into the client-local audit ledger.

## Acceptance Criteria

- **[sqlite-recovery-and-zero-copy-fork]**: Committing turns in a `DurableHabitat` backed by `openNodeSqliteStorage`, closing the `Harness`, reopening the same `habitat.sqlite` file, and calling `fork(atEntryId)` preserves parent history while isolating new turns on the forked conversation.
- **[multiplexed-host-eviction-and-wake]**: `HabitatHost` opens Habitat `.sqlite` stores on demand, evicts idle `Harness` instances past `idleEvictMs` when `wake().active` is `false`, keeps scheduled wakeup timers armed, and transparently reopens evicted Habitats on the next request or alarm.
- **[durable-turn-fanout-and-cron]**: Registering `TurnAnnotationProbe`s records post-run annotations in `ConversationAnnotationsDoc` via `GenerationTask` `afterRun` child tasks, and configured cron schedules sleep durably via `HabitatCronTask` (`runtime.sleepUntil`).
- **[client-environment-hybrid-egress]**: A Client Environment separates a two-plane boundary where the `perimeter-gateway` serves named reverse-proxy egress routes (`/egress/<service>/*`, `/egress/mcp/<name>/*`) with method/path ACLs and response secret-scrubbing plus an optional CA-backed forward proxy when `CodingTools` `bash` is enabled.

## Implementation Notes

- **`pi-durable` `Tx` & task commit contract**: Inside `TaskRuntime.commit((tx) => ..., ctx)`, mutate documents via `await tx.doc(DocToken, ...)` and return the next `TaskState` (`sleeping` | `running` | `terminal`) from the callback; never call `Harness` read methods inside a `commit()` callback or it will deadlock on the single-writer line.
- **`fauxProvider` tool rounds in tests**: `@earendil-works/pi-ai`'s `fauxAssistantMessage(blocks)` defaults `stopReason` to `"stop"`; pass `{ stopReason: "toolUse" }` whenever scripting tool-call turns for `pi-durable`.

## Verification

1. **Durable Habitat, Repo Scope & Provisioning Suite**: Run `pnpm exec vitest run packages/habitat/` and `pnpm tsx examples/durable-habitat/host.ts`.
2. **Client Environment Perimeter & Trace Suite**: Run `pnpm run demo:client-env -- --smoke` and verify correlated `llm.completion` + `http.egress` + `policy.denied` audit spans with zero secret leakage.
