# 0025 — The Exchange bears the cost of its own supply failures

Status: Accepted
Date: 2026-08-08

When a response is truncated because a **Supplier** failed — the connection
dropped mid-stream, the runtime died, the upstream returned an error partway —
the buyer is **charged nothing** for that request.

The Supplier is still credited its `Cost` for the tokens it produced. The
difference is the Exchange's loss.

## Why the buyer does not pay

**The buyer did not choose the Supplier. We did.** Dispatch is the Exchange's
decision — it weighs Guarantees, Capabilities and price and picks one (see
`dispatch.ts`). Charging the buyer when that choice fails is charging them for a
decision they were not party to and cannot inspect.

It also produces the wrong incentive on our side. If a flaky Supplier's failures
are billed to buyers, the flakiness is invisible in our own numbers — it shows
up as slightly unhappy customers and unchanged margin. If we absorb it, a
Supplier that drops streams becomes **directly expensive**, visible in the gap
between Charge and Cost, and the pressure to stop routing there lands where the
routing decision is made.

## Why the Supplier is still paid

It produced the tokens. Whether the buyer received them is a question about our
transport and our Dispatch, not about whether work happened. Docking a Supplier
for a network failure between us and the buyer would make earnings depend on
conditions the Supplier cannot see or control, which is the fastest way to lose
the ones you want.

## The distinction that carries the weight

**A buyer who cancels is charged for what was delivered. A Supplier that drops
is not billed to the buyer at all.**

Both produce a truncated stream, and when this was written they looked identical
in the code: the `aborted` flag on a `RequestRecord` was set only by
`req.on("aborted")` and `res.on("close")` — buyer disconnect. There was no
signal for "upstream died mid-stream", so that path recorded a normal completion
and charged for it.

So this ADR creates work rather than describing behaviour:

1. ~~The relay must distinguish a buyer-initiated abort from a supply-side
   failure, and record which.~~ **Done.** `RequestRecord.aborted` is replaced by
   `outcome`: `completed`, `buyer-aborted`, `supply-failed`, `credit-exhausted`,
   settled first-cause-wins so a caller who hangs up and then trips the read
   loop is not recorded as a supply failure.
2. The charge path must skip the debit on the second. **Not done, deliberately.**
   Every outcome is still debited. The distinction is recorded before it is
   acted on, so the numbers exist to say what this rule will cost before it
   starts costing it.
3. The credit to the Supplier (ADR 0024) must happen regardless.

Splitting 1 from 2 is the point rather than a shortcut: a rule that moves money
should be turned on against a population of real records, not on the same day
the records start being kept.

The asymmetry is deliberate and worth stating plainly: **the party who made the
choice bears its consequences.** A buyer who hangs up chose to; we who picked
the Supplier chose that.

## Scope

This covers failures *of supply*. It does not cover:

- **A buyer sending a bad request.** A 400 is charged nothing because nothing
  was produced, not because of this rule.
- **A model producing a bad answer.** Quality is not a failure mode the Exchange
  can detect, and pretending otherwise would make every refund a judgement call.
- **An Offer that was slow but completed.** Headroom is published so a buyer can
  see what it is dispatching into (ADR 0021); slowness is information, not a
  fault.

## Consequences

- Margin becomes an honest number: it already excludes what we chose to eat.
- A Supplier with a high drop rate is visible as a widening Cost-without-Charge
  line, which is a better signal than a support ticket.
- Retrying elsewhere before the first token reaches the buyer stays open as a
  future improvement — it converts a loss into a slower success. After the first
  token it is impossible, and this rule is what makes that case survivable
  rather than contentious.
