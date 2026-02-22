# Habitat Bridge Walkthrough

This walkthrough shows how to run an agent repository in a supervised Dagger container.

## Prerequisites

- Docker running (Dagger uses Docker)
- Go MCP binary compiled at `src/habitat/bridge/go-server/bridge-server-linux`
- A habitat set up (run `dotenvx run -- pnpm run cli habitat` once to onboard)

## Step 1: Start the Habitat REPL

```bash
dotenvx run -- pnpm run cli habitat --provider google --model gemini-3-flash-preview
```

This starts an interactive session where the LLM has bridge tools available.

## Step 2: Clone an Agent

In the REPL, ask:

```
Clone https://github.com/The-Focus-AI/trmnl-image-agent as "TRMNL Image Agent"
```

The LLM will call `agent_clone(gitUrl, name)` which:
1. Registers the agent in `config.json`
2. Starts the `BridgeSupervisor` which:
   - Uses `dag.llm()` to read the repo and build a container
   - Falls back to heuristic build if LLM fails (detects package.json → node:20, etc.)
   - Adds the Go MCP binary, secrets, port, entrypoint
   - Polls until the MCP server responds
   - Starts a health check loop (every 10 seconds)

## Step 3: Interact with the Container

Once the bridge is running, use the bridge tools:

```
List files in the trmnl-image-agent container
```

The LLM calls `bridge_ls(agentId, path)` → shows `/workspace` contents.

```
Read the README from trmnl-image-agent
```

The LLM calls `bridge_read(agentId, "/workspace/README.md")`.

```
Run "npm test" in the trmnl-image-agent container
```

The LLM calls `bridge_exec(agentId, "npm test")`.

## Step 4: Set Secrets

If the agent needs API keys:

```
Set the ANTHROPIC_API_KEY secret for trmnl-image-agent
```

The LLM calls `secrets_set(name, value)`. After setting secrets, restart:

```
Restart the trmnl-image-agent bridge
```

The LLM calls `bridge_stop` then `bridge_start`. Secrets are injected at container build time as environment variables.

## Step 5: Check Status

```
What's the status of trmnl-image-agent?
```

The LLM calls `agent_status(agentId)` which returns:
- Bridge health (port, supervisor status)
- Config (commands, log patterns, provisioning info)
- Recent log files

## CLI Alternative

You can also manage bridges directly from the command line without the REPL:

```bash
# Start a bridge for a registered agent
dotenvx run -- pnpm run cli habitat agent start trmnl-image-agent

# Check status
dotenvx run -- pnpm run cli habitat agent status trmnl-image-agent

# Stop
dotenvx run -- pnpm run cli habitat agent stop trmnl-image-agent
```

The `agent start` command:
1. Creates a `BridgeSupervisor`
2. Builds the container (LLM + fallback)
3. Starts health monitoring
4. Prints the MCP endpoint URL
5. Keeps running until Ctrl+C

## What Happens on Failure

The supervisor automatically handles failures:

1. **Health check fails** → status becomes "unhealthy"
2. **3 consecutive failures** → supervisor tears down container and rebuilds from scratch
3. **Rebuild fails** → retries up to 3 times total
4. **All retries exhausted** → status becomes "error", supervisor stops

State is persisted to `agents/<id>/supervisor.json` so you can inspect what happened.

## Supervisor State

Check the supervisor state file:

```bash
cat ~/habitats/agents/trmnl-image-agent/supervisor.json
```

```json
{
  "agentId": "trmnl-image-agent",
  "status": "running",
  "port": 10000,
  "buildAttempts": 1,
  "maxBuildAttempts": 3,
  "consecutiveFailures": 0,
  "startedAt": "2026-02-22T00:00:00.000Z",
  "provisioning": {
    "baseImage": "node:20",
    "buildSteps": ["npm install"],
    "envVarNames": [],
    "reasoning": "Detected package.json with node dependencies...",
    "analyzedAt": "2026-02-22T00:00:00.000Z"
  }
}
```

## Architecture Summary

```
dotenvx run -- pnpm run cli habitat agent start <agent-id>
  → Habitat.startBridge(agentId)
    → BridgeSupervisor.start()
      → BridgeAgent.start()
        → BridgeLifecycle (spawns worker thread)
          → bridge-worker.ts
            → buildContainerFromRepo() [dag.llm() + fallback]
              → Go MCP binary starts inside container
                → Polls until MCP server responds
                  → Supervisor starts health loop
```

## Comparison: Bridge vs run_project

| Feature | `run_project` | Bridge Agent |
|---|---|---|
| Container | One-shot per command | Persistent, long-running |
| Communication | Dagger exec | MCP over HTTP |
| Building | Hardcoded project type detection | LLM reads repo + heuristic fallback |
| Monitoring | None | Supervisor with health checks |
| Rebuild | Manual | Automatic on failure |
| Use case | Run a script | Ongoing agent work |
