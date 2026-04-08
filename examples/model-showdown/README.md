# Model showdown (evaluation suite)

Reference layout for **multi-dimension evaluations** and **`eval combine`**.

## Key files

- [`suite-config.ts`](suite-config.ts) — `EvalDimension[]` passed to `pnpm run cli -- eval combine --config …`
- [`run-all.ts`](run-all.ts) — orchestration helper (run dimensions, then combine)
- [`shared/models.ts`](shared/models.ts) — shared model list for runs

## Docs

- [Eval combine / suites](https://umwelten.thefocus.ai/guide/model-evaluation) (site)
- [Walkthrough: model showdown](https://umwelten.thefocus.ai/walkthroughs/model-showdown)

## Typical flow

From the **umwelten repo root** (with API keys in `.env`):

```bash
dotenvx run -- pnpm run cli -- eval combine \
  --config examples/model-showdown/suite-config.ts \
  --format md
```

Individual dimension scripts live under `reasoning/`, `knowledge/`, `instruction/`, `coding/`, `mcp-tool-use/` — adjust paths and eval ids to match your cached run directories.
