# Jev as a typed judgment primitive: development pilot

Run date: September 20, 2026. Tracking: [issue #498](https://github.com/The-Focus-AI/umwelten/issues/498).

**The pilot runs end to end. Jev returned valid typed answers quickly, but made six label errors; the generative baseline matched every label it answered, but timed out three times.** This is a development result, not a calibrated-production-policy recommendation or a general model ranking.

## Experiment

The frozen dataset contains 60 agent-authored synthetic cases in 30 contrast pairs: 20 refund-intent binary questions, 20 evidence-relation choices, and 20 ordinal completion judgments. Labels were fixed before inference and never sent to either model. Completion fixtures describe test results; the experiment does not execute tests or verify real code.

- Native: `typesafe/jev-1.13`, served as `typesafe/jev-1.13-20260917`, through Mycel `/v1/decisions` using Application `umwelten-internal`.
- Generated-probability baseline: `deepseek/deepseek-v4.1-flash`, through the existing Umwelten Interaction structured-output path and direct OpenRouter access.
- The initial Mycel baseline failed all three smoke cases with `503 no_eligible_offer`: Mycel incorrectly made a missing `structured-output` catalog flag a hard gate. This was a gateway policy issue, not an upstream model limitation. The SDK attempted each request three times. No Mycel request/debit records were created. Those historical failures are retained separately; the original full comparison used direct OpenRouter instead.
- Each successful smoke cache was extended to 60 cases. A second native run reversed only the 20 choice-option definitions, reusing the other 40 records. No ordinal rubric was reversed. Native made 80 distinct calls, not 120.
- Calls were sequential within each run, with a 120-second deadline. Native and direct baseline work overlapped during part of execution. This is not a controlled model-speed benchmark.

## Follow-up: Mycel pass-through corrected

After the original experiment, [issue #500](https://github.com/The-Focus-AI/umwelten/issues/500) removed automatic feature-capability inference from chat requests. Mycel now forwards response-format, tools, media, and streaming parameters for the upstream provider to accept or reject. Authentication, model access, guarantees, credit checks, chat-operation routing, and explicitly requested capability constraints remain enforced.

The correction was deployed after 398 Mycel tests, typecheck, and lint passed. A fresh three-case DeepSeek Flash smoke through Mycel returned **3/3 valid and correct answers**, with exactly three debits totaling **$0.000156**. The Offer still declares only chat, streaming, and tool-calling; no catalog capabilities, prices, funding, or credit limits were changed. This confirms that pass-through works without advertising structured output. The full 60-case comparison below remains the original experiment; it was not rerun or overwritten by this smoke check.

## Original-order results

Accuracy is among valid responses; failures remain separate. Ordinal accuracy uses the maximum-probability level, not a rounded expected score. Brier is class-summed (including the binary case); lower is better. RPS is normalized by the number of ordinal boundaries.

| Family | Jev correct / valid | DeepSeek correct / valid | Jev Brier | DeepSeek Brier |
|---|---:|---:|---:|---:|
| Refund intent | 20/20 | 17/17; 3 timeouts | 0.006970 | 0.000647 |
| Evidence relation | 19/20 | 20/20 | 0.097990 | 0.000290 |
| Completion progress | 15/20 | 20/20 | 0.213350 | 0.003919 |
| Total | 54/60 | 57/57; 3 timeouts | — | — |

Completion RPS: Jev **0.057133**, DeepSeek **0.001063**. The refund metrics do not cover identical case sets because DeepSeek timed out on three cases.

| Successful-call wall time | Jev via Mycel | DeepSeek via OpenRouter |
|---|---:|---:|
| Median | 400 ms | 2,377 ms |
| p95 | 571 ms | 12,947 ms |

The baseline's three 120-second timeouts are excluded from successful-call latency quantiles. Their case IDs are `refund-4-1`, `refund-6-1`, and `refund-7-1`. They were not retried as new experiment calls; replay preserves them as failures.

## Failures worth carrying into the next dataset

Jev's evidence miss was `evidence-3-1`:

> Claim: The effect was observed in humans.
>
> Passage: The effect was observed in mice; no human results are reported.

The fixture label is **unresolved**: the passage does not establish that the effect was never observed in humans. Jev chose **contradicted with probability 0.98**, assigning unresolved 0.02. A 0.9 confidence threshold alone would not reject this error. Independent review of the task interpretation and labels is still needed before using this as benchmark evidence.

Five completion errors were conservative: for inputs explicitly saying all independent acceptance checks passed, Jev assigned the largest probability to “implementation exists but completion is not verified.” The affected tasks were CSV export, empty-cart crash, Unicode filenames, pagination, and timezone offsets. These cases share nearly identical evidence wording, so they are not five independent demonstrations of a broad weakness.

## Option order and accounting

Across 20 original/reversed choice pairs, **zero selected labels changed**. Four probability distributions changed, with a maximum absolute per-option delta of **0.03**. This measures one order permutation, not general order invariance or run-to-run determinism. Original-order evidence Brier was 0.097990; reversed-order Brier was 0.098860. Original and reversed summary files are retained separately.

Costs are deliberately not conflated:

- **Mycel actual retail ledger charge:** $0.000486 for all 80 native calls, with 80 unique request IDs and exactly one debit per request. This includes the option-order experiment.
- **Native upstream-reported cost:** $0.00125622 for those same calls. This is not the Mycel customer charge. Mycel independently meters serialized content, so its billing units differ from upstream token usage.
- **Direct baseline pricing-table estimate:** $0.00739368 for 57 successful calls. This is not an invoice or ledger debit. Usage and actual charges for the three timed-out calls are unknown.
- **Rejected Mycel baseline smoke:** zero Mycel debits.

No production configuration, Offers, funding, or credit limits changed during the experiment.

## Reproduction and evidence

Runner: `examples/jev/run.ts`; setup and command examples: `examples/jev/README.md`.

```sh
pnpm exec tsx examples/jev/run.ts --backend mycel --live --limit 60 --out output/jev/native
pnpm exec tsx examples/jev/run.ts --backend mycel --live --limit 60 --reverse-options --out output/jev/native
pnpm exec tsx examples/jev/run.ts --backend llm --provider openrouter --model deepseek/deepseek-v4.1-flash --live --limit 60 --out output/jev/baseline-openrouter
```

Run three-case smoke gates first; `--live` is paid. Use `--replay` instead of `--live` against the corresponding saved directory to recompute without inference. Preserve summaries between invocations because `summary.json` reflects the latest selection.

The accompanying `jev-labs-results.tgz` export contains frozen per-case requests/labels, raw responses, normalized results, original/reversed/smoke/replay summaries, failure evidence, ledger reconciliation, exact commands, and executed-source hashes. Credentials and private run logs are excluded. At review, all 13 executed source hashes matched the local prototype.

Verification:

- `vitest run packages/core/src/judgment/ packages/evaluation/src/evaluation/judgment/`: **35 tests passed**.
- Core, evaluation, and examples TypeScript checks passed; modified package code passed ESLint.
- Host replays ran with networking disabled and no credentials: 60 cache hits for native original, native reversed, and direct baseline, plus 3 for rejected Mycel baseline. Ledger snapshots were identical before and after replay.
- Independent local inspection rescored baseline records, checked native error cases and order deltas, and replayed both native selections without credentials.

## What this means for Umwelten and the full labs report

The useful primitive is **a bounded judgment with typed outcomes and probability metadata**, separate from an agent loop. Native Jev and a generative model can implement the same experimental contract while preserving their distinct probability sources, execution paths, latency, and accounting. Software remains responsible for actions, permissions, thresholds, and escalation.

Keep this API experimental. Before a publishable calibration claim, add independently reviewed labels, held-out scenario groups, more varied natural and long-context inputs, repeated option-order tests, matched transport/timing conditions, and explicit asymmetric error costs. Evaluate shared-state batching separately; this pilot uses one question per case and does not establish batching benefits. Neither these black-box results nor valid output schemas establish anything about RLCD's proprietary training method.
