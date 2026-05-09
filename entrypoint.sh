#!/bin/sh
set -e

WORK_DIR="${HABITAT_WORK_DIR:-/data}"
CONFIG_FILE="$WORK_DIR/config.json"

# Auto-provision if config.json has gitUrl but project/ doesn't exist yet
if [ -f "$CONFIG_FILE" ]; then
  GIT_URL=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8'));if(c.gitUrl)console.log(c.gitUrl)}catch{}" 2>/dev/null)
  PROJECT_DIR_NAME=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8'));console.log(c.projectDir||'project')}catch{console.log('project')}" 2>/dev/null)
  PROJECT_DIR="$WORK_DIR/$PROJECT_DIR_NAME"

  if [ -n "$GIT_URL" ] && [ ! -d "$PROJECT_DIR/.git" ]; then
    echo "[entrypoint] Auto-provisioning from $GIT_URL..."
    GIT_BRANCH=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8'));if(c.gitBranch)console.log(c.gitBranch)}catch{}" 2>/dev/null)
    BRANCH_ARG=""
    if [ -n "$GIT_BRANCH" ]; then
      BRANCH_ARG="--branch $GIT_BRANCH"
    fi
    git clone $BRANCH_ARG "$GIT_URL" "$PROJECT_DIR"
    echo "[entrypoint] Clone complete."
  fi

  # Run mise install if project exists and has mise.toml
  if [ -d "$PROJECT_DIR" ]; then
    if [ -f "$PROJECT_DIR/mise.toml" ] || [ -f "$PROJECT_DIR/.mise.toml" ]; then
      echo "[entrypoint] Running mise install..."
      cd "$PROJECT_DIR" && mise install && cd /habitat
      echo "[entrypoint] mise install complete."
    fi
  fi

  # Install skills from skills-lock.json if present
  if [ -f "$WORK_DIR/skills-lock.json" ]; then
    echo "[entrypoint] Restoring skills from skills-lock.json..."
    cd "$WORK_DIR" && npx skills install 2>&1 || echo "[entrypoint] Skills install had warnings (non-fatal)"
    cd /habitat
    echo "[entrypoint] Skills restore complete."
  fi
fi

# Execute the main command
exec "$@"
