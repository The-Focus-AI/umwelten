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
liable for it, rather than self-declared by the Supplier.
_Avoid_: Capability, policy, SLA, tag

**Headroom**:
A Supplier's capacity to accept more work right now. Always measured, never
declared.
_Avoid_: capacity, availability, load, SLA

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
Money available to be spent, held by a Client, an Application, or an End User.
_Avoid_: credits, wallet, quota

**Cost**:
What a Supplier is owed for a request. Zero when the operator owns the hardware.
_Avoid_: Charge, price, spend

**Charge**:
What the exchange debits from a Balance for a request. Set independently of Cost.
_Avoid_: Cost, price, rate

**Settlement**:
Periodic reconciliation of what each Supplier is owed for the requests it served.
_Avoid_: payout, invoice, billing
