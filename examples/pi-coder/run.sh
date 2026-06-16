#!/usr/bin/env bash
#
# Serve the pi-coder habitat with the working directory pinned to THIS example
# dir, so config.json's relative "./project" resolves to this example's
# project/ (and pi only ever touches files in here — fully isolated).
#
# Pass extra flags through, e.g.:  ./run.sh --port 7471
#
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
cd "$DIR"
exec dotenvx run -f "$REPO/.env" -- \
  "$REPO/node_modules/.bin/tsx" "$REPO/packages/cli/src/entry.ts" \
  habitat serve --work-dir . --host 127.0.0.1 "$@"
