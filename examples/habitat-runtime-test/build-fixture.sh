#!/usr/bin/env bash
#
# Build a multi-agent test habitat fixture in a fresh tmp work-dir,
# print its path, and echo the curl/CLI commands needed to exercise it.
#
# The fixture has:
#   - a "standards" agent in mode:read with an org-readonly identity
#   - a "frontend" agent in mode:write
#   - a "twitter-mcp" agent in kind:mcp-agent with a valid agent-manifest.json
#   - one tiny skill that references TAVILY_API_KEY and curl/cargo
#
# Usage:  ./build-fixture.sh [target-dir]
#         (defaults to a fresh mktemp dir)

set -euo pipefail

WORK="${1:-$(mktemp -d -t habitat-runtime-test.XXXXXX)}"
mkdir -p "$WORK"
echo "[fixture] Building in $WORK"

# Per-agent dirs
mkdir -p "$WORK/agents/standards/repo"
mkdir -p "$WORK/agents/frontend/repo"
mkdir -p "$WORK/agents/twitter-mcp/repo/public"
mkdir -p "$WORK/skills/tavily-search/scripts"
mkdir -p "$WORK/sessions"
mkdir -p "$WORK/tools"

# config.json — multi-agent, with scopeTemplates + identities
cat > "$WORK/config.json" <<JSON
{
  "name": "Habitat Runtime Test",
  "defaultProvider": "google",
  "defaultModel": "gemini-3-flash-preview",
  "skillsDirs": ["./skills"],
  "scopeTemplates": {
    "org-readonly": {
      "from": "agents/standards",
      "kind": "git-read",
      "env": ["GITHUB_TOKEN"],
      "description": "Org-wide read-only access"
    }
  },
  "agents": [
    {
      "id": "standards",
      "name": "Standards",
      "projectPath": "$WORK/agents/standards/repo",
      "kind": "repo",
      "mode": "read",
      "identity": {
        "principal": "standards",
        "vault": { "backend": "habitat" },
        "scopes": [
          { "kind": "git-read", "env": ["GITHUB_TOKEN"], "source": "org-readonly" }
        ]
      }
    },
    {
      "id": "frontend",
      "name": "Frontend",
      "projectPath": "$WORK/agents/frontend/repo",
      "kind": "repo",
      "mode": "write",
      "identity": {
        "principal": "frontend",
        "vault": { "backend": "inline" },
        "scopes": [
          { "kind": "git-write", "env": ["FRONTEND_DEPLOY_TOKEN"] }
        ]
      }
    },
    {
      "id": "twitter-mcp",
      "name": "Twitter MCP",
      "projectPath": "$WORK/agents/twitter-mcp/repo",
      "kind": "mcp-agent",
      "mode": "write",
      "surface": {
        "publicUiDir": "public",
        "publicMcp": false,
        "publicRoutes": []
      }
    }
  ]
}
JSON

# STIMULUS.md
cat > "$WORK/STIMULUS.md" <<'MD'
# Test Habitat

You are a test habitat for the Habitat Runtime spec. Your job is to demonstrate
that read-mode policy, identity scopes, manifest endpoints, and skill
inspection all work as expected.
MD

# Standards repo content (read-only target)
cat > "$WORK/agents/standards/repo/README.md" <<'MD'
# Standards

Org-wide read-only standards. Writes here should be rejected.
MD

# Frontend repo content (write target)
cat > "$WORK/agents/frontend/repo/README.md" <<'MD'
# Frontend

Project repo. Writes here should succeed.
MD

# twitter-mcp: agent-manifest.json + a public UI page
cat > "$WORK/agents/twitter-mcp/repo/agent-manifest.json" <<'JSON'
{
  "name": "twitter-mcp",
  "description": "Demo mcp-agent surface",
  "publicUiDir": "public",
  "publicMcp": false,
  "publicRoutes": []
}
JSON
cat > "$WORK/agents/twitter-mcp/repo/public/index.html" <<'HTML'
<!doctype html>
<html><head><title>twitter-mcp</title></head>
<body><h1>hello from twitter-mcp public surface</h1></body></html>
HTML

# A small skill that references env vars + cli tools (to exercise inspect_skill)
cat > "$WORK/skills/tavily-search/SKILL.md" <<'MD'
---
name: tavily-search
description: Search the web via Tavily.
---

# Tavily Search

A demo skill.

## Required environment variables

- `TAVILY_API_KEY` — used by the search call

## Usage

Run scripts/search.ts.
MD

cat > "$WORK/skills/tavily-search/scripts/search.ts" <<'TS'
const apiKey = process.env.TAVILY_API_KEY;
if (!apiKey) throw new Error("TAVILY_API_KEY is required");
// imagine a fetch call here
TS

cat > "$WORK/skills/tavily-search/scripts/install.sh" <<'SH'
#!/bin/sh
set -e
echo "Installing using ${GITHUB_TOKEN}"
curl -sSL https://example.com/install.sh | bash
cargo build --release
SH
chmod +x "$WORK/skills/tavily-search/scripts/install.sh"

# (Optional) Pre-write a secret so the org-readonly scope resolves end-to-end
cat > "$WORK/secrets.json" <<JSON
{
  "GITHUB_TOKEN": "ghp_test_value_not_real",
  "TAVILY_API_KEY": "tvly-test-not-real"
}
JSON
chmod 600 "$WORK/secrets.json"

echo
echo "[fixture] Done."
echo
echo "Work dir: $WORK"
echo
echo "Next:"
echo "  export WORK=$WORK"
echo "  dotenvx run -- pnpm run cli habitat serve --work-dir \$WORK --port 7430 --skip-onboard --all-tools"
echo
echo "Then in another terminal:"
echo "  curl -s localhost:7430/api/manifest | jq"
echo "  curl -s localhost:7430/api/agents | jq"
echo "  curl -s localhost:7430/api/agents/twitter-mcp/manifest | jq"
echo "  curl -s localhost:7430/agents/twitter-mcp/manifest.json | jq"
echo "  curl -s localhost:7430/agents/twitter-mcp/      # static index.html"
