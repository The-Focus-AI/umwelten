# Habitat Bridge MCP Test Walkthrough

This guide walks through testing the Bridge MCP system manually.

## Prerequisites

- Docker running (for Dagger containers)
- Environment variables: `dotenvx` configured with `.env`
- Dependencies installed: `pnpm install`
- An agent registered with `gitRemote` in `~/habitats/config.json`

## Starting the Bridge

```bash
dotenvx run -- pnpm run cli habitat agent start trmnl-image-agent
```

This will:

1. Create a Dagger container with `node:20` base image
2. Install apt packages (jq, chromium, imagemagick, etc.)
3. Run setup commands (claude install, etc.)
4. Mount the pre-compiled Go MCP binary
5. Clone the repository to `/workspace`
6. Start the Go MCP server on a port (10000+)
7. Poll until the MCP server responds to an `initialize` request
8. Print the endpoint URL

## Testing MCP Tools

With the bridge running on port 10000:

### Health Check

```bash
curl -s -X POST http://localhost:10000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "bridge_health",
      "arguments": {}
    }
  }' | jq .
```

### List Files

```bash
curl -s -X POST http://localhost:10000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "fs_list",
      "arguments": {"path": "/workspace"}
    }
  }' | jq .
```

### Read a File

```bash
curl -s -X POST http://localhost:10000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "fs_read",
      "arguments": {"path": "/workspace/README.md"}
    }
  }' | jq .
```

### Execute a Command

```bash
curl -s -X POST http://localhost:10000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "exec_run",
      "arguments": {"command": "ls -la /workspace/bin/"}
    }
  }' | jq .
```

### MCP Initialize (what the health check polls)

```bash
curl -s -X POST http://localhost:10000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0"}
    }
  }'
```

Should return a response containing `serverInfo` with name `habitat-bridge`.

## Using the TypeScript Client

```typescript
import { HabitatBridgeClient } from "../habitat/bridge/client.js";

const client = new HabitatBridgeClient({
  host: "localhost",
  port: 10000,
  timeout: 5000,
});

await client.connect();

// Health check
const health = await client.health();
console.log("Status:", health.status);

// List workspace
const files = await client.listDirectory("/workspace");
console.log("Files:", files.map(f => f.name));

// Read a file
const readme = await client.readFile("/workspace/README.md");
console.log("README:", readme.slice(0, 200));

// Execute a command
const result = await client.execute("node --version");
console.log("Node:", result.stdout);

// Check if file exists
const exists = await client.fileExists("/workspace/package.json");
console.log("Has package.json:", exists);

await client.disconnect();
```

## What the Analyzer Discovers

For the `trmnl-image-agent` project, the `BridgeAnalyzer` finds:

| Field | Value |
|---|---|
| Project type | `shell` |
| Detected tools | jq, chrome, claude-code, curl, 1password-cli, npx, python, imagemagick, git |
| APT packages | jq, chromium, chromium-driver, curl, python3, imagemagick, git |
| Setup commands | claude install via curl, 1password-cli install |
| Skills | none |

This is saved to `config.json` under `bridgeProvisioning` so subsequent starts skip analysis.

## Architecture

```
Host                                    Dagger Container
─────                                   ────────────────
CLI (habitat.ts)
  → BridgeAgent (agent.ts)
    → BridgeLifecycle (lifecycle.ts)
      → Worker Thread (bridge-worker.ts)
        → Builds container via Dagger SDK ──→ node:20 + apt packages
        → Mounts Go binary ─────────────────→ /opt/bridge/bridge-server
        → Clones repo ──────────────────────→ /workspace/
        → Starts service ───────────────────→ bridge-server --port 10000
      ← Polls http://localhost:10000/mcp
    ← Worker signals "ready"
  ← BridgeAnalyzer reads repo via MCP
  ← Saves provisioning to config.json
```

The Go MCP server (`bridge-server-linux`) is a static ARM64 binary compiled from `src/habitat/bridge/go-server/main.go`. It uses the official Go MCP SDK with StreamableHTTP transport — no Node.js or npm needed inside the container for the server itself.

## Logs

Bridge logs go to `~/habitats-sessions/logs/` with timestamped filenames:

```bash
# View latest log
ls -lt ~/habitats-sessions/logs/bridge-trmnl-image-agent-*.log | head -1 | xargs cat
```

## See Also

- `src/habitat/bridge/agent.ts` — BridgeAgent orchestration
- `src/habitat/bridge/bridge-worker.ts` — Dagger container build
- `src/habitat/bridge/analyzer.ts` — Repository analysis via MCP
- `src/habitat/bridge/client.ts` — HabitatBridgeClient
- `src/habitat/bridge/go-server/main.go` — Go MCP server source
