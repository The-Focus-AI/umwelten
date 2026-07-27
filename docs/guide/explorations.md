# Explorations

An **Exploration** is a line of inquiry: one or more [Source
Sessions](./source-sessions.md) and the Interactions derived from them, grouped
because they belong to the same piece of work.

The distinction that matters: a Source Session is *where a tool put a
transcript*. An Exploration is *what you were trying to do*. One question
pursued across three Claude Code sessions and a Cursor session is one
Exploration, not four.

`CONTEXT.md` is the ground truth for this language.

## The three kinds

| kind | where it comes from |
|---|---|
| **default** | Every Source Session starts as its own Exploration. Nothing to do. |
| **virtual** | Search results and inferred groupings. Exists only until named. |
| **saved** | A virtual Exploration you named, persisted to `.umwelten/explorations/`. |

Projection is what turns discovered sessions into Explorations:

```typescript
import { projectSessions } from "@umwelten/core/interaction/projection/index.js";

// Walks every registered adapter, returns SourceSessions + default Explorations
const { sessions, explorations } = await projectSessions(projectPath);
```

## The browser

`umwelten browse` is the primary entry point — every session with its digest
shown inline.

```bash
pnpm run cli -- browse                    # 30-day window by default
pnpm run cli -- browse --sessions-dir examples/jeeves-bot/jeeves-bot-sessions
pnpm run cli -- introspect browse         # namespaced alias
```

Keys:

| key | does |
|---|---|
| `enter` | detail view — tabs over the digest: overview, beats, phases, facts, diff against `CLAUDE.md` |
| `D` | run the digester on this session, streaming progress |
| `b` | beats view — deterministic, no LLM |
| `v` | raw transcript |
| `/` | search |
| `4` | widen from 30 days to everything |
| `q` | quit |

The window defaults to 30 days because the list is otherwise dominated by old
work; press `4` when you're looking for something specific.

## Digests

A **digest** is the derived summary of a session: topics, tags, summary, phases,
facts, and metrics. It's what makes the browser readable and search useful, and
it's produced by a multi-stage pipeline — compaction, then analysis, then beats,
phases, and fact extraction.

Run it from the browser with `D`, or in bulk:

```bash
pnpm run cli -- sessions digest build          # digest everything, all projects
pnpm run cli -- sessions digest overview       # command center
pnpm run cli -- sessions digest stats
pnpm run cli -- sessions digest topics         # top topics across everything
pnpm run cli -- sessions digest patterns
pnpm run cli -- sessions digest search "<query>"
pnpm run cli -- sessions digest knowledge      # accumulated knowledge
pnpm run cli -- sessions digest ask "<question>"   # interactive if omitted
```

Digests are stored per session and are incremental — only new or modified
sessions are re-digested unless you force it.

### Beats

A **beat** is one user turn plus everything the assistant did in response.
Beats are computed deterministically with no model call, which is why `b` in the
browser is instant and free while `D` is neither. If you want structure without
paying for it, that's the view.

## Indexing and search

Digesting is the modern path. The older per-project index still exists and backs
`sessions search`:

```bash
pnpm run cli -- sessions index                 # LLM analysis, all sources
pnpm run cli -- sessions index --force -v
pnpm run cli -- sessions search "react hooks" --tags typescript --type bug-fix
pnpm run cli -- sessions analyze --type topics    # or tools, patterns
```

Indexing extracts topics, tags, key learnings, a summary, solution type, code
languages, tools used, success indicators, and related files. It costs roughly
$0.0003 per session on Gemini 3 Flash — about $0.30 for a thousand sessions —
and is incremental.

Search ranks by weighted match: exact tag +10, partial tag +7, topic +5,
summary or learnings +3, tool +2, first prompt +1, plus a recency bonus decaying
over 30 days and +2 for a successful outcome.

For full-content search across every session on disk rather than the index, see
[Search](./search.md).

## Saving one

```typescript
import { SavedExplorationStore } from "@umwelten/core/interaction/knowledge/saved-exploration-store.js";

const store = new SavedExplorationStore(projectPath);
await store.save(exploration);      // → .umwelten/explorations/<name>.json
const all = await store.list();     // newest first
```

Manifests are human-readable JSON, hand-editable on purpose. A Saved Exploration
gives a grouping a stable project-local name so you can refer to it later — from
a Reflection, or from another session entirely.

## Where this goes next

An Exploration is the unit a **Reflection** asks questions about. That's
[Reflections & Knowledge](./reflections-and-knowledge.md).

To fan several questions out over a *live* Interaction rather than a saved
Exploration, see [Turn Fan-out](./turn-fanout.md).
