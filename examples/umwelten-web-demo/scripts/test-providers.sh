#!/usr/bin/env bash
# Smoke-test that /api/chat emits the AI SDK UI Message Stream Protocol
# correctly across providers.
#
# For each provider: boot the server with an env override, send one chat
# request, print the stream, kill the server.

set -u

PORT=3456
URL="http://localhost:$PORT/api/chat"

run_one() {
  local label="$1"
  local provider="$2"
  local model="$3"
  local prompt="${4:-Say hello in 5 words.}"

  echo "════════════════════════════════════════════════════════"
  echo "  $label  ($provider / $model)"
  echo "════════════════════════════════════════════════════════"

  DEMO_PROVIDER="$provider" DEMO_MODEL="$model" PORT="$PORT" \
    dotenvx run -- pnpm exec tsx examples/umwelten-web-demo/src/server.ts \
    > /tmp/web-demo-$$.log 2>&1 &
  local pid=$!

  # Wait for boot
  for _ in 1 2 3 4 5 6 7 8; do
    sleep 1
    curl -sf "http://localhost:$PORT/api/me" >/dev/null 2>&1 && break
  done

  local tid
  tid="$(uuidgen 2>/dev/null || echo "test-$RANDOM")"
  curl -sN -X POST "$URL" \
    -H "Content-Type: application/json" \
    --max-time 30 \
    -d "{\"id\":\"$tid\",\"threadId\":\"$tid\",\"messages\":[{\"id\":\"u1\",\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"text\":\"$prompt\"}]}]}" \
    2>&1 | head -40

  echo ""
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  sleep 0.5
}

run_one "google / gemini-3-flash-preview" "google" "gemini-3-flash-preview"
run_one "openrouter / gpt-4o-mini"         "openrouter" "openai/gpt-4o-mini"
run_one "openrouter / claude-haiku-4.5"    "openrouter" "anthropic/claude-haiku-4.5"
