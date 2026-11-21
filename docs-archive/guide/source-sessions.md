# Source Sessions

A **Source Session** is a persisted conversation produced by some other tool —
Claude Code, Cursor, pi, Antigravity, or a habitat. Umwelten reads them through
a unified adapter layer, normalizes them into one shape, and hands them to
everything downstream.

Read this to find, inspect, and load sessions. For grouping them into lines of
inquiry, see [Explorations](./explorations.md). For turning them into durable
knowledge, see [Reflections & Knowledge](./reflections-and-knowledge.md).

## Supported sources

Five adapters are registered by default:

| Source | Storage | Location |
|---|---|---|
| **Claude Code** | JSONL, read-only | `~/.claude/projects/{encoded-path}/{uuid}.jsonl` |
| **Cursor** | SQLite | `~/Library/.../Cursor/User/workspaceStorage/{hash}/state.vscdb` |
| **pi** | JSONL, branching | pi's session tree — see [ADR 0001](../adr/0001-project-pi-session-trees-as-explorations.md) |
| **Antigravity** | JSONL | per-project |
| **Gaia** | HTTP | remote habitat containers via the Gaia proxy; inert without `GAIA_HOST` |

Native habitat transcripts are handled separately — see
[`sessions habitat`](#habitat-sessions) below.

The adapter interface is **read-only**: `discoverProjects`, `discoverSessions`,
`getSessionEntry`, `getSession`, `getMessages`. There is no `putSession`, so
umwelten never writes into another tool's history. Claude Code transcripts in
particular stay untouched; anything umwelten derives is written elsewhere.

## Finding sessions

```bash
# Sessions for the current project, across every registered source
pnpm run cli -- sessions list

# A different project
pnpm run cli -- sessions list -p ../other-project

# One source, filtered
pnpm run cli -- sessions list --source claude-code --limit 20 --branch main
pnpm run cli -- sessions list --source all --json
```

Run from the **project root** — paths are normalized and matched against each
tool's own notion of the workspace, so being in the same directory the editor
has open is what makes its sessions show up.

For full-content search across every session on disk regardless of project, see
[Search](./search.md) (`umwelten search`, requires ripgrep).

## Inspecting one

```bash
pnpm run cli -- sessions show c15a9952            # metadata, tokens, cost
pnpm run cli -- sessions messages c15a9952 -l 10  # conversation, tool calls inline
pnpm run cli -- sessions tools c15a9952 --tool Bash
pnpm run cli -- sessions stats c15a9952           # token usage and cost
pnpm run cli -- sessions export c15a9952 -o out.md
```

`sessions messages` renders tool calls inline under the message that made them
(`↳ Read (file_path: …)`). `sessions tools` gives the same calls as a table.

Interactively:

```bash
pnpm run cli -- sessions tui                       # overview, then pick
pnpm run cli -- sessions tui abc1234               # a session by id
pnpm run cli -- sessions tui /path/to/session.jsonl
cat session.jsonl | pnpm run cli -- sessions format   # or pipe it
```

`sessions format` also accepts Claude Code's live stream:

```bash
claude -p "prompt" --output-format stream-json | pnpm run cli -- sessions format
```

## The normalized shape

Every adapter returns the same structure, which is what lets the rest of the
system ignore where a session came from:

```typescript
interface NormalizedSession {
  id: string;              // prefixed, e.g. "claude-code:abc123"
  source: SessionSource;
  sourceId: string;        // the original id
  projectPath?: string;
  gitBranch?: string;
  created: string;
  modified: string;
  duration?: number;
  messages: NormalizedMessage[];
  messageCount: number;
  firstPrompt: string;
  metrics?: {
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    totalTokens?: number;
    estimatedCost?: number;
  };
}
```

## Loading one into an Interaction

This is the bridge from *read a transcript* to *carry on working*:

```typescript
import { loadInteraction } from "@umwelten/core/interaction/adapters/load-interaction.js";

// Source is detected from the id
const interaction = await loadInteraction(sessionId, model, stimulus);
const response = await interaction.streamText();
```

From a session you already have in hand:

```typescript
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";

const interaction = Interaction.fromNormalizedSession(session, model, stimulus);
```

And back the other way — `interaction.toNormalizedSession()` returns the
portable form, so an Interaction can be round-tripped through the same shape
adapters produce.

### Programmatic discovery

```typescript
import { getAdapterRegistry } from "@umwelten/core/interaction/adapters/index.js";

const registry = getAdapterRegistry();

// Which sources actually have sessions here?
const adapters = await registry.detectAdapters("/path/to/project");

// One source
const sessions = await registry.get("claude-code")?.discoverSessions({
  projectPath: "/path/to/project",
  limit: 10,
});

// All of them
const all = await registry.discoverAllSessions({ projectPath: "/path/to/project" });
for (const [source, result] of all) {
  console.log(`${source}: ${result.totalCount}`);
}
```

A failing adapter is skipped rather than fatal — an unreachable Gaia host logs a
warning and yields an empty result, and the other sources still list.

## Habitat sessions

Habitat transcripts are umwelten's own, and writable, so they get their own
subtree:

```bash
pnpm run cli -- sessions habitat list --work-dir ~/my-habitat
pnpm run cli -- sessions habitat show <id>
pnpm run cli -- sessions habitat beats <id>
pnpm run cli -- sessions habitat replay <id>
```

On disk, a habitat session directory holds a live tail plus frozen segments:

```
sessions/<id>/
  transcript.jsonl            # live tail
  transcript.{ISO}.jsonl      # frozen segments, oldest first
  facts.jsonl  open_loops.jsonl  preferences.jsonl
  mistakes.jsonl  skill_candidates.jsonl
```

Compaction freezes the live file and starts a new one with a marker line
recording the summary. Learnings are append-only, one file per kind:

```bash
pnpm run cli -- sessions learnings append --session-dir <dir> \
  --kind facts --payload '{"note":"uses pnpm"}'
pnpm run cli -- sessions learnings list --session-dir <dir> --kind facts --json

pnpm run cli -- sessions transcript compact --session-dir <dir> \
  --summary "Rolled up tool-heavy segment; see facts.jsonl" \
  --learning-counts '{"facts":3,"mistakes":1}'
```

Produce learnings *before* compacting, so `learningCounts` is accurate.

Because Claude Code transcripts are read-only, umwelten mirrors learnings for
them under `{habitatWorkDir}/.umwelten/learnings/claude/{safeKey}/`:

```bash
pnpm run cli -- sessions learnings list \
  --work-dir ~/my-habitat \
  --claude-project ~/src/my-repo \
  --claude-uuid <uuid-from-filename>
```

The design behind this substrate is in
[`docs/architecture/session-record-introspection.md`](../architecture/session-record-introspection.md).

## What you can't do yet

There is no way to **send** a session somewhere. The adapter interface only
reads, and the pieces that would make a push — `interactionToNormalizedSession()`
for the portable form, `writeSessionTranscript()` for the Claude-compatible form
— exist but aren't wired to a verb. Remote transfer today is pull-only, via the
Gaia adapter.
