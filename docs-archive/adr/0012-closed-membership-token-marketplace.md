# 0012 — The exchange is a marketplace in its model, closed in its membership

Status: Accepted
Date: 2026-07-26

We are building an exchange that buys model tokens wholesale and resells them
retail (`packages/mycel/CONTEXT.md`). It is modelled as a two-sided
marketplace — **Supplier**, **Offer**, **Dispatch**, **Settlement** are all
first-class — but becoming a Supplier requires our explicit consent. We are
Supplier #1, renting to ourselves, and no code knows that.

## Considered options

An open supply side, where anyone can list a GPU, is what makes Vast.ai and
RunPod cheap: a long tail of strangers bidding each other down. We rejected it
for three reasons, in increasing order of importance.

Payouts, reputation, and fraud are each a quarter of work — bank details, tax
withholding, dispute handling, the 1–3 week ramp-up every marketplace uses to
statistically discover whether a new supplier is honest. A closed network
replaces all of it with a contract.

More seriously, **guarantees are unenforceable against strangers**. We cannot
verify that a supplier ran the model it claimed rather than a cheaper
quantization, and we cannot stop it logging prompts. The DePIN networks have
spent years on this and settled for reputation plus redundant sampling. Since
the exchange is a reseller, every Guarantee it passes through is one *it* is
liable for — so we can only sell guarantees we can personally stand behind.

Concretely: an application that sends users' photographs to an image model
cannot have them land on an unnamed stranger's gaming PC.

## Consequences

We forgo the price pressure of an open long tail. The exchange is a broker for
a handful of known boxes, which is a smaller business than a public
marketplace — and the one where we can name every machine that touches a user's
data.

Because the domain is marketplace-shaped from the start, opening membership
later is a policy change rather than a rewrite.

## Related

Unifies with the decision that upstream vendors and owned hardware are the same
concept: Google is a Supplier with a published wholesale price we cannot
negotiate; the DGX is a Supplier whose price we set. One Offer table, one
Dispatch decision, so overflow from a saturated on-prem box to a commercial
vendor is ordinary routing rather than a special case.
