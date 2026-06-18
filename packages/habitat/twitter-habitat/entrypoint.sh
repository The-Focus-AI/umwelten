#!/bin/sh
set -e

# Twitter-habitat entrypoint wrapper (#155).
#
# The base `habitat` image seeds nothing into /data — Gaia (or a plain
# `docker run`) only puts config.json + secrets.json on the volume. This
# wrapper layers the Twitter work dir (custom tools + their deep modules +
# persona) onto the volume on every boot, then chains the base entrypoint.
#
# Why the node_modules symlink: the work-dir tools are loaded by the habitat
# runtime via `import(file:///data/tools/.../handler.ts)`. Node resolves bare
# specifiers (`ai`, `zod`) from node_modules walking up from the handler's
# path — i.e. /data/.../node_modules, never /habitat/node_modules. Symlinking
# /data/node_modules → /habitat/node_modules makes those imports (and the
# deep modules under /data/src) resolve inside the container.

WORK_DIR="${HABITAT_WORK_DIR:-/data}"
SEED_DIR=/opt/twitter-habitat
HABITAT_ROOT="${HABITAT_ROOT:-/habitat}"

mkdir -p "$WORK_DIR"

# Code (tools + deep modules): the image is the source of truth, so refresh
# these every boot. Operators customize behavior via secrets/persona, not by
# editing baked code on the volume.
rm -rf "$WORK_DIR/tools" "$WORK_DIR/src"
cp -r "$SEED_DIR/tools" "$WORK_DIR/tools"
cp -r "$SEED_DIR/src" "$WORK_DIR/src"
echo "[twitter-habitat] Seeded tools/ and src/ into $WORK_DIR."

# Persona: seed only when absent so an operator's edit (or a Gaia-managed
# STIMULUS.md) wins.
if [ ! -f "$WORK_DIR/STIMULUS.md" ]; then
	cp "$SEED_DIR/STIMULUS.md" "$WORK_DIR/STIMULUS.md"
	echo "[twitter-habitat] Seeded default STIMULUS.md (Twitter persona)."
fi

# Make bare imports from the work-dir tools resolve against the monorepo deps.
ln -sfn "$HABITAT_ROOT/node_modules" "$WORK_DIR/node_modules"

# Config: ensure toolsDir/stimulusFile point at the seeded assets (idempotent
# merge — Gaia-seeded name/provider/model/secret fields are preserved).
node "$SEED_DIR/seed-config.mjs" "$WORK_DIR/config.json"

mkdir -p "$WORK_DIR/sessions"

exec /entrypoint.sh "$@"
