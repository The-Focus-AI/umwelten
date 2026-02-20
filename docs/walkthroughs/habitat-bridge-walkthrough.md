# Habitat Bridge Walkthrough

The Habitat Bridge System runs agent repositories in isolated Dagger containers with an MCP server for communication.

## How It Works

```
CLI: habitat agent start <agent-id>
  → BridgeAgent
    → BridgeLifecycle (spawns worker thread)
      → bridge-worker.ts (builds Dagger container)
        → Go MCP binary starts inside container
          → Polls until MCP server responds at /mcp
            → BridgeAnalyzer reads repo via MCP tools
              → Discovers apt packages, project type, tools needed
                → If packages missing: destroy, rebuild with packages
                  → Saves provisioning to config.json
                    → Ready
```

### First Run (Discovery)

1. Start bare `node:20` container with Go MCP binary + clone repo
2. `BridgeAnalyzer` calls MCP tools (`fs_read`, `fs_exists`, `fs_list`) to read repo files
3. Detects project type, required apt packages, setup commands
4. If packages needed: destroy container, rebuild with full provisioning
5. Save discovered provisioning to `config.json` → agent is ready

### Subsequent Runs (Instant)

1. Load saved `bridgeProvisioning` from `config.json`
2. Build container directly with all packages — **1 iteration, no analysis**
3. Agent ready in seconds

## Prerequisites

- Docker running (Dagger uses Docker under the hood)
- Agent registered in habitat config with `gitRemote` set

## Starting an Agent

```bash
# Start with discovery (first time)
dotenvx run -- pnpm run cli habitat agent start trmnl-image-agent

# Subsequent starts use saved provisioning automatically
dotenvx run -- pnpm run cli habitat agent start trmnl-image-agent

# Force re-analysis (ignore saved provisioning)
dotenvx run -- pnpm run cli habitat agent start trmnl-image-agent --reanalyze
```

Output:

```
[habitat] Logs: /Users/you/habitats-sessions/logs/bridge-trmnl-image-agent-2026-02-19T...log
[habitat] Using saved provisioning from 2026-02-19T00:50:00.000Z
[BridgeAgent:trmnl-image-agent] Using saved provisioning (analyzed 2026-02-19T00:50:00.000Z)
✅ Agent "TRMNL Image Agent" Bridge MCP server started on port 10000
   Endpoint: http://localhost:10000/mcp
   Logs: /Users/you/habitats-sessions/logs/bridge-trmnl-image-agent-2026-02-19T...log
   Iterations: 1
   Detected tools: jq, chrome, claude-code, curl, 1password-cli, npx, python, imagemagick, git
Press Ctrl+C to stop the server
```

## Architecture

```
Host Machine
├── ~/habitats/config.json          # Agent configs with saved bridgeProvisioning
├── ~/habitats/secrets.json         # Encrypted secrets (GITHUB_TOKEN, etc.)
└── ~/habitats-sessions/logs/       # Timestamped bridge log files
    └── bridge-{agentId}-{timestamp}.log

Dagger Container (per agent)
├── /opt/bridge/bridge-server       # Pre-compiled Go MCP binary
└── /workspace/                     # Cloned repository
```

### Components

| Component | File | Role |
|---|---|---|
| **BridgeAgent** | `src/habitat/bridge/agent.ts` | Orchestrates provisioning loop |
| **BridgeLifecycle** | `src/habitat/bridge/lifecycle.ts` | Spawns worker threads, manages ports |
| **bridge-worker** | `src/habitat/bridge/bridge-worker.ts` | Builds Dagger container in worker thread |
| **Go MCP Server** | `src/habitat/bridge/go-server/` | Static binary, MCP over HTTP |
| **BridgeAnalyzer** | `src/habitat/bridge/analyzer.ts` | Reads repo via MCP to detect requirements |
| **BridgeClient** | `src/habitat/bridge/client.ts` | MCP client for calling tools in container |

### Container Build Order (Optimized for Caching)

```
1. Pull base image (node:20)           ← Cached by Dagger
2. apt-get install packages            ← Cached if same packages
3. Run setup commands (claude install)  ← Cached if same commands
4. Mount npm cache volume              ← Persistent across builds
5. Mount Go MCP binary from host       ← Cached if binary unchanged
6. Inject secrets (GITHUB_TOKEN)        ← LATE — after cacheable layers
7. git clone repo                       ← Always runs (repo may have changed)
```

Secrets are injected late so they don't invalidate Dagger's layer cache for the expensive install steps.

## Saved Provisioning

After first run, the agent's config in `config.json` includes:

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

This means the next `habitat agent start` skips analysis entirely.

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

## Logging

Logs are written to `~/habitats-sessions/logs/` with timestamped filenames that never overwrite:

```
bridge-trmnl-image-agent-2026-02-19T00-46-34-000Z.log
```

Logs use synchronous `appendFileSync` so they survive worker thread termination between iterations.

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
| Provisioning | Pre-configured | Auto-detected, saved to config |
| Server | None | Go binary (instant startup) |
| Use case | Run a script | Ongoing agent work |
