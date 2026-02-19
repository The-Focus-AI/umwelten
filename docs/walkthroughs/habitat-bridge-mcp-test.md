# Habitat Bridge MCP Integration Test Walkthrough

This guide walks you through running the Habitat Bridge MCP integration test, which demonstrates:

1. Creating a Habitat
2. Starting a BridgeAgent with the trmnl-image-agent repo
3. Connecting to the MCP server running in a Dagger container
4. Querying the repository for skills, environment variables, and package requirements

## Prerequisites

- Docker running (for Dagger containers)
- Environment variables set up (copy from `.env` if needed)
- Dependencies installed: `pnpm install`

## Quick Start

### 1. Run the Integration Test

```bash
# Run just the bridge MCP integration test
dotenvx run -- pnpm test:run src/habitat/habitat-bridge-mcp.integration.test.ts
```

This will:

- Create a temporary Habitat
- Clone the trmnl-image-agent repo into a Dagger container
- Start an MCP server inside the container
- Connect via HabitatBridgeClient
- Analyze the repository structure
- Query for environment variables and dependencies
- Test tool execution (read/write files, execute commands)
- Clean up all resources

### 2. Expected Output

The test runs through 6 steps:

#### Step 1: BridgeAgent Creation

- Creates a BridgeAgent with ID `test-trmnl-bridge`
- Clones `https://github.com/The-Focus-AI/trmnl-image-agent`
- Starts iterative provisioning (usually 2-3 iterations)
- Bridge becomes ready when provisioning is complete

#### Step 2: MCP Server Connection

- Gets a HabitatBridgeClient connected to the container
- Verifies health check responds with "healthy" status
- Confirms workspace is at `/workspace`

#### Step 3: Repository Analysis

- Lists all files in `/workspace`
- Reads README.md to understand the project
- Checks for package.json, requirements.txt, etc.
- Looks for config files (.env.example, Dockerfile, etc.)

#### Step 4: Environment and Requirements Analysis

- Recursively scans all files in the repo
- Groups files by extension
- Greps for environment variable usage (`process.env`, etc.)
- Detects what runtime/tools are needed

#### Step 5: Tool Execution

- Executes commands in the container (`pwd`, `ls -la`)
- Tests file write/read operations
- Retrieves bridge logs

#### Step 6: Analysis Results Summary

Prints a comprehensive summary including:

```
=== Bridge Agent Analysis Summary ===
Agent ID: test-trmnl-bridge
Repository: https://github.com/The-Focus-AI/trmnl-image-agent
Iterations: 3
Is Ready: true

Project Type: shell
Detected Tools: ['jq', 'chrome', 'claude-code', 'curl', '1password-cli', 'npx', 'python', 'imagemagick', 'git']
APT Packages needed: ['jq', 'chromium', 'chromium-driver', 'curl', 'python3', 'imagemagick', 'git']
Setup Commands: [
  'curl -fsSL https://claude.ai/install.sh | bash',
  'apt-get install -y curl gpg && ... 1password-cli installation ...'
]
Skills needed: []

Provisioning:
Base Image: node:20
APT Packages: ['git', 'jq', 'chromium', 'chromium-driver', 'curl', 'python3', 'imagemagick', 'git']
Git Repos: []

Errors: [...]
```

## What the Test Discovers

For the trmnl-image-agent project:

### Project Type

**Shell-based project** - Uses shell scripts rather than a traditional programming language framework

### Required Tools

- **jq** - JSON processing
- **chromium + chromium-driver** - Browser automation
- **curl** - HTTP requests
- **python3** - Python runtime
- **imagemagick** - Image manipulation
- **git** - Version control
- **claude-code** - Claude CLI (installed via curl)
- **1password-cli** - 1Password CLI (installed via apt)

### Setup Requirements

The project needs:

1. Node.js base image (node:20)
2. Multiple APT packages installed
3. External tools (claude-code, 1password-cli) installed via setup commands
4. No additional git repositories (skills)

## Understanding the Architecture

### Components Tested

1. **Habitat** (`src/habitat/habitat.ts`)
   - Central system for managing agents
   - Creates and tracks BridgeAgents

2. **BridgeAgent** (`src/habitat/bridge/agent.ts`)
   - Manages agent lifecycle
   - Handles iterative provisioning
   - Recreates container until requirements are met

3. **BridgeLifecycle** (`src/habitat/bridge/lifecycle.ts`)
   - Creates Dagger containers
   - Manages container startup and health checks
   - Handles cleanup

4. **HabitatBridgeClient** (`src/habitat/bridge/client.ts`)
   - Connects to MCP server via HTTP JSON-RPC
   - Provides convenient methods (readFile, writeFile, execute, etc.)

5. **Bridge Server** (`src/habitat/bridge/server.ts`)
   - Runs inside Dagger container
   - Exposes MCP protocol over HTTP
   - Provides tools: git/_, fs/_, exec/run, bridge/\*

### Test Flow

```
Test Suite
    ↓
Create Habitat
    ↓
Create BridgeAgent
    ↓
BridgeLifecycle.createBridge()
    ↓
Worker Thread spawns Dagger container
    ↓
Container starts with node:20
    ↓
Repo cloned to /workspace
    ↓
MCP server starts on port 8080
    ↓
HabitatBridgeClient connects
    ↓
BridgeAnalyzer analyzes repo
    ↓
[Iterative provisioning loop]
    ↓
Bridge ready - run tests
    ↓
Test tools and query repo
    ↓
Print analysis summary
    ↓
Cleanup
```

## Troubleshooting

### Test Times Out

- **Cause**: Dagger container startup is slow
- **Solution**: Tests have long timeouts (180s for creation). If it still fails, check Docker is running.

### Port Already in Use

- **Cause**: Previous test didn't clean up properly
- **Solution**: The test handles this with iterative provisioning. You may see "address already in use" errors in iteration 2, but iteration 3 should succeed.

### Docker Not Running

- **Error**: "Cannot connect to Docker daemon"
- **Solution**: Start Docker Desktop or Docker daemon

### Missing Environment Variables

- **Error**: API key errors (though this test doesn't use LLMs)
- **Solution**: Copy `.env.template` to `.env` and fill in values

## Next Steps

After running this test, you can:

1. **Create a BridgeAgent manually**:

```typescript
const habitat = await Habitat.create({ workDir: "./my-habitat" });
const bridgeAgent = await habitat.createBridgeAgent(
  "my-agent",
  "https://github.com/user/repo",
);
const client = await bridgeAgent.getClient();
const files = await client.listDirectory("/workspace");
```

2. **Use the bridge for code execution**:

```typescript
const result = await client.execute("npm test");
console.log(result.stdout);
```

3. **Read and write files**:

```typescript
const content = await client.readFile("/workspace/README.md");
await client.writeFile("/workspace/output.txt", "Hello from bridge!");
```

## See Also

- `src/habitat/bridge/agent.ts` - BridgeAgent implementation
- `src/habitat/bridge/client.ts` - HabitatBridgeClient
- `src/habitat/bridge/lifecycle.ts` - Container lifecycle management
- `src/habitat/habitat.ts` - Habitat main class
- `src/habitat/agent-lifecycle.integration.test.ts` - Full agent lifecycle test (with LLM)
