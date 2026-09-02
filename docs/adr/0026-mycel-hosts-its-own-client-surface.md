# 0026 — Mycel hosts its own Client surface

Status: Accepted
Date: 2026-08-08

Updated by ADR 0036: the surface is no longer read-only or limited to
operator-onboarded Clients.

A Client can see its own usage, spend, per-End-User breakdown and Balance, on a
surface **Mycel serves itself** — not in the habitats SaaS.

## Why not the SaaS

It was proposed, and it was wrong for the same reason every other Mycel boundary
is drawn where it is.

Mycel already has its own Neon project, its own deploy cadence, its own fnox
scope, its own hostname, and its own bounded context with its own glossary. Each
of those was argued on the grounds that Mycel is a different thing from the
habitat fleet — a different business, a different blast radius, a different set
of people. Then hanging its customer-facing surface off the SaaS would have
undone all of it in one move.

More concretely: **a Client is not a habitat user.** A company building a
hairstyle app has no relationship with the habitats fleet, no reason to hold an
account in its identity system, and no business appearing in its user table.
Putting them there couples two products that should be sellable, priceable and
retirable independently — and puts Mycel's customers inside the identity system
that fronts our own infrastructure.

## This is not the admin API that was refused

`packages/mycel/src/command.ts` records why there is no HTTP admin API: those
operations move money and grant eligibility for traffic the operator is liable
for, so a CLI on the box is a smaller surface than a route.

None of that applies here. The Client surface is **read-only**. It moves no
money, grants no eligibility, and changes no configuration. The argument that
killed the admin routes was about consequence, not about HTTP.

## A third kind of identity, and why it does not contradict ADR 0014

ADR 0014 says the Exchange never authenticates **End Users** — no login, no
password reset, no account recovery — because owning that for every Application
forever is a business nobody wants.

A Client operator logging in to see an invoice is a different party. There are a
handful of them, they are onboarded by contract (ADR 0012), and they are exactly
the people we already have a commercial relationship with. So Mycel now has
three identities and they should not be confused:

| Who | How they authenticate | Count |
|---|---|---|
| **End User** | never — asserted by the Application | unbounded |
| **Application** | JWKS, or a hashed static credential | a few per Client |
| **Client operator** | logs in to the Client surface | a handful, total |

The bound on the third row is what makes it safe. If it ever stops being a
handful, this ADR needs revisiting rather than scaling.

## What it shows

Usage by Application and by End User, spend against Balance, the ledger entries
that sum to it, and which Models were served by which Supplier — everything
`mycel balance` and the `RequestRecord` table already hold, rendered for someone
who is not going to ssh anywhere.

Deliberately not shown: **which Supplier served a request**, unless a Guarantee
made it relevant. A Client buys tokens meeting a specification; our supply
arrangements are ours, and exposing them invites a conversation about paying
wholesale.

## Consequences

- Mycel grows a read-only, Client-scoped HTTP surface. Scoped means a Client can
  only ever see its own Applications — the enforcement is not a UI concern.
- Client operator login is a new mechanism to choose and build. Its own auth,
  not the SaaS's.
- The read surface can be added before the UI, and the UI can be as small as a
  single page. Neither blocks stage 1.
- `mycel balance` stays. The CLI is still the operator's tool; this is the
  Client's.
