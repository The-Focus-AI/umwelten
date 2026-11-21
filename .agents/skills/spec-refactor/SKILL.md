---
name: spec-refactor
description: "Refactor, split, merge, or re-layer local conceptual spec packs (docs/specs/<layer>/*.md), migrate legacy monolithic docs into modular packs, pull and reconcile external standards (docs/standards/*.md), declare person-ratified overrides, promote reusable local rules into standards, and audit cold-rebuild completeness."
---

# Refactor Modular Conceptual Spec Packs & Reconcile External Standards

Reorganizes how a project's specifications fit together across conceptual layers without duplicating facts, renumbering identifiers, or silently mutating protected external standards.

Read [references/pack-format.md](references/pack-format.md) before modifying pack structure or frontmatter.

---

## Core Boundaries

1. **Conceptual layers, never numeric prefixes**: Organize `docs/specs/<layer>/<pack-id>.md` around domain concepts (`foundation/`, `orchestration/`, `interfaces/`, etc.) and identify rules by stable kebab-case slugs (`**[rule-slug]**`). Never reintroduce numbered filenames (`01-`) or numbered clause IDs (`P1.1`, `AC-1`).
2. **External standards are read-only during local refactors**:
   - `docs/standards/*.md` (`kind: standard`) contains portable, repo-agnostic rules synced from or destined for a central standards hub (e.g., `standards.thefocus.ai`).
   - When splitting, merging, or re-layering local behavior, **never edit `docs/standards/*.md`** unless explicitly executing a standards pull or promoting a vetted local rule to a reusable standard.
3. **Overrides require human authority**:
   - A local spec may override a standard rule via `overrides:` (`target: standards/<std-id>#<slug>`, `decision: D-...`, `summary: ...`) **only** when `D-...` in `docs/decisions.jsonl` carries `"author": { "role": "person" }` and an outcome of `decided`, `intended`, or `accepted_risk`.
4. **Say each fact once**:
   - Do not duplicate implementation notes across packs, or mirror `docs/decisions.jsonl` into a second prose file.

---

## Workflow Operations

### 1. Migrate Legacy Docs Into Modular Packs

1. Initialize the `docs/` layout non-destructively using this skill's bundled script (`scripts/check-specs.ts` alongside this `SKILL.md`):
   ```bash
   node --experimental-strip-types <this-skill-dir>/scripts/check-specs.ts --root "$PWD" --init
   ```
2. Separate portable rules into `docs/standards/*.md` and repo-specific contracts (with tight `## Implementation Notes` and `## Verification`) into `docs/specs/<layer>/<id>.md`.
3. Migrate historical rationale into `docs/decisions.jsonl`, link every pack in `docs/INDEX.md`, verify **100% rule conservation** against legacy files before retiring them, and validate with `check-specs.ts`.

### 2. Re-layer, Split, or Merge Local Packs (`docs/specs/`)

1. Capture the current effective contract before editing:
   ```bash
   node --experimental-strip-types <this-skill-dir>/scripts/check-specs.ts --root "$PWD" --effective --json
   ```
2. Split, merge, or move rules between `docs/specs/<layer>/<id>.md` packs while preserving every existing `**[rule-slug]**` identifier and incrementing `version` on modified packs.
3. Update `docs/INDEX.md` links and `packs` pointers in `docs/decisions.jsonl` (prefix retired identifiers with `"historical:"` only for removed packs).
4. Re-run `check-specs.ts --effective --json` and confirm **zero lost rules**, zero duplicate slugs, and clean validation.

### 3. Pull / Update External Standards (`docs/standards/`)

1. Place the updated upstream standard markdown in `docs/standards/<id>.md` (with its bumped `version`).
2. Run validation to surface every `VERSION_SKEW` and impacted override:
   ```bash
   node --experimental-strip-types <this-skill-dir>/scripts/check-specs.ts --root "$PWD"
   ```
3. Inspect the delta between the prior standard version and the incoming version, summarize changed clauses and affected local overrides for the user, and confirm whether local specs adopt the new rules as-is or require a `person` override decision.
4. Update affected `docs/specs/<layer>/*.md` `uses:` pins (`standards/<id>@<newVer>`), re-run `check-specs.ts`, and queue `verify-deploy` for impacted packs.

### 4. Override an External Standard

1. Confirm the deviation with the user and append a `"role": "person"` decision to `docs/decisions.jsonl` (`decided`, `intended`, or `accepted_risk`).
2. Add the `overrides:` entry (`target`, `decision`, `summary`) to the owning local pack in `docs/specs/<layer>/<id>.md` and define the replacement rule under `## Invariants` or `## Acceptance Criteria`.
3. Validate authority and target resolution via `check-specs.ts`.

### 5. Promote Local Rules to a Reusable Standard

1. Factor repo-agnostic invariants, acceptance criteria, load-bearing implementation notes, and verification checks out of `docs/specs/<layer>/<pack>.md` into `docs/standards/<new-id>.md` (`version: 1`, `status: draft` until a person ratifies `in_force`).
2. Link the new standard in `docs/INDEX.md`, add `uses: [standards/<new-id>@1]` to the local spec pack(s), remove the duplicated rules from the local spec pack, and validate via `check-specs.ts`.

---

## Cold-Rebuild Sufficiency Audit

Before finishing any major refactor, verify that copying **only the skills directory and `docs/`** into an empty directory (`mktemp -d`) passes validation and bundling and captures everything required to rebuild from scratch without reading source code:

1. Run standalone validation and single-file bundling:
   ```bash
   node --experimental-strip-types <this-skill-dir>/scripts/check-specs.ts --root "$PWD"
   node --experimental-strip-types <this-skill-dir>/scripts/check-specs.ts --root "$PWD" --bundle > /dev/null
   ```
2. Confirm coverage across all surfaces:
   - Toolchain & pinned package/runtime requirements
   - Environment variables and runtime directory/database defaults
   - Durable schemas, state machines, and event/log formats
   - Every CLI subcommand/flag and HTTP/API/UI surface contract
   - Security boundaries, sandbox/auth rules, and release/deployment guarantees
   - UI design tokens, layout geometry, and interaction/motion invariants (when a UI exists)
   - Zero leakage of internal private helper names unless part of the public contract.
