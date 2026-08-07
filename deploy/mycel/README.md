# Running Mycel

Start, stop, roll back, and diagnose. The reasoning behind the shape is
`docs/architecture/mycel-deployment.md`; this is the operating manual.

## First time

```bash
docker network create gaia-net           # already exists if Gaia is running
docker build -t mycel -f packages/mycel/Dockerfile .
cp deploy/mycel/.env.example deploy/mycel/.env   # then fill it in
docker compose --project-directory deploy/mycel up -d
curl https://mycel.thefocus.ai/health
```

`/health` reports whether the **store** is reachable, not merely whether the
process is up:

```json
{ "status": "ok" }
{ "status": "degraded", "store": "…" }   // 503
```

A service that answers while its database is gone is worse than one that does
not answer, because Dispatch keeps sending it traffic.

**Run the store conformance suite against a Neon branch before the first boot.**
`serve` runs the schema DDL on start, so otherwise the deploy is the first time
that code has ever executed:

```bash
MYCEL_DATABASE_URL='postgres://…branch…' \
  pnpm vitest run packages/mycel/src/store/neon-store.integration.test.ts
```

## Onboarding

```bash
# A Supplier. The credential-env is the NAME of an env var, never the key.
umwelten mycel supplier register openrouter \
  --display-name "OpenRouter" \
  --base-url https://openrouter.ai/api/v1 \
  --credential-env OPENROUTER_API_KEY

# Its catalogue. A vendor runs no agent, so the operator publishes for it —
# and this must keep running, because it IS the heartbeat.
umwelten mycel offers sync openrouter \
  --models anthropic/claude-sonnet-5,google/gemini-3-flash-preview \
  --watch 5

# A buyer.
umwelten mycel client create the-focus-ai --name "The Focus AI"
umwelten mycel application create help-habitat --client the-focus-ai
umwelten mycel grant the-focus-ai 50000000        # $50
```

Money is integer micro-dollars everywhere. `50000000` is $50.00.

## Deploying a change

```bash
./deploy/mycel/deploy.sh
```

That is the whole thing. It tags the running image so there is something to roll
back to, builds, recreates the container, and waits for `/health` to report the
**store** reachable. If it never gets there it prints the logs and **rolls back
by itself** — the alternative is a broken Exchange sitting there while somebody
reads a scrollback.

Deliberate, and **not** part of `deploy/gaia/redeploy.sh`. Mycel is not cycled by
a push to umwelten main — that separation is the whole reason it is a peer of
Gaia rather than a habitat Gaia manages. Deploying it is something a person
decides to do.

## Rolling back by hand

The script does this automatically on a failed deploy. To go back later:

```bash
docker tag mycel:previous mycel
docker compose --project-directory deploy/mycel up -d
```

State is in Neon, so a rollback loses nothing. That is the payoff for the
service holding no volume.

## Running an operator command

The container already has `MYCEL_DATABASE_URL` resolved, so the least
error-prone place to run these is inside it — no connection string on your
shell, no chance of pointing at the wrong database:

```bash
docker compose --project-directory deploy/mycel exec mycel \
  pnpm exec tsx packages/cli/src/entry.ts mycel balance the-focus-ai
```

Worth an alias on the host:

```bash
alias mycel='docker compose --project-directory /opt/umwelten/deploy/mycel exec mycel pnpm exec tsx packages/cli/src/entry.ts mycel'
mycel grant the-focus-ai 50000000
```

## Stopping

```bash
docker compose --project-directory deploy/mycel stop
```

Buyers get connection failures, which is correct — a habitat pointed at Mycel is
down when Mycel is down. To un-break one, point it back at OpenRouter directly:
its provider is a registry config value, so that is an edit and a restart, no
deploy. **Rehearse this once before switching real traffic over.**

## Diagnosing

1. `/health` — store reachability first.
2. Cloud Logging, filtered on container `mycel`. The gcplogs driver is the
   daemon default on this host, so nothing extra is configured.
3. A failed dispatch carries a `considered` list: every Offer weighed and why
   each was rejected. "Why did this request go there" is otherwise unanswerable
   after the fact.
4. `umwelten mycel balance <client>` prints the balance **and** the entries that
   sum to it. A Balance is never a stored total, so showing both is the check as
   well as the report.

### The failure that will look like a bug first

**Offers vanishing after fifteen minutes.** Dispatch drops an Offer that has not
been republished within the staleness window. A machine's agent heartbeats every
five minutes; a commercial vendor has no agent, so `offers sync --watch` is what
heartbeats for it. If that process dies, the vendor's Offers expire — which is
correct behaviour, because a dead sync means we no longer know the vendor's
state either.

Symptom: `no_offer` on every request for a vendor model, with a `considered`
list showing `offer-stale`.

### Other likely ones

**402 on a request you expected to work.** A charge falls through End User →
Application → Client, stopping at the first with any ledger entry. If a user was
ever granted anything they are *capped* at it and stay capped once spent — they
do not fall back to the pool. Check `umwelten mycel balance <user> --application`
before assuming the Client's balance covers it.

**401 with a valid-looking credential.** A static credential also needs
`X-Mycel-End-User`. There is no fallback to the Application's own id, on purpose:
a caller that forgot the header would otherwise have its whole estate attributed
to one subject.

**Cost of 0 with a non-zero Charge.** Correct. Charge is independent of Cost
(ADR 0013), and hardware the operator owns costs nothing to buy from.
