#!/usr/bin/env bash
# Replace the shared stock caddy-docker-proxy with the preview-capable build,
# preserving its certificate/config volumes and stopped container as rollback.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${GAIA_ENV_FILE:-$SCRIPT_DIR/.env}"
INGRESS_NETWORK="${GAIA_INGRESS_NETWORK:-caddy}"
BACKUP_CONTAINER="caddy-before-preview"
INSTALL_DIR="${GAIA_CADDY_CONFIG_DIR:-$HOME/.config/gaia-ingress}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: env file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${GAIA_HOSTNAME:?GAIA_HOSTNAME must be set in $ENV_FILE}"
: "${GAIA_PREVIEW_DOMAIN:?GAIA_PREVIEW_DOMAIN must be set in $ENV_FILE}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN must be set in $ENV_FILE}"

log() { echo "[preview-ingress] $*"; }

wait_for() {
  local label="$1" timeout="$2"; shift 2
  local deadline=$((SECONDS + timeout))
  until "$@" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      echo "error: timed out after ${timeout}s waiting for $label" >&2
      return 1
    fi
    sleep 2
  done
}

docker inspect caddy >/dev/null
docker inspect gaia-preview-router >/dev/null
docker network inspect "$INGRESS_NETWORK" >/dev/null
if docker inspect "$BACKUP_CONTAINER" >/dev/null 2>&1; then
  echo "error: rollback container $BACKUP_CONTAINER already exists" >&2
  echo "refusing to overwrite the known-good ingress backup" >&2
  exit 1
fi

data_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' caddy)"
config_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Name}}{{end}}{{end}}' caddy)"
: "${data_volume:?existing caddy has no named /data volume}"
: "${config_volume:?existing caddy has no named /config volume}"

mkdir -p "$INSTALL_DIR"
install -m 0644 "$SCRIPT_DIR/Caddyfile.preview" "$INSTALL_DIR/Caddyfile.preview"

log "building preview-capable Caddy"
docker build -t gaia-caddy:local -f "$SCRIPT_DIR/Dockerfile.caddy" "$ROOT"
docker run --rm \
  -e CLOUDFLARE_API_TOKEN \
  -e GAIA_PREVIEW_DOMAIN \
  -v "$INSTALL_DIR/Caddyfile.preview:/etc/caddy/Caddyfile:ro" \
  gaia-caddy:local validate --config /etc/caddy/Caddyfile --adapter caddyfile

rollback() {
  local status=$?
  if ((status == 0)); then return; fi
  echo "[preview-ingress] replacement failed; restoring stock Caddy" >&2
  docker rm -f caddy >/dev/null 2>&1 || true
  if docker inspect "$BACKUP_CONTAINER" >/dev/null 2>&1; then
    docker rename "$BACKUP_CONTAINER" caddy
    docker start caddy >/dev/null
    wait_for "restored Gaia ingress" 60 curl -fsS --max-time 5 "https://$GAIA_HOSTNAME/health" || true
  elif docker inspect caddy >/dev/null 2>&1; then
    docker start caddy >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap rollback EXIT

log "preserving current Caddy as $BACKUP_CONTAINER"
docker stop caddy >/dev/null
docker rename caddy "$BACKUP_CONTAINER"

docker run -d \
  --name caddy \
  --restart unless-stopped \
  --network "$INGRESS_NETWORK" \
  -p 80:80 \
  -p 443:443 \
  -e "CADDY_INGRESS_NETWORKS=$INGRESS_NETWORK" \
  -e "CADDY_DOCKER_CADDYFILE_EMAIL=${CADDY_EMAIL:-}" \
  -e CADDY_DOCKER_CADDYFILE_PATH=/etc/caddy/Caddyfile \
  -e GAIA_PREVIEW_DOMAIN \
  -e CLOUDFLARE_API_TOKEN \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v "$INSTALL_DIR/Caddyfile.preview:/etc/caddy/Caddyfile:ro" \
  -v "$data_volume:/data" \
  -v "$config_volume:/config" \
  gaia-caddy:local >/dev/null

wait_for "Caddy process" 30 docker exec caddy caddy version
docker exec caddy caddy list-modules | grep -qx dns.providers.cloudflare
wait_for "preview router through ingress" 60 \
  docker exec caddy wget -qO- http://preview-router:7431/health
wait_for "existing Gaia ingress" 90 curl -fsS --max-time 5 "https://$GAIA_HOSTNAME/health"

trap - EXIT
log "replacement healthy; rollback container retained as $BACKUP_CONTAINER"
