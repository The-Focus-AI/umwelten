#!/usr/bin/env bash
# Build and boot the production Gaia image against volume-backed tools. This is
# intentionally an image-level test: Vitest resolves external TypeScript
# imports differently and did not reproduce the production failure.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="habitat-gaia-smoke"
CONTAINER="gaia-image-smoke-$$"
DATA_DIR="$(mktemp -d)"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

mkdir -p "$DATA_DIR/tools/runtime-import" "$DATA_DIR/tools/broken"
cat > "$DATA_DIR/tools/runtime-import/TOOL.md" <<'EOF'
---
name: runtime_import
description: Verify runtime dependencies resolve from a volume-backed tool
---
EOF
cat > "$DATA_DIR/tools/runtime-import/handler.ts" <<'EOF'
import { tool } from "ai";
import { z } from "zod";

export default tool({
  description: "Runtime import smoke test",
  inputSchema: z.object({}),
  execute: async () => ({ ok: true }),
});
EOF
cat > "$DATA_DIR/tools/broken/TOOL.md" <<'EOF'
---
name: broken
description: Verify malformed optional tools do not prevent boot
---
EOF
printf '%s\n' 'export default { this is not valid TypeScript' \
  > "$DATA_DIR/tools/broken/handler.ts"

docker build -t "$IMAGE" -f "$ROOT/packages/habitat/Dockerfile" "$ROOT"
docker run -d --name "$CONTAINER" \
  -e HABITAT_WORK_DIR=/data \
  -v "$DATA_DIR:/data" \
  "$IMAGE" \
  pnpm exec tsx packages/cli/src/entry.ts habitat gaia \
    --port 7420 --data-dir /data --provider openrouter --model smoke \
  >/dev/null

deadline=$((SECONDS + 45))
health=""
until health="$(docker exec "$CONTAINER" node -e \
  "fetch('http://127.0.0.1:7420/health').then(async r => { if (!r.ok) process.exit(1); process.stdout.write(await r.text()) })" \
  2>/dev/null)"; do
  if ! docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
    docker logs "$CONTAINER" >&2
    echo "error: Gaia image exited before becoming healthy" >&2
    exit 1
  fi
  if ((SECONDS >= deadline)); then
    docker logs "$CONTAINER" >&2
    echo "error: Gaia image did not become healthy within 45s" >&2
    exit 1
  fi
  sleep 1
done

node -e '
  const health = JSON.parse(process.argv[1]);
  if (health.status !== "degraded") throw new Error(`expected degraded, got ${health.status}`);
  if (!health.toolIssues?.includes("broken")) throw new Error("broken tool was not reported");
  if (health.toolIssues?.includes("runtime_import")) throw new Error("runtime imports did not resolve");
' "$health"

echo "Gaia image booted; runtime imports resolved and malformed tool was isolated."
