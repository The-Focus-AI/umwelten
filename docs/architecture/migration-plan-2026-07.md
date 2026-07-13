# Migration plan — repo-backed habitats + GCP (July 2026)

> Status: active plan — 2026-07-11. The executable path from today's deploy
> (baked images on a single Docker host) to the locked topology in
> [production-topology.md](./production-topology.md). Cost/platform analysis:
> [reports/2026-07-10-gaia-on-gcp-deployment-strategy.md](../../reports/2026-07-10-gaia-on-gcp-deployment-strategy.md).
> Tracking issues: [#236](https://github.com/The-Focus-AI/umwelten/issues/236)
> (twitter cutover), [#235](https://github.com/The-Focus-AI/umwelten/issues/235)
> (host-run Gaia DNS).

Each phase is independently shippable and independently rollback-able. Do
them in order; don't start a phase until the previous one has soaked.

## Phase 0 — Foundation (DONE, 2026-07-11)

- ✅ Repo-backed runtime complete: entrypoint clones `gitUrl`, `git pull
  --ff-only` on rebuild, `mise install`, and — the missing piece, fixed in
  `019ec02` — `pnpm install --prod` in the project dir so repo tools'
  imports resolve.
- ✅ `The-Focus-AI/twitter-agent` is the source of truth for the Twitter
  habitat: full work dir since June 24, `config.json` synced to canonical
  (`fcd2ec6` — #206 secret declarations, claude-sonnet-5 default), and
  **code synced to canonical** (`77593cb` — the 2026-07-10 identity-mismatch
  diagnostics from umwelten #230: `token-store.connectError()` + the three
  read-tool handlers). The June-24 extraction predated those fixes; any
  future change to `examples/twitter-habitat` must land in twitter-agent
  too until Phase 1 step 5 makes the repo the only copy.
- ✅ End-to-end verified locally: a Gaia agent created + started the habitat
  from the `gitUrl` on the **stock habitat image** — clone, toolchain,
  deps, all 6 twitter tools loaded and executed (bookmarks correctly
  reported stale dev OAuth token; the live one is on the prod volume).
- ✅ Prod picked up the entrypoint fix: the 2026-07-11 11:55 UTC deploy
  shipped `019ec02` and the fleet cycled healthy (Phase 1 step 1 is
  checkable now).

### Context — the 2026-07-10/11 identity + artifact chain (landed, prod)

The cutover's "SaaS attach still healthy" gate now covers much more than a
card fetch. The full per-user chain was fixed and verified end-to-end:

- **umwelten #230/#233/#234**: habitat explains the per-user/operator token
  mismatch instead of "not authenticated"; `/connect/*` and per-request
  auth identity are logged; and — the root cause — the verified JWT speaker
  now survives **streaming** A2A responses (the ALS scope used to end
  before the executor ran, so per-user credentials silently resolved to
  the shared operator on message/stream).
- **umwelten #232 + habitats #92**: agent cards annotate credentials with
  live `configured` status; the attach form stops re-asking for
  gaia-seeded secrets.
- **habitats #93–#96**: dispatch self-heals a missing JWT audience (probes
  the card, TTL re-probe), logs its auth decision per run, and the artifact
  pipeline works — A2A-spec artifact shape normalized, deduped by
  (habitat, blobUrl), body fetched server-side with the dispatch credential
  (habitat `/files/*` is auth-gated), carded on the final message, and
  artifact-updates emitted after the final message are no longer dropped.

## Phase 1 — Twitter habitat prod cutover (#236)

Goal: prod `twitter` entry runs from the repo on the stock image; the baked
`twitter-habitat` image is retired. Needs prod Gaia operator access
(`GAIA_API_KEY` on the host).

1. **Confirm the platform deploy landed**: prod boot logs of any rebuilt
   habitat show the `pnpm install --prod` line (runner deployed `019ec02`).
2. **Repoint the entry**: set `gitUrl =
   https://github.com/The-Focus-AI/twitter-agent`, **clear `image`** (falls
   back to stock `habitat`). Gap: `update_habitat_config` exposes `gitUrl`
   but not `image` — extend the tool or PATCH via the REST/registry path.
3. **Rebuild + verify** (order matters — each check gates the next):
   - boot logs: clone → mise → `pnpm install --prod` clean;
   - `/mcp` lists all six twitter tools;
   - bookmarks works with the **prod** volume's live refresh token
     (merge-on-reseed #205 preserves it — do NOT wipe the volume);
   - SaaS attach still healthy (agent card name/credentials, A2A chat);
   - **run the automated gate**: `scripts/test-twitter-habitat.sh` in the
     habitats repo (on the Gaia host) — 10 checks including card JWT +
     credential `configured` flags, the identity-mismatch diagnostic text
     (regresses if the repo sync is stale), bearer A2A roundtrip, and the
     registry `url`. All 10 must pass before soak starts;
   - per-user chain: one SaaS room message as a connected user returns
     real bookmarks (verifies JWT dispatch → streaming speaker → per-user
     token, the 2026-07-10 chain).
4. **Soak ≥ a few days** with the baked image still present on the host.
   Rollback during soak = restore `image: twitter-habitat` on the entry +
   `rebuild` (volume untouched, so tokens survive both directions).
5. **Retire the machinery** (one PR): `Dockerfile.twitter-habitat` + its
   `.dockerignore`, `packages/habitat/twitter-habitat/{entrypoint.sh,seed-config.mjs}`,
   the build line in `deploy/gaia/redeploy.sh`,
   `scripts/smoke-twitter-habitat.sh`, runbook §1 in `deploy/gaia/README.md`.
   Decide `examples/twitter-habitat`'s fate (delete or leave a pointer —
   the repo is canonical now).

**Deploy-loop invariant after this phase**: umwelten pushes never rebuild
twitter's business logic again; `git push` to twitter-agent + `rebuild` is
its whole deploy.

## Phase 2 — GitHub App hardening (ADR 0004)

1. Register/confirm the **@habitats** App; verify `GITHUB_APP_*` env on the
   prod host (mint path already implemented — boot tokens + `POST
   /github/token`).
2. **Read-list scoping**: `twitter-agent` is public → its ambient read
   token must be an explicit read-list (own repo + declared needs), never
   org-wide read (ADR 0004 blind spot #1).
3. Branch-protection rulesets on habitat repos (App not on bypass list).
4. Flip ADR 0004 → accepted; record the installation repo allowlist.

## Phase 3 — Runtime plane to GCP (per the 2026-07-10 report)

Goal: same stack, GCE host, managed logging/backup. No code changes.

Motivation sharpened 2026-07-10: the current 7.6 GB / no-swap host logged
45 kernel OOM kills in 30 days (accelerating); one storm took the twitter
habitat down for 11 hours because children run `RestartPolicy=no` and
nothing restarts them (#229). Two #229 gaps move with us unless fixed
here — Ops Agent alerting is NOT self-healing:

- **Child restart policy / supervision**: start habitat children with
  `--restart unless-stopped` (or have Gaia supervise health and restart),
  respecting intentionally-stopped entries. An OOM'd habitat must come
  back on its own on the new host too.
- **Runner watchdog**: the self-hosted runner's broker session can die
  (observed 2026-07-10: socket errors after the OOM storm) while GitHub
  still shows the runner online — deploys queue silently forever. Add a
  systemd watchdog or a queued-run-age alert when re-registering the
  runner on GCE.

1. **Provision**: `e2-standard-4`, Debian + Docker + Ops Agent (not COS),
   100 GB pd-balanced, static IP reserved, firewall 80/443 only, SSH via
   IAP. Scheduled disk snapshots (covers `/opt/gaia-data` **and**
   `/var/lib/docker/volumes` in one policy).
2. **Logging**: `gcplogs` as daemon-default log driver (dual logging keeps
   `docker logs`/`agent_logs` working); uptime check on Gaia `/health`;
   disk + error-rate alerts. Runtime logs only — Source Sessions never
   ship to Cloud Logging (see report § Logging).
3. **Migrate state**: stop children → copy `/opt/gaia-data` (registry,
   vault, sessions, App key) → copy named volumes (`docker run --rm -v
   vol:/data alpine tar c` piped over SSH) — volumes carry habitat-rotated
   per-user tokens that exist nowhere else. Copy `deploy/gaia/.env`.
4. **Cut over**: `docker network create gaia-net` → `docker compose up -d`
   → start each habitat → verify (R1 runbook) → repoint DNS
   `*.<base-domain>` + `gaia.<base-domain>` to the new IP → re-register the
   self-hosted runner → decommission the old host after TTLs + one soak day.
5. Rollback: old host stays intact until decommission; DNS back is the
   whole revert.

### Phase 3 execution record (2026-07-13)

**New host provisioned**: `gaia-host`, e2-standard-4, us-east4-c in
`habitats-502314`, static IP **136.107.82.171**, 100 GB pd-balanced with
daily snapshots (14-day retention), firewall 80/443 + IAP-only SSH,
Debian 12 + Docker (gcplogs default) + Ops Agent + 4 GB swap via
`deploy/gcp/gaia-host-startup.sh`. gcloud in this repo is pinned to the
project via `mise.toml` (`CLOUDSDK_ACTIVE_CONFIG_NAME=habitats`).

**Pancake inventory (what moves)** — everything is one unit behind one
caddy on one `gaia-net`:

| What | Detail | Move method |
|---|---|---|
| Gaia + 6 running habitats | twitter, web-research-agent, help, bens-tesla, twitter-workspace, waffle — all `habitat` image, caddy labels `<id>.habitats.thefocus.ai` | compose up + `start` per entry (registry.json travels in gaia-data) |
| `/opt/gaia-data` (1.3 MB) | registry, vault, `github-app.pem`, sessions, fnox.toml | tar over SSH at cutover |
| Named volumes (237 MB total) | incl. stopped habitats' volumes (demo, jwtprod, smoke, standards-agent, tesla-news — per-user tokens live there) + `caddy_data` (certs — copying avoids Let's Encrypt re-issue/rate limits) | per-volume alpine tar stream |
| `pancake-thefocus-ai` nginx | serves pancake.thefocus.ai from `/home/hermes_user/microsites/pancake-root` (170 MB) | rsync + one `docker run` with the same caddy label |
| GitHub Actions runner | systemd `actions.runner.The-Focus-AI-umwelten.gaia-host` under `worker_user`, repo at `/home/worker_user/umwelten` | fresh registration on GCE (+ the #229 watchdog) — never copy runner state |
| Tailscale | pancake is a tailnet node + exit-node offer | fresh `tailscale up` on GCE (needs interactive auth) |

**Prep already done on gaia-host**: worker_user + umwelten clone, staged
`deploy/gaia/.env` (17 vars, 0600), `habitat` + `twitter-habitat` images
built. Total state to move is ~410 MB → single-pass copy inside the
cutover window; no pre-sync needed.

**Cutover runbook** (est. 10–15 min downtime; requires go-ahead):

1. Pancake: `docker stop` children + gaia (leave caddy — it serves a 502,
   which is honest downtime).
2. Copy `/opt/gaia-data`, all `gaia-*` volumes + `caddy_data`/`caddy_config`,
   and the microsites dir (tar over SSH, ~410 MB).
3. GCE: `docker compose up -d` in `deploy/gaia/` (bundled caddy shape),
   start the nginx microsite container with its caddy label, then start
   each habitat through Gaia's API.
4. Flip Cloudflare DNS: `*.habitats.thefocus.ai`, `gaia.habitats.thefocus.ai`,
   `pancake.thefocus.ai` → 136.107.82.171 (short TTL beforehand).
5. Register the Actions runner on GCE (labels `self-hosted, gaia`) with a
   systemd watchdog; disable pancake's runner service.
6. Verify: R1 runbook + `scripts/test-twitter-habitat.sh` (habitats repo)
   + one SaaS room message per attached habitat.
7. Rollback at any point: restart pancake's containers + flip DNS back —
   pancake stays frozen-but-intact until soak passes.

### Cutover executed 2026-07-13 — VERIFIED ✅

Timeline (all times UTC, ~90 min end to end, fleet downtime ~2 h wall):
runner disabled + fleet stopped on pancake → 13 volumes + gaia-data +
microsites copied (~410 MB over IAP) → bring-up on gaia-host (Gaia + all
6 habitats healthy first pass) → runner `gaia-host-gce` online
(`Restart=always` watchdog) → DNS flipped → **10/10 on
`scripts/test-twitter-habitat.sh`** (health, JWT card, credential flags,
identity diagnostic, live A2A LLM roundtrip, registry, auth logging).
All six habitat cards + gaia /health + pancake microsite serve on
136.107.82.171 with the migrated certs.

Deviations from plan:
- **gcplogs deferred**: the default compute SA lacks
  `logging.logWriter`/`monitoring.metricWriter` and the IAM grant needs
  the operator (classifier-blocked for the agent). Docker runs
  `json-file` (50m×3 rotation) until the grants land; then flip
  `/etc/docker/daemon.json` back to gcplogs + `systemctl restart docker`.
  Ops Agent metrics are also blocked on the same grant.
- **pancake.thefocus.ai record**: still on 188.245.167.69 at verification
  time (old nginx serves it) — must move before Hetzner decommission.

Open items (soak period):
1. ✅ DONE 2026-07-13: IAM grants landed (operator), gcplogs live
   (per-container entries in `gcplogs-docker-driver` log), Ops Agent
   clean, uptime check `gaia-health` (5 min period) + three alert
   policies (uptime failure, memory >90%, disk >85%) → email channel.
   Note: the gcplogs flip required a docker daemon restart, and only
   caddy/nginx auto-recovered — gaia + all children needed manual
   starts. Direct, fresh evidence for item 3.
2. Operator: `pancake.thefocus.ai` A record → 136.107.82.171 (still on
   Hetzner; old nginx serves it meanwhile).
3. Code: `--restart unless-stopped` for children in
   `DockerManager.startContainer` (#229) — next PR, redeploys via the new
   runner.
4. Tailscale: SKIPPED by decision (IAP SSH suffices; don't advertise a
   GCE exit node — egress billing).
5. After soak: remove pancake's offline runner registration, cancel the
   Hetzner box (rollback window closes).

## Phase 4 — Platform evolution (triggered, not scheduled)

- **`ContainerBackend` seam**: extract the interface from `DockerManager`
  (start/stop/status/logs/seed/write/childUrl/build). Also fixes #235
  (child URL strategy becomes explicit instead of assuming Docker DNS).
- **Cloud Build + Artifact Registry**: prod pulls images instead of
  building the monorepo on the host; removes the runner-builds-prod
  coupling.
- **GKE Autopilot driver** — trigger conditions (any one): habitat count
  presses the VM's RAM; a customer needs isolation/SLA; single-host blast
  radius becomes unacceptable. Re-evaluate Cloud Run Instances (Preview)
  at that moment.

## Housekeeping

- PR #203 (June standalone-twitter-agent + clone-based provisioning) is
  superseded by `019ec02` + this plan — close it.
- Issue #156 (twitter production cutover HITL runbook) overlaps #236 —
  link or consolidate.

## Standing rules during all phases

- Never wipe a habitat volume during migration — per-user rotated tokens
  live only there (merge-on-reseed #205 is the protection; volume deletion
  bypasses it).
- Runtime logs ≠ Source Sessions: transcripts stay on volumes/snapshots,
  never in the logging pipeline.
- One phase in flight at a time; the prior phase's rollback path stays
  live until the next phase starts.
