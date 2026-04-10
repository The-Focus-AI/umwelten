# Evaluation framework (API)

Use this page as a **quick map** of evaluation-related code. Long-form patterns (strategies, caching, runner examples) live in the canonical doc: **[Evaluation framework (architecture)](../architecture/evaluation-framework.md)**.

## Published package exports

From `umwelten` ([`src/index.ts`](https://github.com/The-Focus-AI/umwelten/blob/main/src/index.ts)):

- `runEvaluation`, `runEvaluationWithProgress`, `generateReport`, `listEvaluations`, `parseModel`
- Types: `EvaluationConfig`, `EvaluationResult`, `EnhancedEvaluationConfig`

Deep imports from `umwelten/dist/...` reach `EvaluationRunner`, strategies, `combine/` suite loaders, `PairwiseRanker`, etc., when you need more control than the CLI wrappers.

## Mental model

1. **`Stimulus`** — What to test (prompt shape, tools, output style).
2. **`Interaction` + `BaseModelRunner`** — How a single model run is executed (used inside runners and `runEvaluation`).
3. **`EvaluationRunner` / strategies** — Repeatable evaluations with disk cache under an eval id.
4. **`eval combine`** + **`EvalDimension[]`** — Merge several evaluation runs into one leaderboard/report ([`examples/model-showdown`](https://github.com/The-Focus-AI/umwelten/tree/main/examples/model-showdown)).

## Minimal custom runner

Extend `EvaluationRunner` and implement `getModelResponse`. When working **inside the umwelten repo** (e.g. `pnpm tsx` scripts), import from `src/...` as in the examples under [**Evaluation framework (architecture)**](../architecture/evaluation-framework.md). From **another package**, use deep imports from the published `dist/` layout (the root `exports` field only exposes the main entry; `EvaluationRunner` is not re-exported there).

## CLI parity

Prefer the CLI for ad-hoc runs; use the API when embedding in your own scripts:

- `pnpm run cli -- eval run …` → `runEvaluation`
- `pnpm run cli -- eval report …` → `generateReport`
- `pnpm run cli -- eval combine --config …` → suite aggregation (see [Model evaluation](../guide/model-evaluation.md))

## See also

- [Model evaluation guide](../guide/model-evaluation.md)
- [Creating evaluations](../guide/creating-evaluations.md)
- [Pairwise ranking API](./pairwise-ranking.md)
- [Cognition / `ModelResponse`](./cognition.md) (use `.content`, not `.text`)
