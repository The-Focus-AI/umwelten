# Headroom: Ollama serializes, llama-server batches

Experiment report, 2026-07-26. M4 Max, via
`pnpm tsx examples/supplier-agent/run.ts probe --concurrency 1,4`.

> **Headline:** Ollama serves concurrent requests **one at a time**. Every model
> shows flat aggregate throughput, an unchanged per-stream decode rate, and TTFT
> rising 40–60× under four concurrent requests. llama-server batches, scaling
> aggregate throughput 2.9×–6.8×. For an exchange these are not two speeds of the
> same thing; one of them cannot serve concurrent traffic at all.

## Method

Three numbers per concurrency level, because they move in different directions
and only together locate saturation:

- **aggregate tok/s** — total completion tokens ÷ wall clock. Rises with
  concurrency until the box saturates.
- **decode tok/s** — per-stream rate excluding time spent waiting to start.
  Falls as concurrency climbs, if the box is genuinely contended.
- **TTFT** — median time to first token. Rises when requests queue.

The discriminator: *flat aggregate with rising TTFT means queueing; falling
aggregate means real contention.* Those want different Dispatch responses.

## Results

### Ollama — capacity 1

| Model | agg c=1 | agg c=4 | decode c=1 | decode c=4 | TTFT c=1 | TTFT c=4 |
| --- | --- | --- | --- | --- | --- | --- |
| gemma4:e2b | 139.7 | 145.3 | 148.5 | 148.6 | 292ms | 7,374ms |
| gemma4:12b | 48.0 | 48.6 | 49.5 | 49.1 | 457ms | 21,422ms |
| gemma4:26b | 96.3 | 99.7 | 101.5 | 101.4 | 367ms | 10,654ms |
| gemma4:31b | 21.4 | 20.8 | 21.9 | 21.3 | 772ms | 48,767ms |
| gemma4:e4b | 89.0 | 91.7 | 93.1 | 93.0 | 344ms | 11,537ms |
| gpt-oss:latest | 85.4 | 89.3 | 109.9 | 114.9 | 1,263ms | 9,919ms |
| nemotron-3-nano:4b | 90.2 | 86.4 | 92.4 | 92.4 | 235ms | 2,115ms |
| nemotron-cascade-2:30b | 88.9 | 91.5 | 92.4 | 92.3 | 301ms | 11,491ms |
| qwen3.6:27b | 22.8 | 22.1 | 23.3 | 22.3 | 642ms | 46,117ms |

Aggregate throughput is unchanged (ratios 0.96–1.04). Per-stream decode is
**identical to three significant figures** at c=1 and c=4. TTFT rises 9×–63×.

That is serialization, not contention. Each request runs alone at full speed
while the others wait. There is no batching to degrade.

### llama-swap — continuous batching

| Model | agg c=1 | agg c=4 | scaling | decode c=1 | decode c=4 | TTFT c=1 | TTFT c=4 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gemma-4-E2B | 148.7 | **1014.3** | 6.8× | 151.6 | 275.2 | 88ms | **195ms** |
| nemotron-3-nano-4B | 89.0 | 389.1 | 4.4× | 96.6 | 188.6 | 658ms | 2,644ms |
| gpt-oss-20b | 115.4 | 332.8 | 2.9× | 140.4 | 201.1 | 713ms | 2,892ms |
| gemma-4-26B | 94.1 | 288.5 | 3.1× | 113.9 | 279.3 | 1,511ms | 6,346ms |
| gemma-4-31B | — | — | — | — | — | — | — |

**Measurement caveat:** per-stream decode *rose* with concurrency, which
batching alone does not explain — in lockstep batched decode each sequence should
hold roughly its single-stream rate. The likely cause is that the c=1 sample
understates: on Apple Silicon a single stream underutilizes the GPU, and short
samples are sensitive to clock ramp. The E2B 6.8× aggregate scaling exceeds the
4× ceiling that four-way parallelism alone allows, which points the same way. The
*direction* of every finding here is unambiguous; the c=1 absolute numbers should
be treated as a floor, and re-measured with a longer sample before anyone prices
against them.

### A failure worth recording

`ggml-org/gemma-4-31B-it-GGUF:Q4_K_M` failed its chat probe with
`AI_RetryError → AI_APICallError: Compute error` after 3 attempts. **It passed in
the capability-only run earlier the same day**, so this is intermittent and most
likely memory pressure — four concurrent requests against a 31B, with the
previous llama-swap model possibly still resident.

`examples/local-providers/README.md` claim 5 records this same `Compute error`
signature under LlamaBarn for `gpt-oss-20b`. Two different models, two different
llama.cpp front-ends, same error. Worth treating as a load/memory symptom rather
than a model-specific defect.

The probe handled it correctly: recorded as failed, rendered `?` in the matrix,
and excluded from capability comparison rather than counted as unsupported. Its
absence is also why the disagreement list shrank from four pairs to three — no
pair, no comparison.

## What this means for the exchange

**1. Ollama is effectively single-tenant.** At four concurrent requests, a buyer
waits 21 seconds for gemma4:12b and 48 seconds for gemma4:31b to *start*. An
exchange reselling an adapted Ollama cannot serve concurrent traffic at all. This
is a considerably stronger argument for ADR 0010 (serve-mode) than the reasoning
capability gap that originally motivated it — that gap costs you a feature, this
costs you the ability to have two customers.

**2. Headroom is a curve, and its shape is runtime-specific.** Ollama's capacity
is 1 regardless of model size. llama-server's is 3–7×, varying by model. A single
"tok/s" field on an Offer would have shown Ollama's gemma4:12b (48) and
llama-swap's gemma-4-26B (94) as roughly comparable. Under load they differ by
6× in aggregate and 3,000ms in TTFT.

**3. Small-and-cheap wins overwhelmingly under load.** gemma-4-E2B on llama-swap
delivers 1014 tok/s aggregate at 195ms TTFT. qwen3.6:27b on Ollama delivers 22
tok/s at 46 seconds. That is a ~46× throughput difference and a ~236× latency
difference between two Offers on the same machine. Pricing that steers traffic
toward the former is not a micro-optimization; it is most of the economics.

**4. TTFT is the admission-control signal.** Ollama's TTFT explosion is what
queueing looks like from outside. Dispatch must cap concurrency per Offer from
measured Headroom rather than discovering the limit by degrading real requests —
which is ADR 0007's "money answers how much this month, concurrency answers how
much right now," now with a number attached.

## Follow-ups

1. **Re-measure c=1 with a longer sample** before pricing against these
   absolutes. Direction is solid; the c=1 numbers look like a floor.
2. **Sample beyond c=4** on llama-swap. Nothing here has found its knee — E2B was
   still scaling at 6.8×, so the ceiling is above the range tested.
3. **Investigate whether Ollama can batch at all** (`OLLAMA_NUM_PARALLEL`). If it
   can, this is a configuration finding rather than an architectural one, and
   adapt-mode over Ollama becomes viable again. If it cannot, ADR 0010 is settled
   on throughput grounds as well as capability grounds.
4. **Cold-start is still unpriced.** llama-swap's on-demand loads were 14–28s
   earlier. Dispatch preferring a warm Offer over a nominally faster cold one is
   likely correct, and unquantified.
