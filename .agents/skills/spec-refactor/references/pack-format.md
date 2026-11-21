# Modular Conceptual Spec Pack Format Reference

This reference defines the exact `.md` and `.jsonl` schemas validated by `scripts/check-specs.ts` across `docs/`.

---

## Directory Layout

```text
docs/
├── INDEX.md                              # System map, defaults table, links to all packs & ledgers
├── decisions.jsonl                       # Append-only decision log (source of "why" + override authority)
├── standards/                            # External / portable standards (NEVER edited by local refactor)
│   └── <standard-id>.md
├── specs/                                # Local conceptual-layer spec packs
│   ├── foundation/
│   │   └── <pack-id>.md
│   ├── orchestration/
│   │   └── <pack-id>.md
│   └── interfaces/
│       └── <pack-id>.md
└── runs/                                 # Immutable timestamped verification outputs
    └── <YYYY-MM-DDTHH-MM-SSZ>_<short-sha[-dirty]>/
        ├── summary.md
        └── verdicts.jsonl
```

---

## 1. External Standard Pack (`docs/standards/<id>.md`)

External standards capture portable, repository-agnostic rules (compatible with shared standards hubs such as `standards.thefocus.ai`). Local refactoring (`spec-extract`, `spec-refactor`) never modifies `docs/standards/`.

```yaml
---
kind: standard
id: <kebab-slug>
title: <Human Title>
source: <canonical-url-or-uri>
version: <positive-integer>
status: in_force | draft
---
```

- `id` must match the filename (`<id>.md`).
- Required sections:
  - `## Intent` (or `## Scope`)
  - `## Invariants` and/or `## Acceptance Criteria` (at least one rule bullet)
  - `## Verification`
- Optional sections: `## Implementation Notes`, `## Open Callouts`.

---

## 2. Local Conceptual Spec Pack (`docs/specs/<layer>/<id>.md`)

Local specs live under conceptual layers (`foundation`, `orchestration`, `interfaces`, or another kebab-slug layer) and declare external dependencies and ratified overrides in frontmatter:

```yaml
---
kind: spec
id: <kebab-slug>
title: <Human Title>
layer: foundation | orchestration | interfaces | <kebab-slug>
version: <positive-integer>
uses:
  - standards/<std-id>@<version>
overrides:
  - target: standards/<std-id>#<rule-slug>
    decision: D-<id>
    summary: <One-line description of local deviation>
---
```

- `id` must match the filename (`<id>.md`) and `layer` must match the parent directory (`docs/specs/<layer>/`).
- `uses` and `overrides` are optional when empty.
- Every `uses` reference `standards/<std-id>@<ver>` must resolve to `docs/standards/<std-id>.md` at exact `version: <ver>` (mismatch raises `VERSION_SKEW`).
- Every `overrides` entry:
  - `target` (`standards/<std-id>#<slug>`) must belong to a standard listed in `uses` and `<slug>` must exist in that standard.
  - `decision` (`D-...`) must exist in `docs/decisions.jsonl` with `author.role === "person"` and `outcome` in `["decided", "intended", "accepted_risk"]`.
- Required sections:
  - `## Intent` (or `## Scope`)
  - `## Invariants` and/or `## Acceptance Criteria` (at least one rule bullet)
  - `## Verification`
- Optional sections:
  - `## Implementation Notes` (load-bearing runtime/SDK/UI design constraints only)
  - `## Open Callouts` (only genuine spec-vs-code discrepancies or unresolved questions)

---

## 3. Rule Slug Syntax

Under `## Invariants` and `## Acceptance Criteria`, every checkable rule uses a globally unique kebab-case slug (no numeric prefixes):

```markdown
- **[kebab-slug]** (*NEVER*): Observable invariant statement.
- **[kebab-slug]** (*EVENTUALLY*): Observable liveness guarantee.
- **[kebab-slug]** (*NEVER / EVENTUALLY*): Combined safety and liveness rule.
- **[kebab-slug]**: Observable acceptance criterion statement.
```

Rules under `## Invariants` have kind `invariant`; rules under `## Acceptance Criteria` have kind `criterion`.
Slugs are globally unique across all packs unless a spec overrides `standards/<std-id>#<slug>` (which allows that spec to replace or redefine `<slug>`).

---

## 4. Append-Only Decision Log (`docs/decisions.jsonl`)

One compact JSON object per line (`D-1`, `D-2`, ...):

```json
{
  "id": "D-3",
  "date": "2026-11-15",
  "type": "choice",
  "outcome": "decided",
  "author": { "role": "person" },
  "packs": ["foundation/auth-and-secrets"],
  "title": "Inject shared runtime secrets centrally instead of per-worktree .env files",
  "summary": "1-2 sentence statement of what was decided.",
  "resolution": "1 sentence statement of why it was settled.",
  "comments": [
    { "author": { "role": "person" }, "body": "Key reasoning turn." }
  ]
}
```

Valid `(type, outcome)` pairs:
- `choice`: `decided`, `intended`, `follow_up`
- `possible_bug`: `intended`, `fixed`, `withdrawn`
- `risk`: `accepted_risk`, `follow_up`, `withdrawn`
- `question`: `decided`, `open`

Every non-historical string in `packs` (`standards/<id>` or `<layer>/<id>`) must resolve to an existing pack file. Prefix retired identifiers with `historical:` if an entry references a removed pack.

---

## 5. Timestamped Verification Runs (`docs/runs/`)

Each verification pass writes an immutable directory:

```text
docs/runs/<YYYY-MM-DDTHH-MM-SSZ>_<short-sha[-dirty]>/
├── summary.md
└── verdicts.jsonl
```

Directory names match `/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z_[a-z0-9-]+$/`.

Each line in `verdicts.jsonl` is a JSON object:

```json
{
  "pack": "standards/runtime-toolchain",
  "packVersion": 1,
  "id": "hermetic-binaries",
  "kind": "invariant",
  "verdict": "pass",
  "evidence": "Exact reproducible command/query/file:line proof",
  "proposal": null,
  "waivedBy": null
}
```

- `verdict`: `pass` | `fail` | `inconclusive` | `waived`
- `kind`: `invariant` | `criterion`
- Any `"verdict": "waived"` line must set `"waivedBy": "person"` and provide rationale in `evidence` (or `proposal`).
