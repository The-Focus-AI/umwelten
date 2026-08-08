# 0029 — Mycel sells as principal, and warrants Guarantees on contract

Status: Accepted
Date: 2026-08-08

Mycel buys tokens from Suppliers and resells them **as its own**. A buyer's
counterparty is always Mycel, never the Supplier that happened to serve the
request. Mycel is a principal, not a broker.

A **Guarantee** on a third-party machine is warranted on the strength of a
contract with that Supplier, enforced commercially — audit rights, indemnity,
removal on breach — and not by any technical control.

## Why this needed writing down

It was already built this way, four times over, and never stated:

- **ADR 0013** — Charge is set independently of Cost. Only a principal can do
  that. A broker's fee is a commission on a price the buyer can see.
- **ADR 0016** — a Guarantee is "asserted by the operator, who is liable for
  it." Liable to whom, backed by what, was left open.
- **ADR 0025** — the Exchange bears the cost of its own supply failures. That is
  a principal absorbing a supplier problem; a broker would pass the breach
  through to the party that breached.
- **ADR 0028** — the operator extends credit to a Client. You do that with your
  own counterparty, not with someone else's.

Four decisions resting on an unstated premise is how the premise ends up being
discovered by contradiction later. The alternative was live: a broker Mycel that
introduces and meters, takes a disclosed commission, and names the serving
Supplier to the buyer. That was rejected, and rejecting it is what makes the four
above coherent rather than merely consistent.

## What being the principal costs

**You are liable for machines you do not own and cannot inspect.** A partner's
box in a partner's office serves a request under your warranty. This is the
whole cost of the position, and it is not reduced by the fact that pooling
third-party hardware is the point of the project.

Three ways to back a Guarantee were on the table:

| Backing | Detection of a breach | Rejected because |
|---|---|---|
| Only your own hardware carries Guarantees | n/a — never at risk | Guaranteed demand is the valuable demand; pooling would scale only the cheap traffic |
| **Contract, enforced commercially** | after the fact, if ever | — chosen |
| The serving path proves it | at serving time | Real work, blocked on ADR 0023, and no Guarantee that isn't network-shaped can be proven this way |

The middle one is chosen with its weakness stated rather than argued away: **a
breach is discovered after the fact, if at all, and the buyer is exposed for the
whole window before it is found.** Nothing in the system detects a Supplier
copying a prompt off a machine it controls.

"Not trained on" makes this plainest. It has no network-level evidence and never
will, so even the strongest technical option would fall back to contract for
that Guarantee. Contract is not a placeholder for a mechanism we intend to
build; for some Guarantees it is the only thing there is.

## What follows for what a Supplier sees

A Supplier sees **what it earned** — its Cost, per request and in aggregate,
which is what it needs to check a Settlement. It does not see the retail price
or the margin. That is not secrecy for its own sake: under a principal model the
retail price is Mycel's own price for its own product, and the Supplier is not a
party to that sale. A broker would have to disclose the commission; a principal
does not have a commission to disclose.

This settles the shape of the parked "Suppliers cannot see their earnings"
problem. The surface is Cost, Settlement, and a served-request history. It is
not a smaller copy of the Client surface (ADR 0026).

## What this does not decide

**It is not a statement about how much risk to accept.** Which Suppliers to
admit, what a Guarantee costs to warrant, and whether a given partner is worth
the exposure are commercial judgements made per Supplier. This ADR fixes who is
answerable, not how brave to be.

**It does not close the door on proof.** When ADR 0023 lands, a machine whose
only route out is its dial-in connection makes "stays on-premise" observable
rather than asserted. That would strengthen a Guarantee already sold on
contract; it is an upgrade to the evidence, not a change of counterparty.

## Consequences

- Guarantee eligibility is not restricted by ownership. A third-party Offer can
  carry Guarantees, so `Supplier.kind` does not gate them and dispatch needs no
  new filter.
- Supplier onboarding acquires a contractual step that the software does not
  model and must not pretend to: nothing in the schema should imply a signed
  agreement exists.
- Audit rights and removal-on-breach need somewhere to live. Withdrawing a
  Supplier's Offers already exists (`OfferSupervisor.withdrawAll`); an operator
  action that disables a Supplier outright does not.
- The buyer-facing surface never names the serving Supplier. Dispatch records
  which Offer served a request for our own answerability (ADR 0027), and that
  record is internal.
