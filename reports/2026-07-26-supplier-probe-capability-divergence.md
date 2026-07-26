# Probing local Offers: capability divergence is caused by our client, not the runtime

Experiment report, 2026-07-26. Run on an M4 Max via
`examples/supplier-agent/run.ts probe --no-throughput`.

> **Headline:** the same weights served by Ollama and by llama-swap expose
> *complementary* capability sets — each runtime has a capability the other
> lacks. Both divergences trace to umwelten's provider integrations, not to
> llama.cpp, Ollama, or the models. The design consequence is that an Offer's
> Capabilities must be probed **through the exact code path that will serve
> production traffic**; a table derived from model cards, runtime docs, or a
> different client library is wrong.

## What the experiment was for

The exchange (see `packages/exchange/CONTEXT.md`) needs to know what each Offer
can do before it dispatches to one. The open question was whether a supplier
agent can simply **adapt** — resell whatever runtimes are already up on a box —
or whether it must **serve** the models itself to make any guarantee stick.

The test: probe models that exist in two runtimes on the same machine and see
whether the capability sets agree.

## Results

Five capability probes per Offer, each pass/fail with recorded evidence.

| Runtime | Model | chat | stream | tool | struct | reason |
| --- | --- | --- | --- | --- | --- | --- |
| ollama | `gemma4:e2b` | ✓ | ✓ | ✓ | **✓** | **✗** |
| llamaswap | `unsloth/gemma-4-E2B-it-GGUF:Q4_K_M` | ✓ | ✓ | ✓ | **✗** | **✓** |
| llamaswap | `ggml-org/gemma-4-26B-A4B-it-GGUF:Q4_K_M` | ✓ | ✓ | ✓ | ✗ | ✓ |
| llamaswap | `ggml-org/gemma-4-31B-it-GGUF:Q4_K_M` | ✓ | ✓ | ✓ | ✗ | ✓ |
| llamaswap | `ggml-org/gpt-oss-20b-GGUF:MXFP4` | ✓ | ✓ | ✓ | ✗ | ✓ |
| llamaswap | `unsloth/NVIDIA-Nemotron-3-Nano-4B-GGUF:Q4_K_M` | ✓ | ✓ | ✓ | ✗ | ✓ |
| ollama | `gpt-oss:latest` | ✓ | ✓ | ✓ | **✗** | ✓ |
| ollama | `gemma4:{12b,26b,31b,e4b,latest}` | ✓ | ✓ | ✓ | ✓ | ✗ |
| ollama | `nemotron-3-nano:{4b,latest}` | ✓ | ✓ | ✓ | ✓ | ✗ |

The `gemma-4 E2B` row pair is the cleanest evidence: identical weights,
inverted on exactly two of five capabilities.

**5/5 llama-swap Offers fail structured output. 5/5 expose reasoning.** The
uniformity is the tell — a model-level or quantization-level cause would not
produce a perfect split along runtime lines.

## Root cause

Neither divergence is a property of the runtime or the weights.

### Structured output

`@ai-sdk/openai-compatible` exposes a `supportsStructuredOutputs` flag on
`createOpenAICompatible`. Neither `providers/llamaswap.ts` nor
`providers/lmstudio.ts` passes it, so it defaults to `false`, the SDK never
sends `response_format: { type: 'json_schema', … }`, and it degrades to asking
for JSON in the prompt. The runtime says so explicitly:

```
AI SDK Warning (llamaswap.chat / ggml-org/gemma-4-26B-A4B-it-GGUF:Q4_K_M):
The feature "responseFormat" is not supported.
JSON response format schema is only supported with structuredOutputs
```

The models were not confused. Asked for `{city, countryCode, populationMillions}`,
gemma-4-26B returned well-formed JSON with `city_metadata`, `geography`,
`demographics`, `logistics`, and `key_landmarks` — 933 completion tokens of
perfectly valid, entirely unrequested structure. It was never shown the schema.

llama-server has supported `response_format` with json_schema and GBNF grammars
for a long time, and the observed build is `b10098`. This is very likely a
one-line provider fix rather than a llama.cpp limitation — **but it must be
verified against that build before anyone commits to it**, and it changes
behavior that every existing local-model benchmark was collected against.

### Reasoning

The mirror image, from the Ollama side:

```
AI SDK Warning (ollama.responses / gpt-oss:latest):
reasoning parts in assistant messages are not supported for Ollama responses
```

llama-server splits thinking content into a separate channel that the
OpenAI-compatible provider surfaces; the Ollama provider path does not. Gemma-4
under llama-swap produced 207–1400 characters of reasoning on every model
probed, including the 2B-class E2B variant. The same weights through Ollama
reported no reasoning channel at all.

## What this means

**Q11 (adapt vs serve) was mis-framed.** Serve-mode would not have fixed either
divergence: an agent that launched `llama-server` itself would still route
through the same `llamaswap` provider and still fail structured output.
Adapt-vs-serve is not the axis that controls capability variance. What
serve-mode still buys is control over context size, quantization, and
concurrency — *resource* properties, not *capability* properties. The question
needs re-asking on those terms.

**ADR 0009 falls out of this directly.** Capability is a property of the whole
path — client integration × runtime × build × quantization × weights — and the
only honest way to populate an Offer's capability set is to exercise it through
the code path that will serve production traffic.

**It also confirms ADR 0006's Supplier abstraction is right to be thin.** The
exchange should know "can this Offer do X, at what price, with what headroom" —
and nothing about *why*, because the why turns out to live in a layer the
exchange has no business modelling.

## Secondary observations

- **Cold-start cost is large and uneven.** First-probe latency through
  llama-swap's on-demand launch: 28.6s (26B), 14.4s (31B), versus 0.9–2.7s once
  warm. Dispatch will need to price an idle Supplier differently from a warm
  one; a naive "cheapest Offer wins" rule will route a latency-sensitive
  request into a 30-second model load.
- **The failure path works.** Every structured-output failure was caught by the
  watchdog, recorded with evidence, and the run continued. The stack traces in
  the console are `runner.ts` logging on the way out of a correctly handled
  failure.
- **`examples/local-providers/README.md` claim 6** ("broken structured output,
  vision failures, GGML crashes") is listed as *not tested*. Structured output
  is now tested: it is broken, and we broke it.

## Follow-ups

1. Verify `supportsStructuredOutputs: true` against llama-server b10098 and
   propose a patch to `llamaswap.ts` / `lmstudio.ts`. Flag loudly that this
   invalidates comparability with prior benchmark data.
2. Re-probe after the fix. If both runtimes then agree, the capability
   divergence was entirely self-inflicted — which is the best possible outcome
   and still does not remove the need to probe.
3. Re-ask Q11 on resource properties: does the agent need to pin context size
   and quantization to make an Offer sellable?
4. Throughput sampling (`--concurrency 1,4`) has not been run. That is the
   Headroom half, and it is what E2 needs.
