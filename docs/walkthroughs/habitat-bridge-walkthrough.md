# Habitat Bridge Walkthrough

This walkthrough demonstrates the Habitat Bridge System for managing remote repositories in isolated, auto-provisioned containers.

## Overview

The Habitat Bridge System creates persistent agent containers using the Model Context Protocol (MCP). Unlike the experience-based `run_project` tool, Bridge Agents:

- Run continuously inside Dagger containers
- Auto-detect and install dependencies (no manual configuration)
- Communicate via MCP over HTTP
- Support iterative provisioning (start basic → analyze → recreate with correct setup)

## Prerequisites

- Docker running
- Dagger CLI installed
- GitHub token configured (for private repos): `export GITHUB_TOKEN=ghp_...`
- Umwelten built: `pnpm install && pnpm run build`

## Quick Start

### 1. Create a Habitat with Bridge Agent

```typescript
import { Habitat } from "umwelten/habitat";

const habitat = await Habitat.create({
  workDir: "~/habitats",
});

// Create a bridge agent for any git repository
const bridgeAgent = await habitat.createBridgeAgent(
  "demo-project", // Unique agent ID
  "https://github.com/The-Focus-AI/umwelten.git", // Repository URL
);

console.log("Bridge agent ready!");
```

### 2. Automatic Provisioning

The bridge automatically provisions itself through iterative analysis:

```
[BridgeAgent:demo-project] Starting iterative provisioning...
[BridgeAgent:demo-project] Iteration 1: Creating with ubuntu:22.04
[BridgeAgent:demo-project] Cloning https://github.com/The-Focus-AI/umwelten.git
[BridgeAgent:demo-project] Analyzing repository...
[BridgeAgent:demo-project] Detected: { projectType: 'npm', tools: [], aptPackages: [], skills: [] }
[BridgeAgent:demo-project] Recreating with node:20
[BridgeAgent:demo-project] Iteration 2: Creating with node:20
[BridgeAgent:demo-project] Running npm install...
[BridgeAgent:demo-project] Bridge ready!
```

### 3. Interact with the Container

Once ready, get the client and start working:

```typescript
const client = await bridgeAgent.getClient();

// List files in the workspace
const files = await client.listDirectory("/workspace");
console.log(
  "Files:",
  files.map((f) => f.name),
);

// Read a file
const readme = await client.readFile("/workspace/README.md");
console.log("README:", readme.substring(0, 500));

// Execute commands
const result = await client.execute("npm test");
console.log("Test output:", result.stdout);

// Check health
const health = await client.health();
console.log("Status:", health.status, "Uptime:", health.uptime);

// View logs for debugging
const logs = await client.getLogs(50);
console.log("Recent logs:", logs.join("\n"));
```

### 4. Work with Git

The bridge provides full git operations:

```typescript
// Check status
const status = await client.gitStatus("/workspace");
console.log("Modified files:", status.metadata.files);

// Make changes and commit
await client.writeFile("/workspace/changes.md", "# My Changes\n\nUpdated!");
await client.gitCommit("Updated changes.md", "/workspace");

// Push to remote
await client.gitPush("/workspace");
```

### 5. File Operations

Full filesystem access within the container:

```typescript
// Read
const content = await client.readFile("/workspace/package.json");
const pkg = JSON.parse(content);

// Write
await client.writeFile("/workspace/output.txt", "Hello from bridge!");

// Check existence
const exists = await client.fileExists("/workspace/some-file.txt");

// Get file stats
const stats = await client.stat("/workspace/package.json");
console.log(`Size: ${stats.size} bytes, Modified: ${stats.modified}`);
```

## Complete Example

Here's a complete script that clones a repo, analyzes it, and runs tests:

```typescript
import { Habitat } from "umwelten/habitat";

async function analyzeAndTest(repoUrl: string) {
  const habitat = await Habitat.create();

  try {
    // Create bridge agent
    console.log(`Creating bridge agent for ${repoUrl}...`);
    const bridgeAgent = await habitat.createBridgeAgent("test-agent", repoUrl);

    const client = await bridgeAgent.getClient();

    // Get project info
    const pkgJson = await client.readFile("/workspace/package.json");
    const pkg = JSON.parse(pkgJson);
    console.log(`\nProject: ${pkg.name}`);
    console.log(`Version: ${pkg.version}`);
    console.log(`Scripts: ${Object.keys(pkg.scripts || {}).join(", ")}`);

    // Run available tests
    if (pkg.scripts?.test) {
      console.log("\nRunning tests...");
      const result = await client.execute("npm test");
      console.log(result.stdout);
      if (result.stderr) {
        console.error("Stderr:", result.stderr);
      }
    }

    // Check health
    const health = await client.health();
    console.log(`\nBridge health: ${health.status}`);
    console.log(`Uptime: ${Math.floor(health.uptime)} seconds`);

    // Cleanup
    await habitat.destroyBridgeAgent("test-agent");
    console.log("\nBridge agent destroyed.");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

// Run it
analyzeAndTest("https://github.com/The-Focus-AI/umwelten.git");
```

## How Iterative Provisioning Works

The bridge doesn't guess provisioning—it analyzes the actual repository:

### Step 1: Start Basic

```
Container: ubuntu:22.04
Installed: git
Repo: Cloned to /workspace
```

### Step 2: Analyze

The bridge uses MCP file tools to examine the repository:

- **Detect project type**: Looks for `package.json` (npm), `requirements.txt` (pip), `Cargo.toml` (cargo), etc.
- **Scan scripts**: Reads `bin/` directory, shell scripts, `CLAUDE.md` for tool usage patterns
- **Detect tools**: Regex patterns find references to `imagemagick`, `jq`, `ffmpeg`, etc.
- **Find skills**: Looks for `~/.claude/plugins/cache/` references
- **Extract env vars**: Parses `CLAUDE.md` and `.env` files for required variables

### Step 3: Recreate if Needed

If analysis shows requirements not met:

```
Current: ubuntu:22.04
Detected: package.json present, needs node:20
Action: Destroy and recreate with node:20
```

### Step 4: Install Dependencies

Once the correct base image is confirmed:

```
Base: node:20
Installing: git, detected apt packages
Cloning: skill repositories
Running: npm install (or pip install, cargo fetch, etc.)
```

### Step 5: Ready!

The bridge is now ready for use and will report its status as `healthy`.

## MCP Tools Available

The bridge exposes these tools via the MCP protocol:

### Git Tools

- `git/clone` - Clone a repository
- `git/status` - Check working directory status
- `git/commit` - Commit changes with a message
- `git/push` - Push to remote

### File System Tools

- `fs/read` - Read file contents
- `fs/write` - Write file contents
- `fs/list` - List directory entries
- `fs/exists` - Check if path exists
- `fs/stat` - Get file/directory metadata

### Execution Tools

- `exec/run` - Execute commands with optional timeout and working directory

### Bridge Lifecycle Tools

- `bridge/health` - Check bridge status and uptime
- `bridge/logs` - Retrieve recent log entries

## Error Handling and Debugging

### Check Bridge State

```typescript
const state = bridgeAgent.getState();
console.log("Iteration:", state.iteration);
console.log("Ready:", state.isReady);
console.log("Errors:", state.errors);
console.log("Logs:", state.logs.slice(-10));
```

### View Container Logs

```typescript
const logs = await client.getLogs(100);
console.log(logs.join("\n"));
```

### Iteration Cap

By default, the bridge will try up to 10 iterations to get the provisioning right. You can configure this:

```typescript
const bridgeAgent = await habitat.createBridgeAgent(
  "my-project",
  "https://github.com/user/repo.git",
  { maxIterations: 5 }, // Limit to 5 attempts
);
```

## Comparison: Bridge vs run_project

| Feature           | `run_project`            | BridgeAgent              |
| ----------------- | ------------------------ | ------------------------ |
| **Provisioning**  | Pre-configured           | Auto-detected from repo  |
| **Container**     | One-shot per command     | Persistent, long-running |
| **State**         | Experience directory     | Container filesystem     |
| **Communication** | Dagger exec              | MCP over HTTP            |
| **Use case**      | Simple command execution | Complex ongoing work     |
| **Setup**         | Requires manifest/config | Zero configuration       |

## Security

- **Sandboxed**: Bridge server only allows access to `/workspace` and `/opt`
- **Git auth**: Uses `GITHUB_TOKEN` env var, never exposes credentials in logs
- **Port isolation**: Each bridge gets unique port, no cross-bridge access
- **Container isolation**: Full Docker/Dagger container isolation

## Next Steps

- Read the [Habitat Guide](./habitat.md) for more on the main habitat system
- Learn about [Habitat Agents](./habitat-agents.md) for local project management
- Check the [API reference](../api/bridge.md) for detailed method documentation
- Build the bridge server: `pnpm run build:bridge`
