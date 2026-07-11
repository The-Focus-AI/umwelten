# Production topology — repos, the GitHub App, GCP, Gaia, and the habitats SaaS

> Status: proposed lock-in — 2026-07-11. Companion to ADR 0003 (per-user
> identity), ADR 0004 (Gaia as GitHub App), and
> `reports/2026-07-10-gaia-on-gcp-deployment-strategy.md` (why the runtime
> plane is a GCE VM now, GKE later). This doc is the system-of-systems view:
> who talks to whom, over what credential, and what you do when it breaks.

## The three planes

```
┌─ CODE PLANE (GitHub, the-focus-ai org) ─────────────────────────────┐
│  umwelten (platform monorepo)      habitat repos (twitter-habitat…) │
│  standards (private corpus)        @habitats GitHub App             │
└──────────┬──────────────────────────────────┬───────────────────────┘
           │ push→main: self-hosted runner    │ clone/pull/push via
           │ (platform deploy loop)           │ 1-hour minted tokens
┌──────────▼──────────────────────────────────▼───────────────────────┐
│  RUNTIME PLANE (GCP — one GCE VM, Stage 1)                          │
│  caddy-docker-proxy ── *.habitats.thefocus.ai (wildcard TLS)        │
│  Gaia (DooD, socket) ── App private key ── master secret vault      │
│  child habitats: gaia-<id> containers, volumes, gaia-net DNS        │
│  Cloud Logging (gcplogs) · Ops Agent · uptime checks · snapshots    │
└──────────┬──────────────────────────────────────────────────────────┘
           │ A2A (per-user JWT or bearer) · control API (bearer)
┌──────────▼──────────────────────────────────────────────────────────┐
│  CONTROL/UX PLANE (habitats SaaS — habitats.thefocus.ai)            │
│  Clerk auth → per-user JWTs (JWKS) · webhook hub for GitHub events  │
│  /workstreams · /audit · notifications · per-user token push        │
└──────────────────────────────────────────────────────────────────────┘
```

## Current state vs locked target (the honest delta)

**How the Twitter habitat gets its code TODAY: baked image from the
umwelten monorepo — NOT the GitHub App.** `deploy/gaia/redeploy.sh` builds
`twitter-habitat` from `packages/habitat/Dockerfile.twitter-habitat`
(context: umwelten repo root, `examples/twitter-habitat/` baked in) on every
push to umwelten main. The standalone `the-focus-ai/twitter-habitat` repo
does not exist yet (verified 2026-07-11). The GitHub App *runtime* is built
— `entrypoint.sh` prefers App-minted boot tokens, `docker.ts` injects
`GITHUB_TOKEN`/`GITHUB_WRITE_TOKEN`, Gaia serves `POST /github/token`
(commits 3caaeb8, 74b0bab) — but no habitat is repo-backed yet. ADR 0004
rollout step 4 (extract twitter-habitat, registry entry → base image +
`gitUrl`, retire the Dockerfile) is the missing piece.

Why this matters: today the Twitter habitat's business logic is coupled to
the **platform** deploy loop — every umwelten push rebuilds and cycles it.
The locked architecture separates the loops:

| Loop | Trigger | Path | Blast radius |
|---|---|---|---|
| **Platform deploy** | push to `umwelten` main | self-hosted runner → `redeploy.sh` → rebuild base images → restart Gaia → cycle running children | everything (rare, deliberate) |
| **Habitat deploy** | push to `<habitat>` repo main | Gaia `rebuild` → entrypoint `git pull --ff-only` via minted token → restart | that habitat only |

## Locked decisions

1. **One GitHub App (@habitats), key held only by Gaia** (ADR 0004). Gaia
   is the sole minting authority; per-habitat two-token bundles (ambient
   read + origin-pinned write), 1-hour TTL, boot injection + pull-to-refresh
   via `POST /github/token`, every mint audit-logged. The App's installation
   repo list is the outer blast-radius boundary.
2. **Habitat code lives in per-habitat repos** (initially private),
   provisioned by `gitUrl` on the shared base image. Custom per-habitat
   Dockerfiles are retired once a habitat is repo-backed. "Push → rebuild"
   is the whole habitat deploy. The umwelten monorepo ships the *platform*
   (runtime, Gaia, base images), never habitat business logic.
3. **Runtime plane is GCP, staged** (per the 2026-07-10 report): GCE VM
   running the existing `deploy/gaia/` compose stack verbatim now; a
   `ContainerBackend` seam extracted from `DockerManager`; GKE Autopilot
   driver when habitat count/isolation demands it. Images move to
   Cloud Build + Artifact Registry (pull, not build, on the host) as part
   of Stage 2 — this also decouples the self-hosted runner from building.
4. **The SaaS is the human surface and the GitHub-event hub** (ADR 0004
   decision 5): webhooks land at its receiver and forward to Gaia; runs
   surface in /workstreams; grants (one-time/standing) and the audit log
   live there. Users authenticate via Clerk; per-user JWTs (ADR 0003)
   verify at Gaia and children (dual-auth with service bearers).
5. **Two log streams, never conflated**: runtime logs (stdout/stderr →
   `agent_logs` / Cloud Logging, dev/debug, retention-bounded) vs Source
   Sessions (JSONL on volumes, business record, egressed to host,
   snapshot-covered). See the GCP report § Logging.

## Credential map (who holds what)

| Credential | Held by | Scope | Rotation |
|---|---|---|---|
| @habitats App private key | Gaia host only (`0600` file under `/opt/gaia-data`, outside vault JSON) | mints everything | two-key overlap: generate → deploy → revoke |
| Minted read/write tokens | child containers (env, 1h TTL) | per-habitat declared capabilities | automatic (TTL); pull route refreshes |
| `GAIA_API_KEY` / `HABITAT_API_KEY` (Gaia) | SaaS ↔ Gaia | Gaia control plane | manual; recreate-gaia-jwt.sh pattern |
| Per-child `HABITAT_API_KEY` (`gaia_…`) | Gaia registry + child | that child's A2A/API | regenerate + rebuild child |
| Per-user JWTs | minted by SaaS, verified via JWKS | per-user, per-audience | stateless |
| Provider keys (OpenRouter, Google…) | Gaia master vault → per-habitat `secretBindings` | per-habitat | update vault + rebuild (merge preserves habitat-rotated keys) |
| Per-user tokens (e.g. `TWITTER_REFRESH_TOKEN:<sub>`) | child volume `secrets.json` | one user, one habitat | habitat self-rotates; survives re-seed via merge (#205) |

## Runbooks

### R1 — Diagnose a running problem in production

Work down the planes; at each layer the question and the tool differ.

1. **Symptom triage (SaaS).** Which habitat, which user, which run?
   /workstreams + /audit give run id, habitat id, timestamps. A SaaS-side
   failure (attach errors, 401s) with a healthy habitat → check credential
   map above (expired grant? rotated bearer?) before touching the VM.
2. **Is the container alive? (Gaia control plane, no SSH needed.)**
   `GET /api/habitats` → status; `GET /api/habitats/<id>/health` (proxied,
   auth-injected). `not-found`/`exited` → jump to step 5.
3. **Runtime logs (dev/debug stream).** First `GET
   /api/habitats/<id>/logs?tail=200` (or the `agent_logs` tool from Gaia
   chat). For history beyond the tail or cross-habitat correlation: Logs
   Explorer filtered on the container name `gaia-<id>` (gcplogs driver
   labels), severity ≥ ERROR, time-bracketed by the run timestamps from
   step 1. This answers *"why did it crash/error"*.
4. **Source Sessions (business record).** This answers *"what did the
   agent actually say/decide/do"*: on the host,
   `pnpm run cli browse --sessions-dir /opt/gaia-data/sessions/<id>` (or
   `sessions show/messages --session-dir …`). Tool-call args, model errors
   surfaced into the conversation, and cost anomalies live here, not in
   stdout. Do not skip this layer — a "bug" is often the agent behaving
   correctly on bad instructions or a dead credential.
5. **Container/state layer (SSH via IAP, last resort).**
   `docker inspect gaia-<id>` (exit code, OOM flag), `docker exec -it
   gaia-<id> sh` (is `/data/project` cloned? did `mise install` finish? is
   `secrets.json` populated?), `docker run --rm -v gaia-<id>-data:/data
   alpine cat /data/secrets.json | jq 'keys'` (bindings present, values
   never printed). OOM → check VM headroom (Ops Agent memory chart) before
   blaming the habitat.
6. **Credential-shaped failures.** GitHub 401/404 in logs → token mint
   path: does Gaia log the grant on `POST /github/token`? Is the repo on
   the App installation list? `needs_reauth` from a tool → per-user token
   on the volume (see R3). Provider 401 → vault binding vs habitat's
   secrets.json (merge semantics mean a stale value needs a re-seed, not
   just a vault update).
7. **Escalation ladder:** habitat restart (`POST …/<id>/start` — port and
   volume are stable) → `rebuild` (re-seed + fresh tokens + git pull) →
   platform redeploy (`redeploy.sh`) → VM restore from snapshot. Each rung
   preserves volumes; note in the incident which rung fixed it — that's
   the bug's address.

### R2 — Deploy a change

- **Habitat logic** (target state): push to the habitat repo → Gaia
  `rebuild <id>`. Until twitter-habitat is extracted, its logic changes
  ride the platform loop (edit `examples/twitter-habitat` in umwelten,
  push, runner rebuilds the baked image) — this is the coupling to remove.
- **Platform/runtime**: PR to umwelten → merge to main → self-hosted
  runner runs `redeploy.sh` (rebuilds images, restarts Gaia, cycles
  *running* children; deliberately-stopped ones stay stopped). Verify:
  `/health` on Gaia, then per-habitat health, then one end-to-end chat.
- **SaaS**: its own repo/Vercel pipeline; contract surfaces to re-verify
  after either side changes: JWKS URL, A2A endpoints, webhook forwarding.

### R3 — Rotate a credential

Use the credential map. The three worth rehearsing: **App key** (two-key
overlap — upload new key to the App, replace the 0600 file, restart Gaia,
revoke old); **Gaia bearer** (`recreate-gaia-jwt.sh` derives current env;
update the SaaS attachment); **per-user token gone bad** (SaaS pushes a
fresh one via the scoped `POST /api/secrets` receiver, or re-run the OAuth
bootstrap and `rebuild` — merge keeps everything else).

### R4 — Onboard a new habitat

1. Create `the-focus-ai/<name>` from the habitat template (config.json,
   STIMULUS.md, tools/, mise.toml, tests, branch protection ruleset).
2. Add it to the @habitats App installation list (deliberate act — this is
   the blast-radius boundary).
3. Vault: add any new secrets; registry: `create_habitat` with `gitUrl`,
   capabilities (`github:read@…`, `github:write@<repo>`), secretBindings,
   hostname (or default `<id>.<base-domain>`).
4. `start` → verify health, agent card, logs, then attach in the SaaS
   (per-habitat URL + that child's own key — not Gaia's master key).

### R5 — Lose the VM

Volumes and `/opt/gaia-data` are on the snapshotted disk. Restore: create
VM from snapshot → `docker compose up -d` in `deploy/gaia/` → `start` each
habitat (registry is on the data dir; ports re-derive; caddy re-issues
certs) → re-register the self-hosted runner. DNS is wildcard → static IP:
reserve the IP so restore doesn't touch DNS. Rehearse once before relying
on it.

## Gaps to close to reach the locked state

1. **Extract twitter-habitat to its own repo** (ADR 0004 rollout step 4):
   registry → base image + `gitUrl`, retire `Dockerfile.twitter-habitat`
   and its redeploy.sh build line. This decouples the deploy loops.
2. **Register/verify the @habitats App** on the allowlist (`standards`,
   `twitter-habitat`) and confirm `GITHUB_APP_*` env on the prod host —
   the code path exists; App registration is external state. Flip ADR 0004
   to accepted when done.
3. **GCE migration per the 2026-07-10 report** (if the current host isn't
   already GCE): VM + gcplogs + Ops Agent + uptime check + snapshot
   schedule + IAP SSH.
4. **Stage-2 seam work**: `ContainerBackend` interface; Cloud Build +
   Artifact Registry so prod pulls images instead of building the monorepo.
5. **SaaS webhook → worker loop** (ADR 0004 decision 5) — blocked on the
   notifications spine per the ADR.
