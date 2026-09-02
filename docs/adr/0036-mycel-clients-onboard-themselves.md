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
Clerk `sub` maps to exactly one Client. The mapping comes only from the verified
session token, never from a request body. Every read, Application creation, and
credential rotation resolves through that mapping before touching Client data.

The API verifies the Clerk issuer and the token's authorized party. Missing
runtime auth configuration disables the customer control plane rather than
accepting an incompletely verified token.

## Credentials and money

An Application credential is returned once. Mycel stores only its SHA-256 hash;
rotation invalidates the old key immediately and there is no recovery endpoint.

Signup is not a grant of upstream spend. A self-service Client gets a
deployment-configured postpaid limit whose safe default is zero. Raising that
default is an explicit acceptance of financial exposure under ADR 0028, not a
side effect of enabling signup.

## Consequences

- The Client surface is now a customer control plane, not only a report.
- A Client operator can see only customer-safe usage: retail charge is visible;
  Supplier identity, wholesale cost, and credential hashes are not.
- Application count is bounded per Client to constrain accidental or abusive
  growth. Supplier registration, pricing, Guarantees, grants, and enablement
  remain operator-only.
- Clerk browser dependencies remain in the isolated `apps/mycel-client`
  workspace. The Exchange runtime receives only compiled static assets and uses
  `jose` for token verification.
- ADR 0026's read-only limitation and ADR 0028's operator-only limit assignment
  are superseded by this decision. Their trust and accounting boundaries remain.
