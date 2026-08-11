# The dial-in protocol

> Status: specified, unbuilt — 2026-08-11. Implementation plan for ADR 0023
> (machine Suppliers dial in). The ADR decides *that* machines dial out and why;
> this decides the parts it left open, and records where it is extended.

A machine Supplier runs one command and becomes dispatchable:

```bash
umwelten supplier serve --mycel https://mycel.thefocus.ai --credential sk-mycel-…
```

No tunnel, no ACL, no DNS, no firewall rule, no address to register. An outbound
WebSocket over 443, held open. Work is pushed down it; tokens stream back up.

## What ADR 0023 already settles

Not re-litigated here: WebSocket rather than long-poll; **push** rather than
pull, because a queue is a component and not a detail; request frames down and
token frames up correlated by request id; multiplexing concurrent requests over
one Connection; reconnect with backoff and half-open detection; a dropped
Connection mid-stream is a truncated response recorded `supply-failed` (ADR
0025) with no buffering, replay or re-dispatch; `Supplier` gains a `kind` of
`agent` or `vendor` and `baseUrl` stays meaningful only for vendors; Dispatch
consults live Connections; the staleness window, agent heartbeat, `offers sync
--watch` and the `mycel-offers` sidecar are removed for agents.

## Decisions this adds

### 1. Offers persist; the Connection is a Dispatch-time filter

"Connected is available; disconnected is withdrawn" reads like Offers should
live and die with the Connection. They must not.

**Correction, found by reading the store rather than assuming it.** An earlier
draft argued Offers must persist or operator pricing would reset to
`DEFAULT_PRICING` on every lid-close. That is wrong: pricing already lives in its
own table keyed on (Supplier, Model), explicitly so it "must outlive the Offer it
applies to, so that a re-probe — or a Model that briefly disappears — does not
silently reset an operator's prices." Prices survive either way.

The decision stands on weaker but sufficient ground: disconnection is routine —
the machine is a laptop and laptops close — and making it a write means database
churn proportional to how flaky someone's wifi is, for information the connection
map already holds. Persisting also keeps `enabled`, granted Guarantees and the
Offer's own record inspectable while a machine is asleep, so an operator can
price a Supplier that is not currently connected.

So `replaceOffers` keeps writing to Postgres, and dispatchability is computed per
request:

```
eligible = offer exists
        && offer.enabled
        && (offer.supplierKind === "vendor" ? not stale : connections.has(offer.supplierId))
```

**`kind` is denormalized onto the Offer**, because `dispatch()` receives
`Offer[]` and no Supplier records. That is not a new pattern — `Offer.guarantees`
already works exactly this way, and says why: "Inherited from the Supplier, never
published by it… an Offer carries a copy so Dispatch can filter without a second
lookup." Dispatch stays a pure function of Offers plus the connection set.

The connection set arrives as a second argument rather than a module import, so
`dispatch()` remains pure and testable without a live socket — the same reason
`staleAfterMs` and `now` are injected today.

Disconnection mutates nothing. It changes what Dispatch will select, which is
the sense of "withdrawn" that matters — nothing routes there, instantly, with no
window to tune.

A new `RejectionReason`, `supplier-disconnected`, sits beside `offer-stale`. The
two are different problems and the `considered` list has to say which.

### 2. Connection state: an append-only log, plus an in-memory map

Two structures, answering different questions, neither redundant:

**`connections` table — append-only.** One row per connect and per disconnect:
supplier id, timestamp, and for disconnects a reason (clean shutdown, transport
error, half-open detected, displaced). It answers *was thor up at 03:00 when
those requests failed*, *how often does that laptop flap*, *what is this
Supplier's real uptime*. It joins to `RequestRecord` — "every request that failed
while thor was disconnected" is one query. Rows about the past stay true.

**An in-memory map — what Dispatch reads.** Empty on boot, which is exactly
correct: nothing is connected, because nothing is.

> **This extends ADR 0023, which says Dispatch must consult live connections
> "rather than a database column".** That instruction is kept — Dispatch reads
> the map, never the table. What is added is the durable record, which a column
> could not have provided anyway: a boolean can only say *now*, and by the time
> anyone asks, now has moved. No current-state column exists, so there is nothing
> to go stale across a restart.

### 3. Agents publish their Offers over the Connection

`POST /suppliers/offers` stays, for vendors only — `mycel offers sync` publishes
on a vendor's behalf and a vendor runs no agent.

Agents send their Offer set in the opening frame. This makes "connected is
available" exact: there is no window in which a Supplier is connected but has not
published, or has published but is not connected. Two mechanisms with independent
timing is how a Supplier ends up believed-in and unreachable.

Reconnect republishes for free. The agent re-probes only when its fingerprint
changes (ADR 0022), so a reconnect costs a cached payload and one `replaceOffers`
write. If flapping ever makes that write amplification worth caring about,
comparing a hash of the published set before writing is the cheap fix — not
built now.

### 4. One Connection per Supplier; the newest displaces the oldest

The forcing scenario: thor sleeps, TCP goes half-open, Mycel still holds a socket
it believes in. Thor wakes and dials again. Two Connections now claim `thor`, one
a corpse indistinguishable from the living one except by age.

On handshake, a new Connection **displaces** any existing one for that Supplier.
The new socket is provably alive — packets just arrived on it — while the old is
only presumed alive. Preferring the provable one needs no timer and no heuristic,
and makes reconnect-after-sleep the normal path rather than a race.

**Displacing kills whatever was in flight on the old Connection.** Those requests
become `supply-failed`, the buyer's stream ends where the tokens stopped, and the
Exchange eats the cost (ADR 0025). That is already the specified behaviour for a
dropped Connection; a displaced one is a dropped one noticed sooner.

Rejected: N Connections per Supplier with load balancing across them. It
multiplies the in-flight accounting for no gain — a box with two GPUs worth
exposing separately is two Supplier registrations, which is the honest modelling.

### 5. In-flight requests are counted, and not capped

Mycel counts in-flight requests per Connection, because under push it is the only
party that can. **It enforces no limit in v1.**

The obvious cap — derive it from the measured saturation verdict, since
`servesConcurrently()` already answers "can this take a second customer" and
nothing calls it — is unsafe today, because the measurement it would rest on is
mis-ranged:

`HEADROOM_POLICY.levels` is `[1, 4]`, clamped by `MAX_SAMPLE_CONCURRENCY = 8`.
Those were set against llama.cpp and Ollama, where the question is whether the
runtime batches at all. **A vLLM box serving 32–64 concurrently is sampled
entirely below its knee**, so its verdict describes a range nobody cares about.
Capping from it would throttle a box that batches beautifully.

The right answer is a limit derived from observed throughput under real load,
which the live count is the prerequisite for. Recorded in the Exchange glossary's
flagged ambiguities; the sampling range needs fixing regardless of dial-in,
because `supplier probe` is wrong on vLLM hardware today.

Until then: count, expose to operators, push freely.

### 6. The agent still probes, and learns vLLM

Dial-in changes how work arrives, not where Capabilities come from. ADR 0015
stands: probed through the serving path, never declared. An agent that forwarded
blind would publish Capabilities nobody verified — the vendor compromise, and
there is no reason to accept it on a box we are running code on.

`discoverRuntimes` currently knows ollama, lmstudio, llamabarn and llamaswap.
vLLM is OpenAI-compatible, so it is the same shape as the existing `lmstudio` and
`llamaswap` providers — a base URL and `/v1/models`. The one new thing is an API
key, which the local providers do not currently take.

## Build order

The money path changes last, against something already proven.

1. **Wire types**, shared as a shape and at most a type — never a shared module.
   `packages/supplier` must not depend on `packages/mycel` (ADR 0023).
2. **Connection registry + `connections` table** in Mycel. Accept, authenticate
   against `getSupplierByCredentialHash`, displace, log, expose.
3. **Agent dials in and publishes.** `supplier serve` opens the socket, sends its
   Offer set, reconnects with backoff. Verifiable end to end against a local
   Mycel with no Dispatch changes at all — the Offers land in Postgres exactly as
   the POST path lands them.
4. **vLLM provider** in core, plus the API-key handling.
5. **Relay over the Connection.** Push a request frame, stream token frames back,
   multiplex by request id.
6. **Dispatch consults the map.** The buyer path changes here and only here.
7. **Delete what this replaces**: agent heartbeat, `--watch`, the staleness
   window for agents, `mycel-offers`.

Steps 1–4 are additive and ship without touching a buyer request. Step 6 is the
one that can break metering, and it arrives after the transport is known good.

## What is still open

- **The capacity limit** (§5) and the sampling range it depends on.
- **ADR 0022's staleness window for vendors** — the ADR suspects it should be
  dropped there too and calls it a separate decision. Unchanged here.
- **Whether a Connection can carry anything other than work** — health, logs,
  metrics. Nothing needs it yet; naming it as deliberately unbuilt so it is not
  assumed.
