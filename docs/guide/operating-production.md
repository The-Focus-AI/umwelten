# Operating production — making changes to the fleet

> Team guide (written for onboarding Ben, 2026-07-13). The system-of-systems
> view lives in [production-topology.md](../architecture/production-topology.md)
> (planes, credential map, runbooks — **R1 there is the
> diagnose-a-production-problem walkthrough**). This doc is the "how do I
> change things" companion. Everything below was verified live on
> 2026-07-13.

## Where everything runs

| Thing | Where | How it deploys |
|---|---|---|
| Gaia + all habitats (`*.habitats.thefocus.ai`) | GCE VM `gaia-host`, project **habitats-502314**, us-east4-c, IP 136.107.82.171 | push to `umwelten` main (platform) or the agent's own repo (agent logic) |
| habitats SaaS (`habitats.thefocus.ai`) | Vercel | push to `habitats` main |
| Status page (public) | [habitats.thefocus.ai/status](https://habitats.thefocus.ai/status) | part of the SaaS |
| Ops dashboard / alerts (internal) | [Cloud Monitoring](https://console.cloud.google.com/monitoring/dashboards?project=habitats-502314) | uptime check on gaia `/health`; memory/disk/uptime alerts → email |

**Host access** (needs project IAM):

```bash
gcloud compute ssh gaia-host --zone us-east4-c --tunnel-through-iap
```

No public SSH port exists; IAP is the only way in. Container logs are in
[Cloud Logging](https://console.cloud.google.com/logs?project=habitats-502314)
(log name `gcplogs-docker-driver`, one entry stream per container) and via
`docker logs gaia-<id>` on the host.

## The three deploy loops (don't mix them up)

1. **Platform** (runner, Gaia, base images, tool sets): merge to
   `umwelten` main touching `packages/`, `examples/`, or `deploy/gaia/` →
   the `Deploy Gaia host` workflow runs on the `gaia-host-gce` self-hosted
   runner → rebuilds images on the VM → recreates Gaia → cycles every
   *running* habitat. ~10 min, no hands on a server. Deliberately-stopped
   habitats stay stopped.
2. **One agent's logic**: push to the agent's own repo (e.g.
   [twitter-agent](https://github.com/The-Focus-AI/twitter-agent)) → ask
   Gaia to `rebuild <id>` (chat or `POST /api/habitats/<id>/rebuild`).
   The entrypoint does `git pull --ff-only` + `mise install` +
   `pnpm install --prod`. Blast radius: that habitat only.
3. **SaaS**: push to `habitats` main → Vercel. See `OPERATIONS.md` in that
   repo (node 22 gotcha, env vars, status page roster).

## Building a new agent (repo-backed — the only pattern going forward)

A habitat is a git repo with:

```
config.json      # name, defaultProvider/Model, toolsDir, stimulusFile, requiredSecrets
STIMULUS.md      # persona
tools/<name>/    # TOOL.md + handler.ts per tool (dynamic-imported at boot)
src/             # shared modules your tools import (relative paths)
package.json     # runtime deps (ai, zod, …) — installed with --prod at boot
mise.toml        # [tools] node = "22", "npm:pnpm" = "latest"
```

Then (Gaia chat can do all of this — it's what the orchestrator is for):

1. Add any new secrets to Gaia's master vault (`add_secret` /
   `POST /api/secrets`).
2. `create_habitat` with `id`, `gitUrl`, `secretBindings`, provider/model.
   Hostname defaults to `<id>.habitats.thefocus.ai` (wildcard DNS + caddy
   labels make it publicly routable with TLS automatically).
3. `start_habitat` → verify `/health`, the agent card, and tools; attach
   in the SaaS with the child's own key (never Gaia's).
4. Deploys from then on are loop 2 above.

Reference: R4 in production-topology.md; the deep dive is
`docs/guide/gaia-orchestrator.md`.

## How Gaia gets GitHub access (ADR 0004 — verified 2026-07-13)

Gaia is the **only** thing holding GitHub credentials. The mechanics:

- **One GitHub App (@habitats)**, installed on an explicit repo allowlist
  in the `the-focus-ai` org. The installation list is the blast-radius
  boundary — a repo the App isn't installed on is unreachable, period.
- **The private key lives only on gaia-host** at
  `/opt/gaia-data/github-app.pem` (mode 0600, never in the vault JSON,
  never seeded to children). `GITHUB_APP_ID`,
  `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY_FILE` come from
  the host's `deploy/gaia/.env`. Rotation: GitHub supports two concurrent
  keys — generate, deploy, revoke.
- **Per-habitat declaration, deny by default.** A habitat's registry entry
  must declare `github: { read: "org" | [repos], write: [repos] }`.
  No declaration ⇒ no `GITHUB_TOKEN` env at boot and the mint route
  refuses (verified: twitter currently declares nothing and gets
  `declares no github read scope`). Public-repo habitats must use an
  explicit read-list, never `"org"` (exfiltration blind spot #1 in the
  ADR).
- **Two tokens, 1-hour TTL**: an ambient **read** token (`GITHUB_TOKEN`,
  what `entrypoint.sh` uses for authenticated clones) and an
  origin-pinned **write** token (`GITHUB_WRITE_TOKEN`, scoped to exactly
  the habitat's own repos). Minted fresh at every container start.
- **Refresh without restart**: a running habitat POSTs
  `GAIA_URL + /github/token` (`GAIA_URL` is injected at start),
  authenticating with **its own** `HABITAT_API_KEY`; Gaia resolves
  key → registry entry → declared scopes → mints a down-scoped token and
  logs the grant. The route is deliberately outside `/api/*` (which
  requires Gaia's operator auth).
- **Verified end-to-end on gaia-host**: App mint produces a valid
  installation token; that token reads `The-Focus-AI/twitter-agent`
  (HTTP 200); a child without declared scopes is refused.

So: to give a new agent git access, (1) install the @habitats App on its
repo, (2) declare `github.read`/`github.write` on its registry entry,
(3) rebuild. Nothing else — no PATs, no keys in the repo, no secrets in
the image.

## Local development (umwelten)

- `pnpm` only; `pnpm test:run` for units (~5s, no network);
  `dotenvx run -- pnpm run cli …` for anything needing API keys.
- gcloud in this repo is pinned to the **habitats-502314** project via
  `mise.toml` (`CLOUDSDK_ACTIVE_CONFIG_NAME=habitats`) — `gcloud` here
  targets prod infra; elsewhere your global config applies.
- Local Gaia against Docker Desktop: `pnpm run cli habitat gaia …` (see
  the gaia-orchestrator guide). Known local-dev quirk: host-run Gaia
  can't reach children by Docker DNS (#235).
