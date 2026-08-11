# Exchange

The exchange buys model tokens wholesale from Suppliers and resells them retail
to Applications. Its job is to decide which Supplier serves a given request,
meter what that request consumed, debit the buyer, and credit the Supplier.

## Language

### Supply

**Supplier**:
A party that produces model tokens for the exchange — hardware the operator
owns, a partner's on-premise machine, or a commercial vendor.
_Avoid_: Provider (means an Umwelten vendor integration), factory, host, node, worker

**Connection**:
The persistent channel a machine Supplier holds open to the exchange, dialled
outbound and never accepted inbound. Its existence *is* that Supplier's
availability — connected is available, disconnected is withdrawn — replacing an
availability inferred from silence. Work is pushed down it and tokens stream
back up (ADR 0023 — machine Suppliers dial in).
_Avoid_: session (means a Source Session elsewhere in umwelten), channel (means a
chat channel in habitat), tunnel (the thing this exists to not need), link, socket

**Guarantee**:
A promise about the conditions under which a Supplier produces tokens, such as
staying on-premise or not being trained on. Asserted by the operator, who is
liable for it, rather than self-declared by the Supplier. On hardware the
operator does not own it rests on a contract with that Supplier, enforced after
the fact rather than prevented (ADR 0029 — Mycel sells as principal).
_Avoid_: Capability, policy, SLA, tag

**Headroom**:
A Supplier's capacity to accept more work right now. Always measured, never
declared, and never one number: aggregate throughput, per-stream decode rate and
time to first token, at more than one concurrency level, because a flat
aggregate with rising time-to-first-token means *queueing* while a falling
aggregate means *contention* and one figure cannot tell them apart. Sampled to a
published policy (ADR 0021 — headroom sampling policy).
_Avoid_: capacity, availability, load, SLA, throughput (singular)

**Model**:
The named thing a buyer asks for, independent of who produces its tokens.
_Avoid_: deployment, variant, endpoint

**Offer**:
A commitment by one Supplier to serve one Model, carrying its own prices and its
own Capabilities.
_Avoid_: listing, endpoint, deployment, model entry

**Capability**:
Something an Offer can do, such as tool calling or a context length. Belongs to
the Offer rather than the Model, because it is a property of the whole serving
path — client integration, runtime, build, quantization, and weights together.
_Avoid_: feature, Guarantee, capacity

**Serving Mode**:
Whether a Supplier controls the runtime behind an Offer (*managed*) or resells a
runtime it does not control (*adapted*). Only managed Offers can commit to
capability and resource properties.
_Avoid_: mode, tier, hosting, deployment

**Dispatch**:
The choice of which Offer serves one request.
_Avoid_: routing, scheduling, load balancing, proxying

### Demand

**Client**:
An organization invoiced for the usage of the Applications it owns.
_Avoid_: customer, tenant, account, org

**Application**:
A product built on the exchange. Holds a signing key, a set of permitted Offers,
and a Balance.
_Avoid_: project, app, service, tenant

**End User**:
A person using an Application, known to the exchange only through a claim that
Application signs.
_Avoid_: user, customer, account, subject

### Money

**Balance**:
What a Client, an Application, or an End User has left to spend — negative when
it has spent more than it holds, which only a Credit Limit permits. Always the
sum of its ledger entries, never a stored total.
_Avoid_: credits, wallet, quota

**Credit Limit**:
How far a Client's Balance may go negative before the exchange refuses it. Set
by the operator, per Client; zero means prepaid. Applies only to a Client's own
Balance, never to an Application's or an End User's, because granting one of
those an amount is how you cap it (ADR 0028 — a Client may be postpaid).
_Avoid_: credit line, overdraft, allowance, quota

**Cost**:
What a Supplier is owed for a request. Zero when the operator owns the hardware.
_Avoid_: Charge, price, spend

**Charge**:
What the exchange debits from a Balance for a request. Set independently of Cost.
_Avoid_: Cost, price, rate

**Settlement**:
Periodic reconciliation of what each Supplier is owed for the requests it served.
_Avoid_: payout, invoice, billing

## Relationships

- A **Client** owns one or more **Applications**; only a Client is invoiced
- An **Application** knows an **End User** only through a claim it signs
- A **Supplier** publishes zero or more **Offers**; an **Offer** serves exactly
  one **Model**, and one Model is served by many Offers
- A **Guarantee** belongs to a **Supplier**; a **Capability** belongs to an
  **Offer** — which is why two Offers for one Model are not interchangeable
- **Dispatch** chooses exactly one **Offer** per request
- One request produces exactly one **Cost** and one **Charge**, and neither is
  computed from the other
- A **Balance** is held by a Client, an Application, or an End User; a Charge
  falls to the first of those three that has ever had an entry
- A **Credit Limit** belongs to a **Client** and applies only to that Client's
  own Balance
- **Settlement** aggregates **Costs** by Supplier, never **Charges**

## Example dialogue

> **Dev:** "An **End User** with an empty **Balance** makes a request. Do we
> refuse it?"
>
> **Domain expert:** "Depends why it's empty. If you granted them $5 and they
> spent it, yes — granting is how you cap someone. If they were never granted
> anything, they have no Balance at all and the **Charge** falls through to the
> **Application**, then to the **Client**."
>
> **Dev:** "And the Client is out of money too?"
>
> **Domain expert:** "Then it depends on its **Credit Limit**. A Client can go
> negative, because we have a contract with it. The End User can't, because a
> cap you can exceed isn't a cap."
>
> **Dev:** "The Supplier's **Offer** costs us nothing — it's our own hardware.
> So the Charge is zero?"
>
> **Domain expert:** "No. **Cost** is what the Supplier is owed; **Charge** is
> what we debit. Ours being free is our margin, not the buyer's discount."

## Flagged ambiguities

- "user" was used for both the operator and the person using an **Application**
  — resolved: the latter is an **End User**, and "user" is never used bare.
- "**Guarantee**" was ambiguous between a promise the Supplier makes and one we
  make — resolved: the operator asserts it and is liable for it, backed by
  contract on hardware we do not own (ADR 0029).
- "aborted" was used for any truncated stream, which conflated a buyer hanging
  up with a Supplier dropping — resolved: four distinct outcomes, because only
  one of them is the buyer's own doing and only one of them is our fault.
- "**Headroom**" is capacity measured at probe time, never current utilization.
  Nothing in the system reads what a machine is doing right now.
