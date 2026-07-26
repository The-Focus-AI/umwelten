# 0009 — An Offer's Capabilities are probed through the path that serves traffic

Status: Accepted
Date: 2026-07-26

Capabilities belong to the **Offer**, not the Model, and are established by
executing the model through the exact code path that will serve production
traffic. Declared capability tables — model cards, runtime documentation, a
different client library's results — are not admissible.

## Why, empirically

We probed models present in two runtimes on one machine
(`reports/2026-07-26-supplier-probe-capability-divergence.md`). Ollama's
`gemma4:e2b` and llama-swap's `unsloth/gemma-4-E2B-it-GGUF:Q4_K_M` are the same
weights and came back **inverted on two of five capabilities**: Ollama had
structured output and no reasoning channel, llama-swap had reasoning and no
structured output. 5/5 llama-swap Offers failed structured output; 5/5 exposed
reasoning.

The instructive part is the cause. Neither divergence belonged to the runtime or
the weights — both traced to our own provider integrations (a missing
`supportsStructuredOutputs` flag on one side, unsupported reasoning parts on the
other). Capability is a property of the whole path: client integration ×
runtime × build × quantization × weights. A layer we would not have thought to
model turned out to dominate the result.

We then fixed the flag (8b8975a) and re-probed. Structured output went 0/5 → 5/5
on llama-swap — **and all five pairs still disagreed**, now on reasoning, plus
`gpt-oss` still failing structured output through Ollama alone.

So we fixed a second cause: nothing could ask an Ollama model to think, and the
probe had never asked, so it was measuring each runtime's default rather than the
Offer's capability (54d018c). Predicted the reasoning disagreements would
collapse. **They did not** — Ollama accepts `think: true` for gemma-4 and returns
no thinking content, because the flag is only honored by certain models. That
divergence is real, is not ours, and cannot be fixed from the client.

Two rounds of eliminating our own bugs, and the runtimes still do not agree. This
is the argument for the ADR in its strongest form: a capability table cannot be
declared even after every known bug is gone, because the layers underneath keep
disagreeing — and it took removing the self-inflicted noise to see which
divergence was genuine.

## Consequences

Every Offer carries the cost of a probe run, and a probe is a snapshot that goes
stale when any layer in that path changes — including a change to our own client
code, which is the layer least likely to trigger a re-probe. Nothing yet decides
when a probe expires.

Dispatch filtering on probed capabilities is only as good as the last probe. A
capability regression introduced by a client upgrade will route confidently into
failure until someone re-probes.

The upside is that this is the only design under which the exchange can honestly
tell a buyer what it is selling.
