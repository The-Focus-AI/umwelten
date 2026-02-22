# Habitat Bridge Walkthrough

The Habitat Bridge System runs agent repositories in isolated Dagger containers with an MCP server for communication.

## How It Works

```
CLI: habitat agent start <agent-id>
  → habitat.startBridge(agentId)
    → BridgeAgent.start()
      → BridgeLifecycle (spawns worker thread)
        → bridge-worker.ts (builds Dagger container)
          → Go MCP binary starts inside container
            → Polls until MCP server responds at /mcp
              → Ready
```

### Three Phases

**Phase 1: Create** — `agent_clone(gitUrl, name)`

Register agent in config. Nothing runs yet. Just metadata.

**Phase 2: Start** — `bridge_start(agentId)` or `habitat agent start <id>`

Start the container with whatever config exists. First time = bare `node:20`. With saved provisioning = packages, setup commands, etc. Returns when MCP server is reachable. No analysis, no iteration loop.

**Phase 3: Diagnose & Monitor** — LLM agents inspect the container

After the bridge is running, use the LLM agent tools:

- `bridge_diagnose` — runs an LLM agent to read project files, detect packages/tools/env vars, save provisioning, and restart the bridge
- `bridge_monitor` — runs an LLM agent to check health, processes, installed tools, env vars, and recent activity

Or use the manual inspection tools directly:

- `bridge_ls`, `bridge_read`, `bridge_exec` — look inside the container
- `agent_status` — is bridge healthy, port, config
- `agent_logs` — container/bridge logs

### First Start (Bare Container)

1. Start bare `node:20` container with Go MCP binary + clone repo
2. Run `bridge_diagnose` — LLM reads repo files, detects requirements
3. Provisioning saved, bridge restarts with all packages
4. If env vars needed, set with `secrets_set`, then `bridge_stop` + `bridge_start`

### Subsequent Starts (Saved Provisioning)

1. Load saved `bridgeProvisioning` from `config.json`
2. Build container directly with all packages
3. Agent ready in seconds

### Monitoring

Run `bridge_monitor` anytime to check if an agent is:
- Healthy (MCP responding, tools installed, env vars set)
- Making progress (recent sessions, no error loops)
- Properly configured (disk space, processes running)

## Prerequisites

- Docker running (Dagger uses Docker under the hood)
- Agent registered in habitat config with `gitRemote` set

## Starting an Agent

```bash
# Start (uses saved provisioning if available, bare node:20 otherwise)
dotenvx run -- pnpm run cli habitat agent start trmnl-image-agent
```

Output:

```
[habitat] Logs: /Users/you/habitats-sessions/logs/bridge-trmnl-image-agent-2026-02-19T...log
[habitat] Using saved provisioning from 2026-02-19T00:50:00.000Z
[BridgeAgent:trmnl-image-agent] Starting bridge MCP server...
[BridgeAgent:trmnl-image-agent] Bridge MCP server started on port 10000
✅ Agent "TRMNL Image Agent" Bridge MCP server started on port 10000
   Endpoint: http://localhost:10000/mcp
   Logs: /Users/you/habitats-sessions/logs/bridge-trmnl-image-agent-2026-02-19T...log
   Detected tools: jq, chrome, claude-code, curl, 1password-cli, npx, python, imagemagick, git
Press Ctrl+C to stop the server
```

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

### Components

| Component | File | Role |
|---|---|---|
| **BridgeAgent** | `src/habitat/bridge/agent.ts` | Builds provisioning, calls lifecycle to start |
| **BridgeLifecycle** | `src/habitat/bridge/lifecycle.ts` | Spawns worker threads, manages ports |
| **bridge-worker** | `src/habitat/bridge/bridge-worker.ts` | Builds Dagger container in worker thread |
| **Go MCP Server** | `src/habitat/bridge/go-server/` | Static binary, MCP over HTTP |
| **BridgeClient** | `src/habitat/bridge/client.ts` | MCP client for calling tools in container |

### Container Build Order (Optimized for Caching)

```
1. Pull base image (node:20)           ← Cached by Dagger
2. apt-get install packages            ← Cached if same packages
3. Run setup commands (claude install)  ← Cached if same commands
4. Mount npm cache volume              ← Persistent across builds
5. Mount Go MCP binary from host       ← Cached if binary unchanged
6. Inject secrets                       ← LATE — after cacheable layers
7. git clone repo                       ← Always runs (repo may have changed)
```

Secrets are injected late so they don't invalidate Dagger's layer cache for the expensive install steps. Secrets come only from the agent's `secrets` config — no implicit `GITHUB_TOKEN` injection.

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
| `bridge_diagnose` | Run LLM agent to detect packages/tools, save provisioning, restart bridge |
| `bridge_monitor` | Run LLM agent to check health, activity, and report issues |
| `agent_status` | Check agent health, port, config |
| `agent_logs` | Read agent log files |

## Interacting with a Running Agent

Once the bridge is running, you can call its MCP endpoint directly:

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

Or programmatically via the client:

```typescript
import { HabitatBridgeClient } from "../habitat/bridge/client.js";

const client = new HabitatBridgeClient({ host: "localhost", port: 10000 });
await client.connect();

const files = await client.listDirectory("/workspace");
const readme = await client.readFile("/workspace/README.md");
const result = await client.execute("ls -la /workspace");
```

## Diagnosing a New Agent

After cloning and starting an agent for the first time, it runs in a bare `node:20` container. Use `bridge_diagnose` to have an LLM agent read the project and figure out what it needs:

```
# In the habitat REPL or via the LLM:
> Clone trmnl-image-agent and diagnose it

# The LLM will:
# 1. agent_clone(gitUrl, name) — register + start bare container
# 2. bridge_diagnose(agentId) — LLM reads files, detects requirements
#    → Saves provisioning (packages, tools, env vars, skills)
#    → Restarts bridge with full config
# 3. If env vars needed: secrets_set + bridge_stop + bridge_start
```

The diagnosis agent inspects:
- `package.json`, `requirements.txt`, etc. for project type
- Scripts in `bin/`, `run.sh`, `setup.sh` for tool dependencies
- `CLAUDE.md` and `README.md` for env var references
- `.env` / `.env.example` for environment variable names
- Plugin references for skill repos (e.g. chrome-driver)

## Monitoring Agent Health

Use `bridge_monitor` to check if an agent is healthy and making progress:

```
# In the habitat REPL or via the LLM:
> Monitor the trmnl-image-agent

# The LLM will call bridge_monitor(agentId), which:
# 1. Checks MCP server health
# 2. Checks container resources (processes, disk, memory)
# 3. Verifies tools are installed (which node, which claude)
# 4. Checks env vars are set (without printing values)
# 5. Looks for recent Claude Code sessions
# 6. Analyzes session content for red flags (loops, errors, thrashing)
# 7. Returns structured health report
```

The monitor returns a report like:

```json
{
  "healthy": true,
  "status": "healthy",
  "checks": [
    { "name": "mcp_health", "passed": true },
    { "name": "processes", "passed": true, "detail": "4 processes running" },
    { "name": "disk_space", "passed": true, "detail": "2.1G available" },
    { "name": "env_vars", "passed": true, "detail": "ANTHROPIC_API_KEY is set" }
  ],
  "issues": [],
  "recommendations": []
}
```

## Logging

Logs are written to `~/habitats-sessions/logs/` with timestamped filenames that never overwrite:

```
bridge-trmnl-image-agent-2026-02-19T00-46-34-000Z.log
```

Logs use synchronous `appendFileSync` so they survive worker thread termination.

## Port Management

- Ports allocated from range 10000–20000
- Each agent gets a unique port
- Ports are released with a 5-second delay after container destruction (prevents reuse race conditions)

## Troubleshooting

### Container won't start

Check the log file — it contains every step of the Dagger build pipeline:

```bash
cat ~/habitats-sessions/logs/bridge-trmnl-image-agent-*.log
```

### Port already in use

The 5-second delayed port release handles most cases. If persistent, the port range (10000–20000) provides plenty of room.

### Docker not running

Dagger requires Docker. Start Docker Desktop or the Docker daemon.

## Comparison: Bridge vs run_project

| Feature | `run_project` | Bridge Agent |
|---|---|---|
| Container | One-shot per command | Persistent, long-running |
| Communication | Dagger exec | MCP over HTTP |
| Provisioning | Pre-configured | Saved to config, or bare node:20 |
| Server | None | Go binary (instant startup) |
| Use case | Run a script | Ongoing agent work |
