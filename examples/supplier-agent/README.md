# Supplier Agent (prototype)

> "I'm running a DGX Spark / M4 Max and I want to plug it into the exchange."

The box-side half of the token exchange. It finds out what this machine can
actually do, and publishes that up as **Offer** drafts. Vocabulary follows
[`packages/exchange/CONTEXT.md`](../../packages/exchange/CONTEXT.md).

**Status: prototype.** Written against real interfaces and typechecked, but not
yet run against real hardware — there is no GPU or local runtime in CI. The
first real run is the point of the exercise.

## The four stages

| Stage | Question | Where it lives |
|---|---|---|
| **Estimate** | What *should* fit on this hardware? | [`whichllm`](https://github.com/Andyyyy64/whichllm) — external, optional |
| **Discover** | What runtimes are up, and what do they serve? | `discover.ts` |
| **Probe** | What does this box *actually* do? | `probe.ts` |
| **Publish** | Turn that into Offers the exchange can route to | `publish.ts` |

Only the probe produces facts. `whichllm` estimates from VRAM math (weights +
KV cache + activation + overhead) and ranks using other people's leaderboard
scores — it never executes a model. Ollama reports context windows from a
hardcoded lookup table in `providers/ollama.ts`. Neither knows what *this*
build of *this* quantization does on *this* machine, which is precisely what an
Offer's Capabilities are supposed to record.

## Usage

```bash
dotenvx run -- pnpm tsx examples/supplier-agent/run.ts discover
dotenvx run -- pnpm tsx examples/supplier-agent/run.ts probe --provider ollama
dotenvx run -- pnpm tsx examples/supplier-agent/run.ts probe --model gemma --concurrency 1,4
dotenvx run -- pnpm tsx examples/supplier-agent/run.ts publish --supplier office-spark
```

`probe` writes `output/supplier-agent/probes.json`; `publish` reads it, so the
slow stage runs once and can be republished freely. Set `EXCHANGE_URL` and
`EXCHANGE_TOKEN` (or pass `--to`) to actually POST.

Flags: `--provider` and `--model` filter targets, `--concurrency 1,4` samples
throughput at multiple levels, `--no-throughput` runs capabilities only.

## What it probes

Five capabilities, each pass/fail with recorded evidence: **chat**,
**streaming** (more than one delta — a runtime that buffers and dumps is not
streaming, whatever the API shape says), **tool-calling** (a real handler
executes, or it didn't happen), **structured-output** (schema-valid JSON), and
**reasoning** (a separate reasoning channel exists).

Throughput is sampled at each requested concurrency: median TTFT and aggregate
completion tokens/sec. Run at 1 for the number a buyer feels, and at N to find
where the box stops scaling — that inflection is the **Headroom** the exchange
needs, and it is measured rather than declared precisely so nobody can claim it.

After a run, `probe` prints any model where two runtimes serving the same
weights disagreed about capabilities. That disagreement is the whole argument
for probing instead of trusting a model card.

## Design constraints

Three things this prototype deliberately does not do:

- **It does not set prices.** The exchange sets Cost and Charge. Price is the
  exchange's routing lever — a supplier that prices itself takes that away.
- **It does not assert Guarantees.** `SupplierProfile.guarantees` is echoed for
  confirmation only. The operator is liable for a Guarantee, so the operator
  owns it.
- **It does not cap output tokens on the throughput probe.** Per CLAUDE.md's
  HARD RULES, the binary capability probes set `maxTokens` on their own
  `Stimulus` — the sanctioned per-task escape hatch, since we are testing
  whether a tool call happens, not how long a model can talk. The throughput
  probe uses a self-terminating prompt instead, because a cap would truncate
  mid-generation and inflate tokens/sec.

## Adapt vs serve

This runs in **adapt mode**: it probes whatever OpenAI-compatible runtimes are
already up. That is right for a laptop, where the owner picked their models and
an agent that fights for the GPU gets uninstalled.

**Serve mode** — where the agent owns the serving layer so it can pin context
size and quantization — is not built. It is mostly `generateLlamaSwapConfig()`
from `packages/core/src/providers/llamaswap-config.ts`, which already scans GGUF
caches and emits a llama-swap config, run before discovery.

## Not built yet

- **Connect.** Publishing is an HTTP POST, which covers a tunnelled box and is
  the same shape a commercial vendor presents. Dial-out — the box holds an
  outbound connection and never listens on a port — is what makes the "no
  inbound surface" claim sellable, and is still an open decision.
- **Context probe.** `ProbedOffer.contextChars` is in the type and unpopulated.
  Finding the real usable context means a needle test at increasing sizes,
  which is slow and evicts other models.
- **Re-probing.** A probe is a snapshot. Nothing yet decides when it goes stale.
