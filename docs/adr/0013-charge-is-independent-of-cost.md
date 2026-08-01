# 0013 — Charge is recorded independently of Cost

Status: Accepted
Date: 2026-07-26

Every request through the exchange records two numbers: **Cost**, what the
Supplier is actually owed, and **Charge**, what we debit from a Balance. They
are deliberately unrelated. Hardware we own has a Cost of zero and a Charge we
choose.

## Why

A GPU in the office is free in dollars and scarce in capacity. If Charge tracked
Cost, requests to owned hardware would burn nothing, "how much free use does a
new signup get" would have no expressible answer, and the box would be
overwhelmed by traffic the ledger considered costless. Pricing owned capacity
synthetically means one Balance, in one denomination, rations everything.

It also makes price the **routing lever**: making local capacity ten times
cheaper than a commercial vendor is how traffic prefers hardware we already
paid for.

## Consequences

The Balance is not the amount of real money owed to anyone. Every report must
be explicit about which column it reads — Client invoices come from Cost,
End User balances from Charge. Getting this wrong bills a customer for GPU time
we never paid for.

A Balance is a long-run control and will not protect a saturated box: someone
with credit remaining can still fire enough concurrent requests to wedge it, and
will only stop once the money runs out, long after the box is unusable. Burst
protection is a separate mechanism — concurrency caps and queue depth enforced
at admission. Money answers "how much may you consume this month"; concurrency
answers "how much may you consume right now."

There is one denomination and it is dollars. Product-facing units — "five free
hairstyles" — are a display concern, not an accounting primitive.
