# Session record & introspection

Unified **session handles**, **learnings** (typed append-only JSONL), and **Habitat transcript compaction** so habitat-facing traffic and **Claude Code** sessions can share the same save/load interface for derived knowledge—without writing into Anthropic’s `~/.claude` JSONL files.

## Principles

- **Canonical content** is the **transcript** (full tool I/O; no default trimming). Scaling uses **compaction + learnings**, not tool-result sidecars.
- **No global “head”.** Each interface context (Discord channel/thread, Telegram chat, CLI session, Claude UUID, …) has its own namespace—usually a **directory** or a resolved **path set**.
- **Learnings** are five append-only files keyed by **kind**: `facts`, `playbooks`, `preferences`, `open_loops`, `mistakes`.
- **Claude Code:** read transcripts from `~/.claude/projects/{encodedPath}/{uuid}.jsonl`; write learnings only under **`{workDir}/.umwelten/learnings/claude/{safeKey}/`** (umwelten-owned).

## On-disk layout

### Habitat session directory (existing)

```
{sessionDir}/meta.json
{sessionDir}/transcript.jsonl          # live append tail
{sessionDir}/transcript.{ISO}.jsonl   # frozen after compaction (optional chain)
{sessionDir}/facts.jsonl             # learnings (optional until first write)
{sessionDir}/playbooks.jsonl
...
```

### Claude (learnings mirror only)

```
{workDir}/.umwelten/learnings/claude/{safeKey}/
  facts.jsonl
  playbooks.jsonl
  ...
  meta.json    # optional: claude project path + uuid
```

`safeKey` is a short SHA-256 of `projectPath` + NUL + `sessionUuid`.

## Code (`src/session-record/`)

| Module | Role |
|--------|------|
| `types.ts` | `SessionHandle`, `LearningKind`, `LearningRecord`, `CompactionEventV1` |
| `learnings-store.ts` | `FileLearningsStore` — append/read per kind |
| `resolve-habitat.ts` | `sessionDir` → handle; learnings root = session dir |
| `resolve-claude.ts` | `workDir` + `projectPath` + uuid → handle |
| `transcript-segments.ts` | Ordered `transcriptReadPaths` for Habitat (frozen + live) |
| `habitat-transcript-load.ts` | `loadHabitatSessionTranscriptMessages`, `loadRecentHabitatTranscriptCoreMessages` |
| `context-merge.ts` | `buildHabitatIntrospectionContextMessages` — optional prepend after compaction |
| `compaction-habitat.ts` | Rename live transcript → `transcript.{iso}.jsonl`, new live with compaction line |

## Compaction line (live `transcript.jsonl`)

First line after compaction is JSON with `type: "umwelten_compaction"`, `schema: 1`, `runId`, `createdAt`, `summary`, `predecessorSegment`, optional `learningCounts`. Habitat tooling uses `loadHabitatSessionTranscriptMessages()` which **drops** these lines so summaries and beats stay aligned with real turns; `parseSessionFile` still returns parsed JSON per line for low-level use.

## Tools & CLI

- **Habitat tools** (`createSessionTools`): `sessions_learnings_append`, `sessions_learnings_read`, `sessions_transcript_compact` (same file ops as compaction module; produce learnings/summary **before** calling or in the same workflow).
- **CLI:** `sessions learnings append|list` ( `--session-dir` or Claude mirror via `--work-dir` + `--claude-project` + `--claude-uuid` ); `sessions transcript compact --session-dir … --summary …`.
- **Context merge:** `buildHabitatIntrospectionContextMessages()` and `Interaction.prependHabitatIntrospectionFromDisk()` — optional prepend after reload/compaction (not on every `streamText`).
- **Digest:** `scripts/session-digest.ts` prints per-session learnings counts for a `sessions/` tree.

## Roadmap

- **Done:** types, learnings I/O, resolvers, compaction, multi-segment transcript load, session tools + CLI, introspection context builder, Discord/Telegram resume across segments, optional `meta.json` routing fields, digest script.
- **Later:** richer digest scheduling, streamed tail-load for very large transcripts.

## See also

- [Session management](../guide/session-management.md)
- `src/interaction/persistence/session-store.ts` — Claude project paths & index
- `src/habitat/session-manager.ts` — session directories
