# Evaluation Architecture

Evaluation remains an original and active Umwelten design goal. The current
implementation is smaller than the old documentation suggested: executable
`EvalSuite`s are the source of truth, while ranking, aggregation, and rendering
are explicit post-processing steps.

## Core pipeline

```text
EvalSuite / runFullEval
        │
        ▼
SimpleEvaluation
        │
        ▼
Interaction + Stimulus + model runner
        │
        ▼
cached raw response
        │
        ├──▶ deterministic VerifyTask
        └──▶ cached JudgeTask call
                    │
                    ▼
             scored task record
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
  PairwiseRanker       loadSuite / reports
```

`EvalSuite` owns run directories, response caching, task execution, optional
judging, and leaderboard output. `runFullEval` composes the maintained language,
coding, and tool-calling suite builders without knowing about local runtime
hardware.

## Core, auxiliary, and historical

### Supported core

- `umwelten eval run` for cached, ad-hoc one-prompt comparisons.
- `EvalSuite`, `VerifyTask`, and `JudgeTask`.
- `runFullEval()` and the language/coding/tool-calling suite builders.
- `PairwiseRanker` and Elo/pairing helpers.
- `EvalDimension`, `loadSuite`, `buildSuiteReport`, and
  `buildNarrativeReport`.
- `Reporter` for console, Markdown, and JSON rendering.

These APIs are exported from `@umwelten/evaluation` and the `umwelten`
meta-package.

### Internal building block

`SimpleEvaluation` is the model-execution layer used by `EvalSuite`. It is
tested, but remains a deep internal import because its cache and runner contract
is lower level than the supported task API.

### Auxiliary and research

- `examples/local-providers` adds runtime discovery, battery/memory preflight,
  eviction, watchdogs, and matrix traversal around `runFullEval`.
- Dagger/container builder code explores reproducible model containers. Its
  tests are research tests, not a public evaluation API guarantee.
- `examples/model-showdown` is the reference report composition, not another
  evaluator.

### Removed concepts

The former monolithic evaluation CLI is not present. A thin `eval run` command
now covers ad-hoc comparison; old `eval report`, `eval combine`, batch/UI, and
attachment options remain removed. `EvaluationRunner`, `MatrixEvaluation`, and
`BatchEvaluation` are also absent. A matrix is ordinary suite data or harness
traversal; a batch is an array of `EvalTask`s.

## Storage contract

Each suite writes under:

```text
output/evaluations/{suite-name}/runs/{NNN}/
```

Task records preserve model/provider identity, prompt, response, score,
duration, cost, and optional judge/tool/transcript metadata. Aggregation reads
these persisted records; it does not rerun models. This separation keeps raw
evidence reusable when report dimensions or prose change.

## Best-practice boundaries

1. **Methodology belongs to suites.** Shell commands launch versioned scripts;
   they do not define a hidden benchmark.
2. **Harness policy stays outside evaluation semantics.** Hardware eviction and
   retries wrap `runFullEval` rather than entering task definitions.
3. **Scoring follows evidence.** Deterministic verification is preferred; LLM
   judging records its structured output and instructions.
4. **Reports are derivations.** Keep cached runs immutable and regenerate
   leaderboards or narrative reports from them.
5. **Public imports use package roots.** Deep imports identify internals or
   experiments and should not appear in canonical consumer examples.

## Current gaps

- `runFullEval` has selection/abort contract tests but no provider-backed CI
  integration fixture.
- Canonical evaluation examples are not yet all included in the root examples
  typecheck gate.
- The local-provider directory mixes maintained harness code and one-off debug
  scripts and needs its own support-tier split.
- Older, noncanonical guides elsewhere in `docs/` still contain options from
  the removed monolithic CLI; the current entry points are this page and the
  evaluation guides.

See [Model Evaluation](../guide/model-evaluation.md),
[Creating Evaluations](../guide/creating-evaluations.md), and
the [system boundary map](./system-boundaries.md).
