#!/usr/bin/env bash
# Redeploy the Gaia host onto the current checkout.
#
# What it does (the manual runbook §1–§5, mechanized):
#   1. Build habitat and both derived images (twitter-habitat, habitat-coding)
#   2. Recreate the gaia service via docker compose (new image ⇒ new container)
#   3. Re-attach gaia to the ingress network (compose only attaches gaia-net)
#   4. Wait for Gaia's public /health
#   5. Cycle every RUNNING child habitat via Gaia's API — start is
#      stop+rm+fresh `docker run`, so children come back on the new image
#      (data persists on their named volumes) — and wait for each health
#
# Config comes from the compose .env. By default the one next to this script;
# CI runs from a throwaway checkout, so it points GAIA_ENV_FILE at the host's
# canonical copy instead.
#
# Requires: docker (daemon access), curl. Run as a user in the docker group.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${GAIA_ENV_FILE:-$SCRIPT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: env file not found: $ENV_FILE" >&2
  echo "hint: set GAIA_ENV_FILE to the host's canonical deploy/gaia/.env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${GAIA_HOSTNAME:?GAIA_HOSTNAME must be set in $ENV_FILE}"
: "${GAIA_API_KEY:?GAIA_API_KEY must be set in $ENV_FILE}"

GAIA_URL="https://$GAIA_HOSTNAME"
# GAIA_API_KEY may hold several comma-separated keys — Gaia accepts any of them,
# but a bearer header carries exactly one. Take the first; the whole list would
# be sent as a single token and 401 on every child cycle below.
GAIA_PRIMARY_KEY="$(printf '%s' "${GAIA_API_KEY%%,*}" | tr -d '[:space:]')"
: "${GAIA_PRIMARY_KEY:?GAIA_API_KEY must contain at least one non-empty key}"
AUTH=(-H "Authorization: Bearer $GAIA_PRIMARY_KEY")

log() { echo "[redeploy] $*"; }

wait_for() { # wait_for <label> <timeout_s> <curl args...>
  local label="$1" timeout="$2"; shift 2
  local deadline=$((SECONDS + timeout))
  until curl -sf --max-time 5 "$@" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      echo "error: timed out after ${timeout}s waiting for $label" >&2
      return 1
    fi
    sleep 2
  done
}

# The private standards corpus is independent of runtime code. Bootstrap or
# refresh it with an authorized token; routine builds reuse only the corpus
# from the last coding image, not that image's stale server/toolchain layers.
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  CODING_STANDARDS=(--secret id=gh_token,env=GITHUB_TOKEN)
else
  if ! docker image inspect habitat-coding:latest >/dev/null 2>&1; then
    echo "error: first coding-image build needs GITHUB_TOKEN with standards read access" >&2
    exit 1
  fi
  CODING_STANDARDS=(--build-context standards=docker-image://habitat-coding:latest)
fi

log "building images from $ROOT"
docker build -t habitat -f "$ROOT/packages/habitat/Dockerfile" "$ROOT"
docker build -t twitter-habitat -f "$ROOT/packages/habitat/Dockerfile.twitter-habitat" "$ROOT"
docker build "${CODING_STANDARDS[@]}" \
  -t habitat-coding -f "$ROOT/packages/habitat/Dockerfile.coding-agent" "$ROOT"

# Catch package-manager writes to the immutable workspace before taking any
# running habitat down. No network, credentials, or production data are used.
docker run --rm --network none --user node --entrypoint pnpm \
  habitat-coding exec node --version >/dev/null

log "recreating gaia"
docker compose --project-directory "$SCRIPT_DIR" --env-file "$ENV_FILE" up -d gaia

# Compose only attaches gaia-net; in the reuse-existing-caddy shape the proxy
# reaches gaia over GAIA_INGRESS_NETWORK, so re-attach after every recreate.
if [[ -n "${GAIA_INGRESS_NETWORK:-}" ]]; then
  docker network connect "$GAIA_INGRESS_NETWORK" gaia 2>/dev/null \
    && log "attached gaia to $GAIA_INGRESS_NETWORK" \
    || log "gaia already on $GAIA_INGRESS_NETWORK"
fi

log "waiting for $GAIA_URL/health"
wait_for "gaia health" 90 "$GAIA_URL/health"

# The preview router is intentionally deployed only when both of its narrow
# capabilities are configured. It joins the reused ingress network explicitly,
# just like Gaia, because compose owns only gaia-net in this deployment shape.
if [[ -n "${GAIA_PREVIEW_WAKE_KEY:-}" && -n "${GAIA_PREVIEW_ACTIVITY_KEY:-}" ]]; then
  log "recreating preview router"
  docker compose --project-directory "$SCRIPT_DIR" --env-file "$ENV_FILE" up -d preview-router
  if [[ -n "${GAIA_INGRESS_NETWORK:-}" ]]; then
    docker network connect --alias preview-router "$GAIA_INGRESS_NETWORK" gaia-preview-router 2>/dev/null \
      && log "attached preview router to $GAIA_INGRESS_NETWORK" \
      || log "preview router already on $GAIA_INGRESS_NETWORK"
  fi
  wait_for "preview router health" 60 http://localhost:7431/health \
    --resolve localhost:7431:$(docker inspect --format '{{(index .NetworkSettings.Networks "gaia-net").IPAddress}}' gaia-preview-router)
else
  log "preview router disabled — both preview capabilities are required"
fi

# Cycle only children whose container is currently running. Registry entries
# that are deliberately stopped (e.g. parked habitats) stay stopped.
mapfile -t RUNNING < <(docker ps --format '{{.Names}}' \
  | grep '^gaia-' | grep -Ev '^gaia-(caddy|preview-router)$' | sed 's/^gaia-//')

if ((${#RUNNING[@]} == 0)); then
  log "no running child habitats to cycle"
else
  for id in "${RUNNING[@]}"; do
    log "cycling habitat: $id"
    curl -sf "${AUTH[@]}" -X POST "$GAIA_URL/api/habitats/$id/stop" >/dev/null
    curl -sf "${AUTH[@]}" -X POST "$GAIA_URL/api/habitats/$id/start" >/dev/null
    wait_for "$id health" 120 "${AUTH[@]}" "$GAIA_URL/api/habitats/$id/health"
    # A healthy process may still be serving an old derived image. Exercise
    # browser auth without a service header; keep legacy-only hosts unchanged.
    docker exec "gaia-$id" node -e '
      const e = process.env;
      const issuer = e.HABITAT_AUTH_ISSUER || e.HABITAT_AUTH_JWKS_URL;
      if (e.HABITAT_ID && e.HABITAT_AUTH_AUDIENCE && e.HABITAT_API_KEY &&
          issuer && (e.HABITAT_AUTH_JWKS_URL || e.HABITAT_AUTH_PUBLIC_KEY)) {
        fetch(`http://127.0.0.1:${e.PORT || 8080}/shell/`, {
          headers: { Accept: "text/html" }, redirect: "manual",
          signal: AbortSignal.timeout(10000),
        }).then(response => {
          const location = new URL(response.headers.get("location") || "", issuer);
          if (response.status !== 303 || location.origin !== new URL(issuer).origin ||
              location.pathname !== "/auth/handoff" ||
              location.searchParams.get("habitat_id") !== e.HABITAT_ID) {
            throw new Error(`Browser login check failed (HTTP ${response.status})`);
          }
        }).catch(error => { console.error(error.message); process.exitCode = 1; });
      }
    '
    log "  $id healthy"
  done
fi

log "done — gaia + ${#RUNNING[@]} habitat(s) on the new images"
