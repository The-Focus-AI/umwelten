#!/usr/bin/env bash
# Deploy Mycel onto the current checkout.
#
# Deliberately NOT called by deploy/gaia/redeploy.sh. Mycel is a peer of Gaia,
# not a habitat Gaia manages — the money service stays on its own VM with its
# own identity (ADR 0030). Continuous deploy is
# `.github/workflows/deploy-mycel.yml` on the mycel-host runner (labels:
# self-hosted, mycel), not Gaia's runner or Gaia's redeploy path.
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
: "${VITE_CLERK_PUBLISHABLE_KEY:?VITE_CLERK_PUBLISHABLE_KEY must be set in $ENV_FILE}"
: "${MYCEL_CLERK_ISSUER:?MYCEL_CLERK_ISSUER must be set in $ENV_FILE}"
: "${MYCEL_CLERK_AUTHORIZED_PARTIES:?MYCEL_CLERK_AUTHORIZED_PARTIES must be set in $ENV_FILE}"
case "$VITE_CLERK_PUBLISHABLE_KEY" in
  pk_live_*) ;;
  pk_test_*)
    if [[ "${MYCEL_ALLOW_DEVELOPMENT_CLERK:-false}" != true ]]; then
      echo "error: development Clerk on a public host requires MYCEL_ALLOW_DEVELOPMENT_CLERK=true" >&2
      exit 1
    fi
    echo "[mycel] WARNING: deploying a development Clerk instance to $MYCEL_HOSTNAME" >&2
    ;;
  *)
    echo "error: VITE_CLERK_PUBLISHABLE_KEY is not a Clerk publishable key" >&2
    exit 1
    ;;
esac

URL="https://$MYCEL_HOSTNAME"
PREVIOUS="mycel:previous"

log() { echo "[mycel] $*"; }

# Say what is about to be deployed.
#
# This builds whatever is in the working tree, and once did so after a
# `git pull` had failed on divergent branches — the pull printed its error, the
# deploy ran on the next line, and it took a health-check failure to notice
# that production had just been handed the same revision it already had. The
# script cannot know which revision you meant; it can refuse to be quiet about
# which one it found.
describe_revision() {
  git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 || { log "not a git checkout"; return; }

  local revision dirty="" behind=0
  revision="$(git -C "$ROOT" rev-parse --short HEAD)"
  git -C "$ROOT" diff --quiet HEAD -- 2>/dev/null || dirty=", dirty"

  if git -C "$ROOT" rev-parse --verify -q "@{upstream}" >/dev/null 2>&1; then
    behind="$(git -C "$ROOT" rev-list --count "HEAD..@{upstream}" 2>/dev/null || echo 0)"
  fi

  log "deploying $revision ($(git -C "$ROOT" rev-parse --abbrev-ref HEAD)$dirty)"
  if [[ "$behind" != "0" ]]; then
    log "WARNING: $behind commit(s) behind upstream — did a git pull fail?"
  fi
}

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

# A healthy API once masked a completely broken browser surface: the bundled
# image omitted runtime-read assets, so every browser stayed on "assembling…".
# Gate the candidate on the actual serving contract before calling it deployed.
verify_client_surface() {
  local account_auth account_manifest agent_guide animation animation_path component landing manifest openapi substrate status
  landing="$(curl -sfS --max-time 5 "$URL/")" || {
    echo "error: landing page unavailable" >&2
    return 1
  }
  if ! grep -q 'Mycel — intelligence grows in networks' <<<"$landing"; then
    echo "error: hostname root is not the Mycel landing page" >&2
    return 1
  fi
  animation_path="$(sed -n 's/.*src="\([^"]*\/assets\/[^"]*\.js\)".*/\1/p' <<<"$landing" | head -1)"
  if [[ -z "$animation_path" ]]; then
    echo "error: landing page does not reference its compiled client" >&2
    return 1
  fi
  animation="$(curl -sfS --max-time 5 "$URL$animation_path")" || {
    echo "error: landing simulation unavailable" >&2
    return 1
  }
  if ! grep -q 'requestAnimationFrame' <<<"$animation"; then
    echo "error: landing simulation response is not the expected runtime" >&2
    return 1
  fi
  manifest="$(curl -sfS --max-time 5 "$URL/shell/manifest.json")" || {
    echo "error: manifest endpoint unavailable" >&2
    return 1
  }
  for component in health models catalogue-stats; do
    if ! grep -Eq '"id"[[:space:]]*:[[:space:]]*"'"$component"'"' <<<"$manifest"; then
      echo "error: manifest missing component: $component" >&2
      return 1
    fi
  done
  account_manifest="$(curl -sfS --max-time 5 "$URL/account/manifest.json")" || {
    echo "error: account assembly manifest unavailable" >&2
    return 1
  }
  for component in account-authentication account-customer account-overview account-applications account-playground account-funding account-admin-grant account-supplier-connections account-ledger account-usage account-team; do
    if ! grep -Eq '"id"[[:space:]]*:[[:space:]]*"'"$component"'"' <<<"$account_manifest"; then
      echo "error: account manifest missing component: $component" >&2
      return 1
    fi
  done
  account_auth="$(curl -sfS --max-time 5 "$URL/assets/account-authentication.js")" || {
    echo "error: account authentication provider unavailable" >&2
    return 1
  }
  if ! grep -q 'export' <<<"$account_auth"; then
    echo "error: account authentication response is not browser ESM" >&2
    return 1
  fi
  agent_guide="$(curl -sfS --max-time 5 "$URL/llms.txt")" || {
    echo "error: agent discovery document unavailable" >&2
    return 1
  }
  if ! grep -q '/v1/models' <<<"$agent_guide"; then
    echo "error: agent discovery document does not identify dynamic model discovery" >&2
    return 1
  fi
  openapi="$(curl -sfS --max-time 5 "$URL/openapi.json")" || {
    echo "error: OpenAPI description unavailable" >&2
    return 1
  }
  if ! grep -q '"/chat/completions"' <<<"$openapi"; then
    echo "error: OpenAPI description is missing the buyer operation" >&2
    return 1
  fi
  status="$(curl -sS --max-time 5 -o /tmp/mycel-substrate.js -w '%{http_code}' \
    "$URL/shell/substrate/index.js")" || {
    echo "error: substrate endpoint unavailable" >&2
    return 1
  }
  if [[ "$status" != 200 ]]; then
    echo "error: substrate endpoint returned HTTP $status" >&2
    return 1
  fi
  substrate="$(cat /tmp/mycel-substrate.js)"
  if ! grep -q 'export' <<<"$substrate"; then
    echo "error: substrate response is not browser ESM" >&2
    return 1
  fi
}

describe_revision

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
#
# Then run the bundle before building an image around it. It came back once
# dead on arrival — `ws` inlined into the ESM output with its `require()`
# rewritten to a stub that throws — and because nothing here executed it, the
# first thing to notice was the health check, after the container had already
# replaced the running one. `--help` is enough: an import-time fault kills
# every command, and a failure here costs a build instead of a rollback.
log "bundling the exchange"
docker volume create mycel-pnpm-store >/dev/null
RUNNER_UID="$(id -u)"
RUNNER_GID="$(id -g)"
# The named store may have been created by an older root-run build. Repair it
# once per deploy, then run the bind-mounted build as the invoking user so the
# Actions runner can clean its checkout on the next run.
docker run --rm -v mycel-pnpm-store:/pnpm/store alpine:3.22 \
  chown -R "$RUNNER_UID:$RUNNER_GID" /pnpm/store
docker run --rm --user "$RUNNER_UID:$RUNNER_GID" --env HOME=/tmp \
  -v "$ROOT:/w" -v mycel-pnpm-store:/pnpm/store -w /w node:22-slim sh -c \
  'mkdir -p /tmp/bin && corepack enable --install-directory /tmp/bin \
   && export PATH="/tmp/bin:$PATH" && pnpm config set store-dir /pnpm/store \
   && pnpm install --frozen-lockfile && pnpm --filter @umwelten/mycel build \
   && node packages/mycel/dist/mycel.js --help >/dev/null'

log "building image from $ROOT"
docker build \
  --build-arg "CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY" \
  -t mycel -f "$ROOT/packages/mycel/Dockerfile" "$ROOT"

log "recreating the container"
docker compose --project-directory "$SCRIPT_DIR" --env-file "$ENV_FILE" up -d

log "waiting for $URL/health"
if wait_for_health 90; then
  log "healthy — store reachable"
  if verify_client_surface; then
    log "client surface healthy — landing, agent docs, manifests and substrate runtime available"
    log "done"
    exit 0
  fi
  echo "error: client surface did not satisfy the serving contract" >&2
fi

echo "error: candidate deployment failed verification" >&2
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
