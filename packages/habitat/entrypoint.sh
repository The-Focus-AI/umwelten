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
# would leak credentials across agents. Instead, the per-agent clone runs with
# `env -i` plus only the env vars listed in identity.scopes[].env (resolved
# from /data/secrets.json, then process env).
#
# The provisioning DECISION — cold start or refresh, and what needs doing
# given the volume's current state — lives in
# packages/habitat/src/provision/, invoked once below (umwelten #269). This
# script keeps only what the shell has to own: resolving the GitHub token and
# exporting the `insteadOf` git config, which the provisioner inherits.

WORK_DIR="${HABITAT_WORK_DIR:-/data}"
CONFIG_FILE="$WORK_DIR/config.json"
SECRETS_FILE="$WORK_DIR/secrets.json"

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

# ── Private-repo git auth ──────────────────────────────────────────────
# Route github.com HTTPS git operations through a token via git's env
# config — this covers the project clone, per-agent clones, and
# `npx skills add`. x-access-token works for classic PATs, fine-grained
# PATs, and app installation tokens alike. The token never lands in
# config.json, the registry, or the clone URLs persisted in git remotes.
#
# Token source, in order — freshest first (ADR 0004):
#   1. GitHub App mint — only Gaia has GITHUB_APP_* env; a fresh ambient-read
#      installation token beats any stored PAT (which can silently go stale).
#   2. GITHUB_TOKEN env — the per-habitat boot token Gaia's token service
#      injects into children (docker.ts). Checked BEFORE the vault so a
#      stale vault PAT can't shadow the fresh per-boot token.
#   3. GITHUB_TOKEN in the seeded secrets vault — legacy PATs.
GITHUB_TOKEN_VALUE=""
if [ -n "$GITHUB_APP_ID" ] && [ -n "$GITHUB_APP_INSTALLATION_ID" ] && [ -n "$GITHUB_APP_PRIVATE_KEY_FILE" ]; then
	GITHUB_TOKEN_VALUE=$(pnpm exec tsx packages/habitat/src/tools/gaia/github/mint-boot-token.ts 2>/dev/null) || GITHUB_TOKEN_VALUE=""
	if [ -n "$GITHUB_TOKEN_VALUE" ]; then
		echo "[entrypoint] GitHub App configured — minted ambient-read token for github.com clones."
	else
		echo "[entrypoint] GitHub App configured but token mint failed — falling back to GITHUB_TOKEN."
	fi
fi
if [ -z "$GITHUB_TOKEN_VALUE" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
	GITHUB_TOKEN_VALUE="$GITHUB_TOKEN"
	echo "[entrypoint] GITHUB_TOKEN env present (per-habitat boot token) — authenticated github.com clones enabled."
fi
if [ -z "$GITHUB_TOKEN_VALUE" ]; then
	GITHUB_TOKEN_VALUE=$(secret_value GITHUB_TOKEN)
	[ -n "$GITHUB_TOKEN_VALUE" ] && echo "[entrypoint] GITHUB_TOKEN present — authenticated github.com clones enabled."
fi
if [ -n "$GITHUB_TOKEN_VALUE" ]; then
	export GIT_CONFIG_COUNT=1
	export GIT_CONFIG_KEY_0="url.https://x-access-token:$GITHUB_TOKEN_VALUE@github.com/.insteadOf"
	export GIT_CONFIG_VALUE_0="https://github.com/"
fi

# ── Provisioning ───────────────────────────────────────────────────────
# One invoked entry. The module inspects the volume, decides what this boot
# needs (clone vs. fast-forward, which mounts are new, toolchain/dependency
# installs, skills restore vs. install) and executes that plan. Behaviour is
# identical to the shell it replaced; `--dry-run` prints the plan instead.
if [ -f "$CONFIG_FILE" ]; then
	pnpm exec tsx packages/habitat/src/provision/provision.ts
fi

exec "$@"
