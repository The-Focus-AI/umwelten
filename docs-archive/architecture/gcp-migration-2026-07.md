# Migrating the Gaia host to Google Cloud (July 2026)

> Status: proposed — 2026-07-13. Dedicated migration runbook for moving the
> production Gaia/umwelten runtime plane off the `pancake` box onto GCP.
> Companion to [migration-plan-2026-07.md](./migration-plan-2026-07.md) — this
> is the executable detail behind that plan's **Phase 3**. Driven by chronic
> memory exhaustion; see § Why now.

## Why now (the RAM problem)

`pancake` — the single box running Gaia, every habitat container, the Caddy
proxy, **and** the self-hosted CI runner — is out of headroom:

- **7.6 GB RAM, zero swap.** Any spike goes straight to the kernel OOM killer.
- **37 OOM kills in the last 7 days**, accelerating (1 on Jun 29 → 23 on Jul 10).
  Each one can take down a habitat child (they run `RestartPolicy=no`, so an
  OOM'd container stays dead until noticed — an 11-hour Twitter outage on
  Jul 10 came from exactly this).
- **Disk pressure**: 38 GB volume, ~82% used, with **6.8 GB of Docker images +
  5.3 GB of build cache** — because prod images are *built on the host* by the
  in-box runner.
- **The runner is itself a liability**: its broker session wedges (online but
  not pulling jobs), silently stalling every deploy. It blocked deploys ~4
  times over the Jul 11–13 weekend (tracked in #229).

Two of these are structural, not "add more RAM" problems: the single-host blast
radius, and the runner-builds-prod coupling. GCP fixes the RAM ceiling
immediately and sets up the path to fix the other two.

## What we're moving

Same stack, new host — **no code changes** (Phase 3 invariant). The moving
parts:

| Thing | Where it lives on `pancake` | Size | Notes |
|---|---|---|---|
| Gaia state | `/opt/gaia-data` (bind mount) | ~1.3 MB | `registry.json`, `secrets.json` (master vault), `sessions/`, `github-app.pem` |
| Habitat data | 11 named Docker volumes (`gaia-*-data`) | ~230 MB | **carries per-user rotated X refresh tokens that exist nowhere else** |
| Ingress | `caddy` container (caddy-docker-proxy) | — | `GAIA_BASE_DOMAIN=habitats.thefocus.ai`, `*.habitats.thefocus.ai` |
| Config | `deploy/gaia/.env` | — | `GAIA_API_KEY`, `GAIA_BASE_DOMAIN`, `GAIA_INGRESS_NETWORK`, GitHub App vars, Neon `DATABASE_URL` |
| CI runner | `~/actions-runner` (systemd) | — | Re-register on the new host, or retire in favor of Cloud Build |

The habitats **SaaS** is already on Vercel/Neon — nothing to move there. This is
purely the Gaia runtime plane.

## Target shape

- **`e2-standard-4`** (4 vCPU, **16 GB RAM**) — 2× current RAM, the headroom the
  OOM data demands, at ~$100/mo. Not `e2-medium`/`e2-small`: the fleet already
  idles at ~2 GB and spikes on concurrent LLM turns + image builds.
- **Debian 12 + Docker** (not Container-OS — we need arbitrary `docker build`
  and bind mounts, and COS fights both).
- **100 GB pd-balanced** — 3× current disk; image + build-cache growth is the
  disk pressure, so give it room.
- **Static external IP**, reserved before cutover (DNS points at it).
- **Ops Agent** for memory/disk/error metrics + alerting (see § Observability).
- **Firewall**: 80/443 ingress only; SSH via **IAP** (no public SSH).
- **Scheduled snapshots** of the boot disk — one policy covers `/opt/gaia-data`
  **and** `/var/lib/docker/volumes` (the per-user tokens) since both are on the
  boot disk.

## Migration runbook

Each step is reversible until the DNS cutover; the old host stays intact until
decommission.

### 1. Provision (no traffic yet)
```
gcloud compute addresses create gaia-ip --region <region>
gcloud compute instances create gaia \
  --machine-type e2-standard-4 --image-family debian-12 --image-project debian-cloud \
  --boot-disk-size 100GB --boot-disk-type pd-balanced \
  --address gaia-ip --no-service-account --no-scopes \
  --shielded-secure-boot
# harden: firewall 80/443 in, SSH via IAP only; install Docker + Ops Agent
```

### 2. Install the stack
- Docker + compose plugin; `git clone` umwelten; create the `caddy` network
  (`GAIA_INGRESS_NETWORK`).
- Copy `deploy/gaia/.env` over (secrets — move it out-of-band, e.g.
  `gcloud compute scp`, never through a repo or this transcript).

### 3. Migrate state (children stopped)
Stop the children on `pancake` first so no token rotates mid-copy (a rotated
single-use X refresh token copied before rotation is dead on arrival).
```
# on pancake: stop children via Gaia API, then:
sudo tar czf - -C /opt gaia-data | ssh gaia 'sudo tar xzf - -C /opt'
# each named volume — carries per-user tokens:
for v in $(sudo docker volume ls -q | grep '^gaia-'); do
  sudo docker run --rm -v $v:/data alpine tar cf - -C /data . \
    | ssh gaia "sudo docker volume create $v && sudo docker run --rm -i -v $v:/data alpine tar xf - -C /data"
done
```
**Never `docker volume rm` or wipe a volume during this** — merge-on-reseed
(#205) is the protection, and a wipe bypasses it (standing rule from the
companion plan).

### 4. Bring up + verify (still no public traffic)
- `docker compose up -d gaia`, attach it to the `caddy` network (else 503s),
  start each habitat via the Gaia API.
- Verify per habitat: `/api/habitats/<id>/health` → `auth:"jwt+bearer"`; and the
  full per-user chain on one habitat — a live `@Twitter` bookmarks pull
  returning real data proves JWT dispatch → speaker → per-user token survived
  the volume copy. Run `scripts/test-twitter-habitat.sh` (habitats repo) as the
  gate — 10 checks, all must pass.

### 5. Cut over DNS
- Repoint `*.habitats.thefocus.ai` and `gaia.habitats.thefocus.ai` A records to
  the reserved GCP IP. **Lower TTLs a day ahead** so cutover is minutes not
  hours.
- Re-register the self-hosted runner on the new host (or skip — see § Fix the
  coupling).

### 6. Soak + decommission
- Keep `pancake` intact (children stopped, not deleted) for one soak day. DNS
  back to the old IP is the entire rollback.
- After TTLs expire + a clean soak, decommission `pancake`.

## Carry the #229 fixes with us (don't re-inherit the OOM class)

The move gives more RAM but two failure modes follow unless fixed **during**
the migration — Ops Agent *alerts*, it doesn't *self-heal*:

- **Child restart policy**: start habitat containers `--restart unless-stopped`
  (or have Gaia supervise + restart). An OOM'd child must come back on its own.
- **Runner watchdog**: the broker-session wedge that blocked deploys all
  weekend follows the runner to GCE. Add a systemd watchdog / queued-run-age
  alert — or remove the runner entirely (below).

## Fix the coupling (the strategic win, Phase 4-adjacent)

The single biggest structural problem — bigger than RAM — is that **prod images
are built on the prod host by an in-box runner**. That's what fills the disk
(12 GB of images + cache), couples deploys to a flaky runner, and competes with
the fleet for memory during builds. The GCE move is the moment to break it:

- **Cloud Build + Artifact Registry**: build images off-host, prod *pulls* them.
  Removes the runner-builds-prod coupling, the build-cache disk bloat, and the
  build-time memory contention in one move.
- Then Gaia's redeploy becomes "pull the new tag + cycle children" — no host
  build, no wedge-prone runner in the hot path.

This is optional for the lift-and-shift (steps 1–6 stand alone) but it's the
reason to prefer GCP over just a bigger box: it's the platform for removing the
coupling, not just more RAM to paper over it.

## Observability (Ops Agent)

- `gcplogs` as the default Docker log driver in **dual mode** so `docker logs`
  and Gaia's `agent_logs` keep working locally while runtime logs ship to Cloud
  Logging.
- **Runtime logs only** — habitat Source Sessions / transcripts stay on the
  volumes and snapshots, never in the logging pipeline (they're user data).
- Uptime check on Gaia `/health`; alerts on available-memory < 1 GB, disk > 85%,
  and habitat-child error rate.

## When to go further (GKE — not now)

Trigger conditions for GKE Autopilot (any one): habitat count presses the VM's
RAM again; a customer needs isolation/SLA; single-host blast radius becomes
unacceptable. Re-evaluate Cloud Run Instances at that moment. Until then, one
well-sized VM + Cloud Build is the right cost/complexity point.

## Standing rules (unchanged from the companion plan)

- Never wipe a habitat volume during migration — per-user rotated tokens live
  only there.
- Runtime logs ≠ Source Sessions: transcripts never enter the logging pipeline.
- One phase in flight at a time; the old host's rollback path stays live until
  decommission.
