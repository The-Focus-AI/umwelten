---
kind: spec
id: durable-habitats
title: Host-Agnostic Durable Habitats and Multi-Agent Host
layer: orchestration
version: 1
uses:
  - standards/per-speaker-agent-identity@1
---

## Intent

Run each Habitat's conversations, forks, tasks, schedules, and UI state inside a host-agnostic `@earendil-works/pi-durable` `Harness` (`Storage` + optional `ExecutionEnv`), allowing dozens of API-only or repo-backed Habitats to share a single Node process without per-agent Docker sprawl.

## Invariants

- **[mounted-repo-read-only-boundary]** (*NEVER*): Coding tools (`write`, `edit`) **NEVER** modify files inside a Mounted read-only repository or outside the Habitat's allowed Owned and Mounted roots; writes succeed only inside the Owned repository and Habitat work directory.
- **[zero-container-api-habitats]**: Opening a `DurableHabitat` with `env: undefined` omits filesystem and shell tools completely while keeping custom HTTP/MCP tools, `ui://` resources, and durable tasks active.

## Acceptance Criteria

- **[sqlite-recovery-and-zero-copy-fork]**: Committing turns in a `DurableHabitat` backed by `openNodeSqliteStorage`, closing the `Harness`, reopening the same `habitat.sqlite` file, and calling `fork(atEntryId)` preserves parent history while isolating new turns on the forked conversation.
- **[multiplexed-host-eviction-and-wake]**: `HabitatHost` opens Habitat `.sqlite` stores on demand, evicts idle `Harness` instances past `idleEvictMs` when `wake().active` is `false`, keeps scheduled wakeup timers armed, and transparently reopens evicted Habitats on the next request or alarm.
- **[durable-turn-fanout-and-cron]**: Registering `TurnAnnotationProbe`s records post-run annotations in `ConversationAnnotationsDoc` via `GenerationTask` `afterRun` child tasks, and configured cron schedules sleep durably via `HabitatCronTask` (`runtime.sleepUntil`).

## Implementation Notes

- **`pi-durable` `Tx` & task commit contract**: Inside `TaskRuntime.commit((tx) => ..., ctx)`, mutate documents via `await tx.doc(DocToken, ...)` and return the next `TaskState` (`sleeping` | `running` | `terminal`) from the callback; never call `Harness` read methods inside a `commit()` callback or it will deadlock on the single-writer line.
- **`fauxProvider` tool rounds in tests**: `@earendil-works/pi-ai`'s `fauxAssistantMessage(blocks)` defaults `stopReason` to `"stop"`; pass `{ stopReason: "toolUse" }` whenever scripting tool-call turns for `pi-durable`.

## Verification

1. **Durable Habitat, Repo Scope & Provisioning Suite**: Run `pnpm exec vitest run packages/habitat/` and `pnpm tsx examples/durable-habitat/host.ts`.
