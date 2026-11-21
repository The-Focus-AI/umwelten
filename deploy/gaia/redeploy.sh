#!/usr/bin/env bash
# Redeploy the single-container `pi-durable` Gaia HabitatHost.
#
# Steps:
#   1. Tag the currently running image (`habitat:previous`) for automatic rollback
#   2. Build `habitat` from `packages/habitat/Dockerfile` and run an offline CLI check
#   3. Recreate the `gaia` container via docker compose and attach `GAIA_INGRESS_NETWORK`
#   4. Verify `/health` (`"runtime":"pi-durable"`), `/.well-known/agent-card.json`,
#      unauthenticated 401 gate, and authenticated `/api/habitats`
#   5. Roll back automatically to `habitat:previous` if verification fails
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
GAIA_PRIMARY_KEY="$(printf '%s' "${GAIA_API_KEY%%,*}" | tr -d '[:space:]')"
: "${GAIA_PRIMARY_KEY:?GAIA_API_KEY must contain at least one non-empty key}"
PREVIOUS="habitat:previous"

log() { echo "[gaia-deploy] $*"; }

attach_ingress() {
  if [[ -n "${GAIA_INGRESS_NETWORK:-}" ]]; then
    docker network connect "$GAIA_INGRESS_NETWORK" gaia 2>/dev/null \
      && log "attached gaia to $GAIA_INGRESS_NETWORK" \
      || log "gaia already on $GAIA_INGRESS_NETWORK"
  fi
}

rollback() {
  if [[ "${HAVE_PREVIOUS:-0}" == "1" ]]; then
    log "verification failed — rolling back to $PREVIOUS"
    docker tag "$PREVIOUS" habitat
    docker compose --project-directory "$SCRIPT_DIR" --env-file "$ENV_FILE" up -d gaia
    attach_ingress
  fi
}

verify_live_surface() {
  local deadline=$((SECONDS + 90))
  local health=""
  while true; do
    health="$(curl -sf --max-time 5 "$GAIA_URL/health" 2>/dev/null || true)"
    if grep -q '"status":"ok"' <<<"$health" && grep -q '"runtime":"pi-durable"' <<<"$health"; then
      break
    fi
    if ((SECONDS >= deadline)); then
      echo "error: timed out waiting for pi-durable /health at $GAIA_URL/health (last: $health)" >&2
      return 1
    fi
    sleep 2
  done

  local card=""
  card="$(curl -sfS --max-time 5 "$GAIA_URL/.well-known/agent-card.json")" || {
    echo "error: /.well-known/agent-card.json unreachable" >&2
    return 1
  }
  grep -q 'Gaia HabitatHost' <<<"$card" || {
    echo "error: unexpected root Agent Card payload" >&2
    return 1
  }

  local unauth_code=""
  unauth_code="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "$GAIA_URL/api/habitats")"
  if [[ "$unauth_code" != "401" ]]; then
    echo "error: expected 401 on unauthenticated /api/habitats, got $unauth_code" >&2
    return 1
  fi

  curl -sfS --max-time 5 \
    -H "Authorization: Bearer $GAIA_PRIMARY_KEY" \
    "$GAIA_URL/api/habitats" | grep -q '"habitats"' || {
    echo "error: authenticated /api/habitats check failed" >&2
    return 1
  }
}

HAVE_PREVIOUS=0
if current_image="$(docker inspect -f '{{.Image}}' gaia 2>/dev/null)"; then
  docker tag "$current_image" "$PREVIOUS"
  HAVE_PREVIOUS=1
  log "saved rollback image $PREVIOUS ($current_image)"
fi

log "building habitat image from $ROOT ($(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown))"
docker build -t habitat -f "$ROOT/packages/habitat/Dockerfile" "$ROOT"

log "smoke-testing built CLI bundle offline"
docker run --rm --network none habitat \
  node packages/umwelten/dist/cli/entry.js habitat gaia --help >/dev/null

docker network inspect gaia-net >/dev/null 2>&1 || docker network create gaia-net

log "recreating gaia container"
docker compose --project-directory "$SCRIPT_DIR" --env-file "$ENV_FILE" up -d gaia
attach_ingress

log "verifying live Gaia HabitatHost at $GAIA_URL"
if ! verify_live_surface; then
  docker logs --tail 60 gaia >&2 || true
  rollback
  exit 1
fi

# Retire the obsolete preview-router container from the pre-pi-durable topology if present
if docker inspect gaia-preview-router >/dev/null 2>&1; then
  log "removing retired gaia-preview-router container"
  docker rm -f gaia-preview-router >/dev/null 2>&1 || true
fi

log "deployed successfully — Gaia HabitatHost (pi-durable) healthy at $GAIA_URL"
