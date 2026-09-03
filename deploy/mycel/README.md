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
cp deploy/mycel/.env.example deploy/mycel/.env    # hostname, port, public Clerk key
./deploy/mycel/deploy.sh
```

The Clerk value must be the `pk_live_*` publishable key from Mycel's own
production Clerk application (STD-009). It is intentionally public browser
configuration, not a secret. Clerk's secret key is not used by this client and
must not be added here.

During the temporary development-instance rollout, set the Mycel `pk_test_*`
key and `MYCEL_ALLOW_DEVELOPMENT_CLERK=true`. The deploy prints a warning and
requires that explicit exception; remove the flag when the production Clerk
domain and social OAuth credentials are ready.

Set `MYCEL_CLERK_ISSUER` to that Clerk instance's issuer and
`MYCEL_CLERK_AUTHORIZED_PARTIES=https://mycel.thefocus.ai`. These runtime values
verify the session token used by the customer control plane. They are public
configuration, not a Clerk secret. Self-service creates Clients and
Applications, but starts with no spendable postpaid credit unless
`MYCEL_SELF_SERVICE_CREDIT_LIMIT_MICRO_DOLLARS` is deliberately raised.

Mycel uses Clerk's non-Organizations RBAC pattern for financial administration.
In Clerk **Sessions → Customize session token**, include
`{"metadata":"{{user.public_metadata}}"}`, then set
`{"role":"admin"}` in an administrator's public metadata. Public metadata is
read-only in the browser, and Mycel trusts the role only after verifying the
signed session token. Sign out and back in after changing the role so Clerk
issues a token carrying the new claim. A customer or Client owner is not an
administrator by implication. An administrator sees **Grant credit**; every
positive grant is bounded to $5,000 per operation and appended to the ledger
with the administrator's Clerk id and required reason. Do not use Clerk
Organization `org:admin` for this capability: an Organization creator may
receive that role by default, while Mycel Clients and team membership
deliberately remain Mycel domain objects.

The customer console is `https://mycel.thefocus.ai/account`. It shows the
Client balance, the append-only entries that sum to it, usage, Application key
lifecycle, team membership, and a live model playground. Playground requests
enter the same dispatch, metering, Balance, and request-recording path as the
public OpenAI-compatible endpoint, but authorize through the signed-in Clerk
operator and owned Application—an Application credential is never recovered
or stored in the browser. The public landing remains at `/`.

### Activating prepaid funding

Funding is deliberately absent until all three values exist:

- `MYCEL_PUBLIC_ORIGIN=https://mycel.thefocus.ai` in `.env`
- `MYCEL_STRIPE_SECRET_KEY` resolved from a Stripe **test** secret key
- `MYCEL_STRIPE_WEBHOOK_SECRET` resolved from the test webhook endpoint for
  `https://mycel.thefocus.ai/api/customer/stripe/webhook`

Create the two secret resources, grant only `mycel-host`'s service account
access, and add their env-name → secret-id mappings to `MYCEL_SECRETS`. Do not
put values in `.env`. Test a payment and a webhook retry before repeating the
setup in live mode; test and live webhook signing secrets are different.

The webhook, not the Checkout redirect, adds credit. Its provider event ID is
accepted once, so Stripe retries cannot double the Client balance.

Secrets are **not** in that `.env`. They live in Google Secret Manager and are
read at container start through this instance's attached service account, so
there is no credential on this disk to protect or to rotate in place. To change
one: `gcloud secrets versions add <id> --data-file=-`, then restart the
container — values are read at boot.

`deploy.sh` builds, recreates the container, and waits for `/health`. Its root
pnpm download store and the isolated client build store persist across builds;
the first cold build still downloads dependencies, while repeat deploys reuse
them. Moving the complete image build off-host remains separate infrastructure
work because no Artifact Registry identity or repository is configured yet.

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

# A buyer created by an operator. Customers can alternatively create their own
# Client, first Application, and one-time credential from the signed-in site.
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
merely the process up. It also verifies the client surface (landing, account
manifests, `/llms.txt`, `/openapi.json`, `/shell/substrate`). If health never
arrives it prints the logs and rolls back by itself — the alternative is a
broken Exchange sitting there while somebody reads a scrollback.

Deliberately **not** part of `deploy/gaia/redeploy.sh`. Mycel is a peer of Gaia,
not a habitat Gaia manages (ADR 0030). Automatic deploy happens on
**mycel-host's** runner only — never on Gaia's.

To go back later:

```bash
docker tag mycel:previous mycel
docker compose --project-directory deploy/mycel up -d
```

State is in Neon, so a rollback loses nothing. That is the payoff for holding no
volume.

## Continuous deploy (push to main)

Once the host is standing, Mycel-related code changes ship automatically:
`.github/workflows/deploy-mycel.yml` runs on every push to `main` that touches
`packages/mycel/`, `apps/mycel-client/`, `packages/substrate/`, or
`deploy/mycel/` (plus the workflow file itself), on a **self-hosted runner
installed on mycel-host** (labels: `self-hosted`, `mycel`). It checks out the
pushed commit and runs `deploy/mycel/deploy.sh`. Path filters are intentionally
tight — unlike Gaia, Mycel does **not** watch all of `packages/**` or
`examples/**`, so unrelated umwelten changes do not cycle the money service.

Setup once from a laptop with `gcloud` + `gh` (IAP SSH; no public SSH).
Modeled on the Gaia runner block in `deploy/gaia/README.md` §8. Do this on
**mycel-host**, never on gaia-host — labels must be `mycel`, not `gaia`.

```bash
# Laptop. Token is one-hour and single-use.
export PROJECT=habitats-502314
export ZONE=us-east4-a
export RUNNER_USER=worker_user
export RUNNER_TOKEN
RUNNER_TOKEN="$(gh api --method POST \
  repos/The-Focus-AI/umwelten/actions/runners/registration-token \
  --jq .token)"

gcloud compute ssh mycel-host \
  --project "$PROJECT" --zone "$ZONE" --tunnel-through-iap \
  --command "sudo env RUNNER_TOKEN='$RUNNER_TOKEN' RUNNER_USER='$RUNNER_USER' bash -s" <<'REMOTE'
set -euo pipefail
id "$RUNNER_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$RUNNER_USER"
usermod -aG docker "$RUNNER_USER"
test -f /opt/umwelten/deploy/mycel/.env || {
  echo "missing /opt/umwelten/deploy/mycel/.env — copy the host .env before deploying" >&2
  exit 1
}

RUNNER_DIR="/home/$RUNNER_USER/actions-runner"
if [[ -x "$RUNNER_DIR/run.sh" && -f "$RUNNER_DIR/.runner" ]]; then
  echo "runner already configured at $RUNNER_DIR"
  systemctl enable --now "actions.runner.The-Focus-AI-umwelten.mycel-host.service" \
    || true
  exit 0
fi

install -d -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_DIR"
cd "$RUNNER_DIR"
# Pin comes from github.com/actions/runner/releases — bump when installing
# on a new host. Progressive rollout: if this tarball 404s, use the version
# shown under Settings → Actions → Runners → New self-hosted runner.
VER=2.337.0
curl -fsSL -o "actions-runner-linux-x64-${VER}.tar.gz" \
  "https://github.com/actions/runner/releases/download/v${VER}/actions-runner-linux-x64-${VER}.tar.gz"
tar xzf "actions-runner-linux-x64-${VER}.tar.gz"
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR"
sudo -u "$RUNNER_USER" ./config.sh \
  --url https://github.com/The-Focus-AI/umwelten \
  --token "$RUNNER_TOKEN" \
  --name mycel-host \
  --labels mycel \
  --unattended \
  --replace
./svc.sh install "$RUNNER_USER"
./svc.sh start
REMOTE

unset RUNNER_TOKEN
```

Then confirm Idle at github.com/The-Focus-AI/umwelten → Settings → Actions →
Runners (`self-hosted`, `mycel`). Kick with Actions → Deploy Mycel → Run
workflow, or wait for the next matching push to `main`.

The workflow reads host config from `MYCEL_ENV_FILE` (canonical
`/opt/umwelten/deploy/mycel/.env` on this host) — nothing secret lives in the
repo. The Actions checkout is under the runner home, not `/opt/umwelten`; keep
the `.env` at the path above so operators and CI agree on one file.

> **Public-repo warning:** this runner drives the production docker daemon.
> Keep it off `pull_request` triggers, and set *Settings → Actions → General →
> Fork pull request workflows → Require approval for all outside
> collaborators*, so fork PRs can never reach it via a modified workflow.

Manual deploy is the same one command: `deploy/mycel/deploy.sh` (or
`workflow_dispatch` the workflow from the Actions tab).

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
4. **`mycel balance <client>`** prints the balance _and_ the entries summing to
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
was ever granted anything is _capped_ at it and stays capped once spent — they
do not fall back to the pool. Check `mycel balance <app>:<user> --application`
before assuming the Client's balance covers it.

**401 with a credential that looks right.** A static credential also needs
`X-Mycel-End-User`. There is no fallback to the Application's own id, on purpose:
a caller that forgot the header would otherwise have its whole estate attributed
to one subject, and per-user caps would quietly stop being per-user.

**A Cost of 0 with a non-zero Charge.** Correct. Charge is independent of Cost
(ADR 0013), and hardware the operator owns costs nothing to buy from.
