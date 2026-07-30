# Language Styles

Compare how models render the *same content* under five stylistic registers —
Standard English, Strunk & White, Victorian English, Will Self, and iambic
pentameter — scored on style fidelity + content fidelity, with deterministic
stylometrics as a mechanical cross-check. See [PLAN.md](PLAN.md) for the full
design.

## The registers are skills

Each register lives in `skills/<id>/SKILL.md` (agentskills spec): frontmatter
`metadata` carries label/role/temperature, the markdown body is the rules. The
body is injected verbatim into the generation stimulus **and** quoted to the
judge, so authored rules, asked-for rules, and scored-against rules cannot
drift. **To iterate on a style, edit its SKILL.md and rerun with `--new`** —
every result record snapshots the stimulus it was scored against, so runs
remain comparable after edits.

The same directories work as normal opt-in skills in any habitat: point
`skillsDirs` at `examples/language-styles/skills/`.

## Running

```bash
# Quick roster (3 models), 5 styles x 4 briefs
dotenvx run -- pnpm tsx examples/language-styles/style-eval.ts

# Subset while iterating on a skill
dotenvx run -- pnpm tsx examples/language-styles/style-eval.ts --style victorian-english --brief scene

# Full roster / fresh run
dotenvx run -- pnpm tsx examples/language-styles/style-eval.ts --all --new

# Deterministic metrics over the latest run (writes stylometrics.json into the run dir)
pnpm tsx examples/language-styles/stylometrics.ts

# The research report (leaderboard, fidelity split, stylometrics, excerpts, judge notes)
pnpm tsx examples/language-styles/generate-report.ts --output output/reports/language-styles.md

# Self-check for the stylometric heuristics (no API keys needed)
pnpm tsx examples/language-styles/stylometrics.check.ts
```

Results land in `output/evaluations/language-styles/runs/<NNN>/`.

## Files

- `skills/<id>/SKILL.md` — the five register definitions (single source of truth)
- `load-styles.ts` — `loadSkillsFromDirectory` + metadata parsing → `StyleDef[]`
- `briefs.ts` — the four shared briefs; `retell` has a fixed fact-dense source passage as the content-fidelity control
- `style-eval.ts` — the EvalSuite matrix (JudgeTask per style×brief, stimulus factory keyed by `task.section`)
- `stylometrics.ts` — sentence length, semicolons, contractions, -ly adverbs, type-token ratio, polysyllabic share, and a 9-11-syllable pentameter scansion band (syllable counting is heuristic, hence the band)
- `generate-report.ts` — custom markdown research report

## Why the judge alone isn't trusted

LLM judges are weak at counting, so every mechanical claim has a deterministic
counterpart: the report's stylometrics table shows whether each register
*actually moved* relative to `standard-english` (Strunk & White should have the
shortest sentences and zero qualifiers; Victorian the most semicolons and no
contractions; pentameter a high share of lines in the scansion band) —
independent of what the judge thought.
