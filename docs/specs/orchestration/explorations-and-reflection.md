---
kind: spec
id: explorations-and-reflection
title: Cross-Harness Explorations, Session Search, Beats, and Knowledge Promotion
layer: orchestration
version: 2
---

## Intent

Ingest persisted conversations across Pi (`~/.pi` JSONL v3 trees), Pi Durable (`*.sqlite` stores), Claude Code, and Cursor into queryable **Explorations** inside `@umwelten/sessions`, enabling ripgrep full-content search, deterministic conversation beats, and promotion of distilled knowledge into project files.

## Invariants

- **[non-destructive-source-ingestion]** (*NEVER*): Session adapters (`pi`, `pi-durable`, `claude-code`, `cursor`) **NEVER** mutate or initialize tables inside foreign session files during discovery or projection.

## Acceptance Criteria

- **[pi-and-durable-exploration-projection]**: `PiSessionAdapter` and `PiDurableSessionAdapter` discover root sessions and branched/forked conversations from JSONL v3 trees and `pi-durable` SQLite files, projecting each conversation into an `Exploration` with message and tool metrics.
- **[ripgrep-session-search]**: `searchSessions(query)` scans configured session roots via `rg`, filters noise files, and returns message-level `SessionHit`s with bounded context snippets.
- **[reflection-promotion-routing]**: `classifyReflectionAnswer` and `PromotionRouter.promote` write declarative truths to `FACTS.md`, imperative guidance inside `<!-- umwelten:reflections:start/end -->` markers in `AGENTS.md`, and dated outputs to `.umwelten/reflections/` or `.umwelten/artifacts/`.

## Implementation Notes

- **Read-only precheck for `pi-durable` SQLite files**: `PiDurableSessionAdapter` probes `sqlite_master` for `durable_schema` via `openNodeSqliteDatabase(file, { mode: "read-only" })` before opening `SqliteStorage` so unrelated `.sqlite`/`.db` files are never mutated.

## Verification

1. **Sessions & Pi Extension Suite**: Run `pnpm exec vitest run packages/sessions/ packages/pi/src/extension.test.ts` and `pnpm tsx examples/pi-extension/demo.ts`.
