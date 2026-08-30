# Model showdown (evaluation suite)

**Start here for evaluations:** reference layout for **multi-dimension
evaluations**, suite aggregation, and structured or narrative reports. Pair
with [model evaluation](https://umwelten.thefocus.ai/guide/model-evaluation) on
the docs site.

## Key files

- [`suite-config.ts`](suite-config.ts) — the `EvalDimension[]` suite definition
- [`run-all.ts`](run-all.ts) — orchestration helper (run dimensions, then combine)
- [`generate-report.ts`](generate-report.ts) — loads cached runs and renders console, Markdown, JSON, or a narrative writeup
- [`shared/models.ts`](shared/models.ts) — shared model list for runs

## Docs

- [Eval combine / suites](https://umwelten.thefocus.ai/guide/model-evaluation) (site)
- [Walkthrough: model showdown](https://umwelten.thefocus.ai/walkthroughs/model-showdown)

## Typical flow

From the **umwelten repo root** (with API keys in `.env`):

```bash
dotenvx run -- pnpm tsx examples/model-showdown/run-all.ts

# Re-render cached results without running models again
pnpm tsx examples/model-showdown/generate-report.ts --format md \
  --output output/model-showdown-results.md
```

Individual dimension scripts live under `reasoning/`, `knowledge/`, `instruction/`, `coding/`, `mcp-tool-use/` — adjust paths and eval ids to match your cached run directories.

`umwelten eval run` handles ad-hoc prompt comparisons. This benchmark and its
reports stay script-driven so suite configuration, scoring, and output remain
reviewable in source control.
