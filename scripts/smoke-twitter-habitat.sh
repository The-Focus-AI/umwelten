#!/usr/bin/env bash
set -euo pipefail

# Smoke check for the twitter-habitat image (#155, PRD #149). Not part of the
# unit suite — needs Docker and ~5 minutes on a cold build.
#
#   scripts/smoke-twitter-habitat.sh             # build base + twitter image, boot, assert
#   SKIP_BUILD=1 scripts/smoke-twitter-habitat.sh    # reuse existing images
#
# Asserts:
#   1. image builds from the habitat base
#   2. container boots the container server; /health is OK; bearer auth gates /api/*
#   3. the agent card is served (name "Twitter")
#   4. work dir seeded onto the volume: tools/, src/, STIMULUS.md, and the
#      node_modules symlink that makes the tool's `ai`/`zod`/`../../src` resolve
#   5. config.json points at the seeded assets (toolsDir/stimulusFile)
#   6. the `bookmarks` work-dir tool actually loads (imports resolve in-container)
#   7. volume contents survive a stop/start; seeds are not destructively re-stamped

IMAGE_BASE="${IMAGE_BASE:-habitat}"
IMAGE="${IMAGE:-twitter-habitat}"
NAME="smoke-twitter-habitat"
VOLUME="smoke-twitter-habitat-data"
PORT="${PORT:-7438}"
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
# BuildKit is required so the per-Dockerfile ignore
# (Dockerfile.twitter-habitat.dockerignore) is honored and examples/ is included.
export DOCKER_BUILDKIT=1
if [ -z "${SKIP_BUILD:-}" ]; then
  docker image inspect "$IMAGE_BASE" >/dev/null 2>&1 \
    || docker build -t "$IMAGE_BASE" -f packages/habitat/Dockerfile .
  docker build -t "$IMAGE" -f packages/habitat/Dockerfile.twitter-habitat \
    --build-arg "BASE_IMAGE=$IMAGE_BASE" .
fi
pass "image $IMAGE built (base: $IMAGE_BASE)"

cleanup
docker volume create "$VOLUME" >/dev/null
docker run -d --name "$NAME" -v "$VOLUME:/data" \
  -e "HABITAT_API_KEY=$API_KEY" -p "127.0.0.1:$PORT:8080" "$IMAGE" >/dev/null

echo "── 2. boot + auth"
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  if [ "$i" = 60 ]; then docker logs "$NAME" | tail -30; fail "server did not become healthy in 60s"; fi
  sleep 1
done
curl -sf "http://127.0.0.1:$PORT/health" | grep -q '"status":"ok"' || fail "/health not ok"
pass "/health ok"
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/contexts/smoke")" = "401" ] \
  || fail "unauthenticated gated /api/* not rejected"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:$PORT/api/contexts/smoke")" = "404" ] \
  || fail "bearer-authenticated gated /api/* not served"
pass "bearer auth gates registered /api/* routes"

echo "── 3. agent card"
curl -sf -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:$PORT/.well-known/agent-card.json" \
  | grep -q '"name":"Twitter"' || fail "agent card not served / wrong name"
pass "A2A agent card served (Twitter)"

echo "── 4. volume seeding"
cexec test -f /data/tools/bookmarks/handler.ts || fail "tools/ not seeded"
cexec test -f /data/src/token-store.ts || fail "src/ not seeded"
cexec test -f /data/STIMULUS.md || fail "STIMULUS.md not seeded"
cexec test -L /data/node_modules || fail "/data/node_modules symlink missing"
cexec test -e /data/node_modules/ai || fail "ai not resolvable via the node_modules symlink"
pass "tools/, src/, STIMULUS.md seeded; node_modules symlinked to monorepo deps"

echo "── 5. config seeded"
cexec node -e 'const c=JSON.parse(require("fs").readFileSync("/data/config.json","utf8")); if(c.toolsDir!=="tools"||c.stimulusFile!=="STIMULUS.md") process.exit(1)' \
  || fail "config.json toolsDir/stimulusFile not seeded"
pass "config.json points at toolsDir/stimulusFile"

echo "── 6. bookmarks tool loads"
# The work-dir tool is loaded via dynamic import of its .ts handler; if the
# node_modules symlink were wrong its `ai`/`zod`/`../../src` imports would throw
# and the loader would warn "failed to load handler". Assert no such warning.
if docker logs "$NAME" 2>&1 | grep -qi "failed to load handler"; then
  docker logs "$NAME" 2>&1 | grep -i "failed to load handler" | tail -5
  fail "bookmarks handler failed to load (import resolution broken)"
fi
pass "no handler-load failures (bookmarks tool imports resolve)"

echo "── 7. stop/start persistence"
cexec sh -c 'echo smoke-marker > /data/sessions/smoke-marker.txt'
cexec sh -c 'printf "{\"TWITTER_REFRESH_TOKEN\":\"rotated-xyz\"}" > /data/secrets.json'
docker restart "$NAME" >/dev/null
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  if [ "$i" = 60 ]; then fail "server did not come back after restart"; fi
  sleep 1
done
[ "$(cexec cat /data/sessions/smoke-marker.txt)" = "smoke-marker" ] || fail "volume contents lost across restart"
cexec grep -q "rotated-xyz" /data/secrets.json || fail "rotated refresh token lost across restart"
pass "volume survives restart; rotated refresh token persists"

cleanup
echo ""
echo "PASS — twitter-habitat image smoke check complete."
