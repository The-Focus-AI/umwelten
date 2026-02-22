# Habitat Bridge System

## Overview

The Habitat Bridge System runs agent repositories in isolated Dagger containers with an MCP server for communication. It follows a three-phase design: **Create** (register agent), **Start** (launch container), **Inspect** (LLM uses tools to look inside).

## Architecture

```
Host Machine
+-- ~/habitats/config.json          # Agent configs with saved bridgeProvisioning
+-- ~/habitats/secrets.json         # Encrypted secrets
+-- ~/habitats-sessions/logs/       # Timestamped bridge log files
    +-- bridge-{agentId}-{timestamp}.log

Dagger Container (per agent)
+-- /opt/bridge/bridge-server       # Pre-compiled Go MCP binary
+-- /workspace/                     # Cloned repository
```

## Three Phases

### Phase 1: Create — `agent_clone(gitUrl, name)`

Register agent in config. Nothing runs. Just metadata.

### Phase 2: Start — `bridge_start(agentId)` or `habitat agent start <id>`

Start the container with whatever config exists. First time = bare `node:20`. With saved provisioning = packages, setup commands, etc. Returns when MCP server is reachable. No analysis, no iteration loop. Just start and return.

### Phase 3: Inspect — use bridge MCP tools to look inside

After the bridge is running, the LLM uses tools to inspect and iterate:

- `agent_status` — is bridge healthy, port, config
- `agent_logs` — container/bridge logs
- `bridge_ls`, `bridge_read`, `bridge_exec` — look inside the container
- `bridge_health` — check MCP server status

The LLM decides what needs updating, modifies the agent config (add packages, secrets, etc.), then restarts. **The LLM is the iteration loop.**

## LLM Agents

The bridge system includes two LLM-based agents for automated provisioning and health monitoring. Each agent is a **Stimulus** (role + instructions + restricted tool set) that runs via an ephemeral **Interaction** using the habitat's default model.

### Diagnosis Agent (`bridge_diagnose`)

**When:** After `agent_clone` or when `hasProvisioning=false`, or when the user asks to re-diagnose.

The diagnosis agent gets **read-only** access to the container (no exec) and a `diagnose_complete` tool to submit its findings:

| Tool | Purpose |
|---|---|
| `bridge_read` | Read project files (package.json, CLAUDE.md, scripts) |
| `bridge_ls` | List directories to understand project structure |
| `bridge_health` | Check MCP server is up |
| `bridge_logs` | Read container logs |
| `diagnose_complete` | Submit structured findings (project type, packages, tools, env vars, skills) |

After the agent calls `diagnose_complete`, the tool code automatically:
1. Merges findings with existing provisioning (additive)
2. Determines base image from project type
3. Saves to `agent.bridgeProvisioning`
4. Stops and restarts the bridge with new config

**Source:** `src/habitat/bridge/diagnosis-agent.ts`

### Monitor Agent (`bridge_monitor`)

**When:** On demand to check if an agent is healthy, stuck, or misconfigured.

The monitor agent gets **exec access** (to check processes, installed tools) and a `monitor_complete` tool:

| Tool | Purpose |
|---|---|
| `bridge_read` | Read files (sessions, logs, configs) |
| `bridge_ls` | Find session dirs, log files |
| `bridge_exec` | Check processes (`ps aux`), memory, disk, installed tools (`which`), env vars |
| `bridge_health` | MCP server status |
| `bridge_logs` | Container logs |
| `monitor_complete` | Submit structured health report |

The health report includes:
- Overall health status (`healthy`, `degraded`, `unhealthy`, `unknown`)
- Individual checks (MCP health, processes, env vars, tools)
- Recent Claude Code session activity analysis
- Issues found and recommendations

**Source:** `src/habitat/bridge/monitor-agent.ts`

## Components

| Component | File | Role |
|---|---|---|
| **BridgeAgent** | `src/habitat/bridge/agent.ts` | Builds provisioning, calls lifecycle to start |
| **BridgeLifecycle** | `src/habitat/bridge/lifecycle.ts` | Spawns worker threads, manages ports |
| **bridge-worker** | `src/habitat/bridge/bridge-worker.ts` | Builds Dagger container in worker thread |
| **Go MCP Server** | `src/habitat/bridge/go-server/` | Static binary, MCP over HTTP |
| **BridgeClient** | `src/habitat/bridge/client.ts` | MCP client for calling tools in container |
| **DiagnosisAgent** | `src/habitat/bridge/diagnosis-agent.ts` | LLM agent for project inspection |
| **MonitorAgent** | `src/habitat/bridge/monitor-agent.ts` | LLM agent for health monitoring |

## Usage

### CLI

```bash
# Start a bridge (uses saved provisioning if available, bare node:20 otherwise)
dotenvx run -- pnpm run cli habitat agent start trmnl-image-agent
```

### Programmatic

```typescript
import { Habitat } from "./habitat/habitat.js";

const habitat = await Habitat.create({ workDir: "./my-agent" });

// Start bridge for an agent that has gitRemote configured
const bridgeAgent = await habitat.startBridge("my-project-agent");

// Get the client to interact with the container
const client = await bridgeAgent.getClient();

// Use the client
const files = await client.listDirectory("/workspace");
const content = await client.readFile("/workspace/README.md");
const result = await client.execute("npm test");

// Check health
const health = await client.health();

// When done
await bridgeAgent.destroy();
```

## Saved Provisioning

After the LLM inspects and configures an agent, the config in `config.json` includes:

```json
{
  "id": "trmnl-image-agent",
  "name": "TRMNL Image Agent",
  "gitRemote": "https://github.com/The-Focus-AI/trmnl-image-agent",
  "bridgeProvisioning": {
    "baseImage": "node:20",
    "aptPackages": ["git", "jq", "chromium", "chromium-driver", "curl", "python3", "imagemagick"],
    "setupCommands": ["curl -fsSL https://claude.ai/install.sh | bash"],
    "detectedTools": ["jq", "chrome", "claude-code", "curl", "python", "imagemagick", "git"],
    "projectType": "shell",
    "skillRepos": [],
    "analyzedAt": "2026-02-19T00:50:00.000Z"
  }
}
```

This means the next `habitat agent start` builds the container with all packages immediately.

## Container Build Order (Optimized for Caching)

```
1. Pull base image (node:20)           <- Cached by Dagger
2. apt-get install packages            <- Cached if same packages
3. Run setup commands (claude install)  <- Cached if same commands
4. Mount npm cache volume              <- Persistent across builds
5. Mount Go MCP binary from host       <- Cached if binary unchanged
6. Inject secrets                       <- LATE -- after cacheable layers
7. git clone repo                       <- Always runs (repo may have changed)
```

Secrets are injected late so they don't invalidate Dagger's layer cache for the expensive install steps. Secrets come only from the agent's `secrets` config — no implicit token injection.

## MCP Tools Available

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

## Habitat Tools for Bridge Interaction

These tools are available to the LLM in the habitat:

| Tool | Description |
|---|---|
| `bridge_start` | Start a bridge container for an agent |
| `bridge_stop` | Stop a running bridge |
| `bridge_list` | List all bridges and their status |
| `bridge_ls` | List files in a bridge container |
| `bridge_read` | Read a file from a bridge container |
| `bridge_exec` | Execute a command in a bridge container |
| `bridge_diagnose` | Run LLM diagnosis agent to detect needed packages/tools, save provisioning, restart |
| `bridge_monitor` | Run LLM monitor agent to assess container health, check activity, report issues |
| `agent_status` | Check agent health, port, config |
| `agent_logs` | Read agent log files |

## Port Management

- Ports allocated from range 10000-20000
- Each agent gets a unique port
- Ports are released with a 5-second delay after container destruction (prevents reuse race conditions)

## Logging

Logs are written to `~/habitats-sessions/logs/` with timestamped filenames that never overwrite:

```
bridge-trmnl-image-agent-2026-02-19T00-46-34-000Z.log
```

Logs use synchronous `appendFileSync` so they survive worker thread termination.

## Security

- Bridge server only allows access to `/workspace` and `/opt`
- Secrets come only from the agent's configured `secrets` array — no implicit token injection
- Dynamic port allocation per agent
- Sandboxed container execution via Dagger

## Related

- [Habitat Bridge Walkthrough](../walkthroughs/habitat-bridge-walkthrough.md) — Complete walkthrough
- [Habitat Agents](./habitat-agents.md) — Local sub-agents (HabitatAgent)
- [Habitat](./habitat.md) — Top-level container
