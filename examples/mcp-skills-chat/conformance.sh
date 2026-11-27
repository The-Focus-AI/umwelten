#!/usr/bin/env bash
# Run the official MCP conformance suite (github.com/modelcontextprotocol/conformance)
# against the example skill server.
#
# The suite (0.1.16) covers protocol revisions 2025-06-18 / 2025-11-25 only, so it
# exercises the SDK's stateless 2025 fallback; 2026-07-28 and the Skills extension
# are covered by packages/protocols/src/mcp/skills/host.test.ts and e2e.ts.
# Scenarios not listed here call fixtures of the reference "everything" server
# (test_* tools, test:// resources) or features this server does not offer
# (prompts, logging, completion, subscriptions); run them with SCENARIOS=all.
set -euo pipefail
URL="${1:-http://127.0.0.1:7701/mcp}"
SCENARIOS="${SCENARIOS:-server-initialize ping tools-list resources-list dns-rebinding-protection}"
if [ "$SCENARIOS" = all ]; then
  exec npx -y @modelcontextprotocol/conformance@0.1.16 server --url "$URL"
fi
for s in $SCENARIOS; do
  npx -y @modelcontextprotocol/conformance@0.1.16 server --url "$URL" --scenario "$s"
done
