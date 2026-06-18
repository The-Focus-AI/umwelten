# Gaia deployment & how it spins up habitats

> Research note — 2026-06-18. Context: issue #155 ("Twitter habitat: fly.toml +
> container deploy config + runbook") assumes a standalone fly.io deploy, but the
> question on the table is whether the Twitter habitat should instead be spun up
> and coordinated by **Gaia**. This note documents how Gaia actually works today
> (from the code), where it can run, and what each path means for #155.

## TL;DR

- **Gaia spins up habitats by shelling out to the `docker` CLI on its own host.**
  It builds the `habitat` image, creates a named volume, seeds `config.json` +
  filtered `secrets.json` into it, and `docker run`s the image on a private
  `gaia-net` network with a localhost-only port (7440–7499) and an injected
  `HABITAT_API_KEY`. This is fully built and documented (`docs/guide/gaia-orchestrator.md`).
- **Therefore Gaia must run on a host where it controls a Docker daemon** — a VPS
  ("our own server") or a **GCE VM**, with Docker installed. It **cannot** run on
  fly.io or GCP Cloud Run / Vercel / Lambda, because those don't give a process the
  ability to spawn sibling containers.
- **There is no existing production deploy artifact for Gaia.** Today it's a
  dev/local tool launched with `pnpm run cli habitat gaia`. No `fly.toml`, no
  compose file, no systemd unit, no decision recorded. The aspirational
  multi-target story in `docs/architecture/habitat-deployment.md` (a `habitat deploy
  --target gcp|fly|vps|...` command, RuntimeTarget adapters) is **mostly unbuilt**.
- **Two real, divergent deploy paths exist for the Twitter habitat** (details below).
  #155 only scoped the standalone one. Picking the Gaia path changes the deliverable.

## How Gaia spins up a habitat (from the code)

Source: `packages/habitat/src/tools/gaia/{gaia.ts,docker.ts,gaia-tools/habitats.ts,gaia-tools/seed-files.ts}`.

1. **Gaia is itself a normal habitat.** `Gaia.start()` (`gaia.ts`) boots a
   `startContainerServer` on **7420** with the standard container tool sets **plus**
   a `gaiaToolSet` of ~14 orchestrator tools. So Gaia gets sessions, MCP, A2A,
   artifacts, and bearer auth for free.
2. **It owns a `DockerManager`** (`docker.ts`) constructed with `(dataDir, projectRoot)`.
   `projectRoot` is the umwelten repo root — used as the `docker build` context.
3. **`create_habitat`** (`gaia-tools/habitats.ts`) writes a registry entry, generates
   a `gaia_`-prefixed API key, and seeds the volume.
4. **`buildSeedFiles`** (`seed-files.ts`) produces exactly **two files**:
   `config.json` (the habitat config) and `secrets.json` (only the master-vault
   secrets bound to this habitat). **It does not seed custom `tools/` or `src/` code.**
5. **`start_habitat` → `DockerManager.startContainer`** runs:
   ```
   docker run -d --name gaia-<id> --network gaia-net \
     -v gaia-<id>-data:/data \
     -v <gaiaDataDir>/sessions/<id>:/data/sessions \
     --env HABITAT_API_KEY=<entry.apiKey> \
     -p 127.0.0.1:<7440-7499>:8080 \
     <image>            # default "habitat", or entry.image
   ```
6. The container's `entrypoint.sh` runs at boot. If `config.json` has a `gitUrl`,
   it **clones that repo into `/data/project/`** and runs `mise install`. Then it
   `exec`s `habitat serve --port 8080`.

### Two ways a custom-code habitat (like Twitter) gets its tools in

The default seed is config + secrets only, so the Twitter habitat's `tools/` +
`src/` must arrive one of two ways:

- **(A) Git provisioning** — `create_habitat` with a `gitUrl`; the entrypoint clones
  the agent repo into `/data/project/`. This is the documented "production agents
  live in their own repo with custom tools/skills/persona" path
  (`gaia-orchestrator.md` Part 12). It would require the Twitter habitat work dir
  to be its own git repo (or a subdir the entrypoint can target).
- **(B) Custom image** — `create_habitat({ image: "twitter-habitat" })`. Gaia runs a
  pre-built image that bakes the work dir in, instead of the default `habitat`
  image. The image must already exist on the host (`docker.ts` hard-errors if a
  named `entry.image` is missing — it only auto-builds the default `habitat` image).

## Where Gaia can run

Gaia's whole job is `docker build` / `docker run` / `docker volume` / `docker network`
against a daemon. So:

| Target | Can host Gaia? | Why |
|---|---|---|
| **Our own server / VPS** (Docker installed) | ✅ Best fit | Gaia drives the host daemon directly; sibling containers + named volumes + `gaia-net` all work as designed. |
| **GCE VM** (Docker installed) | ✅ Same as VPS | Identical model; just GCP-hosted. Pick a machine type with enough RAM for N child containers (each `[[vm]]` analog is ~1 GB). |
| **GCP Cloud Run** | ❌ | No Docker daemon; filesystem ephemeral; can't spawn sibling containers. |
| **fly.io** | ❌ for Gaia | A fly *machine* is itself a container; you don't get a host daemon to spawn siblings on. (fly is fine for a *single* habitat — see below — just not for the orchestrator.) |
| **Vercel / Lambda** | ❌ | Serverless, no Docker. |

**Containerizing Gaia itself** is possible via Docker-out-of-Docker: run the
`habitat` image (it already installs the Docker CLI — see the Dockerfile comment
"for Gaia to manage child containers via mounted socket") with
`-v /var/run/docker.sock:/var/run/docker.sock`. Gotcha: Gaia bind-mounts a host
sessions dir into each child (`hostSessionsDir`), and those paths are resolved by
the **host** daemon — so when Gaia runs in a container the bind paths must line up
with host paths. Simplest first deploy is to run Gaia **directly on the VM** (under
systemd / `pnpm run cli habitat gaia`), not containerized.

## What this means for issue #155 — two divergent paths

### Path 1 — Standalone single container (what #155 / PRD #149 scoped)

The Twitter habitat is its **own** deployable service. Work dir (config + STIMULUS
+ tools + src) baked into a custom image; a volume for `secrets.json`/sessions so
the rotated X refresh token survives restarts; `HABITAT_API_KEY` bearer auth on
`/a2a`. The habitats SaaS attaches to its A2A endpoint **directly**. Gaia is not
involved. Mirrors the existing `examples/twitter-mcp` and `examples/oura-mcp` fly
apps. Host can be fly.io **or** a VPS/GCE VM via `docker run` / compose — the image
is host-agnostic.

- ✔ Matches the ticket and the PRD exactly; smallest, self-contained.
- ✔ The SaaS attach flow (A2A endpoint + bearer) already exists end-to-end.
- ✘ Doesn't give you a coordination layer; each agent is an island.

### Path 2 — Gaia-orchestrated (what the question is really about)

Deploy **Gaia** on a Docker host (own server / GCE VM). The Twitter habitat becomes
a Gaia-managed container — provisioned by git (A) or a custom image (B), started on
`gaia-net` at a localhost port. Coordination, secret isolation, multi-habitat A2A
fan-out, and the dashboard all come from Gaia.

- ✔ Real coordination substrate; add more habitats later with no new infra.
- ✔ Secret isolation via the master vault; one place to manage many agents.
- ✘ **New, unscoped work:** Gaia has no production deploy artifact today. Need to
  (1) stand up the host, (2) deploy Gaia (systemd unit or socket-mounted container),
  (3) decide git-provisioning vs custom-image for Twitter's tools, (4) expose the
  habitats SaaS to the Twitter habitat **through Gaia's proxy** (`/api/habitats/twitter/a2a`)
  or publish the child port — the SaaS currently expects a direct A2A endpoint.
- ✘ Child containers bind to `127.0.0.1` only; reaching them from outside the host
  needs Gaia's proxy or a reverse proxy in front.

### They're not mutually exclusive

The same `habitat` image + the same work dir power both. You can ship Path 1 now
(standalone Twitter agent the SaaS chats with) and adopt Path 2 later (move it under
a Gaia you stand up), because the container is identical — only the wrapper differs.

## Open decisions (for the human)

1. **Is #155 still "standalone fly.io," or has the target shifted to a Gaia we
   stand up on our own server / GCE VM?** This decides whether the deliverable is a
   `fly.toml` + runbook, a `docker-compose`/systemd + runbook, or a Gaia-deploy +
   register-Twitter runbook.
2. **If Gaia: own server or GCE VM?** Both work identically; choice is operational
   (where the Neon DB + other services already live, cost, who administers the box).
3. **If Gaia: git-provisioning (A) or custom image (B) for Twitter's tools?** (A) needs
   the work dir to be a git repo; (B) needs an out-of-band image build + push.
4. **External reachability of a Gaia-managed Twitter habitat** for the habitats SaaS:
   through Gaia's `/api/habitats/:id/a2a` proxy, or expose the child port directly?

## Sources

- `packages/habitat/src/tools/gaia/gaia.ts` — orchestrator boot.
- `packages/habitat/src/tools/gaia/docker.ts` — `DockerManager` (build/run/seed/volume).
- `packages/habitat/src/tools/gaia/gaia-tools/{habitats.ts,seed-files.ts}` — create/start, seed files.
- `packages/habitat/Dockerfile`, `entrypoint.sh` — the shared habitat image; git provisioning.
- `docs/guide/gaia-orchestrator.md` — the operator guide (authoritative on the runtime model).
- `docs/architecture/habitat-deployment.md` — aspirational multi-target deploy (mostly unbuilt).
- Prior art: `examples/twitter-mcp/{fly.toml,Dockerfile}`, `examples/oura-mcp/{fly.toml,Dockerfile}`.
