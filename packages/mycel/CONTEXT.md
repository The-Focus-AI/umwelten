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
