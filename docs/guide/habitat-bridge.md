# Habitat Bridge System

## Overview

The Habitat Bridge System is an optional runtime for managed agents. The normal path is to clone a project into the habitat workspace and inspect it with `agent_ask`; when the project needs isolation, a bridge runs that managed workspace inside a Dagger container with an MCP server for communication.

## Architecture

```
Host Machine
├── ~/habitats/config.json          # Agent configs with saved bridgeProvisioning
├── ~/habitats/secrets.json         # Encrypted secrets
└── ~/habitats-sessions/logs/       # Timestamped bridge log files
    └── bridge-{agentId}-{timestamp}.log

Dagger Container (per agent)
├── /opt/bridge/bridge-server       # Pre-compiled Go MCP binary
└── /workspace/                     # Cloned repository
```

## How It Works

### 1. Clone — `agent_clone(gitUrl, name)`

Clone the repo into `agents/<id>/repo` and register the agent in config. Nothing starts yet.

### 2. Build — LLM-driven container building

The system uses Dagger's `dag.llm()` with a privileged environment to read the repo and build a working container:

1. The LLM reads project files (package.json, requirements.txt, Cargo.toml, etc.)
2. Picks the right base image (node:20, python:3.11, rust:1.75, etc.)
3. Installs all dependencies
4. Copies repo to `/workspace`

After the LLM builds the container, fixed layers are always added on top:
- Go MCP server binary at `/opt/bridge/bridge-server`
- Secrets injected via environment variables
- Port exposed, entrypoint set

### 3. Supervise — automatic health monitoring

The `BridgeSupervisor` monitors the container after it starts:

- **Health check**: HTTP POST to `/mcp` every 10 seconds
- **Unhealthy**: After 3 consecutive health check failures, the container is considered dead
- **Rebuild**: Tears down the old container and builds from scratch (fresh repo read, fresh LLM build)
- **Give up**: After 3 total build attempts fail, status goes to "error"

You don't need to manually diagnose or provision containers. The supervisor handles it.

## CLI Commands

```bash
# Start the habitat REPL (interactive mode)
dotenvx run -- pnpm run cli habitat --provider google --model gemini-3-flash-preview

# Start a bridge for a specific agent
dotenvx run -- pnpm run cli habitat agent start <agent-id>

# Stop a bridge
dotenvx run -- pnpm run cli habitat agent stop <agent-id>

# Check status of all agents or one specific agent
dotenvx run -- pnpm run cli habitat agent status
dotenvx run -- pnpm run cli habitat agent status <agent-id>
```

## Habitat Tools

These tools are available to the LLM in the habitat REPL:

| Tool | Description |
|---|---|
| `agent_clone` | Clone a git repo into the habitat workspace and register it |
| `agent_status` | Check agent health, port, config |
| `agent_logs` | Read agent log files |
| `agent_ask` | Send a message to a sub-agent (requires model config) |
| `bridge_start` | Start a bridge container for an agent |
| `bridge_stop` | Stop a running bridge |
| `bridge_list` | List all bridges and their status |
| `bridge_ls` | List files in a bridge container |
| `bridge_read` | Read a file from a bridge container |
| `bridge_exec` | Execute a command in a bridge container |

## MCP Tools in the Container

The Go binary exposes these tools via MCP StreamableHTTP at `/mcp`:

| Tool | Description |
|---|---|
| `fs_read` | Read file contents |
| `fs_write` | Write file contents |
| `fs_list` | List directory entries |
| `fs_exists` | Check if path exists |
| `fs_stat` | Get file/directory metadata |
| `exec_run` | Execute shell commands |
| `git_clone` | Clone a repository |
| `git_status` | Check working directory status |
| `git_commit` | Commit changes |
| `git_push` | Push to remote |
| `bridge_health` | Check bridge status and uptime |
| `bridge_logs` | Retrieve recent log entries |

All file operations are sandboxed to `/workspace` and `/opt`.

## Components

| Component | File | Role |
|---|---|---|
| **BridgeSupervisor** | `src/habitat/bridge/supervisor.ts` | Build → health loop → rebuild cycle |
| **container-builder** | `src/habitat/bridge/container-builder.ts` | LLM container building via dag.llm() |
| **BridgeAgent** | `src/habitat/bridge/agent.ts` | Wraps lifecycle, tracks provisioning |
| **BridgeLifecycle** | `src/habitat/bridge/lifecycle.ts` | Spawns worker threads, manages ports |
| **bridge-worker** | `src/habitat/bridge/bridge-worker.ts` | Builds Dagger container in worker thread |
| **Go MCP Server** | `src/habitat/bridge/go-server/` | Static binary, MCP over HTTP |
| **BridgeClient** | `src/habitat/bridge/client.ts` | MCP client for calling tools in container |

## Saved Provisioning

After a successful build, provisioning info is saved to `config.json`:

```json
{
  "id": "my-agent",
  "name": "My Agent",
  "gitRemote": "https://github.com/org/repo",
  "bridgeProvisioning": {
    "baseImage": "node:20",
    "buildSteps": ["npm install"],
    "envVarNames": ["ANTHROPIC_API_KEY"],
    "reasoning": "Detected package.json with npm dependencies...",
    "analyzedAt": "2026-02-22T00:00:00.000Z"
  }
}
```

On subsequent builds, this is passed as a hint to the LLM so it can reuse or improve on the previous build.

## Programmatic Usage

```typescript
import { Habitat } from "./habitat/habitat.js";

const habitat = await Habitat.create({ workDir: "./my-agent" });

// Start bridge — supervisor builds container and monitors health
const bridgeAgent = await habitat.startBridge("my-project-agent");

// Get the client to interact with the container
const client = await bridgeAgent.getClient();
const files = await client.listDirectory("/workspace");
const content = await client.readFile("/workspace/README.md");
const result = await client.execute("npm test");

// When done
await bridgeAgent.destroy();
```

## Interacting with a Running Bridge

```bash
# Health check
curl -X POST http://localhost:10000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"bridge_health","arguments":{}}}'

# List files
curl -X POST http://localhost:10000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fs_list","arguments":{"path":"/workspace"}}}'
```

## Prerequisites

- **Docker running** — Dagger uses Docker under the hood
- **Go MCP binary compiled** — `src/habitat/bridge/go-server/bridge-server-linux` (cross-compiled for arm64 Linux)

## Port Management

- Ports allocated from range 10000–20000
- Each agent gets a unique port
- Ports are released with a 5-second delay after container destruction

## Logging

Logs are written to `~/habitats-sessions/logs/` with timestamped filenames:

```
bridge-trmnl-image-agent-2026-02-22T00-46-34-000Z.log
```

Logs use synchronous `appendFileSync` so they survive worker thread termination.

## Troubleshooting

### Container won't start

Check the log file:

```bash
cat ~/habitats-sessions/logs/bridge-<agent-id>-*.log
```

### Supervisor keeps rebuilding

Check `agents/<id>/supervisor.json` for the state. The `lastError` field shows what failed. If `buildAttempts` has hit `maxBuildAttempts` (default 3), the supervisor has given up.

### Docker not running

Dagger requires Docker. Start Docker Desktop or the Docker daemon.

## Related

- [Habitat Bridge Walkthrough](../walkthroughs/habitat-bridge-walkthrough.md) — Step-by-step guide
- [Habitat Agents](./habitat-agents.md) — Local sub-agents (HabitatAgent)
- [Habitat](./habitat.md) — Top-level container
