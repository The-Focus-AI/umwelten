#!/usr/bin/env bash
set -euo pipefail

# Smoke check for the coding-agent image (#123). Not part of the unit suite —
# needs Docker and ~5 minutes on a cold build.
#
#   scripts/smoke-coding-agent.sh            # build base + coding image, boot, assert
#   SKIP_BUILD=1 scripts/smoke-coding-agent.sh   # reuse existing images
#
# Asserts:
#   1. image builds from the habitat base
#   2. container boots the container server; /health is OK; bearer auth gates /api/*
#   3. gh, pi, claude, mise, git, rg available inside
#   4. standards corpus present at /opt/standards (entry doc + prompts)
#   5. server process runs as the node user (non-root)
#   6. persona + routing + workspace agent seeded into the volume, node-owned
#   7. volume contents survive a stop/start (sessions intact)

IMAGE_BASE="${IMAGE_BASE:-habitat}"
IMAGE="${IMAGE:-habitat-coding}"
NAME="smoke-coding-agent"
VOLUME="smoke-coding-agent-data"
PORT="${PORT:-7439}"
API_KEY="smoke-key-123"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; cleanup; exit 1; }

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}

cexec() { docker exec "$NAME" "$@"; }

echo "── 1. build"
if [ -z "${SKIP_BUILD:-}" ]; then
  docker image inspect "$IMAGE_BASE" >/dev/null 2>&1 \
    || docker build -t "$IMAGE_BASE" -f packages/habitat/Dockerfile .
  # The standards repo is private — pass a token as a BuildKit secret.
  GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}"
  export GITHUB_TOKEN
  SECRET_ARGS=()
  [ -n "$GITHUB_TOKEN" ] && SECRET_ARGS=(--secret "id=gh_token,env=GITHUB_TOKEN")
  docker build -t "$IMAGE" -f packages/habitat/Dockerfile.coding-agent \
    --build-arg "BASE_IMAGE=$IMAGE_BASE" "${SECRET_ARGS[@]}" .
fi
pass "image $IMAGE built (base: $IMAGE_BASE)"

cleanup
docker volume create "$VOLUME" >/dev/null
docker run -d --name "$NAME" -v "$VOLUME:/data" \
  -e "HABITAT_API_KEY=$API_KEY" -p "127.0.0.1:$PORT:8080" "$IMAGE" >/dev/null

echo "── 2. boot + auth"
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  if [ "$i" = 60 ]; then docker logs "$NAME" | tail -20; fail "server did not become healthy in 60s"; fi
  sleep 1
done
curl -sf "http://127.0.0.1:$PORT/health" | grep -q '"status":"ok"' || fail "/health not ok"
pass "/health ok"
# /api/status is open by design; the registered routes (e.g. /api/contexts)
# are the bearer-gated surface.
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/contexts/smoke")" = "401" ] \
  || fail "unauthenticated gated /api/* not rejected"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:$PORT/api/contexts/smoke")" = "404" ] \
  || fail "bearer-authenticated gated /api/* not served"
curl -sf -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:$PORT/.well-known/agent-card.json" >/dev/null \
  || fail "A2A agent card not served"
pass "bearer auth gates registered /api/* routes; A2A agent card served"

echo "── 3. toolchain"
for tool in gh pi claude mise git rg; do
  cexec sh -c "command -v $tool >/dev/null" || fail "$tool missing"
done
pass "gh, pi, claude, mise, git, rg present"

echo "── 4. standards corpus"
cexec test -f /opt/standards/AGENTS.md || fail "standards entry doc missing"
cexec test -f /opt/standards/prompts/setup-project.md || fail "setup prompt missing"
cexec test -f /opt/standards/prompts/standardize-project.md || fail "standardize prompt missing"
pass "/opt/standards corpus present"

echo "── 5. non-root"
[ "$(cexec stat -c %u /proc/1)" = "1000" ] || fail "server (pid 1) not running as node (uid 1000)"
pass "server runs as node (uid 1000)"

echo "── 6. volume seeding"
cexec test -f /data/STIMULUS.md || fail "STIMULUS.md not seeded"
cexec grep -q "/opt/standards" /data/STIMULUS.md || fail "persona does not reference the standards corpus"
cexec grep -q '"runtime": "claude-sdk"' /data/routing.json || fail "routing not bound to an agentic runtime"
cexec node -e 'const c=JSON.parse(require("fs").readFileSync("/data/config.json","utf8")); if(!c.agents.some(a=>a.id==="workspace")) process.exit(1)' \
  || fail "workspace agent not in config.json"
[ "$(cexec stat -c %u /data/STIMULUS.md)" = "1000" ] || fail "/data not owned by node"
pass "persona + routing + workspace agent seeded, node-owned"

echo "── 7. stop/start persistence"
cexec sh -c 'echo smoke-marker > /data/sessions/smoke-marker.txt'
docker restart "$NAME" >/dev/null
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  if [ "$i" = 60 ]; then fail "server did not come back after restart"; fi
  sleep 1
done
[ "$(cexec cat /data/sessions/smoke-marker.txt)" = "smoke-marker" ] || fail "volume contents lost across restart"
cexec grep -q "/opt/standards" /data/STIMULUS.md || fail "persona overwritten on reboot"
pass "volume survives restart; seeds not re-stamped"

cleanup
echo ""
echo "PASS — coding-agent image smoke check complete."
