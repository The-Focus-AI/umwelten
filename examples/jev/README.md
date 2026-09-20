# Jev judgment pilot (experimental)

This is the first implementation milestone for the Jev labs report, tracked in
[issue #498](https://github.com/The-Focus-AI/umwelten/issues/498). It does not
change agents, Mycel, or the existing generation/evaluation contracts.

## Access

**No separate TypeSafe account is required when using OpenRouter.** A funded
OpenRouter key can call `typesafe/jev-1.13` through
`https://openrouter.ai/api/alpha/decisions`. This is an **alpha Decisions API**,
not `/chat/completions`; ordinary chat clients and the regular chat model
catalog are not authoritative for availability. Set `OPENROUTER_API_KEY` in
your environment or a gitignored `.env`, never in source or a command argument.

Direct TypeSafe access is also implemented: obtain a key from
<https://console.typesafe.ai/keys>, set `TYPESAFE_API_KEY`, and select
`--backend typesafe`. It uses `jev-1.13.0` at `/v1/systemone`.

Mycel supplies **native Jev Decisions and generative baselines**. Set
`MYCEL_URL=https://mycel.thefocus.ai`, an existing Application credential in
`MYCEL_API_KEY`, and an appropriate stable `MYCEL_END_USER`. No database access,
new account creation, or exchange deployment is needed when those are already
available. Mycel must actually support the selected model's structured-output
request; a listing alone does not prove this capability.

Use `--backend mycel` for native Jev. Its response usage/cost comes from
OpenRouter, not Mycel billing: the adapter stores `upstreamCostUsd` separately
and leaves `metadata.cost` unknown. Reconcile the saved Mycel `requestId` with
the Exchange ledger for actual charges. Never price upstream token counts as
though they were Mycel's independently metered units.

Sources checked September 19, 2026:
- <https://openrouter.ai/typesafe/jev-1.13>
- <https://openrouter.ai/docs/cookbook/building-agents/gate-tool-calls-with-jev>
- <https://docs.typesafe.ai/api>
- <https://docs.typesafe.ai/confidence>

## Run

```sh
# Offline: validate all 60 synthetic cases; preview three selected calls.
pnpm exec tsx examples/jev/run.ts

# Paid: three calls, one of each judgment kind. Start here, not with a full run.
pnpm exec tsx examples/jev/run.ts --live --out output/jev/openrouter-smoke

# Native Jev through the deployed Mycel Exchange.
pnpm exec tsx examples/jev/run.ts --backend mycel --live --out output/jev/mycel-jev

# Extend the same smoke cache to the 60-case development pilot.
pnpm exec tsx examples/jev/run.ts --backend mycel --live --limit 60 --out output/jev/mycel-jev

# Reverse only choice options; unchanged binary/ordinal cases reuse the cache.
pnpm exec tsx examples/jev/run.ts --backend mycel --live --limit 60 --reverse-options --out output/jev/mycel-jev

# Rebuild the same summary without any model calls (credentials not required).
pnpm exec tsx examples/jev/run.ts --replay --out output/jev/openrouter-smoke

# Direct TypeSafe, if desired.
pnpm exec tsx examples/jev/run.ts --backend typesafe --live --out output/jev/typesafe-smoke

# Generative baseline: provider/model names use the existing Umwelten runtime.
pnpm exec tsx examples/jev/run.ts --backend llm --provider mycel \
  --model deepseek/deepseek-v4.1-flash --live --out output/jev/mycel-smoke

# Full development pilot, only after smoke results and spending are reviewed.
pnpm exec tsx examples/jev/run.ts --live --limit 60 --out output/jev/openrouter-pilot
```

`--reverse-options` reverses choice option insertion order; it deliberately does
not reverse ordinal levels, which would change the rubric. Exact request order,
question definitions, labels, backend settings and adapter version are included
in cache identity. Requests/labels, raw successful responses, normalized results,
usage and timings are persisted per case. `summary.json` describes the selected
cases from the latest invocation, not every record in the directory.

Failures are persisted too and are not retried on resume. Use a new output
directory for a deliberate repeat. Native Jev uses one attempt per call; the
LLM baseline retains the existing runtime/SDK retry behavior. Cancellation is
forwarded, and each call has a 120-second abort deadline. An interrupted process
may have spent money without saving its last response. Do not treat the cache as
a billing ledger. Unknown costs remain unknown; OpenRouter's reported Jev cost
is preserved, whereas direct TypeSafe without caller-supplied rates has no cost
estimate. No output-token cap is added.

## What this establishes (and does not)

- Binary truth probabilities, choice distributions and ordinal distributions
  share one backend contract, in `@umwelten/core/judgment/types.js`.
- Probability values are checked for finiteness/bounds, exact outcome coverage,
  and a total within 0.0001 of one. They are never silently normalized.
- Provider confidence stays in the raw response. It is not probability of
  correctness. Generated LLM estimates are marked separately from native ones.
- Brier is the **class-summed** convention (0–2); for binary questions this is
  twice the scalar Brier convention. Ranked probability score uses K-1 ordered
  boundaries and divides by K-1. Ordinal accuracy selects a maximum-probability
  level, breaking ties toward the first level; binary ties select true.
- Summaries keep accuracy among valid answers separate from failed-call counts.
  Reliability bins and threshold curves are descriptive, not guarantees.
  Latency summaries cover successful calls and include original wall time even
  when loaded from cache; replay incurs no new inference cost.

The 60 cases are **30 agent-authored contrast pairs**, 10 pairs per family:
refund intent, evidence support, and demonstrated completion progress. They are
synthetic development fixtures, not 60 independent observations, not a
human-reviewed test set, and not evidence of general calibration. Completion
cases exercise interpretation of supplied check results; they do not run tests
or authorize actions. The labels are never sent to the model.

The [September 20 development pilot](../../reports/2026-09-20-jev-development-pilot.md)
completed native Mycel and direct OpenRouter baseline runs. The initial Mycel
baseline was rejected by an incorrect capability gate. That gate is now removed:
a fresh three-case `--backend llm --provider mycel` smoke passed without changing
Offer metadata. The full baseline results remain the original direct OpenRouter run.

Next: human label review, held-out scenario-group
splits, more natural inputs and longer contexts, question batching/isolation,
controlled latency repetitions, asymmetric error-cost policies, uncertainty
intervals, then the full labs report. Keep the API experimental. No conclusions about RLCD's training method follow from
black-box API comparisons.

## Verification

```sh
pnpm exec vitest run packages/core/src/judgment/ packages/evaluation/src/evaluation/judgment/
pnpm exec tsc --noEmit -p packages/core/tsconfig.json
pnpm exec tsc --noEmit -p packages/evaluation/tsconfig.json
pnpm exec tsc --noEmit -p examples/tsconfig.json
```
