# 0021 — Headroom is sampled to a fixed policy, published with the numbers

Status: Accepted
Date: 2026-08-01

Every Offer carries Headroom sampled the same way: **at concurrency 1 and 4**,
each level generating for at least **20 seconds** of decode, inside a **300
second** budget per Model, with a **2 second** cooldown between levels, and
**re-measured after 6 hours**. The policy travels on the Offer alongside the
numbers it produced.

## Why a policy at all

Headroom is measured, never declared — that part was never in question. What was
missing is that two Suppliers' measurements are only comparable if they were
taken the same way, and nothing in an Offer said how they were taken. A number
sampled over three seconds and a number sampled over sixty are different kinds
of number, and Dispatch was being handed both as though they were the same.

So the policy is not just chosen, it is published. An Offer whose sampling did
not meet it says so (`meetsPolicy: false`) rather than being silently ranked
against Offers that did.

## Why these numbers

**Two levels, not one.** Measurement across nine models
(`reports/2026-07-26-headroom-ollama-does-not-batch.md`) found one runtime whose
aggregate throughput was flat from one to four concurrent requests while
time-to-first-token climbed to 48 seconds, and another that scaled aggregate
roughly three to sevenfold. A single throughput figure presents those two as
comparable Offers. Under load they are not remotely comparable, and the
difference decides whether a Supplier can have a second customer at all.

Three numbers per level, for the same reason: aggregate throughput rises with
concurrency until the machine saturates, per-stream decode falls as concurrency
climbs, and time-to-first-token rises under queueing. Flat aggregate with rising
TTFT is **queueing**; falling aggregate is **contention**. Those want different
responses, so they are recorded as different verdicts rather than one number.

**Twenty seconds of decode.** The same prototype run produced two results that
cannot both be true: per-stream decode appeared to *rise* with concurrency,
which batching alone does not explain, and one model's aggregate scaling
exceeded the ceiling four-way parallelism allows. Both point the same way — the
single-request sample was understating, most likely a single short stream never
getting the GPU fully busy. The direction of every finding was unambiguous, but
the single-request absolutes were a floor rather than a rate.

Twenty seconds is where those numbers stopped moving. Rather than assert that
every sample achieves it, each sample publishes the decode window it actually
got, so a consumer can see a floor for what it is.

**A 300 second budget, and a cooldown.** Sampling happens on a machine whose
purpose is to earn, so it is bounded: levels run sequentially with a gap, and a
Model slow enough to exhaust the budget publishes the levels it managed with the
shortfall recorded. Requested concurrency is clamped at 8 — an operator chooses
where to sample, not how hard.

**Cold start is measured too.** On-demand model loads were observed at 14–28
seconds, which is the entire difference between dispatching to a warm Offer and
a sleeping one, and it was previously unpriced. It is measured as *first touch*
— the first request of a probe run, before anything else has loaded the Model —
and flagged as such, because a runtime that already had the Model resident
reports a warm number and pretending otherwise would be worse than saying so.

## What follows

A failed Headroom sample does **not** withhold the Offer. A Model that serves
but whose throughput we could not measure is more useful to Dispatch than a
Model it was never told about; "throughput unknown" is a fact Dispatch can weigh,
and absence is not. The failure is recorded on the Offer.

Managed mode uses the same measurement to check itself: a runtime the table says
batches is confirmed to batch *on this box, at this `--parallel`* before its
Offers are published (ADR 0016). A runtime configured out of its own concurrency
looks exactly like one that never had any.
