# Gaia Host Deployment (`pi-durable`)

Gaia runs as a **single-container, zero-Docker-socket `GaiaHost`** (`packages/habitat/Dockerfile`) built on `@earendil-works/pi-durable` and `@leocavalcante/pi-a2a` (A2A 1.0).

## Architecture

- **Single Node 24 container (`gaia`)**: No `/var/run/docker.sock` mount and no per-agent child containers.
- **Transactional SQLite per Habitat**: Each Habitat persists under `/opt/gaia-data/habitats/<id>/habitat.sqlite` (using Node 24's built-in `node:sqlite`) with declarative metadata in `/opt/gaia-data/habitats-registry.json`. Idle Harnesses are evicted from RAM automatically after 10 minutes while keeping cron `wakeTimer`s armed.
- **Dual Auth (`jwt+bearer`)**: Accepts comma-separated operator keys in `GAIA_API_KEY` (constant-time SHA-256 comparison) and per-speaker ES256/RS256 JWTs verified against `GAIA_JWKS_URL`, isolating A2A conversations per `(tenant, speaker)`.

## HTTP Surface

- `GET /health` — Host readiness, runtime (`"pi-durable"`), auth mode, default model, registered count, and warm Habitat IDs.
- `GET /.well-known/agent-card.json` & `POST /a2a` — Root `"gaia"` orchestrator Habitat (with `host_status`, `list_models`, `list_habitats`, `upsert_habitat`, `ask_habitat`, `delete_habitat` tools).
- `GET /habitats/:id/.well-known/agent-card.json` & `POST /habitats/:id/a2a` — Child Habitat `:id` A2A 1.0 endpoints (also routed via `https://<id>.$GAIA_BASE_DOMAIN` when `GAIA_BASE_DOMAIN` is set).
- `GET|POST /api/habitats`, `GET|PUT|DELETE /api/habitats/:id`, `POST /api/habitats/:id/ask` — Authenticated operator REST control plane.

## Continuous Deploy & Rollback

Pushes to `main` touching `packages/habitat/**`, `packages/pi/**`, `packages/protocols/**`, `packages/cli/**`, `packages/umwelten/**`, or `deploy/gaia/**` trigger `.github/workflows/deploy-gaia.yml` on the `[self-hosted, gaia]` runner, executing [`deploy/gaia/redeploy.sh`](./redeploy.sh).

`redeploy.sh` saves the running image as `habitat:previous`, builds the new image, smoke-tests the CLI bundle with `--network none`, recreates `gaia`, verifies live HTTPS `/health`, `/.well-known/agent-card.json`, `401` unauthenticated gate, and `200` authenticated `/api/habitats`, and automatically rolls back to `habitat:previous` if any check fails.
