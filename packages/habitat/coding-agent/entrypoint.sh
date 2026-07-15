#!/bin/sh
set -e

# Coding-agent entrypoint wrapper (#123).
#
# Runs as root just long enough to (1) seed the volume with the default
# persona, routing, and config agents — never overwriting what's already
# there — and (2) hand the data volume to the node user. Then drops
# privileges and chains into the base habitat entrypoint, which provisions
# agents/skills and execs the container server as node (uid 1000).

WORK_DIR="${HABITAT_WORK_DIR:-/data}"
SEED_DIR=/opt/coding-agent

mkdir -p "$WORK_DIR"

# Persona: points the agent at the standards corpus (only when absent —
# operators and Gaia seeds win).
if [ ! -f "$WORK_DIR/STIMULUS.md" ]; then
	cp "$SEED_DIR/STIMULUS.md" "$WORK_DIR/STIMULUS.md"
	echo "[coding-agent] Seeded default STIMULUS.md (standards persona)."
fi

# Channel routing: bind a2a/web to the workspace agent on an agentic runtime.
if [ ! -f "$WORK_DIR/routing.json" ]; then
	cp "$SEED_DIR/routing.json" "$WORK_DIR/routing.json"
	echo "[coding-agent] Seeded default routing.json (coding channel → claude-sdk)."
fi

# Config: ensure the workspace + standards-corpus agents exist (idempotent
# merge — Gaia-seeded config.json fields are preserved).
node "$SEED_DIR/seed-config.mjs" "$WORK_DIR/config.json"

# Directories the runtimes expect under the volume.
mkdir -p "$WORK_DIR/workspace" "$WORK_DIR/pi-agent" "$WORK_DIR/claude-config" "$WORK_DIR/codex" "$WORK_DIR/sessions"

# Hand the volume to the node user. Gaia re-seeds config/secrets as root on
# every (re)start, so this must run every boot, not just the first.
chown -R node:node "$WORK_DIR"

exec gosu node /entrypoint.sh "$@"
