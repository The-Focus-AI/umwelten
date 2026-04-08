# Multi-Agent Bridge System

> **Maintained docs:** [Habitat Bridge guide](docs/guide/habitat-bridge.md).

## Overview

The Bridge system supports multiple concurrent agents, each running in its own Dagger container with an MCP server for communication.

## Architecture

The system follows a three-phase design:

1. **Create** — `agent_clone(gitUrl, name)`: Register agent in config
2. **Start** — `habitat.startBridge(agentId)`: Launch container with saved provisioning or bare `node:20`
3. **Inspect** — LLM uses bridge MCP tools to look inside and iterate

## Key Components

| Component | File | Role |
|---|---|---|
| **BridgeAgent** | `src/habitat/bridge/agent.ts` | Simple `start()` — builds provisioning, calls lifecycle |
| **BridgeLifecycle** | `src/habitat/bridge/lifecycle.ts` | Spawns worker threads, manages ports |
| **bridge-worker** | `src/habitat/bridge/bridge-worker.ts` | Builds Dagger container in worker thread |
| **Go MCP Server** | `src/habitat/bridge/go-server/` | Static binary, MCP over HTTP in container |
| **BridgeClient** | `src/habitat/bridge/client.ts` | MCP client for calling tools in container |
| **Habitat** | `src/habitat/habitat.ts` | `startBridge()` — validates agent, resolves secrets, starts bridge |

## API

### Habitat Class

```typescript
// Start a bridge for a registered agent
startBridge(agentId: string, options?: { logFilePath?: string }): Promise<BridgeAgent>

// Manage running bridges
getBridgeAgent(agentId: string): BridgeAgent | undefined
listBridgeAgents(): string[]
destroyBridgeAgent(agentId: string): Promise<void>

// Directory and state management
getAgentDir(agentId: string): string
ensureAgentDir(agentId: string): Promise<void>
saveBridgeState(agentId: string, state: BridgeState): Promise<void>
loadBridgeState(agentId: string): Promise<BridgeState | null>
```

### Bridge Tools (LLM-facing)

```typescript
// Start/stop bridges
bridge_start(agentId: string)      // Start bridge container
bridge_stop(agentId: string)       // Stop running bridge
bridge_list()                      // List all running bridges

// Inspect container contents
bridge_ls(agentId: string, path?: string)    // List files
bridge_read(agentId: string, path: string)   // Read file
bridge_exec(agentId: string, command: string) // Execute command

// Agent management
agent_clone(gitUrl, name)          // Register agent + start bridge
agent_status(agentId)              // Health check, port, config
agent_logs(agentId)                // Read log files
```

## Port Management

- Range: 10000-20000
- Each agent gets a unique port
- Ports released with 5-second delay after container destruction
- No conflicts between concurrent agents

## Logging

Logs written to `~/habitats-sessions/logs/` with timestamped filenames:

```
bridge-{agentId}-{timestamp}.log
```

Logs use synchronous `appendFileSync` so they survive worker thread termination.

## Security

- Secrets come only from agent's configured `secrets` array — no implicit token injection
- Bridge server sandboxes file access to `/workspace` and `/opt`
- Dynamic port allocation per agent
- Sandboxed container execution via Dagger
