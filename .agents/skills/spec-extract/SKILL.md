---
name: spec-extract
description: "Extract and maintain modular Intent, Invariants, Acceptance Criteria, Load-Bearing Implementation Notes, Open Callouts, and Decisions from code changes and conversation transcripts into docs/specs/ and docs/decisions.jsonl. Use for 'extract spec', 'write acceptance criteria', 'record decisions', 'distill this session', or updating packs as code evolves."
---

# Extract Intent, Acceptance Criteria, and Decisions into Modular Packs

Distills **what** a change accomplishes and **why** it looks the way it does into minimal, cold-rebuild-complete spec packs under `docs/specs/<layer>/<pack>.md` and append-only entries in `docs/decisions.jsonl`, ready for human review or automated verification via `verify-deploy`.

It splits ground truth across two sources and never invents claims from imagination:

- **Code / Diff = Ground truth for *what* happens**
- **Conversation Transcript = Ground truth for *why* it happens**

Per change, this skill updates only the impacted files:

- `docs/specs/<layer>/<pack>.md` — Incremented `version`, `## Intent`, `## Invariants`, `## Acceptance Criteria` (`**[kebab-slug]**`), tight `## Implementation Notes` (only load-bearing SDK/platform traps), `## Verification`, and `## Open Callouts`.
- `docs/decisions.jsonl` — Append-only **Distilled Decisions (`D-1..N`)** with `type`, `outcome`, `author` credit, `packs`, `summary`, `resolution`, and chronological 1st-person comments (no duplicate prose decisions or learnings files).

**External Standards Protection**: Never edit `docs/standards/*.md` during normal `spec-extract` runs. If local code intentionally diverges from an inherited standard rule, record a `person`-authored decision in `docs/decisions.jsonl` and declare an `overrides:` block in the owning `docs/specs/<layer>/<pack>.md` (or use `spec-refactor` to explicitly pull, update, or promote standards).

---

## Step 1: Bootstrap (If Needed) & Read Ground-Truth Inputs

Run this skill's bundled validator (`scripts/check-specs.ts` alongside this `SKILL.md`) against the target repository (`"$PWD"`):

1. **Bootstrap Missing `docs/` Structure**:
   - If `docs/INDEX.md` or `docs/decisions.jsonl` does not exist yet in the repository, initialize them non-destructively first:
     ```bash
     node --experimental-strip-types <this-skill-dir>/scripts/check-specs.ts --root "$PWD" --init
     ```
2. **The Code & Working Tree**:
   - Inspect `git status` and `git diff` (`git diff <base>..HEAD` on feature branches). For stacked branches, diff each branch against its immediate parent.
   - If Git is uninitialized or has no commits yet, inspect the project tree, configuration, tests, and implementation files directly.
3. **The Conversation Transcript**:
   - Read the active conversation history and any session transcript logs on disk when earlier turns were compacted or summarized.
4. **Current Specs & Effective Rules**:
   - Read `docs/INDEX.md`, impacted packs under `docs/specs/`, recent lines of `docs/decisions.jsonl`, and resolve the active ruleset:
     ```bash
     node --experimental-strip-types <this-skill-dir>/scripts/check-specs.ts --root "$PWD" --effective --json
     ```
   - Map changed files to the existing conceptual pack(s). Do not create redundant packs or re-layer unless the change introduces a genuinely distinct domain boundary (use `spec-refactor` for structural pack splits or merges).

---

## Step 2: Distill Decisions (`docs/decisions.jsonl`)

Read [references/decisions.md](references/decisions.md) and apply its distillation, attribution, and thread rules to the transcript:

- Append **Decisions (`D-...`)** to `docs/decisions.jsonl`: choices, intentional oddities, accepted risks, non-obvious fixed bugs, deferred follow-ups, withdrawn concerns, or answered/open questions where a reviewer could ask *"why?"* and the session answered.
- Fold **only load-bearing operational/SDK traps** (facts required to build, configure, run, or avoid silent regressions — never session play-by-play) into the owning pack's `## Implementation Notes` section.

---

## Step 3: Update Owning Pack(s) (`Intent`, `Acceptance Criteria`, `Verification`, `Callouts`)

For each touched `docs/specs/<layer>/<pack>.md`:

1. **Intent**:
   - 1–3 plain sentences describing the pack's behavioral purpose, echoing the user's phrasing without internal class/file/table names.
2. **Invariants & Acceptance Criteria (`**[kebab-slug]**`)**:
   - Read [references/acceptance-criteria.md](references/acceptance-criteria.md) and enforce every gate (including cross-filtering against Step 2's Decisions).
   - Keep **2–5 focused criteria per pack** using stable kebab-case slugs (never numeric `AC-1` or `P1.1`). Preserve existing slugs unless behavior changed; adding criteria in one pack must never evict criteria from other packs.
3. **Verification & Implementation Notes**:
   - Keep `## Verification` concise and executable (read-only state/DB queries, CLI checks, UI checks, or isolated `mktemp -d` drills).
   - Keep `## Implementation Notes` terse: record exact protocol/config contracts and SDK traps once, without narrative prose.
4. **Open Callouts**:
   - Flag only what is genuinely open or contradictory (code failing a criterion, code diverging from an adopted standard without a ratified override, or an `open` decision).

---

## Step 4: Review with the User (Interactive Mode)

When running interactively for confirmation before writing (or when asked to preview first):

1. Show impacted pack(s), **Intent**, **Acceptance Criteria** (noting each `[slug]` is verified independently), **Open Callouts**, any needed standard **Overrides**, and the **Decisions Preview**.
2. Ask one direct question: *"Anything to add, remove, or tighten before I persist these updates to `docs/`?"*
3. When the user explicitly asks to write/persist immediately, write directly and note that confirmation was pre-authorized.

---

## Step 5: Persist & Validate

1. Update only touched `docs/specs/<layer>/<pack>.md` files (incrementing integer `version`).
2. Append new lines to `docs/decisions.jsonl` (preserving existing lines verbatim).
3. Update `docs/INDEX.md` if a new pack was added so every pack has a relative Markdown link.
4. Validate schema, slug uniqueness, override authority, and index links before finishing:
   ```bash
   node --experimental-strip-types <this-skill-dir>/scripts/check-specs.ts --root "$PWD"
   ```
5. Note that any rule whose exact text changed must be re-verified by `verify-deploy` (prior waivers in `docs/runs/` do not carry forward across modified rule text).
