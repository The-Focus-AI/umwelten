# 0036 — Mycel Clients onboard themselves

Status: Accepted
Date: 2026-09-01

A person may create a Mycel account, establish one Client, create Applications,
and issue or rotate their own Application credentials without an operator.
Supplier membership remains closed.

## Why the boundary changed

ADR 0026 deliberately introduced a Client-scoped surface as read-only because
the first Clients were expected to arrive through contracts. That makes the
Exchange inspectable, but not adoptable: every trial still waits for someone
with shell and database access to create records and relay a credential.

Self-service demand does not weaken the reason supply is closed in ADR 0012.
Creating an Application grants no Guarantee and admits no machine to Dispatch.
It only creates an authenticated buyer identity. The Exchange still decides
which known Suppliers may serve it.

## Identity and ownership

Mycel has its own Clerk application, separate from the habitats SaaS. A verified
Clerk `sub` maps to exactly one Client. A Client has one owner and may have
member operators. The mapping comes only from the verified session token, never
from a request body. Every read and mutation resolves through that mapping
before touching Client data.

Team membership belongs to Mycel rather than Clerk Organizations. An owner may
mint a seven-day, one-use invitation whose bearer value is returned once and
stored only as a SHA-256 hash. A signed-in recipient consumes it to create their
own subject mapping. Members cannot invite or remove operators; the owner cannot
be removed through self-service. This preserves STD-009's product boundary
without making an identity-provider Organization the Exchange's Client model.

The API verifies the Clerk issuer and the token's authorized party. Missing
runtime auth configuration disables the customer control plane rather than
accepting an incompletely verified token.

## Credentials and money

An Application credential is returned once. Mycel stores only its SHA-256 hash;
rotation invalidates the old key immediately and there is no recovery endpoint.
A customer may explicitly revoke the credential or disable and re-enable the
Application. Applications are not deleted: their usage and ledger history must
remain attributable.

Signup is not a grant of upstream spend. A self-service Client gets a
deployment-configured postpaid limit whose safe default is zero. Raising that
default is an explicit acceptance of financial exposure under ADR 0028, not a
side effect of enabling signup.

Prepaid funding is an append-only positive Client ledger entry. Stripe Checkout
is only available when a secret API key, a distinct webhook signing secret, and
the public redirect origin are configured together. The webhook is verified
against its unmodified request body with a five-minute timestamp tolerance.
Each provider event is persisted before credit and may affect the ledger at most
once. A completed Checkout page is never itself evidence of payment.

With Stripe unconfigured, funding fails closed and the console says so. Test and
live endpoints have different secrets and are intentionally separate operator
rollouts.

## Consequences

- The Client surface is now a customer control plane, not only a report.
- A Client operator can see only customer-safe usage: retail charge is visible;
  Supplier identity, wholesale cost, and credential hashes are not.
- Application count is bounded per Client to constrain accidental or abusive
  growth. Supplier registration, pricing, Guarantees, grants, and enablement
  remain operator-only.
- The dedicated `/account` console shows the Client balance, the entries that
  sum to it, recent usage, Applications, and team membership. `/` remains the
  public landing page.
- `/account/` is a trusted `@umwelten/substrate` assembly: authentication,
  customer state, and layout are providers; overview, Applications, funding,
  ledger, usage, and team are independently mounted components. The account
  manifest does not admit agent-authored components. Their provider-free
  `/shell/` assembly therefore remains read-only while trusted account
  components can call the authenticated customer control plane.
- Clerk browser dependencies remain in the isolated `apps/mycel-client`
  workspace. Its compiled authentication provider participates in the account
  assembly without bringing Clerk into the root workspace. The Exchange uses
  `jose` for token verification.
- ADR 0026's read-only limitation and ADR 0028's operator-only limit assignment
  are superseded by this decision. Their trust and accounting boundaries remain.
