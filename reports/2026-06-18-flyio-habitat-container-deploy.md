# Deploying an umwelten Habitat Container to Fly.io

**Date:** 2026-06-18
**Scope:** A single always-on Node.js container running `habitat serve`, exposing an authenticated A2A/HTTP surface on internal port **8080**, backed by a **persistent volume** for mutable state, with **secrets injected as environment variables**. Dockerfile lives at `packages/habitat/Dockerfile` and must build from the **monorepo root** as context.

> **TL;DR.** Use `min_machines_running = 1` + `auto_stop_machines = "off"` so the single machine never stops — this is the only safe config for a service that must persist a rotated OAuth refresh token to a file on its one volume. Build from the monorepo root with `fly deploy --dockerfile packages/habitat/Dockerfile` (the **CLI flag**, not just `[build]` in fly.toml, is the reliable way to keep the root as build context). Put every sensitive value in `fly secrets set` (encrypted vault, injected as env vars at boot); keep only non-sensitive config in `[env]`.

---

## 1. fly.toml structure (Dockerfile-built app with a volume)

A complete `fly.toml` for the Habitat container:

```toml
app = "umwelten-habitat"
primary_region = "iad"           # pick the region where your volume lives

[build]
  # Path to the Dockerfile, relative to the build context (the monorepo root).
  # NOTE: this field alone does NOT change the build context — see Section 6.
  dockerfile = "packages/habitat/Dockerfile"

[env]
  # Non-sensitive config ONLY. These are plaintext in the repo. Never put
  # OAuth secrets, DATABASE_URL, or the bearer key here.
  PORT = "8080"
  NODE_ENV = "production"
  HABITAT_DATA_DIR = "/data"

[mounts]
  source = "habitat_data"        # volume NAME (must already exist in the region)
  destination = "/data"          # mount point inside the machine (cannot be "/")
  initial_size = "10gb"          # only used when fly creates the volume on first deploy

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"     # never stop the machine (see Section 2)
  auto_start_machines = false
  min_machines_running = 1       # keep exactly one machine alive

[[vm]]
  size = "shared-cpu-1x"         # or set cpu_kind/cpus/memory explicitly
  cpu_kind = "shared"
  cpus = 1
  memory = "1gb"
```

Field reference ([App configuration (fly.toml)](https://fly.io/docs/reference/configuration/)):

- **`[build] dockerfile`** — relative path/URL to the Dockerfile. By default `flyctl` looks for `Dockerfile` in the app root. **Critical caveat from the docs:** *"This option will not change the Docker context path, which is set to the project root directory by default."* See Section 6 for the monorepo implication.
- **`[mounts]`** — `source` is the **volume name** (the volume must exist in some region); `destination` is the in-machine path and **cannot be `/`**; `initial_size` is consulted only by `fly launch`/`fly deploy` when creating a new volume.
- **`[http_service]`** — `internal_port` is the port your app listens on inside the container (default `8080`); `force_https` redirects HTTP→HTTPS at the Fly Proxy edge. `auto_stop_machines` accepts `"off"`, `"stop"`, or `"suspend"`.
- **`[[vm]]`** — use `size` for a preset (`fly platform vm-sizes` lists them) or set `cpu_kind` (`"shared"`/`"performance"`), `cpus` (1/2/4/8/16), and `memory` (`"1gb"`, `"512mb"`, or plain MB integer) explicitly.

> Make sure your Dockerfile path is **not** excluded by `.dockerignore`, and that anything the build needs (the whole pnpm workspace) is inside the build context and not ignored.

---

## 2. Volume persistence semantics (the most important section)

### How Fly volumes relate to machines

A Fly volume is a slice of NVMe storage pinned to one physical host. The pairing is strictly one-to-one ([Volumes overview](https://fly.io/docs/volumes/overview/)):

> *"A Machine can only mount one volume at a time and a volume can be attached to only one Machine."*

For a single-machine Habitat that's exactly what we want: one machine, one volume at `/data`.

### Survival across restart and redeploy

Volume data is **durable across machine restarts and redeploys**. The ephemeral root filesystem is wiped on every restart; the volume is not. The docs say to use a volume *"for any information that needs to persist after deploy or restart."* So a rotated OAuth refresh token written to `/data/oauth/refresh-token.json` survives `fly deploy`, secret updates, machine restarts, and crashes.

### The scale-to-zero gotcha (this is the trap)

The Fly default that `fly launch` writes is `auto_stop_machines = "stop"`, `auto_start_machines = true`, `min_machines_running = 0` ([Autostop/autostart](https://fly.io/docs/launch/autostop-autostart/)). For a stateless web app that's fine. For a single-volume stateful service it is dangerous:

- The volume cannot move hosts. With only one machine, all your state lives on that one machine's volume.
- With `min_machines_running = 0`, the proxy stops the machine when idle. The data still exists on the NVMe slice (it is not deleted), but **the service is down until a request wakes it**, and any in-process state, in-flight token rotation, or background timer is lost on stop. A suspended/stopped machine with a volume **still bills you for the volume** ([community thread](https://community.fly.io/t/setting-a-minimum-number-of-instances-to-keep-running-when-using-auto-start-stop/12861)).
- `fly launch` only ever provisions **one** machine when a volume is mounted, because *"volumes don't automatically replicate your data"* — you would have to set up replication yourself before adding machines.

### Correct config for a token-persisting, always-on service

`min_machines_running` has **no effect** unless `auto_stop_machines` is `"stop"` or `"suspend"`. Two valid always-on shapes:

**Option A — fully disable autostop (recommended for this service):**

```toml
[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = false
  min_machines_running = 1
```

**Option B — allow autostop but always keep one:**

```toml
[http_service]
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1
```

Both keep one machine running in the primary region. For a service that owns a rotated OAuth refresh token and must respond to A2A traffic at any time, **Option A** is the cleanest: the machine simply never stops, so background token refresh and any in-memory session state stay alive, and the volume is always mounted and writable.

> `min_machines_running` only applies to the **primary region**; it does not keep machines alive in secondary regions. For this single-machine deploy that's irrelevant — keep everything in one region matching the volume.

**Durability caveat:** a single volume on a single host is a single point of failure. Fly does **not** replicate volume data automatically. For a refresh token you cannot afford to lose, also rely on Fly's automatic volume **snapshots** (default 5-day retention) and/or write the token to your Postgres `DATABASE_URL` as the source of truth, treating the file on the volume as a cache ([Volumes overview](https://fly.io/docs/volumes/overview/)).

---

## 3. Secrets vs `[env]`

Use the right channel for each value ([App secrets](https://fly.io/docs/apps/secrets/)):

| Channel | Storage | Use for |
|---|---|---|
| `fly secrets set` | Encrypted in a vault, decrypted and **injected as env vars at boot** | X OAuth client id/secret/refresh token, `DATABASE_URL`, `HABITAT_API_KEY` bearer token, all Tavily/provider API keys |
| `[env]` in fly.toml | **Plaintext** in your repo | `PORT`, `NODE_ENV`, non-secret paths/flags |

Key facts:

- **Injection.** When a machine launches, the Fly host agent decrypts your secrets and injects them as environment variables at boot. Your Node process reads them with `process.env` exactly like the `[env]` values — no code change needed to switch a value from `[env]` to a secret.
- **Setting a secret triggers a restart.** *"`fly secrets set` … updates each Machine belonging to that Fly App. This involves a restart of the Machine and a consequent reset of its ephemeral file system."* The volume at `/data` survives that restart, so a persisted refresh token is unaffected — but be aware each `secrets set` bounces the machine.
- **Batch + stage.** Set multiple secrets in one command to incur a single restart, or use `--stage` to defer the restart until your next `fly deploy`:

```bash
# All at once (one restart):
fly secrets set \
  X_CLIENT_ID="..." \
  X_CLIENT_SECRET="..." \
  X_REFRESH_TOKEN="..." \
  DATABASE_URL="postgres://user:pass@host/db" \
  HABITAT_API_KEY="$(openssl rand -hex 32)"

# Stage now, apply on next deploy (no immediate restart):
fly secrets set HABITAT_API_KEY="..." --stage
```

- **Warning from the docs.** Secrets are readable by your own application code. *"People with deploy access can deploy code that reads secret values and prints them to logs."* Make sure Habitat never logs `process.env` wholesale.
- `fly secrets list` shows names + digests (never values); `fly secrets unset NAME` removes one.

> **Initial refresh token vs rotated token.** Seed the initial OAuth refresh token via `fly secrets set X_REFRESH_TOKEN=...`. After that, the rotated token should be written by the app to a file on the **volume** (`/data/...`) — secrets are read-only to the app at runtime, so the volume is the right place for the value that changes.

---

## 4. First-time, single-container deploy commands

Recommended order of operations for an app needing a volume + secrets **before** first deploy:

```bash
# 0. (optional) Authenticate
fly auth login

# 1. Scaffold WITHOUT deploying, so you can edit fly.toml first.
#    --no-deploy lets you fix the build/mounts/secrets before going live.
fly launch --no-deploy --name umwelten-habitat --region iad
#    Or, to skip flyctl's scanners entirely and use a hand-written fly.toml:
#    fly apps create umwelten-habitat

# 2. Edit fly.toml: set [build] dockerfile, [mounts], [http_service] (Section 1-2).
#    GOTCHA: `fly launch` regenerates/overwrites fly.toml from its scanners and
#    may flip auto_stop_machines back to "stop" and min_machines_running to 0,
#    and may not preserve your [build]/[mounts] block. Re-check the file after
#    every `fly launch`. Prefer `fly apps create` + hand-written fly.toml if you
#    want full control.

# 3. Create the volume in the SAME region as primary_region.
fly volumes create habitat_data --size 10 --region iad -a umwelten-habitat
#    --size is in GB. The volume NAME must match [mounts] source.

# 4. Set secrets (batch them — see Section 3). These stage onto the app.
fly secrets set \
  X_CLIENT_ID="..." X_CLIENT_SECRET="..." X_REFRESH_TOKEN="..." \
  DATABASE_URL="postgres://..." HABITAT_API_KEY="$(openssl rand -hex 32)" \
  -a umwelten-habitat

# 5. First deploy — build from monorepo root (see Section 6).
fly deploy --dockerfile packages/habitat/Dockerfile -a umwelten-habitat
```

Notes:

- **`fly launch` overwrites fly.toml.** Treat any `fly launch` re-run as destructive to your hand-edited `[build]`/`[mounts]`/autostop settings. Diff the file afterward.
- `fly volumes create` with `--size N` creates an `N` GB volume; it must be in the same region as the machine that will mount it.
- Setting secrets before the first deploy means they're present at first boot.

---

## 5. Verifying the deployed container

```bash
# App + machine state, region, and (when expanded) mounts
fly status -a umwelten-habitat
fly status --all -a umwelten-habitat

# Live logs — confirm `habitat serve` bound to 0.0.0.0:8080 and secrets loaded
fly logs -a umwelten-habitat

# Confirm the volume exists and is attached to the machine
fly volumes list -a umwelten-habitat
#   -> shows the volume id, name (habitat_data), size, region, and ATTACHED machine id

# Inspect a machine to see its mounts and config
fly machine list -a umwelten-habitat
fly machine status <machine-id> -a umwelten-habitat

# Hit the public health/A2A endpoint (force_https is on)
curl -i https://umwelten-habitat.fly.dev/health

# Authenticated A2A surface — bearer token = the HABITAT_API_KEY secret
curl -i https://umwelten-habitat.fly.dev/.well-known/agent.json \
  -H "Authorization: Bearer $HABITAT_API_KEY"

# Confirm secrets are present (names only, never values)
fly secrets list -a umwelten-habitat

# Optional: open a shell on the machine and verify the mount + persisted token
fly ssh console -a umwelten-habitat
#   then inside: ls -la /data && mount | grep /data
```

What "good" looks like:

- `fly status` shows **one** machine, state `started`, in your primary region, and (with `--all`/machine status) a mount at `/data`.
- `fly volumes list` shows `habitat_data` **attached** to that machine.
- `fly logs` shows the server listening on port 8080 and no "secret undefined" errors.
- The health endpoint returns 200 over HTTPS; the A2A endpoint rejects unauthenticated requests and accepts the bearer token.

---

## 6. Building from a non-root context (the monorepo question)

**This is the subtle one.** From [App configuration](https://fly.io/docs/reference/configuration/) and the [monorepo guide](https://fly.io/docs/launch/monorepo/):

- The **build context** (the files shipped to the builder) defaults to the **project root** — i.e., the directory `fly deploy` runs from (or its `[WORKING_DIRECTORY]` argument).
- The `[build] dockerfile` field / `--dockerfile` flag only chooses **which Dockerfile** to use. Per the docs: *"This option will not change the Docker context path."*

So the two knobs are independent:

- **Working directory argument** → sets the build context (what files Docker can see).
- **`--dockerfile`** → which Dockerfile, **relative to that working directory**.

### Recommended for this repo

Run from the **monorepo root** and point at the nested Dockerfile with the flag:

```bash
# cwd = monorepo root  => build context = monorepo root (entire pnpm workspace)
fly deploy --dockerfile packages/habitat/Dockerfile -a umwelten-habitat
```

This gives the Dockerfile access to the whole workspace (root `pnpm-workspace.yaml`, `package.json`, all `packages/*`) while building from `packages/habitat/Dockerfile`. The Dockerfile's `COPY` paths are relative to the **root**, e.g. `COPY packages/habitat ./packages/habitat`.

**Does `[build] dockerfile = "packages/habitat/Dockerfile"` in fly.toml alone work?** It selects the right Dockerfile, and because the docs state the context defaults to the project root, running `fly deploy` from the monorepo root *should* keep the root as context. **But** the reliable, documented pattern is the explicit `--dockerfile` flag run from the root — the config-file `[build] dockerfile` field is less consistently honored for context across flyctl behavior, and the monorepo docs only demonstrate the CLI flag. Use the flag; keep the fly.toml field too for documentation, but don't rely on it alone.

**Anti-pattern to avoid:** `fly deploy packages/habitat` (passing the subdir as the working directory). That would make `packages/habitat` the build context, and the Dockerfile would lose access to the rest of the workspace — breaking any `pnpm install` that needs the root lockfile/workspace.

Ensure the **root `.dockerignore`** does not exclude `packages/`, `pnpm-lock.yaml`, or `pnpm-workspace.yaml`.

---

## Quick reference checklist

- [ ] `fly.toml`: `[build] dockerfile = "packages/habitat/Dockerfile"`, `[mounts]` source `habitat_data` → `/data`, `[http_service]` `internal_port = 8080` + `force_https`.
- [ ] `auto_stop_machines = "off"`, `auto_start_machines = false`, `min_machines_running = 1` (never scale this stateful service to zero).
- [ ] Volume created in the **same region** as `primary_region`.
- [ ] All credentials via `fly secrets set` (one batched call); only non-sensitive config in `[env]`.
- [ ] Rotated OAuth refresh token written to a file on the **volume** (`/data/...`), with Postgres as the durable backstop; initial token seeded as a secret.
- [ ] Deploy from monorepo root: `fly deploy --dockerfile packages/habitat/Dockerfile`.
- [ ] Re-diff `fly.toml` after any `fly launch` (it overwrites your edits).
- [ ] Verify with `fly status`, `fly volumes list`, `fly logs`, and an authenticated curl to the A2A endpoint.

---

## Sources

1. [App configuration (fly.toml) reference — Fly Docs](https://fly.io/docs/reference/configuration/)
2. [Volumes overview — Fly Docs](https://fly.io/docs/volumes/overview/)
3. [App secrets — Fly Docs](https://fly.io/docs/apps/secrets/)
4. [Autostop/autostart Machines — Fly Docs](https://fly.io/docs/launch/autostop-autostart/)
5. [Monorepo and multi-environment deployments — Fly Docs](https://fly.io/docs/launch/monorepo/)
6. [Create and launch a new app — Fly Docs](https://fly.io/docs/launch/create/)
7. [flyctl deploy command reference — Fly Docs](https://fly.io/docs/flyctl/deploy/)
8. [Resilient apps use multiple Machines — Fly Docs](https://fly.io/docs/blueprints/resilient-apps-multiple-machines/)
9. [Keeping a minimum number of instances running — Fly.io Community](https://community.fly.io/t/setting-a-minimum-number-of-instances-to-keep-running-when-using-auto-start-stop/12861)
10. [Deploying a monorepo application from the root directory — Fly.io Community](https://community.fly.io/t/how-to-correctly-deploy-a-monorepo-application-from-the-root-directory/25592)
