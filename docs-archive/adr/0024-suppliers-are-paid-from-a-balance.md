# 0024 — A Supplier is paid from a Balance, like everyone else

Status: Accepted — designed, not built
Date: 2026-08-08

A Supplier accrues earnings in a **Balance**, using the same append-only ledger
that already tracks what buyers owe. Every served request credits the Supplier's
Balance by its `Cost`. A payout is a debit against that Balance.

Nothing here is built. It is designed now so that the dial-in protocol
(ADR 0023) and the ledger are shaped for it, rather than being retrofitted
around a payout mechanism invented later.

## Why a Balance rather than a payouts table

The ledger already does exactly this job on the demand side: append-only, never
a stored total, every entry traceable to the request that caused it (ADR 0013,
and the Balance definition in `packages/mycel/CONTEXT.md`). A Supplier's
earnings have the same requirements — reconstructable, disputable, and
auditable — so a second mechanism would be a second thing to get wrong.

Concretely: `BalanceOwnerKind` gains `"supplier"`. Everything else already
exists.

The symmetry is the point. "What are we owed" and "what do we owe" become the
same query against the same table, which is what makes a margin number
believable.

## What we owe is what we measured

ADR 0017 has the Exchange meter at its own boundary rather than trusting an
upstream's usage report. The same argument runs the other way: **a Supplier is
owed for what we measured it produce**, not for what it claims.

That is not distrust so much as arithmetic hygiene. We already record
`upstreamPromptTokens` / `upstreamCompletionTokens` alongside our own count
precisely so the two can be compared. A persistent divergence on one Supplier is
a conversation; letting the Supplier's number set the payment would make it an
unnoticed one.

A disputed Cost resolves against the `RequestRecord`, which the ledger entry
references by id.

## What this ADR does not decide

**How dollars actually move.** Bank transfer, Stripe Connect, or a spreadsheet
and an invoice are all compatible with the above, and for a closed pool of a
handful of Suppliers the answer is probably the boring one. The Balance says
what is owed; the rail is an operational choice that can change without the
ledger noticing.

**Cadence.** Monthly, on request, or above a threshold — all expressible as
"when someone runs the payout command." Deferring this costs nothing because the
Balance accrues continuously either way.

**Tax and reporting.** Real, and out of scope until there is a Supplier who is
not us.

## Consequences

- `BalanceOwnerKind` gains `"supplier"`; `supplierOwner(id)` joins the existing
  owner helpers.
- The request path credits the Supplier as part of the same transaction that
  debits the buyer. One request, two entries, one place.
- A payout is `debit(supplierOwner(id), amount, "payout")` — visible in the same
  history as everything else.
- **A Supplier is credited even when the buyer is not charged** (ADR 0025). The
  work was done; who eats the failure is a separate question from who did the
  work.
- Until this is built, `Cost` on a `RequestRecord` is the only record of what is
  owed. That is sufficient to reconstruct every Balance retroactively, which is
  why deferring the build is safe and deferring the *design* was not.
