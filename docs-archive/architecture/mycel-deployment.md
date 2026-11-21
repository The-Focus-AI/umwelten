# Deploying Mycel

> Status: **deployed 2026-08-10** at https://mycel.thefocus.ai — stage 1 serving,
> no Suppliers registered yet. Runs on its own instance with its
> own GCP identity (ADR 0030). The runbook for putting the Exchange
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
| **2** | a local box as a second Supplier, dialling in | the dial-in protocol — ADR 0023, specified in `dial-in-protocol.md`, unbuilt |
| **3** | the habitats SaaS as an Application (per-user balances) | stage 1 |
| **4** | a third-party client app in its own repo | stage 3 |

The point of the ordering: stage 1 has no new transport and no new identity, so
when it breaks you know it is the money plumbing. Stage 2 is transport only.
Stage 3 is identity only.

---

## Part 0 — What this needed, and what shipped

Stage 1 could not run when this was written. Everything below is now built, and
**stage 1 is blocked only on the Neon project.**

| Was missing | Now |
|---|---|
| An entrypoint — `createExchangeServer` was a library function | `umwelten mycel serve` |
| Any auth a habitat could use — JWKS only, and a habitat has no signing key | `sk-mycel-…` + `X-Mycel-End-User`, alongside JWKS |
| A way to onboard anyone or fund a balance | `mycel client` / `application` / `grant` / `balance` |
| A way to publish a vendor's catalogue — the supply endpoint expects an agent | `mycel offers sync --watch` |
| A container and a compose service | `packages/mycel/Dockerfile`, `deploy/mycel/` |
| A port outside Gaia's managed range | Mycel 7438, supplier runtime 7439 |

Two of those were design rather than plumbing, and the reasoning is worth
keeping.

**Static credentials, alongside JWKS rather than instead of it.** An Application
either publishes a JWKS (the SaaS already does, per ADR 0003) or holds a
credential stored hashed — the same pattern Suppliers already use. With a static
credential the End User arrives in a header:

```
Authorization: Bearer sk-mycel-…
X-Mycel-End-User: user-1234
```

This is not the downgrade it looks like. **The JWT never authenticated the End
User** — ADR 0014 has Mycel trust the Application's assertion of `sub` either
way, so a signature only ever proved *which Application* was calling, which a
hashed bearer proves too. What the JWT genuinely buys is short expiry and no
spendable secret at rest, which is why it stays recommended for anyone able to
serve a JWKS.

**No HTTP admin API.** The operator surface is a CLI on the box. These
operations run rarely, by one person, and each can move money or grant
eligibility for traffic the operator is liable for (ADR 0012) — a route is a
larger surface than a command, and the convenience is not worth securing.

This does **not** forbid a read-only surface. ADR 0026 gives Clients their own
view of their own usage, served by Mycel rather than by the habitats SaaS. The
argument above is about consequence, not about HTTP: a route that moves no money
and grants no eligibility is not the thing that was refused.

---

## Part 1 — The database

**Neon, its own project, a region in the same metro as the VM.**

Mycel's host is `mycel-host`, project `habitats-502314`, `us-east4` — Ashburn,
alongside `gaia-host` but a separate instance with a separate identity (ADR
0030). AWS `us-east-1` is Northern Virginia, the same metro, so a Neon project
there is single-digit milliseconds away.

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
- [ ] Connection string in GSM as `mycel-database-url` (and in 1Password for humans)
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
- [ ] Stored in GSM as `mycel-openrouter-api-key`, bound to `mycel-sa`
- [ ] Reaches the process as `OPENROUTER_API_KEY` — the name a Supplier record
      stores in `upstreamCredentialEnv`, so the mapping in `MYCEL_SECRETS` and
      the value in that column have to agree

---

## Part 3 — Secrets and the container

**Google Secret Manager, read through the instance's own identity** (ADR 0030).
An earlier draft of this section specified fnox with its own 1Password scope.
That was replaced, and the reason is worth keeping: fnox in production requires
a long-lived 1Password service-account token to sit in a file on the host, while
a GCE instance's attached service account is workload identity — the metadata
server issues short-lived tokens and **nothing long-lived is written to disk at
all**. The GCP-native path has no bootstrap secret to protect.

1Password stays the source of truth for humans and laptops, which have no
metadata server. GSM is the production store. The sync runs one way. This is
GDE-003's Pattern B; STD-007 §3.10 is satisfied on purpose rather than by
accident.

**Placement: its own instance, `mycel-host`, not a container on gaia-host.**
Every container on a Docker host can reach the metadata server and assume that
instance's service account — so on one VM there is one identity, and no compose
arrangement divides it. gaia-host runs habitat containers executing arbitrary
agent code; sharing a box would hand them the ledger's connection string by
construction. Separate deploy cadence was always the argument for a separate
compose file, and a separate identity is the same argument carried to the
boundary that actually matters.

```
deploy/mycel/
  docker-compose.yml    # mycel + its own caddy, on mycel-net
  entrypoint.sh         # resolves GSM → process env, then execs
  .env.example          # hostname, port, caddy email — nothing secret
  README.md             # start / stop / roll back
deploy/gcp/
  mycel-host-startup.sh # docker + gcplogs + ops agent + mycel-net
```

**Provisioning, once.** The service account is the boundary this whole section
exists to draw, so each secret is granted on the secret resource rather than
project-wide (STD-007 §3.12):

```bash
PROJECT=habitats-502314
SA=mycel-sa@$PROJECT.iam.gserviceaccount.com

gcloud iam service-accounts create mycel-sa --project "$PROJECT" \
  --display-name "Mycel — the Exchange"

# Two project-level roles, and they are not optional. The gcplogs Docker driver
# needs logWriter to START a container at all: without it the container sits in
# `Created` and the daemon reports IAM_PERMISSION_DENIED, which reads as an
# application failure rather than a logging one. The Ops Agent wants
# metricWriter, and fails quietly without it.
#
# Project-level is right here — there is no sub-resource on which "may write its
# own logs" can be scoped, and neither role can read anything. The scoping that
# matters is per-secret, below.
for role in roles/logging.logWriter roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:$SA" --role "$role"
done

# One secret per value. No --set-env-vars, ever: STD-007 §3.6 forbids passing a
# secret value as a deployment flag, and shell history is a good reason why.
for s in mycel-database-url mycel-openrouter-api-key mycel-google-generative-ai-api-key; do
  gcloud secrets create "$s" --project "$PROJECT" --replication-policy automatic
  gcloud secrets add-iam-policy-binding "$s" --project "$PROJECT" \
    --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor
done

# Values arrive on stdin, never in argv.
printf '%s' "$MYCEL_DATABASE_URL" | \
  gcloud secrets versions add mycel-database-url --project "$PROJECT" --data-file=-

gcloud compute instances create mycel-host --project "$PROJECT" \
  --zone us-east4-a --machine-type e2-small \
  --service-account "$SA" --scopes cloud-platform \
  --metadata-from-file startup-script=deploy/gcp/mycel-host-startup.sh
```

`--scopes cloud-platform` looks broad and is not: on modern GCE, scopes are a
ceiling and IAM is the actual grant. This service account can read three secrets
and do nothing else, which is what the per-secret bindings above establish.

**Hostname: `mycel.thefocus.ai`, not `mycel.habitats.thefocus.ai`.** The wildcard
would be free, but Mycel is not a habitat and putting it under that wildcard says
it is. One A record — at **mycel-host's** static IP, not the Gaia host's, which
is the DNS consequence of the split. Caddy issues the cert from the label.

**Port: 7438.** Below 7440, where Gaia starts assigning ports to managed containers. The supplier agent's
managed-runtime default moves to 7439 in the same change.

Logging needs nothing: `gcplogs` is the daemon default on that host, so Mycel's
stdout lands in Cloud Logging beside everything else.

### Checklist

- [ ] `mycel-sa` service account created
- [ ] `roles/logging.logWriter` + `roles/monitoring.metricWriter` granted to it
      (without logWriter the container never starts — see above)
- [ ] GSM secrets created, each bound to `mycel-sa` on the secret resource, and
      every id in `MYCEL_SECRETS` actually exists — a missing one stops the boot
- [ ] `mycel-host` instance created with that service account attached
- [ ] `deploy/mycel/` written, `docker build` reproducible
- [ ] DNS A record for `mycel.thefocus.ai` → **mycel-host's** static IP
- [ ] `docker compose up -d`, then `curl https://mycel.thefocus.ai/health` → `{"status":"ok"}`
- [ ] Confirm no secret is on the host: `sudo grep -r OPENROUTER /opt /etc 2>/dev/null` finds nothing

`/health` already reports whether the **store** is reachable, not merely whether
the process is up — a service that answers while its database is gone is worse
than one that does not answer.

---

## Part 4 — Register OpenRouter as a Supplier

A commercial vendor and a box on a desk are the same kind of thing here
(ADR 0012). The difference is only who publishes the Offers: a local machine runs
the agent, and a vendor has its catalogue published on its behalf.

```bash
mycel supplier register openrouter \
  --display-name "OpenRouter" \
  --base-url https://openrouter.ai/api/v1 \
  --credential-env OPENROUTER_API_KEY \
  --guarantees ""          # a commercial vendor gets none by default

mycel offers sync openrouter --watch 5 --models \
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
mycel price openrouter anthropic/claude-sonnet-5 \
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
mycel client create the-focus-ai --name "The Focus AI"
mycel application create help-habitat --client the-focus-ai
# → sk-mycel-…   shown once, never recoverable

mycel grant the-focus-ai 50000000        # $50 of credit
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
mycel balance the-focus-ai
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

**Deploy a change.** `./deploy/mycel/deploy.sh` — tag, build, recreate, wait for
health, roll back automatically if it never gets there. A deliberate act: Mycel
is *not* cycled by `redeploy.sh`, which is the entire argument for it being a
peer of Gaia rather than a child.

**Roll back.** The script does it on a failed deploy. By hand later:
`docker tag mycel:previous mycel` and `up -d`. State is in Neon, so a rollback
loses nothing.

**Where the image is built.** On the host, today, matching how Gaia's images are
built. That is a known liability rather than a good idea — the GCP report traces
disk pressure on this host to exactly this (6.8 GB of images plus 5.3 GB of build
cache), and Stage 2 of that plan moves to Cloud Build plus Artifact Registry so
prod pulls instead of building. Mycel is the natural first service to move,
having no legacy to carry, but building on the host is what works today and is
not worth blocking the first deploy on.

**Stop.** `docker compose stop mycel` — buyers get connection failures, which is
correct: a habitat pointed at Mycel is down when Mycel is down. Point it back at
OpenRouter to un-break it.

**Diagnose.** `/health` first (it reports store reachability). Then Cloud Logging
filtered on the container name. Then the `considered` list on a failed dispatch,
which records every Offer weighed and why each was rejected — "why did this
request go there" is otherwise unanswerable after the fact.

**Watch for:** a vendor's Offers expiring. Dispatch drops a vendor Offer not
republished within 15 minutes (`DEFAULT_STALE_AFTER_MS`), and a vendor has no
agent republishing for it, so **a synced Offer set needs re-syncing on that
cadence** — which is why `offers sync` should be a scheduled job rather than a
one-shot.

Machines are not subject to this. ADR 0023 landed, and a machine Supplier's
availability is the Connection it holds: its Offers never expire, and it drops
out the instant it disconnects.

---

## How a request is paid for

A charge falls through **End User → Application → Client**, stopping at the
first owner that has ever had a ledger entry.

The test is *existence*, not solvency, and that is the load-bearing part. An
unfunded End User draws from the pool behind it, so a new signup works without
anyone granting it anything first. Granting an End User *anything* opts it into
being capped at that amount — and it stays capped once spent, rather than being
silently promoted back to the pool it was capped away from.

The resolved owner is also the one debited, which keeps the two consistent: an
unfunded user debits the Client, never acquires an entry of its own, and so
keeps resolving to the Client.

To cap a user at $5, grant them $5. To leave them uncapped, grant them nothing.

## Open decisions

- **The Neon project** — create it, hand over the connection string.
- ~~**Where Mycel runs, and how it gets its secrets.**~~ **Decided: ADR 0030 —
  its own instance, its own service account, secrets from Google Secret Manager
  read through the attached identity.** One VM is one identity, and gaia-host
  runs agent code; sharing a box would have made the separation a convention
  enforced by nothing. No key file, no bootstrap token, nothing secret at rest.
- ~~**Reachability for a local box.**~~ **Decided: ADR 0023 — machine Suppliers
  dial in.** Mycel never connects to a machine; the machine holds an outbound
  connection and receives work over it. No tunnel, no ACL, no address to
  register, and the box accepts no inbound connections at all.

  Built, and it deleted the staleness apparatus for machines with it (#382) —
  that whole mechanism existed only to infer a liveness a held connection makes
  observable. Vendors keep it, having neither an agent nor a connection.
- **Which local box, and which model on it** — pending.
