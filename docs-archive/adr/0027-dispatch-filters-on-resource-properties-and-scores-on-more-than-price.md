# 0027 — Dispatch filters on resource properties, and scores on more than price

Status: Accepted
Date: 2026-08-08

Two changes to how one Offer is chosen, both correcting things that were built
on assumptions nobody agreed to.

1. **Quantization and context length are requirable**, the same way Guarantees
   already are. A buyer who cares says so; one who does not gets whatever wins.
2. **Ranking is a weighted score**, not the cheapest price. Price is one term
   alongside measured throughput, time-to-first-token, and whether the Offer
   batches at all.

## Why resource properties had to become requirable

Dispatch matched a Model on exact string equality. So a DGX serving
`gemma-4-26b` at Q8 with a 128k context and a vendor serving the same name at
whatever they run were **interchangeable**, and the cheaper one won.

That is wrong on this project's own evidence. Probing sixteen Offers across two
runtimes on one machine found the same weights exposing *different capability
sets* depending on how they were served
(`reports/2026-07-26-supplier-probe-capability-divergence.md`), which is the
whole reason ADR 0015 has Capabilities probed per Offer rather than looked up
per Model. Quantization was added to the Offer and then never consulted, so the
Offer carried the evidence and the selection ignored it.

**Requirable, not mandatory.** Making every buyer specify a quantization would
make the catalogue an exam. The default stays "give me something that serves
this Model"; the buyer who knows they need Q8 or 128k of context can now say so
and get a `no_offer` rather than a quiet downgrade.

Per-request headers, matching the existing shape:

```
X-Mycel-Require-Quantization: Q8_0
X-Mycel-Min-Context: 131072
```

An Offer with no `quantization` recorded does not match a quantization
requirement. An adapted Offer is reselling a configuration its Supplier does not
control (ADR 0016) and cannot honestly claim one.

## Why cheapest-wins had to go

`rankingPrice` carried its own confession: *"deliberately crude and deliberately
in one place: when metering lands (#297) and real token counts are available
before dispatch, this is what gets replaced."* Metering landed. It was not
replaced.

The consequence is sharper than it sounds, because owned hardware costs zero.
**A Supplier we own always beat every vendor, regardless of anything else** — a
DGX that queues four-deep with a 48-second time-to-first-token still won against
an idle vendor, because zero is less than any price. Every Headroom number this
project spent weeks measuring was collected, published, stored, and never read.

## What the score uses, and what it cannot

Four terms, each normalized across the eligible set so a score is only ever
meaningful *relative to the alternatives for this request*:

| Term | Direction | Source |
|---|---|---|
| price | lower better | `retail*PerMillion`, weighted completion-heavy |
| aggregate throughput | higher better | Headroom sample |
| time to first token | lower better | Headroom sample |
| serves concurrent work | boolean | Headroom `saturation` verdict |

**What it cannot do, stated plainly: this is capacity, not utilization.**
Headroom is a measurement taken at probe time, not a reading of what the machine
is doing right now. An Offer that batches beautifully and is currently serving
six other requests looks identical to an idle one. So the score prefers an
Offer that is *characteristically* fast and concurrent — it does not avoid a
busy one.

Live load is knowable later: under ADR 0023 the Exchange holds an open
connection to every machine Supplier, so in-flight request counts become
observable rather than inferred. That is when this becomes true load balancing.
Until then the honest claim is "better-informed than price alone."

**An Offer with no Headroom scores on price alone**, neither rewarded nor
punished for the gap. A vendor catalogue is published without probes and would
otherwise be uniformly penalised for a measurement we never asked it for.

## Explicability is a requirement, not a nicety

Every eligible Offer's score and its component terms are recorded on the
`considered` list, alongside the rejection reasons that were already there.
"Why did this request go there" has to stay answerable after the fact, and a
weighted function is exactly the kind of thing that stops being answerable when
nobody writes the terms down.

Weights are constants in one place, tunable per deployment. They are not
per-Application: a buyer expressing a preference does it through a *requirement*,
which is a filter and therefore explicable, rather than by nudging a scoring
function.

## Consequences

- `DispatchRequirements` gains `quantization` and `minContextTokens`.
- Two rejection reasons: `missing-quantization`, `insufficient-context`.
- `rankingPrice` is replaced by `scoreOffer`. Price-only behaviour remains
  reachable by zeroing the other weights, which is also how the existing tests
  stay meaningful.
- Ties break deterministically on `supplierId`, as before. Production routing
  that flaps under a tie is worse than a slightly wrong preference.
