# Evaluation API

Import supported APIs from `@umwelten/evaluation` or the bundled `umwelten`
package.

## Suite execution

| Export | Purpose |
| --- | --- |
| `EvalSuite` | Declarative tasks, model execution, caching, scoring, and run output |
| `runFullEval` | Compose the standard language, coding, and tool-calling suites |
| `makeLanguageSuite` | Construct the standard language suite |
| `makeCodingSuite` | Construct the standard coding suite |
| `makeToolCallingSuite` | Construct the standard tool-calling suite |

Types: `EvalSuiteConfig`, `EvalTask`, `VerifyTask`, `JudgeTask`,
`VerifyResult`, `TaskResultRecord`, `FullEvalOptions`, `FullEvalResult`,
`SuiteRunResult`, `LlmEvalSuiteName`, and the three suite option types.

```typescript
import { EvalSuite, runFullEval } from '@umwelten/evaluation';
```

`EvalSuite.run()` accepts `{ signal?: AbortSignal }`. Its script-level flags
are `--all`, `--new`, and `--run N`.

For an ad-hoc comparison, use `umwelten eval run --prompt … --models … --id …`.
This command caches raw responses but does not score them.

## Ranking

`PairwiseRanker` ranks existing responses through cached LLM-judge comparisons.
Supporting exports include `expectedScore`, `updateElo`, `buildStandings`,
`allPairs`, `swissPairs`, and `evaluationResultsToRankingEntries`.

See [Pairwise Ranking API](./pairwise-ranking.md).

## Aggregation and reports

| Export | Purpose |
| --- | --- |
| `loadSuite` | Load and normalize persisted evaluation dimensions |
| `findLatestRunDir` / `loadDimension` | Lower-level persisted-run loading |
| `buildSuiteReport` | Build a structured multi-dimension report |
| `buildNarrativeReport` | Build a Markdown methodology/results narrative |
| `Reporter` | Render structured reports to console, Markdown, or JSON |

Related types include `EvalDimension`, `SuiteResult`, `ModelScorecard`,
`DimensionScore`, report options, and report section types.

## Not part of the API

There is no `runEvaluation`, `EvaluationRunner`, `MatrixEvaluation`, or
`BatchEvaluation` API. Use an array of tasks for a batch, ordinary data
iteration for a matrix, and an executable report script for aggregation.

See [Evaluation architecture](../architecture/evaluation-framework.md) and
[Model Evaluation](../guide/model-evaluation.md).
