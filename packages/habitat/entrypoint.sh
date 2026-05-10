#!/bin/sh
set -e

# Habitat Runtime entrypoint.
#
# Per the Habitat Runtime spec (docs/architecture/habitat-runtime.md), this
# script provisions any code-bearing agents declared in config.agents[] before
# starting the habitat server. Each agent gets:
#
#   /data/agents/<id>/         -- per-agent root
#   /data/agents/<id>/repo/    -- cloned repo (kind: repo | mcp-agent)
#   /data/agents/<id>/secrets.json (mode 0600, optional, written by host)
#
# Per-agent secrets / scopes are NOT exported to the entrypoint shell — that
# would leak credentials across agents. Instead, the per-agent clone runs in
# a sub-shell that exports only the env vars listed in identity.scopes[].env
# (resolved from /data/secrets.json, then process env).

WORK_DIR="${HABITAT_WORK_DIR:-/data}"
CONFIG_FILE="$WORK_DIR/config.json"
SECRETS_FILE="$WORK_DIR/secrets.json"
AGENTS_DIR="$WORK_DIR/agents"

# Helper: read a JSON path from CONFIG_FILE via node. Empty stdout on error.
config_json() {
  node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8'));
      const v = (function(){ $1 })();
      if (v !== undefined && v !== null) console.log(typeof v === 'string' ? v : JSON.stringify(v));
    } catch {}
  " 2>/dev/null
}

# Helper: emit each agent record as a JSON line (id, kind, mode, gitRemote, scopeEnv[]).
list_agents() {
  node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8'));
      for (const a of c.agents ?? []) {
        const env = []
          .concat(...(a.identity?.scopes ?? []).map(s => s.env ?? []))
          .concat(a.secrets ?? []);
        const seen = new Set();
        const dedup = env.filter(n => !seen.has(n) && seen.add(n));
        process.stdout.write(JSON.stringify({
          id: a.id,
          kind: a.kind || 'repo',
          mode: a.mode || 'write',
          gitRemote: a.gitRemote || null,
          gitBranch: a.gitBranch || null,
          scopeEnv: dedup,
        }) + '\n');
      }
    } catch {}
  " 2>/dev/null
}

# Helper: lookup a secret value by name, /data/secrets.json first, then env.
secret_value() {
  name="$1"
  node -e "
    try {
      const m = JSON.parse(require('fs').readFileSync('$SECRETS_FILE','utf8'));
      if (m['$name'] !== undefined) { process.stdout.write(String(m['$name'])); process.exit(0); }
    } catch {}
    const v = process.env['$name'];
    if (v !== undefined) process.stdout.write(String(v));
  " 2>/dev/null
}

if [ -f "$CONFIG_FILE" ]; then
  # ── Legacy single-project provisioning (still supported) ──────────────
  GIT_URL=$(config_json "return c.gitUrl")
  PROJECT_DIR_NAME=$(config_json "return c.projectDir || 'project'")
  [ -z "$PROJECT_DIR_NAME" ] && PROJECT_DIR_NAME="project"
  PROJECT_DIR="$WORK_DIR/$PROJECT_DIR_NAME"

  if [ -n "$GIT_URL" ] && [ ! -d "$PROJECT_DIR/.git" ]; then
    echo "[entrypoint] Auto-provisioning from $GIT_URL..."
    GIT_BRANCH=$(config_json "return c.gitBranch")
    BRANCH_ARG=""
    if [ -n "$GIT_BRANCH" ]; then
      BRANCH_ARG="--branch $GIT_BRANCH"
    fi
    git clone $BRANCH_ARG "$GIT_URL" "$PROJECT_DIR"
    echo "[entrypoint] Clone complete."
  fi

  if [ -d "$PROJECT_DIR" ]; then
    if [ -f "$PROJECT_DIR/mise.toml" ] || [ -f "$PROJECT_DIR/.mise.toml" ]; then
      echo "[entrypoint] Running mise install in $PROJECT_DIR..."
      cd "$PROJECT_DIR" && mise install && cd /habitat
      echo "[entrypoint] mise install complete."
    fi
  fi

  # ── Per-agent provisioning (Habitat Runtime spec) ─────────────────────
  mkdir -p "$AGENTS_DIR"

  list_agents | while IFS= read -r line; do
    [ -z "$line" ] && continue
    AGENT_ID=$(echo "$line"   | node -e "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).id||''))")
    AGENT_KIND=$(echo "$line" | node -e "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).kind||'repo'))")
    AGENT_MODE=$(echo "$line" | node -e "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).mode||'write'))")
    AGENT_REMOTE=$(echo "$line" | node -e "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).gitRemote||''))")
    AGENT_BRANCH=$(echo "$line" | node -e "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).gitBranch||''))")
    AGENT_ENV_NAMES=$(echo "$line" | node -e "process.stdin.on('data',d=>process.stdout.write((JSON.parse(d).scopeEnv||[]).join(' ')))")

    [ -z "$AGENT_ID" ] && continue

    # credential-only agents have no project on disk.
    if [ "$AGENT_KIND" = "credential-only" ] || [ "$AGENT_KIND" = "remote-habitat" ]; then
      mkdir -p "$AGENTS_DIR/$AGENT_ID"
      echo "[entrypoint] Skipping clone for $AGENT_ID (kind=$AGENT_KIND)."
      continue
    fi

    AGENT_REPO="$AGENTS_DIR/$AGENT_ID/repo"
    if [ -z "$AGENT_REMOTE" ]; then
      mkdir -p "$AGENTS_DIR/$AGENT_ID"
      echo "[entrypoint] Agent $AGENT_ID has no gitRemote; skipping clone."
      continue
    fi
    if [ -d "$AGENT_REPO/.git" ]; then
      echo "[entrypoint] Agent $AGENT_ID already cloned."
    else
      mkdir -p "$AGENTS_DIR/$AGENT_ID"
      echo "[entrypoint] Cloning agent $AGENT_ID (kind=$AGENT_KIND, mode=$AGENT_MODE) from $AGENT_REMOTE..."

      # Build a per-agent environment dictionary from scope env names.
      AGENT_ENV_SETUP=""
      for n in $AGENT_ENV_NAMES; do
        VAL=$(secret_value "$n")
        if [ -n "$VAL" ]; then
          # shell-escape: wrap in single quotes, escape inner single quotes
          ESC=$(printf "%s" "$VAL" | sed "s/'/'\\\\''/g")
          AGENT_ENV_SETUP="$AGENT_ENV_SETUP $n='$ESC'"
        fi
      done

      BRANCH_ARG=""
      [ -n "$AGENT_BRANCH" ] && BRANCH_ARG="--branch $AGENT_BRANCH"

      # Clone in a sub-shell with only this agent's env vars set.
      sh -c "env -i PATH=\"\$PATH\" HOME=\"\$HOME\" $AGENT_ENV_SETUP git clone $BRANCH_ARG \"$AGENT_REMOTE\" \"$AGENT_REPO\"" \
        || echo "[entrypoint] Clone failed for agent $AGENT_ID (continuing)."
    fi

    if [ -d "$AGENT_REPO" ] && { [ -f "$AGENT_REPO/mise.toml" ] || [ -f "$AGENT_REPO/.mise.toml" ]; }; then
      echo "[entrypoint] Running mise install for agent $AGENT_ID..."
      (cd "$AGENT_REPO" && mise install) || echo "[entrypoint] mise install failed for $AGENT_ID (continuing)."
    fi

    # Write a per-agent provision marker for `provision_status` introspection.
    PROV_FILE="$AGENTS_DIR/$AGENT_ID/.provisioned"
    : > "$PROV_FILE"
    chmod 0600 "$PROV_FILE" 2>/dev/null || true
  done

  if [ -f "$WORK_DIR/skills-lock.json" ]; then
    echo "[entrypoint] Restoring skills from skills-lock.json..."
    cd "$WORK_DIR" && npx skills install 2>&1 || echo "[entrypoint] Skills install had warnings (non-fatal)"
    cd /habitat
    echo "[entrypoint] Skills restore complete."
  fi
fi

exec "$@"
