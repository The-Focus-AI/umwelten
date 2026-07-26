# 0010 — The supplier agent serves models itself; adapting is a lesser Offer tier

Status: Accepted
Date: 2026-07-26

The supplier agent owns the serving layer by default — it launches the runtime,
pins context size and quantization, and controls concurrency. It may instead
**adapt**, reselling a runtime already running on a box it does not control, but
Offers produced that way are a distinct and lower tier: they carry no resource
commitments and a narrower capability set.

## Why, empirically

Probing 16 Offers across Ollama and llama-swap on one machine
(`reports/2026-07-26-supplier-probe-capability-divergence.md`) found that
**llama-server is strictly more capable than Ollama on the same weights**: it
serves reasoning on five models where Ollama serves none, and structured output
on a model Ollama fails.

The decisive part is that this survived two rounds of fixing our own client bugs.
A missing `supportsStructuredOutputs` flag and an unreachable Ollama `think`
parameter both looked like the cause and both were ours. Once removed, the
reasoning gap remained — Ollama accepts `think: true` for gemma-4 and returns no
thinking content at all. No client change can recover it.

So the choice of runtime determines what an Offer can do, which means an agent
that does not choose the runtime cannot commit to what it is selling. That is the
argument adapt-mode loses on.

## Consequences

Adapt-mode stays supported, because it is the only onboarding path that costs a
partner nothing — a laptop with an existing LM Studio install can join the pool
the same day. But it is priced and labelled as a lesser tier rather than treated
as equivalent. A box running our serving layer offers more and is worth more.

`generateLlamaSwapConfig()` in `providers/llamaswap-config.ts` becomes production
code rather than a convenience script, and the agent takes on process management
on hardware we may not own — including the failure modes that come with it
(a partner's box rebooting, a GPU claimed by whoever is sitting at the desk).

This decision constrains capability but not Guarantees: a Guarantee is asserted
by the operator and carried by the Supplier (ADR 0006), so an adapted Offer can
still be on-premise and not-trained-on. It is capability and resource
commitments — context size, quantization, concurrency — that require serving.
