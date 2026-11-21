# Knowledge Pipeline Walkthrough

This walkthrough takes you end-to-end through Umwelten's **Exploration-centered knowledge workflow** — the modern path that replaces the older `sessions index/search` flow.

The pipeline has four stages:

```
Source Sessions  →  Explorations  →  Reflection  →  Promotion
  (Claude Code,      (one per             (ask the       (write to
   Cursor, pi,        session by           model about     AGENTS.md,
   Habitat)           default)             one or more     FACTS.md,
                                           Explorations)   ADRs, …)
```

Everything writes plain Markdown into your project — no opaque database. Working data lives under `.umwelten/` (gitignore-friendly); promoted knowledge lives in top-level files (`AGENTS.md`, `FACTS.md`, `CONTEXT.md`, `docs/adr/`).

For the domain language used here (Source Session, Exploration, Reflection, Memory, Project Fact, Saved Exploration, …) read [`CONTEXT.md`](../../CONTEXT.md) at the repo root.

## Quick orientation: which command does what

| Command | Purpose |
|---|---|
| `umwelten browse` | **TUI dashboard — the one and only entry.** Every session with its digest inline. Search, filter, digest (`D`), reflect (`R`), promote (`P`). |
| `umwelten sessions digest <id>` | Re-run the digest pipeline for a specific session from the CLI (non-interactive). |
| `umwelten introspect browse` | Namespaced alias for `umwelten browse`. |

All examples assume the `dotenvx run --` prefix so `.env` is loaded.

## Step 1 — Run the browser against your project

From a project that has Claude Code, Cursor, or Habitat sessions:

```bash
dotenvx run -- pnpm run cli -- browse
```

What this does:

1. **Projects** every Source Session (Claude Code + Cursor + Habitat) into a default Exploration via `loadBrowseProjection` (`packages/sessions/src/introspect.ts:44`).
2. Walks `.umwelten/digests/` for any **pre-computed digest** and joins it in-row.
3. Renders the dashboard TUI with a 30-day window by default (press `4` to widen to all).

Each row shows: title (from first prompt) · source · message count · tool calls · created date · `solutionType` if digested.

### Key bindings

| Key | Action |
|---|---|
| `enter` | Open detail view (tabs: overview, beats, phases, facts, diff-against-CLAUDE.md) |
| `D` | Run the digester on the highlighted session (streams progress; always re-digests this row) |
| `c` | **Chat** with this session — open-ended multi-turn Q&A grounded on the digest. Type `exit` to return. Good for "what are the jobs to be done?" |
| `R` | **Reflect** — ask one question, get one answer, classifier suggests a promotion target. |
| `P` | **Promote** — same as `R` but auto-accepts the classifier's primary suggestion. |
| `s` | Toggle sort: `last activity` ↔ `started`. Both dates are visible in the row. |
| `b` | Pure-deterministic beats view (no LLM call) |
| `v` | Show raw transcript |
| `/` | Search (matches `solutionType`, summary, tags, topics) |
| `1`–`4` | Time window: 1d / 7d / 30d / all |
| `q` | Quit |

### Re-digesting

- **One row**: highlight + press `D`. Always re-digests, ignoring any digest on disk.
- **Everything**: `umwelten browse --force`. Confirms via the startup overlay, then re-digests every row.
- Without `--force`, the engine only digests rows that have **no digest** or are **stale** (source mtime newer than `digestedAt`).

## Step 2 — Digest a session so it's classified

The browse list shows sessions with or without a digest. To classify a session, run the digester:

```bash
# From inside the TUI: highlight a row and press D
# Or from the CLI for a specific session:
dotenvx run -- pnpm run cli -- sessions digest --session-id <id>
```

The digester runs three sub-pipelines and saves a `SessionDigest` JSON file under `.umwelten/digests/`:

1. **Compaction** — splits the transcript into segments, summarizes each one ("through-line + key facts").
2. **Beat analysis** — one entry per user turn: request → tools used → outcome → narrative → keyFacts.
3. **Phase detection** — groups consecutive beats into named phases ("Initial planning", "Implementation", "Debugging the failing tests", …).
4. **Analysis** — extracts `topics[]`, `tags[]`, `keyLearnings`, `summary`, **`solutionType`**, `codeLanguages[]`, `toolsUsed[]`, `successIndicators`.

The schema is defined in `packages/core/src/interaction/analysis/analysis-types.ts`. `solutionType` is the most useful filter in practice — see the next step.

## Step 3 — Identify planning sessions

Planning sessions are the ones where the **deliverable is a plan, not code**: architecture discussions, design docs, PRDs, ADR drafts, scope decisions, breaking work into tickets.

`solutionType` recognizes:

| Value | Meaning |
|---|---|
| `planning` | Deciding what to build, designing an approach, writing a spec/PRD, drafting an ADR, breaking down work. |
| `feature` | Code was added to ship new functionality. |
| `bug-fix` | A reported defect was fixed. |
| `refactor` | Code restructured without changing behavior. |
| `exploration` | Open-ended investigation of unfamiliar code or data. |
| `question` | One-shot Q&A, no code change intended. |
| `other` | Catch-all. |

### From the TUI

In `umwelten browse`:

1. Press `/` to open search.
2. Type `planning`.
3. The list filters to digested sessions whose `solutionType === "planning"` (the field appears in each row after digestion).

Or, in the detail view (`enter`), the **Overview** tab shows the full classification:

```
Solution type: planning
Topics:        knowledge pipeline architecture, exploration browser TUI, …
Tags:          design, architecture, planning, knowledge-promotion, …
Success:       partial
```

### From the CLI

The older `sessions search` flow still works on the legacy analysis index (use this if you want a quick scriptable filter):

```bash
# Find every planning session in this project
dotenvx run -- pnpm run cli -- sessions search --type planning

# Planning sessions about a specific topic
dotenvx run -- pnpm run cli -- sessions search "knowledge pipeline" --type planning
```

`--type` accepts any `solutionType` value (`bug-fix`, `feature`, `refactor`, `exploration`, `question`, `planning`, `other`).

### Tagging hint

The analyzer is also instructed to put `planning` into the `tags[]` array when relevant. So even if `solutionType` lands on something adjacent (e.g. `exploration` for an architecture deep-dive that turned into design notes), a `tags` filter still catches it:

```bash
dotenvx run -- pnpm run cli -- sessions search --tags planning
```

## Step 4 — Reflect on an Exploration

Reflection is **just an Interaction** whose system context is a set of Explorations. There's no new runner.

In `umwelten browse`:

1. Navigate to the row you want to reflect on (arrow keys).
2. Press `R` (reflect) or `P` (reflect + auto-promote to the primary suggestion).
3. The dashboard unmounts; you're prompted for a question. (e.g. *"what did we decide about the projection layer?"* — well-suited to a planning session.)
4. The CLI builds a reflective Interaction via `buildReflectiveInteraction` (`packages/core/src/interaction/reflection/reflection.ts:58`), streams the model's answer, then runs the **promotion classifier** (next step).

You can also drive this programmatically:

```typescript
import { buildReflectiveInteraction } from "@umwelten/core/interaction/reflection/reflection.js";
import { projectSessions } from "@umwelten/core/interaction/projection/index.js";

const { explorations } = await projectSessions(process.cwd());
const planning = explorations.filter((e) => /* … by id or metadata */);

const interaction = buildReflectiveInteraction(
  planning,
  "What architectural decisions did we make about the knowledge pipeline?",
  { model: { provider: "google", name: "gemini-3-flash-preview" } },
);

const { content } = await interaction.streamText();
console.log(content);
```

## Step 5 — Promote the answer

The reflection answer is a Markdown blob. Where it goes next is the **promotion classifier's** job (`packages/core/src/interaction/promotion/classifier.ts`).

`classifyReflectionAnswer(text)` runs keyword + strong-phrase heuristics and returns one of 8 targets:

| Target | File written |
|---|---|
| `agent-instruction` | `AGENTS.md` (or `CLAUDE.md`) inside a marker-managed `## Reflections` section |
| `project-fact` | `FACTS.md` |
| `domain-language` | `CONTEXT.md` |
| `adr` | `docs/adr/YYYY-MM-DD-slug.md` |
| `skill` | Skill draft under `.umwelten/candidates/skills/` |
| `artifact` | `.umwelten/artifacts/YYYY-MM-DD-slug.md` |
| `saved-reflection` | `.umwelten/reflections/YYYY-MM-DD-slug.md` (holding area) |
| `user-model` | `.umwelten/user-model.md` |

The classifier returns a `primary` decision with confidence + a list of `alternatives`. After the reflection answer is shown, you're prompted:

```
📊 Classification:
  Primary: Architecture Decision Record (72% confidence)
  Alternatives:
    Project fact (FACTS.md) (45%)
    Saved Reflection (30%)

Promote this result?
  [1] Save as reflection
  [2] Promote to Architecture Decision Record
  [3] Skip
Choice [1-3]:
```

`PromotionRouter.promote(decision)` dispatches to the matching writer in `packages/core/src/interaction/knowledge/`.

### Why this matters for planning sessions

Planning answers usually classify into one of three targets:

- **`adr`** when the answer states a decision and tradeoff ("We chose X over Y because…"). Goes to `docs/adr/`.
- **`project-fact`** when the answer is a stable declarative truth ("The pipeline has 4 stages: …"). Goes to `FACTS.md`.
- **`saved-reflection`** when it's a useful observation but not yet load-bearing. Holding area under `.umwelten/reflections/`.

The router uses heuristics — for ambiguous answers, lean toward `saved-reflection` first and promote later by hand.

## Step 6 — Save the Exploration for later

If an Exploration (or group of them) is worth coming back to, save it:

```typescript
import { SavedExplorationStore } from "@umwelten/core/interaction/knowledge/saved-exploration-store.js";

const store = new SavedExplorationStore(process.cwd());
await store.save({
  name: "Knowledge pipeline design sessions",
  explorationIds: [/* the ids from projection */],
  notes: "Planning + first implementation; useful when revisiting the projection layer.",
});
```

Saved Explorations land in `.umwelten/explorations/<slug>.json`. The browser surfaces them as a separate row kind (green-coloured in the dashboard).

## Putting it all together

A realistic workflow for "find all the planning sessions for this project and turn them into ADRs":

```bash
# 1. Index/digest everything (one-time, or after big batches of work)
dotenvx run -- pnpm run cli -- browse        # press D on rows that need digesting
# or batch: dotenvx run -- pnpm run cli -- sessions digest --project .

# 2. Filter to planning sessions
dotenvx run -- pnpm run cli -- sessions search --type planning

# 3. For each interesting session, reflect on it
dotenvx run -- pnpm run cli -- browse
# > navigate to the planning session
# > press R (or P to auto-promote to the primary suggestion)
# > ask "What decisions did we make and what were the tradeoffs?"
# > classifier suggests "Architecture Decision Record" — accept
# > docs/adr/2026-05-26-knowledge-pipeline.md is written

# 4. Aggregate decisions over time live in docs/adr/ — searchable, diffable, hand-editable
ls docs/adr/
```

## File layout this creates

```
your-project/
├── AGENTS.md                              ← agent imperatives (Reflections section)
├── CLAUDE.md                              ← legacy/compat target for AGENTS.md
├── FACTS.md                               ← project truths
├── CONTEXT.md                             ← domain glossary
├── docs/
│   └── adr/
│       └── 2026-05-25-knowledge-pipeline.md
└── .umwelten/                             ← project-local working data
    ├── digests/
    │   └── <session-id>.json              ← cached digest per session
    ├── reflections/
    │   └── 2026-05-25-planning-notes.md   ← holding-area answers
    ├── artifacts/
    │   └── 2026-05-25-design-summary.md   ← dated published outputs
    ├── candidates/
    │   ├── skills/                        ← Skill drafts
    │   └── facts/                         ← Fact candidates
    ├── explorations/
    │   └── <slug>.json                    ← Saved Explorations
    └── user-model.md                      ← work-style observations
```

## Tips

1. **Digest before you filter.** `solutionType` is only set after the digester runs — undigested sessions show up in the list but can't be filtered by type.

2. **Planning ≠ exploration.** Planning has a deliverable (a plan, a decision). Exploration is open-ended investigation. If you find yourself reading code without a plan, that's `exploration`; if you're sketching the next feature, that's `planning`.

3. **Saved Reflections are cheap.** Choosing `[1] Save as reflection` always succeeds — it's the holding area. You can promote later by hand-editing or rerunning the classifier.

4. **The pipeline is hand-editable.** Every file in `.umwelten/` and every promoted target (`AGENTS.md`, `FACTS.md`, etc.) is plain Markdown. The writers use marker-managed sections so they can be re-run without clobbering hand edits.

5. **`umwelten browse` is the only door.** Digest with `D`, reflect with `R`, promote with `P`. Search with `/`. All stages of the pipeline are reachable from this one TUI.

## Module references

If you want to read the code:

- `packages/core/src/interaction/projection/` — Source Session → Exploration
- `packages/core/src/interaction/reflection/reflection.ts` — `buildReflectiveInteraction`
- `packages/core/src/interaction/promotion/classifier.ts` — `classifyReflectionAnswer`, 8 targets
- `packages/core/src/interaction/promotion/router.ts` — `PromotionRouter.promote()`
- `packages/core/src/interaction/knowledge/` — 7 file writers (`AGENTS.md`, `FACTS.md`, …)
- `packages/core/src/interaction/analysis/analysis-types.ts` — `SessionAnalysis`, `SessionDigest`, `solutionType` enum
- `packages/core/src/interaction/analysis/session-analyzer.ts` — the analyzer prompt
- `packages/sessions/src/introspect.ts` — `loadBrowseProjection` (browser data layer)
- `packages/ui/src/tui/introspect/browse.tsx` — `runReflectAndPromote` (the `R` / `P` handlers in the dashboard loop)

## See also

- [Domain glossary](../../CONTEXT.md) — definitions of Exploration, Reflection, Memory, Project Fact, Saved Exploration
- [`docs/adr/0001-project-pi-session-trees-as-explorations.md`](../adr/0001-project-pi-session-trees-as-explorations.md) — why pi session trees become Explorations
- [Session analysis walkthrough (legacy)](./session-analysis-walkthrough.md) — the older `sessions index/search/analyze` flow
