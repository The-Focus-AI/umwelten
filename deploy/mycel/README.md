# Running Mycel

The operating manual: bring it up, onboard someone, deploy a change, work out
what broke. The reasoning behind the shape is
`docs/architecture/mycel-deployment.md`.

## The one alias to set first

Every operator command needs the database, and the container already has it
resolved. Running them inside it means no connection string on your shell and no
chance of pointing a grant at the wrong database:

```bash
alias mycel='docker compose --project-directory /opt/umwelten/deploy/mycel exec mycel /usr/local/bin/mycel-entrypoint node /app/mycel.js'
```

Everything below assumes that alias. Without it, `umwelten mycel …` on the host
will fail with "No database" — correctly, because it has none.

**The `/usr/local/bin/mycel-entrypoint` in there is load-bearing.** `docker exec`
starts a new process and does not run the image's ENTRYPOINT, so the secrets it
resolved live only in the `serve` process — an operator command invoked directly
gets a container with no `MYCEL_DATABASE_URL` and fails exactly as if none were
configured. Going through the entrypoint re-resolves them from Secret Manager
for that one command. `MYCEL_SECRETS` comes from the compose `environment:`
block, so `exec` inherits it.

## Bringing it up

**Every command in this file runs on `mycel-host`, not on the Gaia host.** They
are separate instances with separate service accounts, and that separation is
the point (ADR 0030) — the money service does not share an identity with
containers running agent code.

```bash
# mycel-net is created by deploy/gcp/mycel-host-startup.sh on first boot.
cp deploy/mycel/.env.example deploy/mycel/.env    # hostname + port; nothing secret
./deploy/mycel/deploy.sh
```

Secrets are **not** in that `.env`. They live in Google Secret Manager and are
read at container start through this instance's attached service account, so
there is no credential on this disk to protect or to rotate in place. To change
one: `gcloud secrets versions add <id> --data-file=-`, then restart the
container — values are read at boot.

`deploy.sh` builds, recreates the container, and waits for `/health`. Nothing
else to run.

**Before the very first boot**, run the store conformance suite against a
throwaway Neon branch. `serve` executes the schema DDL on start, so otherwise
the deploy is the first time that code has ever run:

```bash
MYCEL_DATABASE_URL='postgres://…branch…' \
  pnpm vitest run packages/mycel/src/store/neon-store.integration.test.ts
```

## Onboarding

```bash
# A Supplier. --credential-env is the NAME of an env var, never the key itself.
mycel supplier register openrouter \
  --display-name "OpenRouter" \
  --base-url https://openrouter.ai/api/v1 \
  --credential-env OPENROUTER_API_KEY

# Its catalogue. A vendor runs no agent, so the operator publishes for it — and
# a vendor runs no agent, so this has to keep running — it IS the heartbeat.
# Machines need none of it; see the failure below.
mycel offers sync openrouter \
  --models anthropic/claude-sonnet-5,google/gemini-3-flash-preview \
  --watch 5

# A buyer.
mycel client create the-focus-ai --name "The Focus AI"
mycel application create help-habitat --client the-focus-ai   # credential, once
mycel grant the-focus-ai 50000000                             # $50
```

Money is integer micro-dollars everywhere: `50000000` is $50.00.

The Application's credential is printed once and only its hash is stored. Lose
it and you rotate — there is no path that recovers it.

## Deploying a change

```bash
./deploy/mycel/deploy.sh
```

It tags the running image so there is something to roll back to, builds,
recreates, and waits for `/health` to report the **store** reachable rather than
merely the process up. If it never gets there it prints the logs and rolls back
by itself — the alternative is a broken Exchange sitting there while somebody
reads a scrollback.

Deliberately **not** part of `deploy/gaia/redeploy.sh`. Mycel is not cycled by a
push to umwelten main; that separation is the whole reason it is a peer of Gaia
rather than a habitat Gaia manages.

To go back later:

```bash
docker tag mycel:previous mycel
docker compose --project-directory deploy/mycel up -d
```

State is in Neon, so a rollback loses nothing. That is the payoff for holding no
volume.

## Stopping

```bash
docker compose --project-directory deploy/mycel stop
```

Buyers get connection failures, which is correct — a habitat pointed at Mycel is
down when Mycel is down. To un-break one, point it back at OpenRouter: its
provider is a registry config value, so that is an edit and a restart, no deploy.
**Rehearse this once before switching real traffic over.**

## Diagnosing

1. **`/health`** — store reachability first.
   ```json
   { "status": "ok" }
   { "status": "degraded", "store": "…" }   // 503
   ```
   A service that answers while its database is gone is worse than one that does
   not answer, because Dispatch keeps sending it traffic.
2. **Cloud Logging**, filtered on container `mycel`. The gcplogs driver is the
   daemon default on this host, so nothing extra is configured.
3. **The `considered` list** on a failed dispatch: every Offer weighed and why
   each was rejected. "Why did this request go there" is otherwise unanswerable
   after the fact.
4. **`mycel balance <client>`** prints the balance *and* the entries summing to
   it. A Balance is never a stored total, so showing both is the check as well as
   the report.

### The one that will look like a bug first

**Offers vanishing after fifteen minutes.** Symptom: `no_offer` on every request
for a vendor model, with a `considered` list showing `offer-stale`.

Dispatch drops a **vendor's** Offer not republished within the staleness
window, and `offers sync --watch` is what republishes for it. If that process
died, the Offers expire — which is correct, because a dead sync means we no
longer know the vendor's state either.

**This never applies to a machine.** A machine Supplier holds a Connection, and
that Connection is its availability (ADR 0023): its Offers do not expire at any
age, and it becomes undispatchable the instant it disconnects, reported as
`supplier-disconnected` rather than `offer-stale`. If you see `offer-stale` for
a machine, something is wrong with the diagnosis and not with the machine.

### The others worth knowing

**402 on a request you expected to work.** A charge falls through End User →
Application → Client, stopping at the first with any ledger entry. A user who
was ever granted anything is *capped* at it and stays capped once spent — they
do not fall back to the pool. Check `mycel balance <app>:<user> --application`
before assuming the Client's balance covers it.

**401 with a credential that looks right.** A static credential also needs
`X-Mycel-End-User`. There is no fallback to the Application's own id, on purpose:
a caller that forgot the header would otherwise have its whole estate attributed
to one subject, and per-user caps would quietly stop being per-user.

**A Cost of 0 with a non-zero Charge.** Correct. Charge is independent of Cost
(ADR 0013), and hardware the operator owns costs nothing to buy from.
