# Language Styles — research plan

Compare how models render the *same content* under five stylistic registers, score
style fidelity + content fidelity, and produce a research report. Style is treated
as a first-class eval axis (cf. persona-augmented benchmarking, arXiv 2507.22168).

## The five registers

| id | Register | Voice in one line | temp |
| --- | --- | --- | --- |
| `standard` | Standard English | Neutral contemporary prose — the baseline | 0.7 |
| `strunk-white` | Strunk & White | Strict plain style: omit needless words, active voice, short concrete sentences | 0.4 |
| `victorian` | Victorian English | 1870s serial novelist: periodic sentences, semicolons, latinate diction, no contractions, "dear reader" | 0.7 |
| `will-self` | Will Self | Dense, erudite maximalism: recondite vocabulary, long nested sentences, psychogeographic digression, satirical edge | 0.8 |
| `pentameter` | Iambic pentameter | Blank verse: ten syllables per line, iambic stress, enjambment over padding, no "doth/'tis" filler | 0.6 |

> **Assumption:** "strict and white" in the original voice note = **Strunk & White**
> (*The Elements of Style*). It contrasts cleanly with Victorian/Self and is distinct
> from the `standard` baseline (standard = neutral default; strunk-white = actively
> compressed). Swap the definition in `skills/strunk-white/SKILL.md` if that guess is wrong.

## Styles are authored as skills

Each register is a standard agentskills-spec **skill** — a directory with a
`SKILL.md` — so the styles are first-class, editable, versionable artifacts you can
iterate on (and drop into any habitat later), not constants buried in a TS file.

```
examples/language-styles/skills/
  victorian-english/SKILL.md
  will-self/SKILL.md
  iambic-pentameter/SKILL.md
  standard-english/SKILL.md
  strunk-white/SKILL.md
```

```markdown
---
name: iambic-pentameter
description: Write in blank verse — ten-syllable iambic lines. Use when asked to compose or rewrite text as iambic pentameter.
metadata:
  label: Iambic pentameter
  role: verse dramatist
  temperature: "0.6"
---
Write exclusively in iambic pentameter (blank verse).

- Every line has exactly ten syllables, stress on the even syllables.
- Prefer enjambment over padding a line to length.
- No archaic filler ("doth", "'tis") to rescue the meter.
- 12-20 lines unless the brief demands otherwise.
...
```

Mechanics (all existing, `packages/core/src/stimulus/skills/loader.ts`):
`loadSkillsFromDirectory()` scans immediate subdirs for `SKILL.md`; frontmatter
`name`/`description` are required, the `metadata:` map comes through as strings
(per-style `role`, `label`, `temperature` live there), and the markdown body lands
verbatim in `skill.instructions`.

The **same SKILL.md body** feeds three consumers: the generation stimulus (injected
*unconditionally* — see below), the judge rubric ("the response was asked to follow
these rules…"), and the report methodology section. No drift between what we author,
what we ask for, and what we score.

One deliberate deviation from normal skill runtime: skills usually work by
progressive disclosure (only the description is in the system prompt; the model must
call the `skill` tool to fetch the body). For a style eval the voice must be
**always-on**, so the eval loads each skill and injects its body directly into the
stimulus `instructions` rather than relying on the model to opt in. The exact same
skill directories still work as normal opt-in skills in a habitat (`skillsDirs`
pointed at `examples/language-styles/skills/`), which is the payoff of authoring
them in this format.

**The iteration loop:** edit a SKILL.md → rerun with `--new` → diff runs. EvalSuite
already snapshots `stimulusOptions` into every result record, so each run
permanently captures which version of the rules it was scored against.

## The shared briefs (same content across all five styles)

| id | Kind | Brief |
| --- | --- | --- |
| `explain` | technical | Explain how a large language model predicts the next word |
| `scene` | narrative | Describe walking a country road at dawn as rain begins |
| `argue` | persuasive | Make the case that walking improves thinking |
| `retell` | style transfer | Rewrite a fixed source paragraph (given verbatim in the prompt) in the target register |

`retell` is the control: because the source content is fixed, content fidelity is
directly checkable. 5 styles × 4 briefs = **20 tasks per model**.

## Architecture (everything lives in `examples/language-styles/`, zero core changes)

```
examples/language-styles/
  skills/<id>/SKILL.md # the 5 register definitions (single source of truth, see above)
  load-styles.ts       # loadSkillsFromDirectory + metadata parsing → StyleDef[]
  briefs.ts            # the 4 shared briefs + the retell source paragraph
  style-eval.ts        # EvalSuite: stimulus factory keyed by task.section
  stylometrics.ts      # deterministic metrics over cached responses (no LLM)
  generate-report.ts   # loadSuite + custom markdown research report
  salon.ts             # optional: 5-register Dialogue ("the salon") — phase 2
  README.md
```

### `style-eval.ts` — the core matrix (pattern: `examples/evals/reasoning.ts` + the

stimulus-factory idea from `packages/evaluation/src/evaluation/llm-eval/language.ts:70-100`)

- One `EvalSuite({ name: 'language-styles', ... })`.
- `tasks`: cross product of styles × briefs. `id: '<style>:<brief>'`, `section: <style>`
  (section is the grouping label the combine layer reads).
- `stimulus` as a **factory** `(task) => StimulusOptions`: looks up the task's style and
  returns `{ role: skill.metadata.role, objective, instructions: [skill.instructions],
  temperature: Number(skill.metadata.temperature) }`. EvalSuite takes plain
  `StimulusOptions`, not `Stimulus` instances (`suite.ts:292` news one up internally).
- Every task is a `JudgeTask` with one shared Zod schema:
  `style_fidelity` 0–10, `content_fidelity` 0–10, `fluency` 0–10,
  `rule_violations: string`, `explanation: string`;
  `extractScore: j => 0.6 * j.style_fidelity + 0.4 * j.content_fidelity`, `maxScore: 10`.
- Judge instructions are generated per style from the same SKILL.md body.
- Model rosters: reuse `examples/model-showdown/shared/models.ts` helpers — a quick
  3-model roster for iteration, `allModels` for `--all` runs. **gemini-3 only, never
  gemini-2** (house rule).
- Standard flags come free from EvalSuite: `--all`, `--new`, `--run N`.
- Results land in `output/evaluations/language-styles/runs/<NNN>/<taskId>/<modelKey>.json`
  with full transcripts — the report and stylometrics passes read from there.

Known constraints found in exploration, respected here:
- Judge `maxTokens` is hardcoded to 500 in `suite.ts` — keep rubric fields terse.
- Don't use `StimulusOptions.examples` (renders as comma-joined stringification);
  exemplar lines go in `instructions`.
- `StimulusOptions.maxTokens` is inert (never reaches the model — and the runner
  refuses caps by design). Length control is an *instruction* ("150–250 words";
  "12–20 lines" for pentameter).

### `stylometrics.ts` — deterministic style signals (no LLM, no new deps)

LLM judges are weak at counting, so the mechanical claims are verified mechanically.
Reads the cached response JSONs from a run dir and computes per response:

- avg sentence length, semicolon rate, contraction count, -ly adverb rate,
  type-token ratio, % words with 3+ syllables (heuristic syllable counter — flagged
  as approximate in the report)
- **pentameter scansion check**: % of lines with 9–11 syllables (tolerance band,
  since heuristic syllable counting is imperfect)

Output: one JSON per run (`stylometrics.json` in the run dir) that `generate-report.ts`
merges in. Expected signature per register — e.g. strunk-white should show the *lowest*
sentence length and adverb rate, victorian the highest semicolon rate — so the metrics
double as a sanity check on whether models actually moved, independent of the judge.

### `generate-report.ts` — the research report

Pattern: `examples/model-showdown/generate-report.ts`, but with a custom markdown
builder rather than `buildNarrativeReport` (the narrative writer dispatches sections
by evalName substring — `reasoning`/`coding`/etc. — and would emit *nothing* for a
style eval; the structured `buildSuiteReport` only gives generic tables). Sections:

1. Methodology — registers, rules (rendered from the SKILL.md files), briefs, judge setup
2. Leaderboard — per style and combined (style_fidelity / content_fidelity split out)
3. **Style separation** — the stylometrics table: did each register measurably move
   the needle vs `standard`?
4. Content fidelity under constraint — does correctness/coverage degrade as the
   register gets harder (pentameter and will-self expected to bleed content)?
5. Side-by-side excerpts — the same brief in all five voices, per model, in
   `<details>` blocks
6. Judge explanations appendix

Writes to `output/reports/language-styles.md`; a curated final version gets promoted
to `reports/` (the repo's home for dated research writeups) once a full `--all` run
is done.

## Phase 2 (optional, after the core matrix works)

- **Pairwise Elo per register** — `PairwiseRanker` (pattern:
  `examples/mcp-chat/elo-rivian.ts`) over the cached responses to rank models on
  "best Will Self impression" etc. Absolute rubric scores compress at the top;
  head-to-head separates them. Docs already recommend exactly this for style
  (`docs/guide/creating-evaluations.md:277`).
- **`salon.ts` — the dialogue chapter.** Dialogue is deliberately *not* the core
  instrument: participants see each other's turns, so it cross-contaminates the
  measurement, turn allocation is uneven, and the dialogue preamble is a confound.
  But it's the right instrument for a different question — *do styles converge when
  they talk to each other?* One `Dialogue` with 5 `InteractionParticipant`s (one per
  register, each built from the same SKILL.md via `load-styles.ts`; pattern:
  `examples/dialogue-debate/debate.ts`), round-robin,
  `stop: { maxTurns: 20 }`, `persistDir` set. Then run stylometrics over the
  per-speaker turns (capture `result.events`, not the flattened JSONL) and compare
  each register's in-dialogue metrics against its solo-generation metrics: style
  drift, quantified. One `post({kind: "event"})` perturbation mid-run ("now explain
  it to a child") hits all five voices at once.

## Execution order

1. `skills/*/SKILL.md` + `load-styles.ts` + `briefs.ts` (pure data)
2. `style-eval.ts`; smoke-run one brief × two styles on the quick roster
3. `stylometrics.ts`; run over the smoke results
4. `generate-report.ts`; render the smoke report end-to-end
5. Full quick-roster run (20 tasks × 3 models), review, tune rules/rubric
6. `--all --new` full run → `reports/` writeup
7. Phase 2: Elo + salon

## Verification

- `pnpm test:run` stays green (no core changes expected; stylometrics gets a small
  unit test — syllable counter + scansion band against known lines of verse)
- Smoke: `dotenvx run -- pnpm tsx examples/language-styles/style-eval.ts`
- Report: `dotenvx run -- pnpm tsx examples/language-styles/generate-report.ts --output output/reports/language-styles.md`
- Eyeball check: `standard` vs `strunk-white` stylometrics must differ measurably;
  pentameter scansion % must be high for strong models — if not, the rules (not the
  runner) get tuned.
