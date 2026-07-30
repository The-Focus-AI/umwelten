# E3 — Can the exchange bill what it sold?

Experiment report, 2026-07-26. Run via `pnpm tsx examples/exchange-metering/run.ts`
against a mock OpenAI-compatible upstream (no API keys, no GPU).

> **Headline:** no, not from `ModelResponse.metadata` as it stands. Two of three
> realistic situations hand the ledger a request that appears free while real
> tokens were served. The fix is structural: **the exchange must meter at its own
> boundary and treat upstream usage as reconciliation, not as the source of
> truth.**

## Why this needed asking

ADR 0013 (Charge independent of Cost) and ADR 0014 (balances keyed on
`(Application, sub)`) both assume the exchange can count what a request
consumed. Nothing had checked that assumption, and there was already a hint it
was shaky: `runner.ts` carries a fallback that warns *"Usage statistics
(prompt/completion tokens) not available… Cost cannot be calculated"* and
`usage-extractor.ts` normalizes across six different field spellings. Code that
defensive exists because the underlying data is unreliable.

Live providers are the wrong instrument here. The cases that decide whether a
ledger is sound are the awkward ones — a client hanging up mid-stream, an
upstream reporting no usage — and those are hard to provoke on demand and
impossible to provoke repeatably. So `mock-upstream.ts` serves them deliberately,
and `LLAMASWAP_HOST` points the **real** runner, provider, and usage-extraction
cascade at it, unmodified.

## Results

Upstream truth for a completed stream: `prompt=137, completion=18`.

| Scenario | chars served | promptTokens | completionTokens | cost | partial |
| --- | --- | --- | --- | --- | --- |
| usage in final chunk | 89 | **137** ✓ | **18** ✓ | 0 | no |
| upstream reports no usage | 89 | **0** | **0** | *undefined* | no |
| client hangs up mid-stream | 114 | **0** | 29 (estimate) | *undefined* | **yes** |

### The happy path works

When the upstream reports usage, extraction is exact. Note that `cost` is `0`
rather than absent — llama-swap has no pricing table, because it is local
hardware. That is ADR 0013's argument made concrete: if Charge tracked Cost, every
request to your own GPU would be free and the box would be defenceless.

### An upstream that reports no usage yields a free request

89 characters of real output, `promptTokens: 0`, `completionTokens: 0`, cost
undefined. The interesting detail is *why*: the usage object arrives with all the
expected keys — `inputTokens`, `outputTokens`, `totalTokens` — and every value
`undefined`. `normalizeTokenUsage` correctly refuses shaped-but-undefined data
rather than coercing it to zeros it would then bill on. The refusal is right; the
consequence is that nothing is billable.

### An aborted stream is worse than unbillable — it is exploitable

`runner.ts:483-506` salvages what it can on abort, and is honest about doing so:
it sets `partial: true`, `partialApproxTokens`, `partialContentChars`. But for
money:

- **`promptTokens: 0`** — hardcoded, even though the full prompt was submitted and
  processed. For a long-context request this silently zeroes the *majority* of
  the cost.
- **`completionTokens`** is `(content.length + reasoning.length) / 4`. Here that
  happened to land near the truth; it will drift badly on code, non-English text,
  or heavy reasoning output.
- **`cost: undefined`** — so if Charge derives from `metadata.cost`, an aborted
  request costs the buyer nothing.

That is a griefing vector, and a cheap one: submit a long prompt, abort near the
end of generation. The exchange pays the upstream for full prompt processing plus
nearly all the decode, and records nothing. Repeat.

None of this is a bug in `runner.ts`. That metadata was built for benchmark
reporting, where "model burned N tokens thinking and produced nothing" is exactly
the right thing to record. It is fit for its purpose and unfit for ours.

## What follows for the design

**Meter at the exchange boundary, not from the response object.** The exchange is
a proxy — it sees the request before forwarding and every delta as it streams —
so it can count both sides itself and does not need an upstream final chunk that
may never arrive.

Two properties make this tractable:

1. **Prompt tokens are knowable before the request is made.** Count them locally
   at admission with a tokenizer. This is the single highest-value fix: it makes
   prompt charge always collectable, including on abort, and it is the larger
   half of the bill for long-context work.
2. **Completion tokens are countable as they pass through.** The exchange is
   already relaying each chunk. Counting is incremental and survives an abort by
   construction, because the count lives on our side of the wire.

Upstream usage then becomes a **reconciliation signal** — compare it against our
own count, and a persistent discrepancy is a data point about that Supplier
rather than a billing failure.

This also settles what to do when Charge and reality disagree mid-stream. Because
the exchange counts as it relays, it can enforce a Balance *during* generation and
cut the stream when credit runs out, rather than discovering the overdraft
afterwards.

## Follow-ups

1. **ADR 0017** records the metering boundary decision.
2. **Choose a tokenizer for admission-time counting.** It only has to be
   accurate enough to charge on, and it must be the same one for every Supplier
   so Charge is comparable — which means it will disagree with each upstream's
   own count. That disagreement is the reconciliation signal, not an error.
3. **Decide the abort policy explicitly.** Prompt charge always collected;
   completion charged on our relayed count. Worth stating so nobody later
   "fixes" it into refunding aborted requests.
4. **Streaming tool calls are unmeasured.** A multi-step tool loop issues several
   upstream requests for one buyer request. Whether usage aggregates across steps
   or reports only the last was not tested here.
