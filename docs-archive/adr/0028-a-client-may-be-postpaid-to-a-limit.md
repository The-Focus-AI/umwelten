# 0028 — A Client may be postpaid, to a limit it was given

Status: Accepted
Date: 2026-08-08

Updated by ADR 0036: self-service Clients may receive a deployment-configured
default limit. That default is zero unless the operator explicitly accepts
postpaid exposure.

A Client has a **credit limit**. Its Balance may go negative down to that limit,
and what it owes is what you invoice. A limit of zero is prepaid — the behaviour
that exists today.

## Why prepaid alone was wrong

The built behaviour refuses a request the moment a Balance reaches zero. That is
how a prepaid card works, and it contradicts everything else about how a Client
comes to exist here: onboarded by contract, not signup (ADR 0012), a commercial
relationship that already exists, invoiced monthly.

A contracted Client that forgets to top up going dark mid-afternoon is not
prudent, it is a support incident of our own making.

Prepaid was never chosen. It fell out of "a Balance is a sum of ledger entries,
refuse when it cannot cover the charge", which is correct arithmetic and an
unexamined policy.

## Where the limit applies, and where it does not

Only to a **Client's own** Balance.

A charge falls through End User → Application → Client, stopping at the first
owner that has ever had a ledger entry. That chain already carries a meaning:
**granting an End User anything opts it into being capped at that amount**, and
it stays capped once spent rather than falling back to the pool.

The credit limit must not undo that. So:

- Resolved to an **End User** or **Application** balance → hard stop at zero.
  That is a cap, and a cap that can be exceeded is not one.
- Resolved to the **Client** → may go negative to the limit.

Which reads correctly in both directions: caps are ceilings you set for someone
else; the limit is trust you extend to the party you have a contract with.

## What it does not do

**It is not a line of credit that grows.** The limit is set by the operator, per
Client, and changing it is a deliberate act — the same posture as granting a
Guarantee, and for the same reason: the operator is the one carrying the risk.

**It does not remove the refusal.** A Client past its limit is refused exactly
as before. The limit moves where the wall is; it does not remove the wall.

**It does not decide when you invoice.** Cadence is an operational choice; the
Balance accrues continuously and a negative Balance is the amount owed at any
moment you care to look.

## Consequences

- `Client` gains `creditLimitMicroDollars`, defaulting to 0 — so existing
  Clients keep exactly the behaviour they have.
- `Balances.canCover` takes the applicable floor rather than assuming zero.
- The floor is derived from the resolved owner, not from the caller, which is
  what keeps a capped End User capped.
- A negative Balance is a normal state for a postpaid Client, so anything
  reporting balances has to render one without looking like a bug — including
  `mycel balance` and the Client surface (ADR 0026).
- Collections is a business problem this makes possible. A limit set larger than
  you are willing to lose is a decision, and the ADR cannot make it for you.
