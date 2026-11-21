# 0017 — The exchange meters at its own boundary

Status: Accepted
Date: 2026-07-26

The exchange counts prompt tokens at admission and completion tokens as it
relays them. Usage reported by an upstream is a **reconciliation signal**,
compared against our own count, never the basis for a Charge.

## Why

Measured, not assumed
(`reports/2026-07-26-can-the-exchange-bill-what-it-sold.md`). Driving the real
runner against a mock upstream, two of three realistic situations produced a
request that looked free while real tokens were served:

- **Upstream reports no usage** — 89 characters delivered, `promptTokens: 0`,
  `completionTokens: 0`, cost undefined. The usage object arrives with every
  expected key present and every value `undefined`; `normalizeTokenUsage`
  correctly refuses to coerce that into zeros it would bill on.
- **Client hangs up mid-stream** — `promptTokens` is hardcoded to `0` even though
  the whole prompt was processed and paid for, `completionTokens` is a
  `chars / 4` estimate, and cost is undefined. Submit a long prompt, abort near
  the end of generation, and the exchange pays upstream for nearly all of it and
  records nothing. Cheap to repeat.

`ModelResponse.metadata` is not at fault — it was built for benchmark reporting,
where "burned N tokens and produced nothing" is the right thing to capture. It is
fit for that and unfit for money.

Two properties make our own metering tractable: prompt tokens are knowable
*before* the request is sent, and completion tokens pass through us on the way to
the buyer. Counting on our side of the wire survives an abort by construction.

## Consequences

We need a tokenizer at admission, and it must be the same one for every Supplier
so Charges are comparable. It will therefore disagree with each upstream's own
count — that disagreement is the reconciliation signal, not an error, and a
persistent skew is information about a Supplier.

Because the count is incremental and ours, a Balance can be enforced *during*
generation and the stream cut when credit runs out, rather than discovering the
overdraft afterwards.

The abort policy is explicit and deliberate: **prompt charge is always
collected, completion is charged on our relayed count.** Do not "fix" this later
into refunding aborted requests — that is the exploit, not a courtesy.
