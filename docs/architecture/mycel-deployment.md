# Deploying Mycel

> Status: plan — 2026-08-07. The runbook for putting the Exchange
> (`packages/mycel`) into the runtime plane, from nothing to metered traffic.
> Companion to `production-topology.md` (the three planes) and
> `packages/mycel/CONTEXT.md` (the vocabulary).

## What this is for

Stage 1 is deliberately narrow: **Mycel serving one habitat's traffic, bought
from OpenRouter, metered and charged to a balance.** No local GPU, no tunnel, no
new identity system. It proves the money plumbing against traffic that already
works, so a regression is visible.

Each later stage adds exactly one unproven thing:

| Stage | Adds | Blocked on |
|---|---|---|
| **1** | Mycel + OpenRouter Supplier + one habitat buying | Neon project |
| **2** | a local box as a second Supplier | Tailscale + the box |
| **3** | the habitats SaaS as an Application (per-user balances) | stage 1 |
| **4** | a third-party client app in its own repo | stage 3 |

The point of the ordering: stage 1 has no new transport and no new identity, so
when it breaks you know it is the money plumbing. Stage 2 is transport only.
Stage 3 is identity only.

---

## Part 0 — What has to be built first

Stage 1 cannot run today. These are the gaps, smallest first.

| # | Gap | Why it blocks |
|---|---|---|
| 1 | ~~No entrypoint.~~ **Built.** `umwelten mycel serve`. | — |
| 2 | ~~No static-credential auth.~~ **Built.** `sk-mycel-…` + `X-Mycel-End-User`, alongside JWKS. | — |
| 3 | ~~No operator CLI.~~ **Built.** `umwelten mycel client/application/grant/balance/supplier`. | — |
| 4 | **No way to publish a commercial vendor's catalogue.** The supply endpoint takes a Supplier credential and expects an agent. Nothing lists OpenRouter's models as Offers. | No Offers to dispatch to. |
| 5 | **No Dockerfile / compose service.** | Nothing to deploy. |
| 6 | **Port 7450 collides** with Gaia's managed-container range (7440–7499) and with the supplier agent's own runtime default. | Port fight on the host. |

Proposed shape for #2 and #3, since they are design and not just plumbing:

```
umwelten mycel serve                                  # the service
umwelten mycel client create <id> --name "Acme"
umwelten mycel application create <id> --client acme  # prints a credential, once
umwelten mycel application create <id> --client acme --jwks-url https://…
umwelten mycel grant <client|application> <micro-dollars>
umwelten mycel supplier register <id> --base-url … --credential-env OPENROUTER_API_KEY
umwelten mycel offers sync --supplier openrouter --models a,b,c
umwelten mycel status
```

**Static credentials, alongside JWKS, not instead of it.** An Application either
publishes a JWKS (the SaaS already does, per ADR 0003) or holds a credential
stored hashed — the same `credentialHash` pattern Suppliers already use. With a
static credential the End User arrives in a header:

```
Authorization: Bearer sk-mycel-…
X-Mycel-End-User: user-1234
```

This is not the security downgrade it appears to be. **The JWT never
authenticated the End User** — ADR 0014 has Mycel trust the Application's
assertion of `sub` either way. The signature only proves *which Application* is
calling, which a hashed bearer also proves. What the JWT genuinely buys is short
expiry and no spendable secret at rest in Mycel's database, which is why it stays
the recommended path for anyone who can run a JWKS endpoint.

---

## Part 1 — The database

**Neon, its own project, a region in the same metro as the VM.**

The GCE host is `gaia-host`, project `habitats-502314`, `us-east4` — Ashburn.
AWS `us-east-1` is Northern Virginia, the same metro, so a Neon project there
is single-digit milliseconds away.

**Why not Postgres on the VM.** Runbook R5 in `production-topology.md` is "lose
the VM". Today that loses whatever changed since the last snapshot, which for
habitats is session JSONL you can live without. For a money ledger it is
balances you cannot reconstruct. With Neon, Mycel needs **no volume at all** —
which is also the cleanest statement of why it is not a habitat.

**Why its own project, not a database inside the existing one.** Neon's
blast-radius boundary is the project: a leaked connection string reaches its
branches. The existing project holds habitat OAuth tokens; this one holds a
money ledger. Different compromise consequences, and no query spans them.

**Latency, honestly.** A buyer request runs about five queries — application
lookup, offer list, balance check, then the request record and the ledger
append. Three land before the first token. At same-metro latency that is roughly
15 ms added to TTFT on a call measured in seconds.

**Branching pays for itself immediately.** `NeonStore` has never run against
real Postgres. Its concurrency guarantee — insert-and-re-sum in one statement, so
two concurrent requests cannot each see credit only one of them had — is the one
property the memory store structurally cannot exercise. Branch the project, point
`MYCEL_DATABASE_URL` at the branch, run the conformance suite, discard it:

```bash
MYCEL_DATABASE_URL='postgres://…' pnpm vitest run packages/mycel/src/store/neon-store.integration.test.ts
```

Do this **before** first boot. `createExchangeServer` calls `store.setup()` on
start, so the deploy is otherwise the first run of that DDL and of the
`ADD COLUMN IF NOT EXISTS` migration path.

### Checklist

- [ ] Neon project created, separate from the habitats one
- [ ] Region chosen in the Ashburn / N. Virginia metro
- [ ] Connection string in 1Password as `MYCEL_DATABASE_URL`
- [ ] A branch created and the conformance suite run green against it
- [ ] Branch discarded

---

## Part 2 — Which keys

Two different kinds of credential, and conflating them is how upstream keys end
up in a database.

**Upstream keys — what Mycel pays with.** A Supplier record stores the *name of
an environment variable*, never the secret:

```ts
upstreamCredentialEnv: "OPENROUTER_API_KEY"
```

Mycel resolves `process.env[name]` at request time. A database compromise
therefore hands over no key that can spend. For stage 1 the only one needed is
`OPENROUTER_API_KEY` — the same key Gaia already holds for its own chat.

**Whether to reuse Gaia's key or mint a second.** Mint a second. A separate
OpenRouter key for Mycel means its spend is separately visible in OpenRouter's
own dashboard, and revoking one does not take down the other. This matters more
than usual here because Mycel's whole job is metering — having its upstream cost
independently checkable against its own `Cost` records is how you find out the
metering is wrong.

**Downstream credentials — what buyers pay you with.** Issued by
`umwelten mycel application create`, stored hashed, shown once. Never in the
vault, never recoverable; an Application that loses one rotates.

### Checklist

- [ ] A second OpenRouter key minted, labelled for Mycel
- [ ] Stored in 1Password, resolved by fnox as `OPENROUTER_API_KEY`
- [ ] `MYCEL_DATABASE_URL` in the same fnox scope

---

## Part 3 — Secrets and the container

**fnox, with its own scope, not through Gaia.** Gaia is the sole broker for
*habitats*; Mycel is not a habitat, so it resolves its own. The compose command
wraps as `fnox exec -- umwelten mycel serve`, which keeps plaintext out of both
the image and any `.env` on disk, and keeps Gaia's master vault off the money
service's dependency path — the same blast-radius argument as the Neon project.

**Placement: its own compose file, beside Gaia, not inside it.** The whole
argument for Mycel being a peer rather than a Gaia child is *separate deploy
cadence*. Sharing `deploy/gaia/docker-compose.yml` means `docker compose up -d`
for a Gaia change cycles the money service.

```
deploy/mycel/
  docker-compose.yml    # joins gaia-net, caddy label, restart: unless-stopped
  .env.example
  README.md             # start / stop / roll back
```

**Hostname: `mycel.thefocus.ai`, not `mycel.habitats.thefocus.ai`.** The wildcard
would be free, but Mycel is not a habitat and putting it under that wildcard says
it is. One A record at the same static IP; caddy issues the cert from the label.

**Port: 7460.** Outside Gaia's 7440–7499 managed range. The supplier agent's
managed-runtime default moves to 7461 in the same change.

Logging needs nothing: `gcplogs` is the daemon default on that host, so Mycel's
stdout lands in Cloud Logging beside everything else.

### Checklist

- [ ] `deploy/mycel/` written, `docker build` reproducible
- [ ] DNS A record for `mycel.thefocus.ai` → the host's static IP
- [ ] `fnox.toml` scope for Mycel with both secrets
- [ ] `docker compose up -d`, then `curl https://mycel.thefocus.ai/health` → `{"status":"ok"}`

`/health` already reports whether the **store** is reachable, not merely whether
the process is up — a service that answers while its database is gone is worse
than one that does not answer.

---

## Part 4 — Register OpenRouter as a Supplier

A commercial vendor and a box on a desk are the same kind of thing here
(ADR 0012). The difference is only who publishes the Offers: a local machine runs
the agent, and a vendor has its catalogue published on its behalf.

```bash
umwelten mycel supplier register openrouter \
  --display-name "OpenRouter" \
  --base-url https://openrouter.ai/api/v1 \
  --credential-env OPENROUTER_API_KEY \
  --guarantees ""          # a commercial vendor gets none by default

umwelten mycel offers sync --supplier openrouter --models \
  anthropic/claude-sonnet-5,google/gemini-3-flash-preview
```

**Publish a curated list, not the whole catalogue.** Every Offer is a claim about
capabilities, and capabilities are supposed to be *evidence* (ADR 0015). Offers
synced from a vendor's catalogue are the one place that rule bends — nobody
probed them — so keep the set small enough to be honest about, and mark them
`servingMode: adapted`, which is exactly what reselling a runtime you do not
control means.

**Pricing is yours, and independent of cost** (ADR 0013). Retail is the routing
lever:

```bash
umwelten mycel price openrouter anthropic/claude-sonnet-5 \
  --wholesale-prompt 3000000 --wholesale-completion 15000000 \
  --retail-prompt   3600000 --retail-completion  18000000
```

All money is integer micro-dollars. `3000000` is $3.00 per million tokens.

### Checklist

- [ ] Supplier registered, credential stored (it publishes nothing, but rotation needs it)
- [ ] A curated Offer list synced
- [ ] Wholesale set to OpenRouter's real published prices — this is what makes margin checkable
- [ ] Retail set

---

## Part 5 — Onboard the first buyer

Stage 1's buyer is one existing habitat. You are both the Client and the
Application, so there is no billing — this is internal accounting that proves
the meter.

```bash
umwelten mycel client create the-focus-ai --name "The Focus AI"
umwelten mycel application create help-habitat --client the-focus-ai
# → sk-mycel-…   shown once, never recoverable

umwelten mycel grant the-focus-ai 50000000        # $50 of credit
```

Then point the habitat at it — a `secretBindings` change in the Gaia registry:

```
MYCEL_URL      https://mycel.thefocus.ai
MYCEL_API_KEY  sk-mycel-…
```

and set the habitat's model to `mycel:anthropic/claude-sonnet-5`.

**Roll back by pointing it at OpenRouter again.** The habitat's provider is a
config value, so reverting is a registry edit and a restart — no code, no deploy.
Have this rehearsed before you switch it.

### Checklist

- [ ] Client + Application created, credential captured
- [ ] Balance granted
- [ ] One habitat switched
- [ ] Rollback rehearsed once, deliberately

---

## Part 6 — Verify it tracks who did what

The point of the whole exercise. After a handful of turns through the switched
habitat:

```bash
umwelten mycel usage --application help-habitat
```

Each request should show application, subject, supplier, model, prompt and
completion tokens, Cost, and Charge — and the balance should have fallen by the
sum of the Charges.

Three things to check specifically, because each has a plausible failure that
looks like success:

1. **Cost against OpenRouter's own dashboard for the same window.** Mycel meters
   at its own boundary rather than trusting upstream numbers (ADR 0017), so this
   is a genuine cross-check rather than a tautology. Small divergence is
   expected — tokenizer differences — and a large one is a bug.
2. **Charge is independent of Cost** (ADR 0013). A zero-cost Supplier must still
   produce a non-zero Charge; `MINIMUM_CHARGE` exists because a short prompt at a
   low rate otherwise rounds to zero and gets served free.
3. **The balance is a sum, never a stored total.** `SELECT SUM(micro_dollars)`
   over the ledger must equal what the API reports. If it does not, something is
   writing a total somewhere it should not be.

### Checklist

- [ ] Requests appear with the right application and subject
- [ ] Cost reconciles with OpenRouter's dashboard for the window
- [ ] Balance fell by exactly the sum of Charges
- [ ] A request with an empty balance is refused rather than served

---

## Part 7 — Running it

**Deploy a change.** Build, `docker compose up -d mycel`, `curl /health`. It is a
deliberate act — Mycel is *not* cycled by `redeploy.sh`, which is the entire
argument for it being a peer of Gaia rather than a child.

**Roll back.** `docker compose up -d` on the previous image tag. State is in
Neon, so a rollback loses nothing. Keep the previous tag until the new one has
served for a day.

**Stop.** `docker compose stop mycel` — buyers get connection failures, which is
correct: a habitat pointed at Mycel is down when Mycel is down. Point it back at
OpenRouter to un-break it.

**Diagnose.** `/health` first (it reports store reachability). Then Cloud Logging
filtered on the container name. Then the `considered` list on a failed dispatch,
which records every Offer weighed and why each was rejected — "why did this
request go there" is otherwise unanswerable after the fact.

**Watch for:** Offers expiring. Dispatch drops an Offer not republished within 15
minutes (`DEFAULT_STALE_AFTER_MS`). A vendor's synced catalogue has no agent
heartbeating for it, so **a synced Offer set needs re-syncing on that cadence or
its Offers will expire** — the first thing that will surprise you in stage 1, and
the reason `offers sync` should be a scheduled job rather than a one-shot.

---

## Open decisions

- **How an End User gets its first credit.** A charge is drawn from the
  `(Application, subject)` pair, and there is **no fallback** to the Application
  or Client balance — so every End User must be granted before its first
  request, and today nothing does that. This is the unsolved half of "every
  signup gets $10 of credit" (ADR 0014 says the grant must come from the owning
  Client's Balance; it does not say what performs it). Three shapes:
  fall back through end-user → application → client; auto-grant on first sight,
  drawn from the Client; or require an explicit grant and give Applications an
  API to request one. The first makes an unfunded user draw from the pool and a
  *funded* user capped at their funding, which reads closest to what a per-user
  allowance is for — but it is a billing-semantics decision, not a code detail.
- **The Neon project** — create it, hand over the connection string.
- **Reachability for a local box** (stage 2). Mycel dials `Supplier.baseUrl`; a
  machine behind NAT has no URL. Tailscale is the recommendation — outbound-only
  from both ends, and ACLs mean the box is never on the public internet, which is
  what makes an on-premise Guarantee defensible rather than decorative.
- **Which local box, and which model on it** — pending.
