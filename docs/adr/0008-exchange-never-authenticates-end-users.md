# 0008 — The exchange never authenticates End Users

Status: Accepted
Date: 2026-07-26

Applications hold a signing key and mint a short-lived JWT per request whose
`sub` is their own end-user identifier. The exchange verifies the signature via
JWKS and reads `sub`. It has no login, no password, no session, and no account
recovery. Balances are keyed on `(Application, sub)`.

This is deliberately the same mechanism ADR 0003 established for the habitat A2A
surface, where the SaaS mints per-request user-signed grants and the container
holds no shared secret. One identity, asserted once, read in two places — rather
than a second identity system inside the same repo.

## Consequences

The key roll-up falls out for free: aggregate by Application for a Client
invoice, or read one `(Application, sub)` row for a per-user balance. Identifiers
from different Applications cannot collide.

**An Application can mint End Users at will.** The exchange cannot distinguish a
real person from a fabricated `sub` — only the Application can. So a signup grant
funded by the exchange is a standing invitation to farm it. Grants must therefore
be drawn from the owning Client's Balance, making abuse of an Application's
signup flow that Client's cost and that Client's problem to solve.

Had we authenticated End Users directly, we would own signup, login, password
reset, email verification, and account recovery for every Application, forever.
