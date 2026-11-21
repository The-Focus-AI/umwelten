#!/bin/sh
set -e

WORK_DIR="${HABITAT_WORK_DIR:-/data}"
mkdir -p "$WORK_DIR/habitats"

# Optional authenticated github.com HTTPS clones when GITHUB_TOKEN is provided
if [ -n "${GITHUB_TOKEN:-}" ]; then
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0="url.https://x-access-token:${GITHUB_TOKEN}@github.com/.insteadOf"
  export GIT_CONFIG_VALUE_0="https://github.com/"
fi

# Run optional declarative repo/mount provisioning if /data/config.json is present
if [ -f "$WORK_DIR/config.json" ]; then
  pnpm exec tsx packages/habitat/src/provision/provision.ts
fi

exec "$@"
