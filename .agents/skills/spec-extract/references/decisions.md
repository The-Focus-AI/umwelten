# Decisions Distillation & JSONL Format Reference

Code diffs show *what* landed; the session transcript holds *why* — alternatives weighed and dropped, user steering, risks accepted, subtle bugs caught in flight, and questions answered. `spec-extract` appends that reasoning directly to `docs/decisions.jsonl` (single source of truth; no duplicate prose file).

Keep each entry concise and scannable: a human reviewer or verifier reading an entry should grasp the call and why in seconds.

## 1. Classification Matrix (`type` & `outcome`)

Scan the conversation from start to finish. A decision is something a reviewer could reasonably ask *"why is it done this way?"* about, where the conversation holds the answer.

| What happened in the session | `type` | `outcome` |
|---|---|---|
| Picked one approach over another | `choice` | `decided` |
| Kept behavior that looks odd/wrong on purpose | `possible_bug` or `choice` | `intended` |
| Saw a limitation or risk and shipped anyway | `risk` | `accepted_risk` |
| Caught a non-obvious bug during the session and fixed it | `possible_bug` | `fixed` |
| Explicitly deferred scope to later work | `choice` or `risk` | `follow_up` |
| Raised a concern that investigation disproved | `possible_bug` or `risk` | `withdrawn` |
| Asked a question the user explicitly answered | `question` | `decided` |
| Raised a question nobody answered yet | `question` | `open` |

### What to Leave Out
- Anything the code/diff already states plainly (never write a changelog).
- Dead ends that left zero trace in the codebase and that no reviewer would suggest.
- Mechanical fixes (typos, formatting, lint tweaks, import sorting).
- Routine `fixed` bugs, *unless* a reviewer reading the fix would wonder why that code exists or the trap is easy to re-introduce (place pure SDK/runtime traps in the owning pack's `## Implementation Notes` instead).
- Secrets, tokens, personal data, or raw credential material.

Most substantial sessions yield **1–5** new entries. Merge decisions that turned on the same underlying reason.

## 2. Attribution (`author`) & Standard Override Authority

Every decision and every comment carries explicit authorship:

- `{"role": "person"}` — Anything the user raised, asked, rejected, or decided. Never invent user endorsement from silence.
- `{"role": "coding_agent", "harness": "<agent-name>"}` — Calls the coding agent made that the user saw and let stand, or technical root causes the agent diagnosed and fixed.
- `{"role": "review_agent", "harness": "<agent-name>"}` — Findings raised by a verification or review pass.

**Override Rule**: Only a decision with `"author": { "role": "person" }` and `"outcome"` in `["decided", "intended", "accepted_risk"]` can authorize an `overrides:` block against `docs/standards/*.md`. A choice the user made is credited to `person` even when `coding_agent` proposed the options (put the proposal in `comments` as `coding_agent`).

## 3. Writing Each Line (`docs/decisions.jsonl`)

Append one single-line JSON object per decision:

- `id`: Next sequential `D-<N>` identifier (`D-1`, `D-2`, ...).
- `date`: ISO calendar date (`"YYYY-MM-DD"`).
- `type` / `outcome`: From the matrix above.
- `author`: Attributed object (`{ "role": ... }`).
- `packs`: Non-empty array of impacted pack refs (`"<layer>/<id>"` or `"standards/<id>"`, or `"historical:<name>"` if retired).
- `title`: One crisp line stating the call itself, readable cold.
- `summary`: 1–2 sentences stating what was decided.
- `resolution`: 1 sentence stating *why* it was settled this way.
- `comments`: Chronological array (`{ "author": ..., "body": "..." }`) showing only turns that moved the decision, written in 1st-person voice without raw pasted transcripts.
- `anchor` (optional): Relevant repo path(s) where the decision is visible.

Example JSONL line (compact single line per record):
```json
{"id":"D-3","date":"2026-11-15","type":"choice","outcome":"decided","author":{"role":"person"},"packs":["foundation/auth-and-secrets"],"anchor":"src/secrets.ts","title":"Inject shared secrets centrally via process env instead of per-worktree .env files","summary":"Store runtime secrets centrally outside checked-out worktrees and inject them into workspace command environments while scrubbing logs and HTTP GET responses.","resolution":"Fresh Git worktrees omit gitignored .env files; central env injection shares secrets without scattering secret files.","comments":[{"author":{"role":"person"},"body":"Runtime secrets need to be shared across fresh worktrees."},{"author":{"role":"coding_agent","harness":"claude-code"},"body":"Proposed central encrypted store with write-only management and env injection."},{"author":{"role":"person"},"body":"Confirmed central storage, env injection, and strict redaction."}]}
```
