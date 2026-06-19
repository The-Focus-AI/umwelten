# Deploy runbook — Gaia orchestrator + Twitter habitat

This runbook stands up **Gaia** (the habitat orchestrator) as a single
container on a Docker host, then runs the **Twitter habitat** (PRD #149) under
it as a Gaia-managed container. Gaia becomes the coordination layer: add more
habitats later with no new infra.

Background on why Gaia is deployed this way (it shells out to the host's
`docker` CLI to spawn sibling containers, so it can't run on fly.io/Cloud Run):
`reports/2026-06-18-gaia-deployment-and-habitat-orchestration.md`.

> **Host requirement: Linux with Docker.** A VPS or a GCE VM both work
> identically — pick by where your Neon DB / other services live and who
> administers the box. The containerized-Gaia path uses **host networking**,
> which is a Linux Docker feature; it does **not** work on Docker Desktop for
> macOS/Windows. For local dev on a Mac, use the standalone single-container
> path at the end of this doc, or run `pnpm run cli habitat gaia` directly.

---

## 0. Provision the host

A small Linux VM is enough to start (2 vCPU / 4 GB RAM hosts Gaia + a few
habitats; each habitat container is ~1 GB like the fly `[[vm]]`).

```bash
# Install Docker Engine + compose plugin (Debian/Ubuntu)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker   # run docker without sudo

# Clone the repo (the images build from the monorepo root)
git clone https://github.com/The-Focus-AI/umwelten.git
cd umwelten
```

On **GCE**: a `e2-medium` (or larger) VM with the above is equivalent to a VPS.
Open only the ports you need (see §6 — prefer reaching Gaia over SSH tunnel or
a reverse proxy, not a public 7420).

---

## 1. Build the images

Both build from the monorepo root. The Twitter image layers onto the base.

```bash
docker build -t habitat          -f packages/habitat/Dockerfile .
docker build -t twitter-habitat  -f packages/habitat/Dockerfile.twitter-habitat .
```

> Requires **BuildKit** (the default in Docker ≥ 23; else `export DOCKER_BUILDKIT=1`).
> The Twitter build relies on `packages/habitat/Dockerfile.twitter-habitat.dockerignore`
> to include `examples/twitter-habitat` (the root `.dockerignore` excludes
> `examples/`); per-Dockerfile ignore files are a BuildKit-only feature.

`twitter-habitat` bakes `examples/twitter-habitat/{tools,src,STIMULUS.md}` and,
on every boot, seeds them onto the container's `/data` volume, symlinks
`/data/node_modules → /habitat/node_modules` (so the tool's `ai`/`zod`/`../../src`
imports resolve), and merges `toolsDir`/`stimulusFile` into the Gaia-seeded
`config.json`.

---

## 2. Launch Gaia (containerized)

```bash
cd deploy/gaia
cp .env.example .env          # set OPENROUTER_API_KEY (or GOOGLE_…) + GAIA_*
sudo mkdir -p /opt/gaia-data  # identity bind-mount target (see compose header)

docker compose up -d
docker compose logs -f gaia   # watch for "[gaia] Orchestrator at http://0.0.0.0:7420"
```

Gaia is now at `http://<host>:7420` (host networking → binds the host directly).
The dashboard has Chat / Habitats / Secrets / Create tabs. Verify:

```bash
curl -s http://localhost:7420/health
# → {"status":"ok","role":"gaia-orchestrator",...,"docker":true,...}
```

`docker: true` confirms Gaia can reach the host daemon through the mounted
socket.

---

## 3. Add the master secrets

Gaia holds a **master vault**; each habitat receives only the named secrets you
bind to it. Add everything the Twitter habitat needs (and Gaia's own provider
key if not already in `.env`):

```bash
gaia() { curl -s -X POST http://localhost:7420/api/secrets \
  -H 'Content-Type: application/json' -d "$1"; }

gaia '{"name":"TWITTER_CLIENT_ID","value":"<x-app-client-id>"}'
gaia '{"name":"TWITTER_CLIENT_SECRET","value":"<x-app-client-secret>"}'
gaia '{"name":"TWITTER_REFRESH_TOKEN","value":"<bootstrap-refresh-token>"}'
gaia '{"name":"DATABASE_URL","value":"<neon-postgres-url>"}'        # feed reader (#153)
gaia '{"name":"OPENROUTER_API_KEY","value":"<key>"}'               # child LLM provider
```

`TWITTER_REFRESH_TOKEN` is the **seed** from the one-time OAuth bootstrap
(`examples/twitter-habitat/bootstrap-oauth.ts` — see that dir's README). After
the first refresh, X rotates it and the habitat persists the new one itself
(see §5).

---

## 4. Create + start the Twitter habitat

Create a registry entry that runs the **`twitter-habitat`** image and binds the
secrets. (Gaia injects each into the child's `/data/secrets.json`.)

```bash
curl -s -X POST http://localhost:7420/api/habitats \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "twitter",
    "name": "Twitter",
    "image": "twitter-habitat",
    "provider": "openrouter",
    "model": "openai/gpt-4o-mini",
    "secretBindings": [
      "TWITTER_CLIENT_ID", "TWITTER_CLIENT_SECRET", "TWITTER_REFRESH_TOKEN",
      "DATABASE_URL", "OPENROUTER_API_KEY"
    ]
  }'

curl -s -X POST http://localhost:7420/api/habitats/twitter/start
# → {"started": true, "port": 7440}
```

Or just tell Gaia in the **Chat** tab: *"Create a habitat called twitter using
the twitter-habitat image and openrouter openai/gpt-4o-mini. Bind the Twitter
and DATABASE_URL and OpenRouter secrets, then start it."*

---

## 5. Verify the habitat

Everything below goes **through Gaia's proxy**, which injects the child's bearer
token automatically (children bind to `127.0.0.1` only — they're not exposed
directly).

```bash
# Health
curl -s http://localhost:7420/api/habitats/twitter/health        # → {"status":"ok",...}

# Agent card (name/description synced from STIMULUS.md)
curl -s http://localhost:7420/api/habitats/twitter/agent-card | jq .name   # → "Twitter"

# Tools loaded (bookmarks should be present)
curl -s http://localhost:7420/api/habitats/twitter/logs?tail=80 | grep -i bookmark
```

Chat end-to-end (relays an A2A message to the habitat):

> In Gaia chat: *"Ask twitter to show my recent bookmarks."*

A correct setup returns real bookmarks. If auth isn't seeded, the tool returns a
clear `needs_reauth` message (re-check §3's `TWITTER_REFRESH_TOKEN`).

**Refresh-token persistence (the restart test):** the habitat persists the
rotated refresh token to `/data/secrets.json` on its named volume
(`gaia-twitter-data`). Confirm it survives a restart:

```bash
docker run --rm -v gaia-twitter-data:/data alpine cat /data/secrets.json | jq -r .TWITTER_REFRESH_TOKEN | cut -c1-8
curl -s -X POST http://localhost:7420/api/habitats/twitter/stop
curl -s -X POST http://localhost:7420/api/habitats/twitter/start
# token unchanged unless a refresh happened in between; never lost
```

---

## 6. Attach to the habitats SaaS

The SaaS "+ Umwelten agent" flow needs an A2A endpoint + bearer token. Reach the
Gaia-managed habitat through Gaia's proxy:

- **A2A endpoint:** `https://<gaia-host>/api/habitats/twitter/a2a`
- **Bearer token:** Gaia's own `HABITAT_API_KEY` (the proxy forwards to the child
  with the child's token; the SaaS authenticates to Gaia).

Put a TLS reverse proxy (Caddy/nginx) in front of Gaia for `https://` — do not
expose `7420` publicly unauthenticated. The agent card's name/description sync
on attach; a rotated token shows the SaaS's "needs reconnect" state.

> If you prefer the SaaS to talk to the habitat **directly** (no Gaia in the
> request path), publish the child port and point the SaaS at
> `https://<host>:<childport>/a2a` with that child's `HABITAT_API_KEY`. The
> proxy path above is the default because children bind to `127.0.0.1`.

### Per-habitat public URLs via Caddy (#170)

The compose file ships a `caddy` service (`lucaslorentz/caddy-docker-proxy`) that
gives **each spawned habitat its own HTTPS URL** for direct SaaS attach — the
recommended path, since the SaaS then holds a per-habitat credential (revocable
per agent) instead of Gaia's master key.

1. Point DNS `*.<base-domain>` at this host and open ports 80/443.
2. Set `GAIA_BASE_DOMAIN` (and optionally `CADDY_EMAIL`) in `deploy/gaia/.env`.
3. `docker compose up -d` — Caddy now watches the docker socket.

Every habitat Gaia starts gets `caddy=<id>.<base-domain>` labels stamped on its
container (`DockerManager.startContainer`), so Caddy publishes it at
`https://<id>.<base-domain>` and reaches it over `gaia-net` (the loopback `-p`
binding is untouched — Gaia's internal proxy still uses it). Override the host per
habitat with the `hostname` field on `create_habitat`. Auth is **pass-through**:
Caddy forwards `Authorization` and the habitat verifies its own token, so attach
the SaaS to `https://<id>.<base-domain>/a2a` with **that child's**
`HABITAT_API_KEY`. Leave `GAIA_BASE_DOMAIN` unset for local dev — no labels are
emitted and Caddy routes nothing.

**Reusing an existing caddy.** If the host already runs caddy-docker-proxy (it
owns 80/443 on its own network), don't start the bundled one. Set
`GAIA_INGRESS_NETWORK=<that network>` (e.g. `caddy`) so spawned habitats join it
and the existing proxy picks up their labels, then bring up **only** Gaia:

```bash
GAIA_INGRESS_NETWORK=caddy GAIA_BASE_DOMAIN=habitats.example.com \
  docker compose up -d gaia      # not the bundled caddy
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `health` shows `"docker": false` | Socket not mounted / no daemon access. Check `/var/run/docker.sock` mount + the host user is in the `docker` group. |
| Gaia can't reach a started child (proxy 502) | Not on Linux host networking. Containerized Gaia requires `network_mode: host` (this compose) on a Linux host. |
| `Image "twitter-habitat" not found` | Build it on this host (§1). Gaia only auto-builds the default `habitat` image. |
| Child session dirs empty on host | Data dir not identity-mounted. Keep `/opt/gaia-data:/opt/gaia-data` (same path in/out). |
| Bookmarks tool: `needs_reauth` | `TWITTER_REFRESH_TOKEN` missing/expired — re-run the OAuth bootstrap and re-set the secret, then `rebuild` the habitat. |

---

## Standalone alternative (no Gaia)

The **same `twitter-habitat` image** runs as a lone container — useful for local
dev (incl. macOS) or a fly.io deploy where you don't need orchestration:

```bash
docker run -d --name twitter -p 7430:8080 \
  -v twitter-data:/data \
  -e HABITAT_API_KEY=$(openssl rand -hex 16) \
  -e OPENROUTER_API_KEY=$OPENROUTER_API_KEY \
  twitter-habitat
# seed secrets onto the volume, then:
curl -s http://localhost:7430/.well-known/agent-card.json | jq .name
```

For **fly.io**, mirror `examples/oura-mcp/fly.toml`: build this image, mount a
volume at `/data`, set `HABITAT_API_KEY` + the Twitter/Neon/provider secrets via
`fly secrets set`, and use `min_machines_running = 1` + `auto_stop_machines = "off"`
so the volume (and the rotated refresh token) stays put. Details:
`reports/2026-06-18-flyio-habitat-container-deploy.md`.
