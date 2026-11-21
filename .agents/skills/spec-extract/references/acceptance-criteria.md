# Acceptance Criteria Rulebook

Acceptance Criteria (`**[kebab-slug]**`) are the observable checks within a conceptual spec pack (`docs/specs/<layer>/<pack>.md`) that prove the pack achieves its intent. Each criterion is verified independently and read by humans, so every line must earn its slot.

## 1. Start from the Pack Intent

Write or review the pack's `## Intent` first, then ensure its `## Acceptance Criteria` turn that intent into falsifiable, observable outcomes:
1. Ask what an outside observer would check to prove the pack's intent holds.
2. Cross-check against the code/diff to confirm each claim actually holds and catch core behaviors missing from the pack.
3. Carry over criteria the user explicitly stated in their own words when they pass the three gates below.

Scale within each pack (typically **2–5 criteria per pack**; never pad, never merge unrelated behaviors into one giant criterion just to stay under a global cap, and never evict rules in untouched packs).

## 2. The Three-Gate Sieve (What Earns a Slot)

Keep a criterion **only** if all three hold:

1. **Code/changes in this pack can break it.** If nothing in the pack's behavioral surface could flip the check from pass to fail, drop it.
2. **A reviewer would call its absence a gap.** Routine fallbacks, error strings, retry counts, log lines, default values on optional flags, and "still works as before" checks on refactored code do not earn a slot unless handling that exact case *is* the deliverable.
3. **Nothing else in this pack or its `uses:` standards covers it.** Merge overlapping criteria inside the pack, and do not re-state rules already inherited verbatim from `docs/standards/*.md` (unless explicitly declaring an `overrides:` replacement).

## 3. Cross-Filtering with Decisions

Session decisions shape and prune each pack's criteria list:

- **Choices (`choice -> decided`)**: Gate the **observable outcome** the choice produces, *never* the internal library, data structure, or private helper picked.
- **Deferred work (`follow_up`) and accepted risks (`accepted_risk`)**: Get **zero** criteria.
- **Deliberately preserved behavior (`intended`)**: Gets **at most one** criterion, and only if changes could plausibly break it.

## 4. How Each Criterion Reads

Format every invariant or criterion bullet using a stable kebab-case slug (no numeric IDs):

```markdown
- **[slug-name]** (*NEVER*): Observable safety invariant.
- **[slug-name]**: Observable acceptance criterion sentence.
```

- **Surface vocabulary only**: Name the user/operator, the product surface (CLI, HTTP/SSE endpoint, UI, process signal, durable store guarantee), or the external outcome. Keep internal module/function names out unless a symbol *is* the public contract (a CLI subcommand/flag, HTTP route/status, env var, or exposed tool name).
- **No incidental constants**: Omit pixel widths, retry counts, or schema field dumps in criteria (put exact design/protocol contracts in `## Implementation Notes` only when needed for cold-rebuild accuracy).
- **No taste words or CI gates**: Never write `"clean"`, `"intuitive"`, `"fast"`, `"modular"`, and never include `"TypeScript compiles"`, `"linter passes"`, or `"unit tests pass"`.
- **Observer-independent**: Two independent verifiers inspecting the deployed system must reach the same binary verdict.

## 5. What Goes in `## Open Callouts` Instead

Never bend a criterion to hide a bug or standard mismatch. Flag in `## Open Callouts`:
- Code that currently fails a criterion that the intent clearly requires.
- Code that contradicts a settled decision or an inherited `docs/standards/*.md` rule without a `person`-ratified override.
- An unresolved `open` question from `docs/decisions.jsonl`.
