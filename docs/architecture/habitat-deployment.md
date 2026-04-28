# Habitat Deployment

> Portable deployment plan for habitats: GCP, Vercel, AWS, Fly, VPS, local.

## Context

The marketing pitch on thefocus.ai promises a "production AI system that carries your team's rules, learns from decisions, and runs autonomously" — with bulletproof traceability, scoped credentials, and autonomous execution. The habitat code today delivers ~40% of that story locally:

- **Production-ready**: MCP HTTP server with OAuth + PKCE + Postgres-backed OAuth state (`src/habitat/mcp-serve/`, currently using Neon's HTTP driver but the interface is a generic `McpServeStore`), JSONL session transcripts (`src/habitat/transcript.ts`), secrets file (`src/habitat/secrets.ts`), `X-Forwarded-*`-aware URL handling that works on any PaaS (`src/habitat/mcp-serve/public-url.ts`).
- **Half-built**: single global provider/model (`HabitatConfig.defaultProvider` + `defaultModel` — no multi-provider table), skills pulled per-habitat from git with no vetted registry (`src/stimulus/skills/loader.ts`, `src/mcp/client/remote.ts`), Discord/Telegram bridge works but has no bot-token mgmt or failover.
- **Missing**: no Dockerfile, `src/habitat/tools/run-project/` is an empty shell, no container entrypoint, web UI auth is hardcoded `dev`, no central audit/event stream, no multi-tenant isolation.

Goal: close the gap so that `dotenvx run -- pnpm run cli habitat deploy --target <gcp|vercel|aws|vps|local>` takes a local habitat directory and produces a self-running, audited service with vetted skills/MCP tools, configurable providers, durable state, and log/audit that a customer can actually point at during a sales call.

### Portability principle

We should **not** hard-couple to GCP. The runtime needs to work on anything that can run a Node container or serverless handler. That means three clean abstractions with per-target adapters:

| Abstraction | What it does | Adapters |
|---|---|---|
| **RuntimeTarget** | How the process is launched + how requests reach it | Cloud Run, Vercel Functions, AWS Lambda/ECS, Fly.io, bare Docker on VPS |
| **StateBackend** | Sessions, OAuth state, audit rows | **Postgres** (works everywhere — Neon/Supabase/RDS/local), **SQLite** (single-VPS, dev), **fs** (local only) |
| **BlobSink** | Transcript/audit object storage with versioning | GCS, S3, R2, Vercel Blob, local filesystem |

The "Neon" thing today is just **Postgres accessed over HTTP**. The schema in `src/habitat/mcp-serve/neon-store.ts` is plain SQL — `CREATE TABLE`, `INSERT`, `SELECT`. Switching to `pg`/`postgres.js` gets us RDS, Supabase, any Postgres on a VPS with zero schema changes. We don't care which Postgres. We should just care that **Postgres is the state backend**, and the driver is a thin adapter.

## Design

### Phase 1 — Runtime shape (portable container + adapters)

Borrow from `docs/integration-access-patterns.md` (`foundtain-creek` baseline): secret manager + per-target auth + CI-driven deploys. Build it target-neutral from day one:

1. **Add `Dockerfile` at repo root** — multi-stage Node 22, runs `pnpm run cli habitat serve` on `$PORT`. Same image ships to Cloud Run, ECS/Fargate, Fly, and `docker run` on a VPS. Vercel is the one exception (see adapter below).
2. **New CLI command `habitat serve`** in `src/cli/habitat.ts` — wraps `Habitat.create()` + `startGaiaServer()` and binds to `PORT`. Reuses existing `src/habitat/gaia-server.ts`. This is the single entrypoint every target calls.
3. **New `RuntimeTarget` adapters** in `src/habitat/deploy/`:
   - `gcp.ts` — Cloud Run + Secret Manager + Cloud Build (`foundtain-creek` pattern)
   - `aws.ts` — ECS Fargate + Secrets Manager + CodeBuild, OR Lambda container for cheap/low-traffic
   - `vercel.ts` — one `api/[...habitat].ts` catch-all handler that spins up Habitat per request (stateless — see caveat below), reads secrets from Vercel env vars
   - `vps.ts` — emits a `docker-compose.yml` + `caddy` snippet + systemd unit, `habitat deploy --target vps --host user@box` rsyncs and remote-execs (reuse patterns from the `marina-skill` plugin already in your environment)
   - `fly.ts` — `fly.toml` + `fly deploy` (low effort; code already handles `X-Forwarded-*`)
   - `local.ts` — `docker compose up` on the dev machine
4. **State backend abstraction** — today `InteractionStore` is fs-only. Introduce `StateBackend` interface in `src/interaction/persistence/` with three impls:
   - `PostgresStore` — one SQL schema, swappable drivers: `@neondatabase/serverless` (HTTP, fits Vercel/Lambda), `postgres`/`pg` (TCP, fits Cloud Run/ECS/VPS). Connection string from `DATABASE_URL`. Works for Neon, Supabase, RDS, self-hosted, Docker Postgres on a VPS — we don't care, it's just Postgres.
   - `SqliteStore` — single-file, perfect for single-VPS/local deploys. Uses `better-sqlite3`.
   - `FsStore` — the current behavior, kept for local dev and tests.
   The schema in `src/habitat/mcp-serve/neon-store.ts` gets promoted out into this shared backend; `mcp-serve` becomes a consumer.
5. **BlobSink abstraction** — transcripts and audit files go to versioned object storage. Adapters: `GcsSink` (versioning on), `S3Sink`, `R2Sink`, `VercelBlobSink`, `FsSink`. Selected by config, not by runtime target (a GCP deploy can still write audit to S3 if the customer insists).

**Vercel scope (revised — it's more capable than "web only"):**

Vercel Functions + **Vercel Cron** (declared in `vercel.json`, pings a handler on schedule) + **Vercel Blob** + Neon-over-HTTP can host most of a habitat. What fits:

| Surface | On Vercel? | How |
|---|---|---|
| Web UI / HTTP API | Yes | `api/*.ts` handlers |
| MCP server + OAuth | Yes | `src/habitat/mcp-serve/` endpoints drop into `api/oauth/*.ts` — they're already stateless |
| Telegram bot | Yes | Webhook mode (`grammy` supports it). Set webhook URL to `api/telegram/webhook.ts` |
| Discord slash commands | Yes | HTTP Interactions endpoint → `api/discord/interactions.ts` (signature-verified) |
| Scheduled self-run | Yes | Vercel Cron → `api/cron/tick.ts` calls the habitat with the scheduled stimulus |
| Self-log checker | Yes | Same pattern — Cron → `api/cron/audit-check.ts` reads Postgres + pages via webhook |
| Long agent loops | Caveat | Max 300s (Pro) / 800s (Enterprise). Make long turns async: return job id, worker cron picks it up, client polls. |
| Discord **ambient** (non-slash) messages | No | Needs a gateway WebSocket — doesn't fit serverless. Use a serverful target (Cloud Run/VPS/Fly) **or** a tiny Discord-gateway-only sidecar that forwards ambient messages to the Vercel app as webhooks. |
| Local model providers (Ollama, LlamaBarn) | No | Not Vercel-specific — same on any PaaS. |

Net: Vercel is a first-class target for **most** habitats. The only hard "no" is ambient Discord — and even that has a sidecar workaround (a 50-line `discord-gateway-bridge` container on a tiny VPS that just proxies gateway events to the Vercel webhook endpoint). Document the sidecar pattern in `vercel.ts`.

### Phase 2 — Provider registry (multi-provider, scoped credentials)

Today `HabitatConfig` has one `defaultProvider`/`defaultModel` and keys come from global `process.env`. Marketing promises "scoped credentials — each habitat has isolated .env." Deliver that:

1. **Add `HabitatConfig.providers: ProviderEntry[]`** — each entry has `{ id, provider, defaultModel?, secretRef, enabled }` where `secretRef` is a Secret Manager resource name on GCP or a `secrets.json` key locally.
2. **Add `routing` block** — `{ default: providerId, overrides: { 'sessionType:web' → providerId, 'agent:foo' → providerId } }` so different surfaces can use different providers without code changes.
3. **Extend `Habitat.getDefaultModelDetails()`** (`src/habitat/habitat.ts:219`) to read from the registry and resolve secrets from the habitat secret store, not `process.env` directly. Keep the env-var fallback for dev.
4. **CLI: `habitat providers list|add|remove|test`** — `test` does a 1-token ping (we already have `src/cli/run.ts` one-shot scaffolding).

### Phase 3 — Vetted skills & MCP registry (site-wide trust)

Today skills come from `skillsFromGit` per-habitat — the owner hand-picks repos. Marketing sells "vetted and installed." Deliver:

1. **New file `src/habitat/registry/skills-registry.json`** checked into the umwelten repo — a curated list `{ id, repo, commit, description, capabilities, sha256 }`. Commit-pinned. This is the "site-wide vetted" list.
2. **Same shape for MCP servers**: `src/habitat/registry/mcp-registry.json` with `{ id, url, issuer, scopes, vendor, description }` covering our own oura-mcp, twitter-mcp, etc.
3. **CLI: `habitat skills install <id>` and `habitat mcp install <id>`** — reads the registry, verifies commit/sha, writes into habitat `config.json` as a pinned reference. Refuses unknown IDs unless `--unsafe` is passed.
4. **Boot-time verification** in `Habitat.create()` — before registering, hash-check git-cloned skills against the registry entry; log an audit event (see Phase 4) on mismatch and refuse to load unless explicitly allowed.

This gives us a defensible "our platform only runs code we've vetted" line without blocking power users.

### Phase 3.5 — Docker execution from inside a habitat (close the marketing gap)

**The marketing says**: "Code is extracted, compiled, and run in Docker containers" and "Docker containerization for physical process isolation" is the primary trust claim alongside scoped credentials.

**What's actually built today**:
- Full Dagger SDK integration lives in `src/evaluation/dagger/*` — `DaggerRunner`, `llm-container-builder.ts` that picks base images, detects deps, caches provisioning.
- `src/habitat/bridge/` has `supervisor.ts` that lifecycles per-agent MCP containers with health polling and rebuilds. Requires `AgentEntry.gitRemote`.
- `src/habitat/tools/run-project/` is **an empty directory**. This is where "run a project in a container" was supposed to live and doesn't.

**What to build**:

1. **Populate `src/habitat/tools/run-project/`** with a `run_project` tool that wraps the existing Dagger infrastructure. It's not new capability — it's wiring `DaggerRunner` (from evaluation/) into the habitat tool registry so any habitat agent can say "run this script/project in a sandbox" and get a real container.
2. **Promote Dagger out of evaluation/** — move `src/evaluation/dagger/` to `src/sandbox/dagger/` (or similar). Evaluation keeps using it; habitats use it too. Single source of truth for "run code in a container."
3. **Generic `sandbox_exec` tool** in the habitat tool set — takes `{ image, command, env, mounts, timeoutMs }`, returns `{ exitCode, stdout, stderr, durationMs }`. Under the hood: Dagger when available, falls back to local `docker run` via CLI when not. This is the primitive the LLM calls when it needs isolation.
4. **Per-target availability matrix** (honest about limits):
   - Cloud Run: Yes — Dagger engine runs in sidecar, or call a dedicated Dagger Cloud endpoint
   - VPS / local: Yes — Docker socket mounted straight in
   - Fly / AWS ECS: Yes — Docker-in-Docker or Fargate task spawn
   - Vercel / Lambda: No Docker-in-serverless. Fall back to a remote Dagger Cloud endpoint (paid) or delegate to a sidecar runner on a small VPS.
5. **Emit audit events** for every sandbox execution — `sandbox.invoked` with image digest, command, duration, exit code. This is the concrete backing for the marketing claim.

### Phase 3.6 — Git-backed habitat state (audit trail the marketing sells)

**The marketing says**: "Git provides an audit trail of every change" and habitats "learn from decisions" with full versioning.

**What's actually built today**:
- `loadSkillsFromGit()` (`src/stimulus/skills/loader.ts:144`) does `git clone --depth 1` and caches by repo slug. Read-only.
- `agent_clone` tool (`src/habitat/tools/agent-runner-tools.ts`) clones a repo into `agents/{id}/repo` and registers the agent. Read-only.
- `AgentEntry.gitRemote` (`src/habitat/types.ts:52`) records the origin. Used only by the bridge to decide whether it can build a container.
- **No commits ever get written.** Changes to `config.json`, `STIMULUS.md`, skills, or agent state mutate files in place with zero git history. The "audit trail via git" claim is vapor today.

**What to build**:

1. **Make the habitat work dir a git repo by default.** `Habitat.create()` runs `git init` if `.git` doesn't exist. Low cost, huge payoff.
2. **Auto-commit on mutation.** Every operation that writes into the work dir — `saveConfig()`, `setSecret()` (but see redaction note below), skill install, agent add/update/remove, stimulus edits — creates a commit with a structured message: `[habitat] <op> <target>` and the calling session id in the trailer. Use `simple-git` (small, async, no native deps) as the driver.
3. **Secret commits are special.** Never commit `secrets.json` values — it's in `.gitignore` from the start. Commit a `secrets.manifest.json` that lists only key names + set/unset + `updated_at`. That's the audit trail; the values stay in Secret Manager / fs.
4. **Optional git remote for cross-target persistence.** `HabitatConfig.deployment.gitRemote` — if set, every commit is pushed (async, non-blocking). This gives us three things at once:
   - **State replication** across deploy targets (deploy the same habitat to Vercel + Cloud Run by pointing both at the same remote; they sync on startup).
   - **Real audit trail** a customer can `git log` against.
   - **Rollback primitive** — `habitat rollback <sha>` is just a git checkout + reload.
5. **Pin vetted skills via git submodules or lockfile.** The Phase 3 `skills-registry.json` entries already carry `commit` SHAs; wire that to `git submodule add --reference <repo> <sha>` or a plain `skills.lock.json` with SHA pins. Boot-time verification (Phase 3 step 4) checks the actual cloned HEAD against the lock.
6. **`habitat history` CLI** — `git log` with habitat-aware formatting ("session X changed agent Y's stimulus at T"). Same data the audit log has (Phase 4), shown through a git lens.

**Caveat**: git commits are not a replacement for the append-only audit log from Phase 4. They cover *persistent state mutations*; audit covers *ephemeral events* (tool call, model call, secret read). Both are needed. Git is the "what does this habitat look like right now and how did it get here"; audit is the "what did this habitat do between T1 and T2."

### Phase 4 — Audit trail (the trust claim that actually matters)

Marketing is heavy on traceability: "every answer can be traced back to its source." Today we have per-session JSONL and that's it. Build the thinnest possible centralized audit layer:

1. **New module `src/habitat/audit/` with an `AuditLogger`** — append-only events: `session.started`, `tool.invoked`, `secret.accessed`, `model.called`, `skill.loaded`, `provider.routed`, `deploy.published`. Each event has `{ ts, habitatId, sessionId?, actor, event, payload, contentHash }`.
2. **Uses the BlobSink abstraction from Phase 1** — audit writes go through the same `BlobSink` that transcripts use. On GCP the default is `GcsSink` with object-versioning on; on AWS it's `S3Sink` with versioning + object-lock; on Vercel it's `VercelBlobSink`; on a VPS it's `FsSink` with a `chattr +a` append-only flag (or just versioned backups). Append-only-for-real (even against a compromised service account) comes from the versioning/lock feature of whichever store we pick, not from our code.
3. **Hook points**: wrap `BaseModelRunner` (`src/cognition/runner.ts`) to emit `model.called` with token counts + cost. Wrap `Habitat.getSecret()` to emit `secret.accessed`. Wrap tool execution in the existing tool registry (`src/habitat/tool-registry.ts`) to emit `tool.invoked`. The `src/cognition/observers.ts` file already exists and is heading this direction — fold into it.
4. **`habitat audit tail` / `habitat audit verify <date>`** — verify reads JSONL in order, recomputes content hashes to detect tampering, flags gaps.

This is what we point at on a demo to answer "how do you know this agent didn't do something weird."

### Phase 5 — Self-monitoring (autonomy with a safety net)

Marketing promises systems "run autonomously" on schedules. Deliver a minimum viable self-watch:

1. **`habitat schedule` command** wrapping whichever cron the target provides — Cloud Scheduler on GCP, EventBridge on AWS, Vercel Cron on Vercel, Fly machine cron on Fly, systemd timers on VPS. Shared interface: `{ name, cronExpr, endpoint, payload, auth }` translated per target. All targets hit the same `/cron/:jobName` habitat endpoint; only the dispatcher changes.
2. **Self-log checker**: reuse `src/habitat/bridge/monitor-agent.ts` (already an LLM that monitors container health) but point it at the habitat's own audit log + GCP Cloud Logging. Runs on a schedule. If it sees `error.rate > threshold` or `secret.accessed` with no corresponding `tool.invoked`, it pages (Discord webhook / email / Telegram bot — all already integrated).
3. **Health endpoint** on gaia-server: `/healthz` (liveness) and `/readyz` (DB ping + provider smoke test). Cloud Run needs this to route traffic correctly.

### Phase 6 — Deploy command (the actual `habitat deploy`)

The UX that ties it all together. `habitat deploy --target <gcp|aws|vercel|fly|vps|local>`:

1. Reads `HabitatConfig.deployment`. If unset, runs an interactive wizard extending `src/habitat/onboard.ts` (asks target, state backend, blob sink).
2. Validates target-neutral invariants: every `providers[].secretRef` resolves in the target's secret store; every `skillsFromGit` matches the vetted registry; `stateBackend` and `blobSink` are reachable.
3. Dispatches to the matching `RuntimeTarget` adapter from Phase 1:
   - `gcp` → Cloud Build → `gcloud run deploy` with `--update-secrets` (`quantificore` + `foundtain-creek`)
   - `aws` → CodeBuild → `ecs update-service` (or `lambda update-function-code` for the Lambda variant), secrets via Secrets Manager
   - `vercel` → `vercel deploy --prod`, secrets via `vercel env add`
   - `fly` → `fly deploy`, secrets via `fly secrets set`
   - `vps` → build image locally → `docker save | ssh host docker load` → `docker compose up -d`, secrets via `.env` on the remote (0600). Leans on the marina-skill patterns in your env.
   - `local` → `docker compose up` on the dev machine
4. Post-deploy, every adapter: registers `/oauth/*` if MCP is enabled (reuse `src/habitat/mcp-serve/`), runs `/healthz` probe, emits `deploy.published` audit event with target, image digest, and the adapter's generated resource IDs.

## Vercel deployment (consolidated)

The Vercel target is called out separately because it's the most serverless-native and has two documented caveats.

**Generated file layout from `habitat deploy --target vercel`:**

```
<habitat work dir>/
  vercel.json              # routes + cron declarations
  api/
    [...habitat].ts        # catch-all: web UI, HTTP API
    oauth/
      authorize.ts         # reuses src/habitat/mcp-serve/oauth/
      callback.ts
      token.ts
    mcp/
      [...].ts             # reuses src/habitat/mcp-serve/mcp-handler.ts
    telegram/webhook.ts    # grammy webhook mode
    discord/interactions.ts # signature-verified slash commands
    cron/
      tick.ts              # scheduled habitat run
      audit-check.ts       # self-log checker
      jobs/[job].ts        # per-scheduled-job endpoints
    sandbox/proxy.ts       # HMAC-signed proxy to external sandbox runner
  # everything else (config.json, STIMULUS.md, skills/) ships as repo content
```

**Mapping of habitat capabilities to Vercel primitives:**

| Habitat capability | Vercel mechanism | Source that already exists |
|---|---|---|
| HTTP server + web UI | `api/[...habitat].ts` calling `startGaiaServer()`-equivalent | `src/habitat/gaia-server.ts` |
| MCP + OAuth endpoints | individual files under `api/oauth/*`, `api/mcp/*` | `src/habitat/mcp-serve/` — already stateless handlers |
| State (sessions, OAuth, audit rows) | Neon Postgres over HTTP | extended `postgres-store.ts` from Phase 1 |
| Secrets | Vercel env vars | new `VercelEnvStore` adapter on the `SecretStore` interface |
| Transcripts + audit blobs | Vercel Blob with versioning | new `VercelBlobSink` adapter on the `BlobSink` interface |
| Scheduled runs | Vercel Cron in `vercel.json` → `api/cron/*.ts` | Phase 5 schedule command emits the crontab |
| Self-log checker | Vercel Cron → reads Postgres → webhook | Phase 5 step 2 |
| Telegram bot | webhook mode via `api/telegram/webhook.ts` | `grammy` supports this; just swap adapter config |
| Discord slash commands | HTTP Interactions at `api/discord/interactions.ts` | stateless, signature-verified |
| Discord ambient messages | Sidecar VPS runs gateway-only bridge, forwards to `api/discord/ambient.ts` | ~50 lines of discord.js on a $5/mo VPS |
| Long agent turns (>300s) | Async: handler returns `jobId`, worker cron finishes it, client polls `api/jobs/:id` | job table in Postgres |
| Docker sandboxing | `api/sandbox/proxy.ts` HMAC-signs to external sandbox runner (shared VPS) | Phase 3.5 option (b) |
| Local models (Ollama/LlamaBarn) | Not Vercel-specific — use cloud providers only | — |
| Git-backed state | Works per-request but no persistent checkout | `simple-git` in `/tmp` on each invocation, or rely on Postgres + audit log on this target |

**`vercel.json` emitted by the adapter:**

```json
{
  "functions": {
    "api/**/*.ts": { "maxDuration": 300 }
  },
  "crons": [
    { "path": "/api/cron/tick",        "schedule": "*/15 * * * *" },
    { "path": "/api/cron/audit-check", "schedule": "0 * * * *" }
  ]
}
```

Generated by the `vercel.ts` adapter from the habitat's `schedule` config + any scheduled-job definitions.

**Deploy flow** (Phase 6 step 3 for Vercel specifically):

1. `habitat deploy --target vercel` reads `deployment` config, validates `DATABASE_URL` is a Neon/HTTP-capable Postgres, verifies all secrets, validates no scheduled job exceeds 300s expected duration.
2. Runs `vercel env add` for each `providers[].secretRef` + `DATABASE_URL` + `BLOB_READ_WRITE_TOKEN`.
3. Generates `vercel.json` (crons + function config) and the `api/` directory from templates.
4. Runs `vercel deploy --prod`.
5. If habitat has Telegram: `curl` sets webhook URL to `https://<deploy>/api/telegram/webhook`.
6. If habitat has Discord slash: registers interactions endpoint at `https://<deploy>/api/discord/interactions`.
7. If habitat needs ambient Discord: prints "run `habitat sidecar deploy --target vps --host ... --parent <deploy-url>`" — doesn't auto-deploy the sidecar; customer decides.
8. Emits `deploy.published` audit event to the BlobSink.

**The two caveats, stated plainly:**

1. **Ambient Discord requires a sidecar.** 50-line `discord-gateway-bridge` container — reads `DISCORD_TOKEN` + `PARENT_URL` + `SHARED_SECRET`, holds the gateway connection, POSTs every `MESSAGE_CREATE` to `<vercel>/api/discord/ambient` with HMAC signature. Runs on any $5/mo VPS via `habitat sidecar deploy`. One sidecar host can serve multiple habitats.
2. **Sandboxed code execution requires a sandbox runner.** Vercel can't run Docker. The `api/sandbox/proxy.ts` HMAC-signs requests to a shared sandbox-runner service (a VPS running Dagger or Docker daemon); the runner enforces per-habitat quotas + per-image allowlist and returns `{exitCode, stdout, stderr}`. One shared runner can serve many Vercel habitats.

**What's preserved vs. degraded on Vercel:**

- Same CLI: `habitat deploy --target vercel` is interchangeable with `--target gcp`.
- Same config.json: provider registry, routing, skills, audit — all work identically.
- Same audit guarantees: Vercel Blob has versioning, so append-only-for-real still holds.
- Long turns must be async — good practice anyway, enforced only on Vercel.
- No git-mounted work dir between invocations — rely on Postgres-as-state + audit log for the trust story; the auto-commit git history from Phase 3.6 works if `gitRemote` is set (each function invocation pulls latest, commits, pushes) but adds latency. Default to off on Vercel, on everywhere else.

Net: Vercel is a first-class target for web/API/MCP/webhook/Telegram/slash-command/scheduled habitats. Two specific capabilities (ambient Discord, Docker sandboxing) need a small VPS sidecar — and that sidecar pattern is reusable across many Vercel-hosted habitats, so the cost amortizes.

## What's missing / open questions

Decisions to lock before starting:

1. **State backend: Postgres is the answer, but which driver is default?** `@neondatabase/serverless` is HTTP and works everywhere (including Vercel/Lambda cold starts); `postgres`/`pg` over TCP is lower latency on warm containers (Cloud Run/ECS). Recommend shipping both with auto-select: if `DATABASE_URL` looks like `postgres://...@*.neon.tech/...` or target is serverless, use HTTP driver; otherwise TCP. SQLite is available as an opt-in for single-VPS "simple mode."
2. **Do we support non-Postgres state backends?** The schema is plain SQL (no Postgres-isms yet — check `neon-store.ts` carefully for `jsonb`/`ON CONFLICT` which are Postgres-only). Recommend staying Postgres-only to avoid matrix explosion; SQLite is the one escape hatch for "just run it on my box." Explicitly not supporting MySQL/DynamoDB/Firestore unless a customer pays for it.
3. **Who owns the vetted registry?** Checked into umwelten means every update is a release. Hosted as a remote JSON at `registry.thefocus.ai/skills.json` means we can iterate but adds a network dependency at boot. I'd start checked-in, move hosted once we have >1 customer.
4. **Inter-service auth across targets:** GCP has OIDC, AWS has IAM role-assumption, Vercel has bypass tokens, VPS has "shared secret." Recommend a uniform bearer-token-via-secret-store pattern at the app layer (works everywhere) with per-target options to upgrade (OIDC on GCP, IAM on AWS) when a customer requires it.
5. **Audit log retention / redaction policy?** Transcripts contain tool args which may include secrets echoed back. Need a redaction step (pattern-match against known secret values from the habitat store) before writing to the audit sink. This is a small PR but required before we ship the trust claim. Platform-neutral.
6. **Which targets get first-class support vs "works but untested"?** Recommend: **first-class** = GCP Cloud Run, Vercel, VPS-via-Docker, local. **Second-class** = Fly, AWS ECS. **Sidecar-required** = ambient Discord on any serverless target (tiny gateway-bridge container on a $5/mo VPS forwards gateway events as webhooks). **Later** = AWS Lambda. This bounds the QA surface.
7. **Multi-tenant vs single-tenant deploys?** Today one habitat per service is fine and matches the "scoped credentials" marketing. Multi-tenant (one service, many habitat configs) is a v2 problem — don't build it yet.
8. **Docker-in-serverless:** Vercel/Lambda can't run Docker. Three options: (a) use a paid Dagger Cloud endpoint, (b) run a small sidecar sandbox-runner on a VPS that the serverless habitat calls via HTTPS + HMAC, (c) tell customers "if you need sandbox execution, don't pick Vercel." Recommend (b) as the default — single shared sandbox-runner VPS can serve many Vercel-deployed habitats cheaply.
9. **Auto-commit granularity**: commit every mutation (noisy history, perfect audit) or batch per-session (quieter history, some lost audit precision)? Recommend per-mutation with `[habitat]` prefix so `git log --grep` filters easily; optionally collapse with `git rebase -i` per-session for a clean narrative view. The underlying audit log (Phase 4) has the exact-time precision anyway, so we can afford to keep git history terse.

## Critical files to modify

- `src/habitat/types.ts` — extend `HabitatConfig` with `providers`, `routing`, `deployment` (target + stateBackend + blobSink + secretManager).
- `src/habitat/habitat.ts:219` — rewrite `getDefaultModelDetails()` to use provider registry.
- `src/habitat/secrets.ts` — abstract behind a `SecretStore` interface with adapters: `FsSecretStore` (current), `GcpSecretManagerStore`, `AwsSecretsManagerStore`, `VercelEnvStore`.
- `src/habitat/gaia-server.ts` — add `/healthz`, `/readyz`, production auth middleware.
- `src/habitat/mcp-serve/neon-store.ts` — **rename to `postgres-store.ts` + split driver**: one file defines the SQL + interface, another picks `@neondatabase/serverless` vs `postgres` based on `DATABASE_URL` or explicit config. Extend schema to cover sessions + audit tables.
- `src/cli/habitat.ts` — add `serve`, `deploy`, `providers`, `skills`, `mcp`, `audit`, `schedule` subcommands.
- `src/cognition/observers.ts` (already exists) — becomes the audit event emitter for model calls.
- **New directories**:
  - `src/habitat/deploy/` — one file per target (`gcp.ts`, `aws.ts`, `vercel.ts`, `fly.ts`, `vps.ts`, `local.ts`) implementing a shared `RuntimeTarget` interface
  - `src/habitat/audit/` — `AuditLogger`, event types, `verify.ts`
  - `src/habitat/registry/` — `skills-registry.json`, `mcp-registry.json`, loader
  - `src/habitat/git/` — `simple-git` wrapper, auto-commit hooks, `history.ts`, secret-manifest generation
  - `src/habitat/tools/run-project/` — finally populate it: `run_project.ts` wrapping the promoted Dagger runner
  - `src/sandbox/` — Dagger runner promoted out of `src/evaluation/dagger/`, plus a `docker-cli` fallback and a `sandbox_exec` tool
  - `src/interaction/persistence/postgres-store.ts`, `sqlite-store.ts` (alongside existing fs store)
  - `src/habitat/blob/` — `BlobSink` interface + `gcs.ts`, `s3.ts`, `r2.ts`, `vercel-blob.ts`, `fs.ts` adapters
- **New repo-root files**: `Dockerfile`, `docker-compose.yml` (local target), `cloudbuild.yaml` (GCP), `fly.toml` template (Fly).

## Verification

- Unit: `PostgresStore` round-trips a session against a Dockerized Postgres in CI (works for Neon/RDS/self-hosted since it's just Postgres); `SqliteStore` round-trips the same test suite; `AuditLogger` events hash correctly and `audit verify` catches a tampered line.
- Integration: `dotenvx run -- pnpm tsx scripts/examples/deploy-smoke.ts` builds a minimal habitat, runs `habitat deploy --target local` (Docker Compose with Postgres sidecar), hits `/healthz`, sends a chat, asserts audit events landed in the blob sink.
- E2E, per target (manual, once each): deploy to `focus-ai-sandbox` GCP project, verify `habitat audit verify` against GCS; deploy to a throwaway VPS and do the same against the filesystem sink; deploy web-only variant to Vercel and confirm the webhook path lands events in Postgres.
- Portability smoke test: same `config.json` + same image, just swap `deployment.target` and `DATABASE_URL`. If anything behaves differently between targets that isn't explicitly documented (Vercel's stateless caveat), that's a bug.
- Pre-existing test failures (Ollama, result-analyzer cost) stay out of scope.
