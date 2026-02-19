# Habitat Bridge Walkthrough

This walkthrough demonstrates the Habitat Bridge System for managing multiple remote repositories in isolated, auto-provisioned containers using the Model Context Protocol (MCP).

## Overview

The Habitat Bridge System creates persistent agent containers that can run concurrently. Unlike the experience-based `run_project` tool, Bridge Agents:

- Run continuously inside Dagger containers
- Auto-detect and install dependencies (no manual configuration)
- Communicate via MCP over HTTP
- Support iterative provisioning (start basic → analyze → recreate with correct setup)
- Support **multiple concurrent agents** (20-75+ on a single machine)
- Persist state and logs to disk

## Architecture

```
Habitat (Host)
├── agents/
│   ├── agent-1/
│   │   ├── logs/bridge.log      # Persistent logs
│   │   └── state.json           # Port, PID, status
│   ├── agent-2/
│   │   ├── logs/bridge.log
│   │   └── state.json
│   └── ... (up to 75+ agents)
├── config.json                  # Agent configurations
└── secrets.json                 # Encrypted secrets
```

Each Bridge Agent:

- Gets a unique port (10000-20000 range)
- Has its own Dagger container
- Writes logs to `~/.habitat/agents/{agentId}/logs/bridge.log`
- Persists state to `~/.habitat/agents/{agentId}/state.json`

## Prerequisites

- Docker running
- Dagger CLI installed
- GitHub token configured (for private repos): `export GITHUB_TOKEN=ghp_...`
- Umwelten built: `pnpm install && pnpm run build`

## Quick Start

### 1. Create a Habitat

```typescript
import { Habitat } from "umwelten/habitat";

const habitat = await Habitat.create({
  workDir: "~/habitats",
});
```

### 2. Create Multiple Bridge Agents

```typescript
// Create multiple bridge agents concurrently
const agent1 = await habitat.createBridgeAgent(
  "frontend-app",
  "https://github.com/org/frontend.git",
);

const agent2 = await habitat.createBridgeAgent(
  "backend-api",
  "https://github.com/org/backend.git",
);

const agent3 = await habitat.createBridgeAgent(
  "ml-pipeline",
  "https://github.com/org/ml-repo.git",
);

console.log("All agents ready!");
console.log("Agent 1 port:", agent1.getPort()); // e.g., 10000
console.log("Agent 2 port:", agent2.getPort()); // e.g., 10001
console.log("Agent 3 port:", agent3.getPort()); // e.g., 10002
```

### 3. List All Running Agents

```typescript
// Get all bridge agent IDs
const agentIds = habitat.listBridgeAgents();
console.log("Running agents:", agentIds);
// ["frontend-app", "backend-api", "ml-pipeline"]

// Get all bridge agents with details
const allAgents = habitat.getAllBridgeAgents();
for (const agent of allAgents) {
  console.log(`Agent: ${agent.getState().id}, Port: ${agent.getPort()}`);
}
```

### 4. Interact with Specific Agents

```typescript
// Get a specific agent
const frontendAgent = habitat.getBridgeAgent("frontend-app");
const client = await frontendAgent.getClient();

// List files
const files = await client.listDirectory("/workspace");
console.log(
  "Frontend files:",
  files.map((f) => f.name),
);

// Read a file
const readme = await client.readFile("/workspace/README.md");

// Execute commands
const result = await client.execute("npm test");
console.log("Test output:", result.stdout);
```

### 5. Automatic Provisioning

The bridge automatically provisions itself through iterative analysis:

```
[BridgeAgent:frontend-app] Starting iterative provisioning...
[BridgeAgent:frontend-app] Iteration 1: Creating with node:20
[BridgeAgent:frontend-app] Cloning https://github.com/org/frontend.git
[BridgeAgent:frontend-app] Analyzing repository...
[BridgeAgent:frontend-app] Detected: {
  projectType: 'npm',
  tools: ['jest', 'eslint'],
  aptPackages: [],
  skills: []
}
[BridgeAgent:frontend-app] Running npm install...
[BridgeAgent:frontend-app] Bridge ready on port 10000!
```

### 6. Check Agent Status

```typescript
// Load persisted state
const state = await habitat.loadBridgeState("frontend-app");
console.log({
  agentId: state.agentId,
  port: state.port,
  status: state.status, // 'running', 'stopped', 'error'
  createdAt: state.createdAt,
  lastHealthCheck: state.lastHealthCheck,
});

// Check health
const client = await habitat.getBridgeAgent("frontend-app")?.getClient();
const health = await client?.health();
console.log("Health:", health);
```

### 7. View Logs

```typescript
// Read from log file
const { readFile } = await import("node:fs/promises");
const logPath = `${habitat.getAgentDir("frontend-app")}/logs/bridge.log`;
const logs = await readFile(logPath, "utf-8");
console.log("Recent logs:", logs.split("\n").slice(-50).join("\n"));
```

### 8. Stop and Cleanup

```typescript
// Stop a specific agent
await habitat.destroyBridgeAgent("frontend-app");
console.log("Frontend agent stopped");

// Check remaining agents
const remaining = habitat.listBridgeAgents();
console.log("Remaining agents:", remaining);
// ["backend-api", "ml-pipeline"]
```

## Complete Example: Multi-Agent Workflow

Here's a complete script that manages multiple agents:

```typescript
import { Habitat } from "umwelten/habitat";

async function manageMultipleAgents() {
  const habitat = await Habitat.create();

  const repos = [
    { id: "web-frontend", url: "https://github.com/org/frontend.git" },
    { id: "api-backend", url: "https://github.com/org/backend.git" },
    { id: "data-processor", url: "https://github.com/org/processor.git" },
  ];

  try {
    // Start all agents concurrently
    console.log("Starting agents...");
    for (const { id, url } of repos) {
      await habitat.createBridgeAgent(id, url);
      console.log(`✓ ${id} started`);
    }

    // List all running agents
    const agentIds = habitat.listBridgeAgents();
    console.log(`\n${agentIds.length} agents running:`);

    for (const agentId of agentIds) {
      const agent = habitat.getBridgeAgent(agentId);
      const state = await habitat.loadBridgeState(agentId);
      console.log(
        `  - ${agentId}: port ${state?.port}, status ${state?.status}`,
      );
    }

    // Interact with each agent
    for (const agentId of agentIds) {
      const agent = habitat.getBridgeAgent(agentId);
      if (!agent) continue;

      const client = await agent.getClient();

      // Check health
      const health = await client.health();
      console.log(`\n${agentId}: ${health.status}`);

      // List workspace
      const files = await client.listDirectory("/workspace");
      console.log(`  Files: ${files.length} items`);

      // Read package.json if exists
      try {
        const pkgJson = await client.readFile("/workspace/package.json");
        const pkg = JSON.parse(pkgJson);
        console.log(`  Project: ${pkg.name}@${pkg.version}`);
      } catch {
        console.log("  No package.json");
      }
    }

    // View logs for one agent
    const logPath = `${habitat.getAgentDir("web-frontend")}/logs/bridge.log`;
    console.log(`\nLogs for web-frontend:`);
    console.log("  Location:", logPath);
  } catch (error) {
    console.error("Error:", error);
  }
}

manageMultipleAgents();
```

## Using Bridge Tools

The Habitat CLI provides tools for managing bridge agents:

### agent_clone

Register and start a new bridge agent:

```bash
# In habitat CLI
agent_clone gitUrl="https://github.com/org/repo.git" name="my-project"
```

### bridge_start

Start a bridge for an existing agent:

```bash
bridge_start agentId="my-project"
# Returns: port, mcpUrl, logFile path
```

### bridge_list

List all running bridge agents:

```bash
bridge_list
# Returns: count, bridges [{agentId, port, status, mcpUrl, logFile}]
```

### bridge_stop

Stop a specific bridge agent:

```bash
bridge_stop agentId="my-project"
```

### bridge_ls, bridge_read, bridge_exec

Interact with a specific agent:

```bash
# List files
bridge_ls agentId="my-project" path="/workspace/src"

# Read a file
bridge_read agentId="my-project" path="/workspace/README.md"

# Execute a command
bridge_exec agentId="my-project" command="npm test"
```

## How Iterative Provisioning Works

The bridge doesn't guess provisioning—it analyzes the actual repository:

### Step 1: Start Basic

```
Container: node:20
Installed: git, node, npm
Repo: Cloned to /workspace
```

### Step 2: Analyze

The bridge uses MCP file tools to examine the repository:

- **Detect project type**: Looks for `package.json` (npm), `requirements.txt` (pip), `Cargo.toml` (cargo), etc.
- **Scan scripts**: Reads `bin/` directory, shell scripts, `CLAUDE.md` for tool usage patterns
- **Detect tools**: Regex patterns find references to `imagemagick`, `jq`, `ffmpeg`, etc.
- **Find skills**: Looks for `~/.claude/plugins/cache/` references
- **Extract env vars**: Parses `CLAUDE.md` and `.env` files for required variables

### Step 3: Install Dependencies

Once the correct base image is confirmed:

```
Base: node:20
Installing: detected apt packages
Cloning: skill repositories
Running: npm install (or pip install, cargo fetch, etc.)
```

### Step 4: Ready!

The bridge is now ready for use and will report its status as `healthy`.

## MCP Tools Available

The bridge exposes these tools via the MCP protocol:

### Git Tools

- `git_clone` - Clone a repository
- `git_status` - Check working directory status
- `git_commit` - Commit changes with a message
- `git_push` - Push to remote

### File System Tools

- `fs_read` - Read file contents
- `fs_write` - Write file contents
- `fs_list` - List directory entries
- `fs_exists` - Check if path exists
- `fs_stat` - Get file/directory metadata

### Execution Tools

- `exec_run` - Execute commands with optional timeout and working directory

### Bridge Lifecycle Tools

- `bridge_health` - Check bridge status and uptime
- `bridge_logs` - Retrieve recent log entries

## State Persistence

Each agent's state is persisted to disk:

```typescript
interface BridgeState {
  agentId: string;
  port: number;
  pid: number;
  status: "starting" | "running" | "stopped" | "error";
  createdAt: string;
  lastHealthCheck: string;
  containerId?: string;
  repoUrl: string;
  error?: string;
}
```

State is saved:

- When agent starts
- When agent stops
- When errors occur

## Port Management

Ports are allocated from the range 10000-20000:

- Each agent gets a unique port
- Ports are tracked in a `Set` to prevent conflicts
- Ports are released when agents are destroyed
- Supports up to 10,000 concurrent agents (theoretical limit)

## Logging

Each agent writes logs to its own file:

```
~/.habitat/agents/{agentId}/logs/bridge.log
```

Logs include:

- Container startup messages
- Git clone output
- Dependency installation
- MCP server startup
- Health check results

## Error Handling and Debugging

### Check Bridge State

```typescript
const state = await habitat.loadBridgeState("my-project");
console.log("Status:", state?.status);
console.log("Last error:", state?.error);
console.log("Port:", state?.port);
```

### View Container Logs

```typescript
const { readFile } = await import("node:fs/promises");
const logPath = `${habitat.getAgentDir("my-project")}/logs/bridge.log`;
const logs = await readFile(logPath, "utf-8");
console.log(logs.split("\n").slice(-100).join("\n"));
```

### Iteration Cap

By default, the bridge will try up to 10 iterations to get the provisioning right. You can configure this:

```typescript
const bridgeAgent = await habitat.createBridgeAgent(
  "my-project",
  "https://github.com/user/repo.git",
);
// maxIterations is set internally
```

## Comparison: Bridge vs run_project

| Feature           | `run_project`            | BridgeAgent                            |
| ----------------- | ------------------------ | -------------------------------------- |
| **Provisioning**  | Pre-configured           | Auto-detected from repo                |
| **Container**     | One-shot per command     | Persistent, long-running               |
| **State**         | Experience directory     | Container filesystem + persisted state |
| **Communication** | Dagger exec              | MCP over HTTP                          |
| **Concurrency**   | Single execution         | 20-75+ concurrent agents               |
| **Logging**       | Console output           | Persistent log files                   |
| **Use case**      | Simple command execution | Complex ongoing work                   |
| **Setup**         | Requires manifest/config | Zero configuration                     |

## Security

- **Sandboxed**: Bridge server only allows access to `/workspace` and `/opt`
- **Git auth**: Uses `GITHUB_TOKEN` env var, never exposes credentials in logs
- **Port isolation**: Each bridge gets unique port, no cross-bridge access
- **Container isolation**: Full Docker/Dagger container isolation
- **Log isolation**: Each agent has its own log file

## Performance Considerations

- **Memory**: Each container uses ~50-100MB RAM
- **CPU**: Containers share CPU, no limits by default
- **Disk**: Log files grow over time, monitor disk usage
- **Network**: Each container has isolated network stack

## Next Steps

- Read the [Habitat Guide](./habitat.md) for more on the main habitat system
- Learn about [Habitat Agents](./habitat-agents.md) for local project management
- Check the [API reference](../api/bridge.md) for detailed method documentation
- Build the bridge server: `pnpm run build:bridge`
