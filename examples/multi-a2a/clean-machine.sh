#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js (>= 22.19) is required. Install Node.js first." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 22 )); then
  echo "Error: Node.js >= 22 is required; found $(node --version)." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm is required. Enable it via 'corepack enable pnpm'." >&2
  exit 1
fi

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "Installing workspace dependencies with pnpm..."
  pnpm install --frozen-lockfile
fi

if ! command -v pi >/dev/null 2>&1; then
  echo "Installing @earendil-works/pi-coding-agent CLI globally with pnpm..."
  pnpm add -g @earendil-works/pi-coding-agent
fi

exec pnpm exec tsx examples/multi-a2a/e2e.ts "$@"
