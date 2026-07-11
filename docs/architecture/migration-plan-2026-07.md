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
