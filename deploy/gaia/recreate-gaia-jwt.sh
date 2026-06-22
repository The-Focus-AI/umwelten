#!/usr/bin/env bash
#
# Recreate the live Gaia container with per-user JWT verification on its OWN
# A2A surface (ADR 0003). The running container already sets GAIA_JWKS_URL (so
# spawned CHILDREN verify JWTs) but not HABITAT_AUTH_AUDIENCE/JWKS_URL for Gaia
# itself — so Gaia stays bearer-only and the SaaS attach flow can only ask for a
# pasted bearer token. This adds those two vars (keeping HABITAT_API_KEY ⇒ dual
# jwt+bearer) so Gaia's card advertises bearerFormat:"JWT" and the SaaS mints a
# per-user grant on attach instead of demanding a token.
#
# Safe + reversible: derives all current runtime env + the /data volume from the
# running container (no hardcoded secrets), keeps the old container as a stopped
# `gaia-prev` backup, verifies the new card, and rolls back automatically if the
# new container doesn't come up.
#
# Usage (on the pancake host):  sudo bash deploy/gaia/recreate-gaia-jwt.sh
set -euo pipefail

NAME=gaia
HOSTNAME_FQDN=gaia.habitats.thefocus.ai
AUD="https://${HOSTNAME_FQDN}"
JWKS="https://habitats.thefocus.ai/.well-known/jwks.json"

command -v docker >/dev/null || { echo "docker not found"; exit 1; }
docker inspect "$NAME" >/dev/null 2>&1 || { echo "container '$NAME' not found — nothing to recreate"; exit 1; }

# Capture current runtime env (skip image-baked vars like PATH/NODE_VERSION).
# Existing HABITAT_AUTH_* are carried over as-is; we only add them if missing, so
# this is safe to re-run after an image rebuild to pick up new container code.
mapfile -t ENVS < <(docker inspect "$NAME" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^(GAIA_|HABITAT_API_KEY=|HABITAT_AUTH_|HABITAT_WORK_DIR=|OPENROUTER_API_KEY=|GOOGLE_GENERATIVE_AI_API_KEY=)')
DATA_VOL=$(docker inspect "$NAME" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')

EARGS=(); for e in "${ENVS[@]}"; do EARGS+=(-e "$e"); done
# Add the JWT-verify vars only if the running container didn't already have them.
printf '%s\n' "${ENVS[@]}" | grep -q '^HABITAT_AUTH_AUDIENCE=' || EARGS+=(-e "HABITAT_AUTH_AUDIENCE=${AUD}")
printf '%s\n' "${ENVS[@]}" | grep -q '^HABITAT_AUTH_JWKS_URL=' || EARGS+=(-e "HABITAT_AUTH_JWKS_URL=${JWKS}")

echo "Backing up current container as gaia-prev (stopped)…"
docker rename "$NAME" gaia-prev
docker stop gaia-prev >/dev/null

echo "Starting new gaia with JWT verification…"
if ! docker run -d --name "$NAME" --restart unless-stopped \
  --network caddy \
  -l "caddy=${HOSTNAME_FQDN}" -l 'caddy.reverse_proxy={{upstreams 7420}}' \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/gaia-data:/opt/gaia-data \
  ${DATA_VOL:+-v "${DATA_VOL}:/data"} \
  "${EARGS[@]}" \
  habitat sh -c 'pnpm exec tsx packages/cli/src/entry.ts habitat gaia --port 7420 --data-dir /opt/gaia-data --provider "$GAIA_PROVIDER" --model "$GAIA_MODEL"'; then
  echo "docker run failed — rolling back to gaia-prev"
  docker rm -f "$NAME" 2>/dev/null || true
  docker rename gaia-prev "$NAME"
  docker start "$NAME"
  exit 1
fi

echo "Waiting ~10s for caddy to re-route + Gaia to boot…"
sleep 10

if curl -fsS -m 10 "${AUD}/.well-known/agent-card.json" | grep -q '"bearerFormat":"JWT"'; then
  echo "✅ Gaia now advertises per-user JWT. Removing backup gaia-prev."
  docker rm gaia-prev >/dev/null
  echo "Done. Re-attach Gaia in the SaaS — no bearer token needed."
else
  echo "⚠️  New card did not show bearerFormat:JWT. Check: docker logs gaia"
  echo "Backup retained. Roll back with:"
  echo "    docker rm -f gaia && docker rename gaia-prev gaia && docker start gaia"
  exit 1
fi
