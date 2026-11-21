# 0003 — Per-user identity on the habitat A2A surface (replace the shared `HABITAT_API_KEY`)

Status: Accepted (rollout in progress)
Date: 2026-06-17

## Context

The habitat container's A2A surface (and `/api/*`, `/mcp`) authenticates callers with a
single shared secret, `HABITAT_API_KEY` (`container-server.ts:174`, `web/auth/bearer-auth.ts`).
Every caller who presents it becomes the hardcoded `userId: 'bearer-user'`. The A2A handler
then *discards even that* and derives the session/user id from the caller-chosen `contextId`
(`a2a-handler.ts` → `a2a:${contextId}`).

On the caller side (the **habitats** SaaS, `src/workflows/agents/umwelten.ts`):

- the bearer is a static per-attachment secret (`loadBearerToken(orgId, secretIntegrationId)`);
- `contextId` is stored on the **attachment** (`habitat_agents.config.contextId`), so it is
  **one stable contextId per (habitat, agent)** — every user of a habitat shares it.

Net effect: **all users of a habitat collapse into one backend conversation and one identity.**
Two people @mentioning the agent get the same session, the same history, and — once private
per-user tools exist (e.g. Twitter bookmarks) — the same account. This is a structural flaw:
the surface conflates *service-to-service trust* ("may this caller reach the container") with
*user identity* ("on whose behalf"), and then throws the identity away. Per-user attribution,
per-user tokens, and per-user cost tracking are all impossible.

This is the blocker behind the Twitter habitat's single-tenant limitation (PRD #149 scoped
multi-tenant out precisely because of this).

## Decision

Replace the shared `HABITAT_API_KEY` with **per-user signed grants**. The bearer token becomes
a short-lived JWT the SaaS mints **per request, signed for the speaking user**. One mechanism
carries both concerns:

- **Service trust** — the habitat verifies the JWT **signature** (asymmetric: SaaS signs with a
  private key, habitat verifies via JWKS / pinned public key). The habitat holds no shared
  secret and cannot mint tokens.
- **User identity** — the verified `sub` claim **is** the end-user id, used as
  `interaction.userId` and as the key for per-user upstream (e.g. X) tokens.

### Identity model (thread vs speaker)

These are deliberately separate:

- **`contextId` = the thread.** First @mention opens a thread; the SaaS mints a new contextId
  for it, stable for the thread's life. New thread → new contextId. It moves **off the
  attachment** onto the thread.
- **`sub` = the speaker, per message.** Each message is its own A2A request with its own bearer,
  so the JWT's `sub` is whoever spoke *that* message. One contextId, many speakers — identity is
  carried per message for free.

Consequences (the point of the change):

1. **Per-message token resolution.** Within one thread, "show my bookmarks" resolves to the
   *speaking* user's token. Private tools bind to the current speaker each turn, not once per
   session.
2. **Speaker-labeled history.** The shared thread tags who said each turn so the agent can
   disambiguate "my" and address people by name.
3. **Per-turn attribution.** `interaction.userId` is the speaker for that turn; the runner already
   forwards it to providers for per-user cost/abuse analytics.

### `sub` is the SaaS internal `users.id`

Stable, opaque, SaaS-owned (not `clerkUserId`). It is what the habitat keys per-user upstream
tokens by.

### JWT contract

```
Authorization: Bearer <JWT>
  alg: RS256 | ES256        # asymmetric; reject alg:none and HS*
  iss: <habitats SaaS issuer>
  aud: <habitat id / url>   # habitat rejects tokens not minted for it
  sub: <users.id>           # the speaking user
  exp: short (≈5 min)
  name?: <display name>     # optional, for speaker labeling
Verification: JWKS endpoint (preferred) or a pinned public key, configured on the habitat.
```

## Rollout (no broken window in production)

1. **Additive, both sides.** Habitat *accepts* JWTs (new `jwtAuth` verifier) while still accepting
   the legacy `HABITAT_API_KEY`. SaaS *starts minting* per-user JWTs from `runs.invokedByUserId`.
   — _this ADR's first PR delivers the habitat verifier._
2. **Consume the identity.** Habitat threads the verified `sub` end-to-end: kill `'bearer-user'`
   and the `a2a:${contextId}`-as-userId substitution; per-turn `interaction.userId`, per-turn
   private-tool token binding, speaker-labeled history. Session stays keyed by contextId.
3. **SaaS: thread → contextId.** Move contextId off `habitat_agents.config` onto a thread record.
4. **Flip to required.** Habitat *requires* a valid JWT; delete the static-key path. Dev/local
   `habitat serve` keeps an explicit dev-auth fallback only when no verifier is configured.

## What already exists (de-risks the SaaS side)

- `runs.invokedByUserId` (habitats `db/schema.ts:217`) already records the speaking user per run.
- `messages.authorUserId` attributes each message.
- RLS already threads user identity (`db/client.ts` principal `{ orgId, userId }`).
- `jose` is already a habitats dependency (signing) — and is added to `@umwelten/habitat` here
  (verification).

So the speaker is already known at dispatch; the SaaS work is forwarding it, not capturing it.

## Alternatives considered

- **Trusted unsigned header (`X-Habitat-User`).** Simplest, but anyone who reaches the endpoint
  could spoof any user. Rejected — identity must be signed, not asserted.
- **Verify Clerk session tokens directly at the habitat.** Leaks a powerful, browser-scoped
  credential into a background dispatch path; ties the habitat to Clerk. Rejected in favor of the
  SaaS minting a narrow, habitat-scoped token it fully controls.
- **Keep `HABITAT_API_KEY` and add a separate identity field.** Keeps the service/identity split
  as two secrets to manage and two things to get right. The signed-JWT-as-grant collapses them.

## Security requirements

Reject `alg:none` and symmetric algs; enforce `aud` and `exp`; verify signature against JWKS /
pinned key only. Never trust an unsigned identity claim. Short token lifetime.

## Addendum — Gaia (the orchestrator) is on this same path

Gaia is itself a habitat (it runs `container-server` and exposes A2A at
`https://$GAIA_HOSTNAME/a2a`). So when the SaaS provisions habitats by **attaching
Gaia as an agent** and chatting with it (rather than calling a bespoke REST
client), Gaia's caller-identity rides **this exact per-user-JWT path** — the SaaS
mints a JWT (`aud` = Gaia's host) and Gaia verifies it, identical to any child.
The control plane (SaaS→Gaia) and the data plane (SaaS→habitat) therefore share
one auth mechanism; there is no separate "orchestrator auth" to design.

Transitional state (today): exactly as for every habitat — Gaia is reached with
the legacy shared bearer (`HABITAT_API_KEY` / `GAIA_API_KEY`) until the SaaS
starts minting (step 1 SaaS half) and step 4 flips to required.

Note on Gaia's REST control plane (`/api/*`, served by `extraRawHandler`): that
surface is gated by the shared key and is for **direct admin only**. The intended
SaaS→Gaia path is A2A (so it inherits per-user JWT for free); the REST routes are
not the per-user surface and don't need separate JWT work. Deploy Gaia like any
habitat — caddy-fronted, authenticated, never raw on a public port.

(Implemented across umwelten #170/#171/#172/#174/#175; arm64 fix #173. The
multi-tenant **upstream** token follow-on — e.g. per-user X tokens keyed by the
verified `sub` — is tracked in umwelten #176 + habitats #56.)
