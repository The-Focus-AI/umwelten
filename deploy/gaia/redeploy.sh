#!/usr/bin/env bash
# Redeploy the Gaia host onto the current checkout.
#
# What it does (the manual runbook §1–§5, mechanized):
#   1. Preserve the outgoing images for automatic rollback
#   2. Build the habitat + twitter-habitat images from the repo root
#   3. Recreate the gaia service via docker compose (new image ⇒ new container)
#   4. Re-attach gaia to the ingress network (compose only attaches gaia-net)
#   5. Wait for Gaia's public /health, failing early on a restart loop
#   6. Cycle every RUNNING child habitat via Gaia's API — start is
#      stop+rm+fresh `docker run`, so children come back on the new image
#      (data persists on their named volumes) — and wait for each health
#   7. On any post-replacement failure, restore the outgoing images and all
#      running services that had already moved to the candidate
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
PREVIOUS_HABITAT="habitat:previous"
GAIA_HEALTH_TIMEOUT="${GAIA_HEALTH_TIMEOUT:-90}"
CHILD_HEALTH_TIMEOUT="${CHILD_HEALTH_TIMEOUT:-120}"
GAIA_MAX_RESTARTS="${GAIA_MAX_RESTARTS:-3}"
declare -A CHILD_IMAGE_IDS=()
declare -A CHILD_IMAGE_REFS=()
declare -A ORIGINAL_REF_IMAGES=()

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

attach_ingress() {
  if [[ -n "${GAIA_INGRESS_NETWORK:-}" ]]; then
    docker network connect "$GAIA_INGRESS_NETWORK" gaia 2>/dev/null \
      && log "attached gaia to $GAIA_INGRESS_NETWORK" \
      || log "gaia already on $GAIA_INGRESS_NETWORK"
  fi
}

wait_for_gaia() { # wait_for_gaia <timeout_s>
  local timeout="$1"
  local deadline=$((SECONDS + timeout))
  local restarts status
  until curl -sf --max-time 5 "$GAIA_URL/health" >/dev/null 2>&1; do
    restarts="$(docker inspect --format '{{.RestartCount}}' gaia 2>/dev/null || echo 0)"
    status="$(docker inspect --format '{{.State.Status}}' gaia 2>/dev/null || echo missing)"
    if [[ "$restarts" =~ ^[0-9]+$ ]] && ((restarts >= GAIA_MAX_RESTARTS)); then
      echo "error: GAIA_RESTART_LOOP: gaia restarted $restarts times (status: $status)" >&2
      return 1
    fi
    if ((SECONDS >= deadline)); then
      echo "error: timed out after ${timeout}s waiting for gaia health" >&2
      return 1
    fi
    sleep 2
  done
}

gaia_diagnostics() {
  echo "--- gaia container status ---" >&2
  docker ps -a --filter name='^/gaia$' \
    --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' >&2 || true
  echo "--- gaia state ---" >&2
  docker inspect --format \
    'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    gaia >&2 2>&1 || true
  echo "--- gaia logs (last 200 lines) ---" >&2
  docker logs --tail 200 gaia >&2 2>&1 || true
}

recreate_gaia() {
  docker compose --project-directory "$SCRIPT_DIR" --env-file "$ENV_FILE" \
    up -d gaia-watchdog || return 1
  docker compose --project-directory "$SCRIPT_DIR" --env-file "$ENV_FILE" \
    up -d --force-recreate gaia || return 1
  attach_ingress
}

cycle_habitat() { # cycle_habitat <id> <timeout_s>
  local id="$1" timeout="$2"
  curl -sf "${AUTH[@]}" -X POST "$GAIA_URL/api/habitats/$id/stop" >/dev/null \
    || return 1
  curl -sf "${AUTH[@]}" -X POST "$GAIA_URL/api/habitats/$id/start" >/dev/null \
    || return 1
  wait_for "$id health" "$timeout" "${AUTH[@]}" "$GAIA_URL/api/habitats/$id/health"
}

remember_image_ref() { # remember_image_ref <image-reference>
  local ref="$1" image_id
  [[ "$ref" == sha256:* ]] && return 0
  [[ -n "${ORIGINAL_REF_IMAGES[$ref]+set}" ]] && return 0
  image_id="$(docker image inspect --format '{{.Id}}' "$ref" 2>/dev/null)" \
    || return 0
  ORIGINAL_REF_IMAGES["$ref"]="$image_id"
}

restore_original_refs() {
  local ref
  for ref in "${!ORIGINAL_REF_IMAGES[@]}"; do
    docker tag "${ORIGINAL_REF_IMAGES[$ref]}" "$ref" || return 1
  done
}

select_child_rollback_image() { # select_child_rollback_image <id>
  local id="$1" ref="${CHILD_IMAGE_REFS[$1]}"
  # Content-addressed image references already select the captured image. A
  # mutable reference is moved just long enough for DockerManager to create
  # this child; the resulting container pins the image ID even when the tag is
  # moved again for a sibling.
  [[ "$ref" == sha256:* ]] && return 0
  docker tag "${CHILD_IMAGE_IDS[$id]}" "$ref"
}

rollback() { # rollback <cycle-children: 0|1>
  local cycle_children="$1"
  if ((HAVE_PREVIOUS_HABITAT == 0)); then
    echo "error: no outgoing Gaia image is available for rollback" >&2
    docker compose --project-directory "$SCRIPT_DIR" --env-file "$ENV_FILE" stop gaia || true
    restore_original_refs || echo "error: pre-deploy image tags could not be restored" >&2
    return 1
  fi

  log "rolling back gaia to $PREVIOUS_HABITAT"
  docker tag "$PREVIOUS_HABITAT" habitat || return 1
  recreate_gaia || return 1
  if ! wait_for_gaia "$GAIA_HEALTH_TIMEOUT"; then
    echo "error: outgoing Gaia image did not recover" >&2
    gaia_diagnostics
    return 1
  fi

  if ((cycle_children == 1)); then
    for id in "${RUNNING[@]}"; do
      log "rolling back habitat: $id"
      if ! select_child_rollback_image "$id"; then
        echo "error: could not select the outgoing image for habitat $id" >&2
        restore_original_refs || true
        return 1
      fi
      if ! cycle_habitat "$id" "$CHILD_HEALTH_TIMEOUT"; then
        echo "error: habitat $id did not recover on the outgoing images" >&2
        docker logs --tail 100 "gaia-$id" >&2 2>&1 || true
        restore_original_refs || true
        return 1
      fi
    done
  fi
  if ! restore_original_refs; then
    echo "error: fleet recovered but pre-deploy image tags could not be restored" >&2
    return 1
  fi
  log "rollback healthy"
}

# Snapshot who is intentionally running before changing any containers. This
# is also the rollback set if a child fails after some siblings were upgraded.
mapfile -t RUNNING < <(docker ps --format '{{.Names}}' \
  | grep '^gaia-' \
  | grep -v -E '^gaia-(caddy|watchdog)$' \
  | sed 's/^gaia-//')

# Snapshot each running child's exact image, not only its mutable image name.
# Different containers can legitimately run different IDs behind the same tag
# after staggered rebuilds; rollback must reproduce that state one child at a
# time. Also remember every mutable tag's pre-deploy target so the shell leaves
# Docker's tag state exactly as it found it.
remember_image_ref habitat
remember_image_ref twitter-habitat
for id in "${RUNNING[@]}"; do
  CHILD_IMAGE_IDS["$id"]="$(docker inspect --format '{{.Image}}' "gaia-$id")" \
    || { echo "error: could not snapshot image for running habitat $id" >&2; exit 1; }
  CHILD_IMAGE_REFS["$id"]="$(docker inspect --format '{{.Config.Image}}' "gaia-$id")" \
    || { echo "error: could not snapshot image reference for running habitat $id" >&2; exit 1; }
  remember_image_ref "${CHILD_IMAGE_REFS[$id]}"
done

# Preserve the exact image used by the outgoing Gaia container. The mutable
# `habitat` tag may already point elsewhere after an interrupted manual build.
if outgoing_image="$(docker inspect --format '{{.Image}}' gaia 2>/dev/null)"; then
  docker tag "$outgoing_image" "$PREVIOUS_HABITAT"
  log "tagged outgoing Gaia image as $PREVIOUS_HABITAT"
  HAVE_PREVIOUS_HABITAT=1
elif docker image inspect habitat >/dev/null 2>&1; then
  docker tag habitat "$PREVIOUS_HABITAT"
  log "tagged current habitat image as $PREVIOUS_HABITAT"
  HAVE_PREVIOUS_HABITAT=1
else
  log "no existing habitat image — first deploy has no rollback target"
  HAVE_PREVIOUS_HABITAT=0
fi

log "building images from $ROOT"
if ! docker build -t habitat -f "$ROOT/packages/habitat/Dockerfile" "$ROOT"; then
  restore_original_refs || echo "error: pre-deploy image tags could not be restored" >&2
  exit 1
fi
if ! docker build -t twitter-habitat -f "$ROOT/packages/habitat/Dockerfile.twitter-habitat" "$ROOT"; then
  restore_original_refs || echo "error: pre-deploy image tags could not be restored" >&2
  exit 1
fi

log "recreating gaia"
if ! recreate_gaia; then
  echo "error: candidate Gaia could not be recreated" >&2
  gaia_diagnostics
  rollback 0 || echo "error: rollback failed" >&2
  exit 1
fi

log "waiting for $GAIA_URL/health"
if ! wait_for_gaia "$GAIA_HEALTH_TIMEOUT"; then
  gaia_diagnostics
  rollback 0 || echo "error: rollback failed" >&2
  exit 1
fi

if ((${#RUNNING[@]} == 0)); then
  log "no running child habitats to cycle"
else
  for id in "${RUNNING[@]}"; do
    log "cycling habitat: $id"
    if ! cycle_habitat "$id" "$CHILD_HEALTH_TIMEOUT"; then
      echo "error: candidate habitat $id failed; restoring outgoing fleet images" >&2
      docker logs --tail 100 "gaia-$id" >&2 2>&1 || true
      rollback 1 || echo "error: rollback failed" >&2
      exit 1
    fi
    log "  $id healthy"
  done
fi

log "done — gaia + ${#RUNNING[@]} habitat(s) on the new images"
