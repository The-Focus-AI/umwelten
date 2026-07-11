# Gaia on Google Cloud — deployment strategy

> Research note — 2026-07-10. Question: Gaia currently orchestrates habitats by
> driving a Docker daemon (`packages/habitat/src/tools/gaia/docker.ts`,
> deployed via `deploy/gaia/docker-compose.yml` as Docker-out-of-Docker). How
> should this run on GCP — a container platform? Kubernetes? What's the right
> strategy? Builds on `reports/2026-06-18-gaia-deployment-and-habitat-orchestration.md`
> (which established Gaia can't run on Cloud Run/fly/Vercel *as-is*) with
> verified July-2026 GCP pricing and product status.

## TL;DR

- **Now: lift the current stack onto a single GCE VM.** Debian + Docker on an
  `e2-standard-4` (~$108/mo list, ~$68/mo with a 1-yr CUD, incl. 100 GB disk)
  runs `deploy/gaia/` **verbatim** — compose, caddy-docker-proxy, named
  volumes, self-hosted runner CD, everything. The runbook already documents
  this as equivalent to a VPS. Zero code change.
- **Not Cloud Run for the orchestrated children.** Habitats are long-lived
  (Discord/Telegram gateways, scheduled work — no scale-to-zero) and stateful
  (POSIX appends to JSONL transcripts, self-rotated `secrets.json` on a
  per-container volume). Cloud Run has no per-instance POSIX volume (GCS FUSE
  is last-write-wins, flush-on-close — it can silently lose the transcript
  tail), no `docker exec`/`cp` analog (SSH-into-container is Preview), and
  worker pools have **no inbound URL** while services cap inbound WebSockets
  at 60 min and replace instances at will. The economics also don't help:
  always-on instance-based billing ≈ $26/mo per small habitat — the
  scale-to-zero savings that justify Cloud Run never materialize for this
  workload.
- **Kubernetes (GKE Autopilot) is the right *managed* target — but only at
  scale.** It is the one managed option that preserves every primitive Gaia
  uses today (table below). At 10 always-on habitats it's ~$130–140/mo with
  marginal habitat cost ~$10/mo, undercutting Cloud Run and approaching the
  VM. But it costs a driver rewrite + new ingress/build/secrets plumbing.
  Adopt it when the VM's capacity or blast radius becomes the problem, not
  before.
- **The cheap insurance to buy now:** extract a `ContainerBackend` interface
  from `DockerManager`. The class is already a clean seam (~15 methods, no
  Docker types leak into callers). That single refactor makes the eventual
  GKE (or Cloud Run Instances, see below) move mechanical instead of
  architectural.

## What Gaia actually requires of its substrate

From `docker.ts` + `deploy/gaia/`:

| # | Primitive | Today (Docker) |
|---|---|---|
| 1 | Spawn/stop/rebuild long-lived containers programmatically | `docker run -d` / `stop` / `rm` via CLI |
| 2 | Per-habitat persistent POSIX volume (`/data`) | named volume `gaia-<id>-data` |
| 3 | Host-visible session files (#119 egress, `umwelten browse`) | bind mount `<dataDir>/sessions/<id>` |
| 4 | Seed/merge files into the volume (config, merged `secrets.json`) | one-shot Alpine container + `docker exec`/`cp` |
| 5 | Container-to-container addressing | embedded DNS on `gaia-net` (`http://gaia-<id>:8080`) |
| 6 | Logs + status for the dashboard/tools | `docker logs` / `inspect` |
| 7 | Per-habitat public HTTPS on wildcard subdomains | caddy-docker-proxy labels + `*.GAIA_BASE_DOMAIN` |
| 8 | Image build on deploy | `docker build` on host (BuildKit, monorepo root context) |
| 9 | Boot-time env injection (API key, GitHub tokens, JWKS) | `--env` flags at `docker run` |
| 10 | Long-lived outbound WebSockets (Discord/Telegram gateways) | just a process in a container |

Any GCP option is judged by how many of these survive.

## Option analysis

### A. GCE VM — lift and shift (recommended now)

Same model as the current VPS; the deploy runbook (`deploy/gaia/README.md` §0)
already treats them as interchangeable. All 10 primitives survive untouched.

- **Cost:** `e2-standard-2` (2 vCPU/8 GB) ≈ $49/mo; `e2-standard-4`
  (4 vCPU/16 GB) ≈ $98/mo; 100 GB pd-balanced ≈ $10/mo. 1-yr CUD ≈ −37%.
  Each habitat is ~1 GB RAM, so e2-standard-4 comfortably hosts Gaia + caddy
  + ~10 habitats.
- **Image choice:** plain **Debian + Docker + Ops Agent**, not
  Container-Optimized OS. COS's read-only root and *no Ops Agent support*
  make the compose/caddy/self-hosted-runner setup awkward; the auto-updating
  minimalism isn't worth it here.
- **GCP conveniences over a bare VPS:** scheduled disk snapshots (named
  volumes live in `/var/lib/docker/volumes`, so one snapshot policy covers
  all habitat state + `/opt/gaia-data`), IAP-tunneled SSH (no public 22),
  firewall closed to 80/443, Ops Agent → Cloud Logging, shielded VM.
- **Honest downsides:** single point of failure, pet-server ops, vertical
  scaling only, and the docker-socket mount remains host-root (mitigated as
  today: Gaia caddy-fronted + bearer-gated, 7420 never exposed).

### B. Cloud Run — wrong shape for the orchestrator's children

The control-plane side is actually fine: the Admin API v2 can create/delete
services *and* worker pools programmatically (180 writes/min, 1,000
services/region — plenty). What breaks is the data plane:

- **State (primitives 2–4):** no per-instance persistent disk. GCS FUSE
  volumes explicitly document *"last write wins and all previous writes are
  lost"* for concurrent writes, stage writes in memory until close/fsync
  (crash loses the JSONL tail), and do non-atomic renames. Filestore/NFS has
  real POSIX semantics but a **1 TiB / ~$164/mo minimum**. Going this route
  honestly means finishing the `StateBackend` work from
  `docs/architecture/habitat-deployment.md` (Postgres for sessions/secrets)
  first — a rearchitecture, not a deploy.
- **Runtime shape (primitive 10):** worker pools (GA Apr 2026) are built for
  exactly this — always-on, CPU-always, no request model — **but expose no
  inbound URL at all**, and habitats must serve HTTP (A2A, chat, artifacts).
  Services with instance-based billing + min-instances=1 work, but instances
  are replaced at Google's discretion (gateway reconnect churn) and inbound
  WebSockets die at 60 min.
- **Networking/ingress (5, 7):** no embedded-DNS analog; children become
  `*.run.app` URLs + IAM ID-token auth; wildcard subdomains need a global LB
  + Certificate Manager. All buildable, all new plumbing.
- **Economics:** ~ $26/mo per always-on 0.5 vCPU/512 MiB service (list) —
  ~$260/mo for 10 habitats, with none of Cloud Run's scale-to-zero upside.
- **Where Cloud Run *is* right:** a **standalone single habitat** (the fly.io
  path in the 06-18 report) that's webhook-driven — Telegram in webhook mode,
  MCP servers, A2A endpoints — especially once its state is in Postgres.
  Also **watch "Cloud Run Instances"** (Preview, Next '26): an
  individual-instance primitive pitched verbatim at "long-running background
  agents," plus SSH-into-container. If it GAs with persistent-ish volumes,
  it becomes a credible `ContainerBackend` driver target.

### C. GKE Autopilot — the correct managed endgame

The only managed substrate where every primitive has a 1:1 mapping:

| Docker today | GKE equivalent |
|---|---|
| `docker run` per habitat | Deployment (or StatefulSet) per habitat, via `@kubernetes/client-node` |
| named volume | per-habitat PVC (pd-balanced, $0.10/GiB-mo) — real POSIX appends |
| seed via alpine one-shot / `docker exec` | init container / `pod exec` API (same trick, K8s API) |
| `gaia-net` embedded DNS | cluster DNS (`gaia-<id>.habitats.svc`) |
| `docker logs` / `inspect` | pods log/status API |
| caddy labels + wildcard | one Gateway + Certificate Manager **wildcard cert via DNS auth**; controller stamps an HTTPRoute per habitat |
| `docker build` on host | Cloud Build → Artifact Registry (needed anyway for any managed path) |
| `--env` injection | pod env + Secret Manager CSI |
| socket-mount = host root | namespaced RBAC service account — *better* than today |

- **Cost:** ~$0.0445/vCPU-hr + ~$0.0049/GiB-hr on requested resources;
  $73/mo cluster fee **netted to ~$0 by the monthly Autopilot credit** for
  the first cluster. 10 habitats at 0.25 vCPU/512 MiB ≈ $99 + $10 PVCs +
  ~$20 LB ≈ **$130–140/mo**, marginal habitat ≈ **$10/mo**.
- **Cost of admission:** rewrite `DockerManager` → `KubernetesManager`
  (mechanical if the interface is extracted first — ~200 lines against the
  K8s API), move builds to Cloud Build, replace caddy with Gateway API,
  rethink #119 session egress (sessions land on PVCs, not a host dir —
  either a sidecar syncing to GCS, or point `browse` at an API). Plus
  actually operating a cluster, however "auto" the pilot.
- **When it pays:** > ~10–15 always-on habitats, per-customer isolation/SLA
  requirements (GKE Sandbox for untrusted habitat code), or when one VM's
  blast radius is no longer acceptable.

### Ruled out

- **Vertex AI Agent Engine / Gemini Enterprise Agent Runtime:** hosts custom
  containers now, but ~2× Cloud Run pricing ($0.0864/vCPU-hr), per-event
  session billing, an agent-serving HTTP contract, and no evidence it
  tolerates persistent outbound gateway connections. Wrong abstraction —
  it wants to *be* the habitat framework we already have.
- **Cloud Run jobs / GCE MIGs / cluster-per-habitat:** wrong lifecycle,
  overkill, operational non-starter respectively.

## Recommended strategy

**Stage 1 (now) — GCE VM, zero code.** `e2-standard-4`, Debian + Docker +
Ops Agent, 100 GB pd-balanced with scheduled snapshots, IAP SSH, 80/443 only.
Run `deploy/gaia/` exactly as on the VPS; point `*.GAIA_BASE_DOMAIN` DNS at
the VM; install the self-hosted runner. ~$68–108/mo all-in.

**Stage 2 (small PR, anytime) — extract the seam.** Define
`ContainerBackend` (start/stop/status/logs/seedFiles/writeFile/childUrl/
buildImage/volumeExists/removeVolume) and make `DockerManager` its first
implementation. Also move image builds to **Cloud Build + Artifact Registry
even for the VM** (pull instead of build on host) — it removes the biggest
CD divergence between VM and any managed future, and drops the "build the
monorepo on the prod box" requirement.

**Stage 3 (triggered, not scheduled) — GKE Autopilot driver.** Triggers:
habitat count pressing the VM's RAM, a customer needing isolation/SLA, or
the single-host blast radius becoming a sales objection. Implement
`KubernetesManager`, Gateway API wildcard ingress, Secret Manager. Re-check
**Cloud Run Instances** at that moment — if it has GA'd with suitable volume
semantics, it may be a cheaper driver to write than GKE.

Orthogonal at every stage: standalone webhook-shaped habitats (Twitter-style,
Telegram-webhook, MCP servers) can go to Cloud Run/fly individually per the
06-18 report — Gaia orchestration and per-habitat serverless deploys aren't
mutually exclusive.

## Logging

Three distinct streams; don't conflate them. In particular, **runtime logs**
(container stdout/stderr — operational/debug output for development and
testing) are a different thing from **Source Sessions** (the JSONL
conversational record — business logic), even though runtime logs
incidentally echo streamed conversation content. Rules: transcripts never
ship to Cloud Logging (wrong retention/cost, breaks the digester/browse
consumers); Cloud Logging is never the durable record (exclusion-filtered,
30-day expiry). Coding agents need access to *both*, routed by tool
descriptions: "what did the agent say/decide" → `sessions_*` tools;
"why did it crash/error" → `agent_logs` (and later a `query_logs` tool on
the Cloud Logging API — richer than `--tail`, and the substrate the Phase-5
self-log checker needs).

**1. Runtime logs: container stdout/stderr → Cloud Logging via the `gcplogs` driver.**
Set `"log-driver": "gcplogs"` in `/etc/docker/daemon.json` (daemon-level
default — every habitat Gaia spawns inherits it, no `DockerManager` change).
Each container arrives tagged with its name (`gaia-<id>`), so Logs Explorer
filters per-habitat. Docker ≥ 20.10 **dual logging** keeps a local ring
buffer (~5×20 MB/container) so `docker logs --tail` still works — Gaia's
`getLogs()` ([docker.ts:476](../packages/habitat/src/tools/gaia/docker.ts)),
the dashboard Logs view, and `agent_logs` are unaffected. Alternative:
keep `json-file` + Ops Agent file-tailing with a JSON parser; if so, set
`max-size`/`max-file` rotation (chatty agents fill disks).

**2. Host metrics/syslog → Ops Agent** (the reason for Debian over COS).
Gives the operational safety net: log-based alert on error patterns,
disk >80% alert (transcript growth), and a Cloud Monitoring **uptime check
on `https://gaia.<domain>/health`**.

**3. Source Sessions (conversational JSONL) are state, not logs.** They stay on the
bind-mounted sessions dirs / named volumes (browse, digester, egress #119
all read them there), covered by disk snapshots. For off-box durability:
periodic `gsutil rsync` to a versioned GCS bucket — which is also the
Phase-4 audit/BlobSink shape from `docs/architecture/habitat-deployment.md`.

Cost: Cloud Logging ingestion ~$0.50/GiB after 50 GiB free/project/month,
30-day default retention; add exclusion filters for known-noisy patterns.

Later stages: **GKE** ships pod stdout/stderr to Cloud Logging automatically
with pod labels (`KubernetesManager.getLogs()` reads the pods/log API —
another argument for the `ContainerBackend` seam); **Cloud Run** standalone
habitats get per-service logs with zero config. Centralizing on Cloud
Logging from Stage 1 also gives Phase 5's "self-log checker" agent a real
query substrate (Logging API) instead of parsing `docker logs` text.

## Key facts (verified 2026-07-10)

- Cloud Run worker pools GA Apr 2026; managed via Admin API v2
  `projects.locations.workerPools`; **no inbound URL**; GCS FUSE/NFS volumes
  only. ([docs](https://docs.cloud.google.com/run/docs/deploy-worker-pools))
- GCS FUSE: no concurrency control ("last write wins"), writes staged until
  close/fsync, non-atomic rename — unsuitable as primary store for
  append-critical JSONL. ([docs](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts))
  **Cloud Storage Rapid** zonal buckets (GA, Next '26) have native appendable
  objects via API — a future transcript target worth watching.
- Cloud Run services: inbound WebSocket ≤ 60 min; instance-based billing
  required for outbound gateways (request-based throttles CPU between
  requests); ~$26/mo per always-on 0.5 vCPU/512 MiB; 1,000 services/region,
  180 Admin API writes/min. ([pricing](https://cloud.google.com/run/pricing), [quotas](https://docs.cloud.google.com/run/quotas))
- GKE Autopilot: pod-resource billing (~$0.0445/vCPU-hr, ~$0.0049/GiB-hr),
  $73/mo cluster fee offset by free-tier credit for one cluster; min pod
  50m CPU/52 MiB; wildcard certs via Gateway API + Certificate Manager DNS
  auth. ([pricing](https://cloud.google.com/kubernetes-engine/pricing))
- GCE: e2-standard-2 ≈ $49/mo, e2-standard-4 ≈ $98/mo, pd-balanced
  $0.10/GiB-mo; Ops Agent **not** supported on Container-Optimized OS.
- Filestore minimum ≈ $164/mo (1 TiB Basic HDD) — rules out NFS-per-habitat.
- Unverified/flagged: Google's own worker-pool pricing example ($11.61/mo)
  vs list-rate arithmetic (~$31/mo) for the same config — reconcile in the
  Pricing Calculator before cost-modeling worker pools.

## Sources

- `packages/habitat/src/tools/gaia/docker.ts` — the full Docker surface Gaia uses.
- `deploy/gaia/{README.md,docker-compose.yml}` — current production shape (DooD + caddy-docker-proxy + self-hosted runner CD).
- `reports/2026-06-18-gaia-deployment-and-habitat-orchestration.md` — why Cloud Run/fly can't host Gaia as-is.
- `docs/architecture/habitat-deployment.md` — the (mostly unbuilt) multi-target plan; its `StateBackend`/Postgres work is the prerequisite for any serverless child runtime.
- GCP docs & pricing pages as linked inline (fetched 2026-07-10).
