#!/usr/bin/env bash
# Deploy Mycel onto the current checkout.
#
# Deliberately NOT called by deploy/gaia/redeploy.sh. Mycel is a peer of Gaia,
# not a habitat Gaia manages, and the whole point of that separation is that a
# push to umwelten main does not cycle the service holding the money ledger.
# Deploying Mycel is something a person decides to do.
#
# What it does:
#   1. Tag the image currently running, so there is something to roll back to
#   2. Build from the repo root
#   3. Recreate the container via compose
#   4. Wait for /health to report the STORE reachable, not just the process up
#   5. Roll back automatically if it never gets there
#
# Requires: docker (daemon access), curl. Run as a user in the docker group.
#
# Runbook: deploy/mycel/README.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${MYCEL_ENV_FILE:-$SCRIPT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: env file not found: $ENV_FILE" >&2
  echo "hint: cp $SCRIPT_DIR/.env.example $ENV_FILE and fill it in" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${MYCEL_HOSTNAME:?MYCEL_HOSTNAME must be set in $ENV_FILE}"

URL="https://$MYCEL_HOSTNAME"
PREVIOUS="mycel:previous"

log() { echo "[mycel] $*"; }

# Health is not "did the container start". It asks whether the store is
# reachable, because a Mycel that answers while Neon is gone will happily take
# requests it cannot meter.
wait_for_health() {
  # Two statements, deliberately. Bash expands every argument to `local` before
  # the builtin runs, so `local timeout="$1" deadline=$((SECONDS + timeout))`
  # evaluates the arithmetic while `timeout` is still unset — which under
  # `set -u` aborts the deploy at the moment it starts waiting.
  local timeout="$1"
  local deadline=$((SECONDS + timeout))
  until curl -sf --max-time 5 "$URL/health" | grep -q '"status":"ok"'; do
    if ((SECONDS >= deadline)); then return 1; fi
    sleep 2
  done
}

# Keep the outgoing image addressable before it is replaced. Rolling back is
# then a retag and a restart, and costs nothing to have prepared.
if docker image inspect mycel >/dev/null 2>&1; then
  docker tag mycel "$PREVIOUS"
  log "tagged the running image as $PREVIOUS"
  HAVE_PREVIOUS=1
else
  log "no existing image — this is a first deploy, nothing to roll back to"
  HAVE_PREVIOUS=0
fi

# Bundle first, in a throwaway node container. Nothing needs to be installed on
# this host, and the image stays a single COPY of the result.
log "bundling the exchange"
docker run --rm -v "$ROOT:/w" -w /w node:22-slim sh -c \
  'corepack enable && pnpm install --frozen-lockfile && pnpm --filter @umwelten/mycel build'

log "building image from $ROOT"
docker build -t mycel -f "$ROOT/packages/mycel/Dockerfile" "$ROOT"

log "recreating the container"
docker compose --project-directory "$SCRIPT_DIR" --env-file "$ENV_FILE" up -d

log "waiting for $URL/health"
if wait_for_health 90; then
  log "healthy — store reachable"
  log "done"
  exit 0
fi

echo "error: never became healthy within 90s" >&2
docker compose --project-directory "$SCRIPT_DIR" logs --tail 40 mycel >&2 || true

if ((HAVE_PREVIOUS == 0)); then
  echo "error: no previous image to roll back to; leaving it stopped" >&2
  docker compose --project-directory "$SCRIPT_DIR" stop || true
  exit 1
fi

# Automatic, because the alternative is a broken Exchange sitting there while
# somebody reads the logs. State is in Neon, so rolling back loses nothing.
log "rolling back to $PREVIOUS"
docker tag "$PREVIOUS" mycel
docker compose --project-directory "$SCRIPT_DIR" --env-file "$ENV_FILE" up -d

if wait_for_health 90; then
  log "rolled back and healthy — the new image is the problem, not the host"
  exit 1
fi

echo "error: the previous image is not healthy either — look at Neon first" >&2
exit 1
