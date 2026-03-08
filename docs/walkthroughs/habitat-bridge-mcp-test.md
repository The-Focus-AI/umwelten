# Habitat Bridge MCP Test Walkthrough

This guide walks through testing the Bridge MCP system manually.

## Prerequisites

- Docker running (for Dagger containers)
- Environment variables: available in a local `.env` file
- Dependencies installed: `pnpm install`
- An agent registered with `gitRemote` in `~/habitats/config.json`

## Starting the Bridge

```bash
pnpm run cli -- habitat agent start trmnl-image-agent
```

This will:

1. Load saved provisioning from `config.json` (or use bare `node:20` on first start)
2. Build Dagger container with base image + apt packages + setup commands
3. Mount the pre-compiled Go MCP binary
4. Clone the repository to `/workspace`
5. Start the Go MCP server on a port (10000+)
6. Poll until the MCP server responds to an `initialize` request
7. Print the endpoint URL

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

## Saved Provisioning

After an LLM inspects and configures an agent, `config.json` includes the provisioning data:

```json
{
  "id": "trmnl-image-agent",
  "bridgeProvisioning": {
    "baseImage": "node:20",
    "aptPackages": ["jq", "chromium", "chromium-driver", "curl", "python3", "imagemagick", "git"],
    "setupCommands": ["curl -fsSL https://claude.ai/install.sh | bash"],
    "detectedTools": ["jq", "chrome", "claude-code", "curl", "python", "imagemagick", "git"],
    "projectType": "shell",
    "skillRepos": [],
    "analyzedAt": "2026-02-19T00:50:00.000Z"
  }
}
```

Subsequent starts use this saved provisioning to build the container with all packages immediately.

## Architecture

```
Host                                    Dagger Container
-----                                   ----------------
CLI (habitat.ts)
  -> Habitat.startBridge(agentId)
    -> BridgeAgent.start()
      -> BridgeLifecycle (spawns worker thread)
        -> bridge-worker.ts (builds container) --> node:20 + apt packages
        -> Mounts Go binary -----------------> /opt/bridge/bridge-server
        -> Clones repo ---------------------> /workspace/
        -> Starts service ------------------> bridge-server --port 10000
      <- Polls http://localhost:10000/mcp
    <- Worker signals "ready"
  <- Returns BridgeAgent with port + client
```

The Go MCP server (`bridge-server-linux`) is a static ARM64 binary compiled from `src/habitat/bridge/go-server/main.go`. It uses the official Go MCP SDK with StreamableHTTP transport — no Node.js or npm needed inside the container for the server itself.

## Logs

Bridge logs go to `~/habitats-sessions/logs/` with timestamped filenames:

```bash
# View latest log
ls -lt ~/habitats-sessions/logs/bridge-trmnl-image-agent-*.log | head -1 | xargs cat
```

## See Also

- `src/habitat/bridge/agent.ts` — BridgeAgent (simple start, no iteration loop)
- `src/habitat/bridge/diagnosis-agent.ts` — LLM agent for project inspection and provisioning
- `src/habitat/bridge/monitor-agent.ts` — LLM agent for health monitoring
- `src/habitat/bridge/bridge-worker.ts` — Dagger container build
- `src/habitat/bridge/client.ts` — HabitatBridgeClient
- `src/habitat/bridge/go-server/main.go` — Go MCP server source
- `src/habitat/habitat.ts` — `startBridge()`, `createAgentInteraction()`
- `src/habitat/tools/agent-runner-tools.ts` — `bridge_diagnose`, `bridge_monitor` tools
