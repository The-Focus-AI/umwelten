#!/usr/bin/env bash
# Redeploy the Gaia host onto the current checkout.
#
# What it does (the manual runbook §1–§5, mechanized):
#   1. Build the habitat + twitter-habitat images from the repo root
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
AUTH=(-H "Authorization: Bearer $GAIA_API_KEY")

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

log "building images from $ROOT"
docker build -t habitat -f "$ROOT/packages/habitat/Dockerfile" "$ROOT"
docker build -t twitter-habitat -f "$ROOT/packages/habitat/Dockerfile.twitter-habitat" "$ROOT"

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

# Cycle only children whose container is currently running. Registry entries
# that are deliberately stopped (e.g. parked habitats) stay stopped.
mapfile -t RUNNING < <(docker ps --format '{{.Names}}' \
  | grep '^gaia-' | grep -v '^gaia-caddy$' | sed 's/^gaia-//')

if ((${#RUNNING[@]} == 0)); then
  log "no running child habitats to cycle"
else
  for id in "${RUNNING[@]}"; do
    log "cycling habitat: $id"
    curl -sf "${AUTH[@]}" -X POST "$GAIA_URL/api/habitats/$id/stop" >/dev/null
    curl -sf "${AUTH[@]}" -X POST "$GAIA_URL/api/habitats/$id/start" >/dev/null
    wait_for "$id health" 120 "${AUTH[@]}" "$GAIA_URL/api/habitats/$id/health"
    log "  $id healthy"
  done
fi

log "done — gaia + ${#RUNNING[@]} habitat(s) on the new images"
