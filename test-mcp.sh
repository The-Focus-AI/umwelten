#!/bin/bash
# Test script for Habitat MCP Server

# First, let's add a simple test agent to the habitat
echo "=== Adding test agent ==="
dotenvx run -- pnpm run cli -- habitat agent-add test-agent "Test Agent" "./test-project"

# Start the agent's MCP server
echo ""
echo "=== Starting agent MCP server ==="
dotenvx run -- pnpm run cli -- habitat agent start test-agent

# Check agent status
echo ""
echo "=== Checking agent status ==="
dotenvx run -- pnpm run cli -- habitat agent status test-agent

# List all agents with MCP status
echo ""
echo "=== Listing all agents ==="
dotenvx run -- pnpm run cli -- habitat agent status

echo ""
echo "=== MCP Server should be running on port 8081 ==="
echo "You can now connect to: http://localhost:8081/mcp"
echo ""
echo "To test with curl:"
echo "  curl -X POST http://localhost:8081/mcp \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -H 'Accept: application/json, text/event-stream' \\"
echo "    -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}'"
echo ""
echo "To stop the agent:"
echo "  dotenvx run -- pnpm run cli -- habitat agent stop test-agent"
