# 0023 — Machine Suppliers dial in; the Exchange never dials a machine

Status: Accepted
Date: 2026-08-08

A Supplier that is a **machine** — a DGX on a desk, a laptop, anything someone
owns — opens a persistent connection *to* Mycel and receives work over it. Mycel
never connects to it, and it accepts no inbound connections at all.

A Supplier that is a **commercial vendor** is still dialed out to, because a
public API is reachable by definition.

So there are two supplier transports. That asymmetry is the correction: the
previous design pretended a vendor and a box on a desk were the same kind of
thing, and every problem below came from that.

## What was wrong

The original model gave every Supplier a `baseUrl` that Mycel connects to. For
OpenRouter that is right. For a machine behind NAT it is a requirement that
someone stand up a tunnel, register a stable address, and hand it over before
they can contribute a single token.

Two consequences followed, and neither was noticed as a consequence:

**Onboarding became a network project.** "Install Tailscale, get an ACL, get an
address, tell the operator" is not something a person with a spare Mac Studio
does on a whim. For a pool whose entire premise is other people's idle hardware,
that is the difference between the idea working and not.

**Liveness became unobservable, so it got inferred.** Mycel could not tell
whether a machine was still there, so it inferred it from silence — and that
inference is where a whole subsystem came from:

- a 15-minute staleness window on every Offer (ADR 0022)
- a 5-minute heartbeat republish in the supplier agent
- a `--watch` mode on `offers sync`
- a `mycel-offers` compose service to run that mode for vendors, which have no
  agent to heartbeat for them

Four mechanisms, all answering *"is this supplier alive?"* — a question a held
connection answers by existing. **Connected is available; disconnected is
withdrawn.** Exactly, instantly, with no window to tune and nothing to schedule.

That accumulation was the signal the premise deserved re-examining, and it was
missed for long enough to ship all four.

## Why dial-out is the standard answer

Wherever workers sit behind NAT and the coordinator is public, the workers dial
the coordinator: GitHub's self-hosted runners dial GitHub, `cloudflared` dials
Cloudflare, kubelet dials the API server. None of them ask the operator to make
the worker reachable, because making a worker reachable is the hard part and it
is avoidable.

## What it buys beyond reachability

**Onboarding is one command.** No tunnel, no ACL, no DNS, no firewall rule:

```
umwelten supplier serve --mycel https://mycel.thefocus.ai --credential sk-mycel-…
```

That works from a coffee shop and from behind a corporate proxy, because it is
an outbound WebSocket over 443.

**The privacy guarantee gets stronger.** Under the tunnel design the machine sits
on a private network but still runs a listening service. Under dial-out it
accepts no inbound connections at all — there is nothing to reach, from
anywhere. An on-premise Guarantee (ADR 0012, which the operator is liable for)
is easier to defend when the honest description is "that machine is not
addressable."

**Four mechanisms delete.** Staleness window, heartbeat, `--watch`, sidecar. The
Offer expiry that ADR 0022 specifies remains meaningful only for vendor
Suppliers, where it is also unnecessary — a vendor with an SLA and a status page
does not vanish the way a NAT'd box does.

## The connection is a request channel, not a work queue

Mycel **pushes**. A request frame goes down the socket, token frames come back
up, correlated by request id. The machine does not ask for work.

The alternative was a pull model — the machine reports "I can take two more" and
Mycel hands work down as slots free. It was rejected despite being the better
answer to backpressure, because a queue is a component and not a detail: depth,
timeouts, an ordering policy, and a buyer's request that can now sit waiting on
a machine that never asks. Push keeps the relay doing what it already does —
dispatch picks an Offer and forwards — and leaves one hop between buyer and
tokens.

**The cost is precise, and it is not small.** Mycel must decide for itself what
a machine can take, and the only thing it knows is Headroom, which is a
measurement from probe time rather than a reading of now (ADR 0027 says this
about scoring; it applies with more force here, because a wrong score picks a
slower Offer while a wrong capacity estimate pushes a fifth request at a box
that serves four). Nothing in this ADR closes that gap. What the held connection
does give us is the *ability* to close it later — in-flight requests per machine
are countable by Mycel because Mycel issued every one of them, which is strictly
more than the probe-time inference available today.

## What it costs

**Protocol work.** WebSocket: request framing, response streaming back
token-by-token, multiplexing concurrent requests over one connection, reconnect
with backoff, half-open detection. Days, not hours, and all of it is code we own
rather than configuration we describe.

**A dropped connection mid-stream is a truncated response, and nothing more.**
No buffering, no replay, no re-dispatch: the buyer's stream ends where the
tokens stopped and the request is recorded `supply-failed` (ADR 0025). This is
the routine case rather than the exceptional one — the machine is a laptop and
laptops close — and it is accepted rather than engineered around, because both
alternatives cost more than the failure does. Re-serving from the top pays for
one sale twice; resuming from a prefix seams at the join and is not supported
across runtimes at all.

**Mycel becomes connection-stateful.** It must know which Suppliers are
connected right now, and Dispatch must consult that rather than a database
column. At this scale — a handful of machines — that is a map in memory, and it
replaces a database round trip rather than adding one.

**Two transports to maintain.** Accepted, and named: `Supplier.kind` is `agent`
or `vendor`, and the difference is real rather than incidental.

## Sequencing, and a reversal

The first recommendation here was: Tailscale for stage 2 now, dial-out later,
on the reasoning that Tailscale is zero code and running it would teach us what
the protocol needs to carry.

**That was wrong, and it was wrong in the same way the original design was.**

What Tailscale would prove — that Mycel can relay to a remote GPU — is not
seriously in doubt; it is the same relay path that already works for a
commercial vendor. What is unproven is the protocol, and a tunnel derisks none
of it. Meanwhile the staged version means building stage 2 twice and keeping
four pieces of doomed machinery alive in between.

So: **dial-out first.** Tailscale remains a legitimate fallback for a machine
that cannot run the agent, and nothing here forbids it.

## Consequences

- `Supplier` gains a `kind`. `baseUrl` becomes meaningful only for vendors.
- Dispatch consults live connections for agent Suppliers.
- ADR 0022's staleness window narrows to vendors, and should probably be
  dropped there too — a separate decision.
- The supplier agent's heartbeat, `offers sync --watch`, and the `mycel-offers`
  compose service are removed once dial-out lands.
- Mycel tracks in-flight requests per connected machine, because under push it
  is the only party that can. Whether it *refuses* to exceed a number, and what
  that number is, is left open — probe-time Headroom is a poor basis for it and
  a live count is the better one, once there is a live count.
- `packages/supplier` still must not depend on `packages/mycel`: the wire
  protocol is a shared shape, and a shared *type* at most, never a shared
  database driver.
