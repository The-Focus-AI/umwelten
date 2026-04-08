# Bridge System Workflow

> **Maintained docs:** [Habitat Bridge guide](docs/guide/habitat-bridge.md) on the documentation site. This file is a short workflow summary for the repo.

## Core Principle

**NEVER clone repos to host computer. Everything happens inside Dagger containers.**

## Three Phases

### Phase 1: Create — `agent_clone(gitUrl, name)`

Register agent in config. Nothing runs yet. Just metadata.

### Phase 2: Start — `bridge_start(agentId)` or `habitat agent start <id>`

Start the container with whatever config exists:
- First time = bare `node:20`
- With saved provisioning = packages, setup commands, etc.
- Returns when MCP server is reachable
- **No analysis, no iteration loop.** Just start and return.

### Phase 3: Inspect — LLM uses bridge MCP tools

After the bridge is running, the LLM uses tools to inspect and iterate:

1. `agent_status` — is bridge healthy, port, config
2. `agent_logs` — container/bridge logs
3. `bridge_ls`, `bridge_read`, `bridge_exec` — look inside the container
4. `bridge_health` — check MCP server status

The LLM decides what needs updating, modifies the agent config (add packages, secrets, etc.), then restarts. **The LLM is the iteration loop.**

## First Start (Bare Container)

1. Start bare `node:20` container with Go MCP binary + clone repo
2. Agent is ready — LLM can inspect via bridge tools
3. LLM reads repo files, determines what's needed
4. LLM updates agent config with packages/commands, restarts

## Subsequent Starts (Saved Provisioning)

1. Load saved `bridgeProvisioning` from `config.json`
2. Build container directly with all packages
3. Agent ready in seconds

## Container Build Order

```
1. Pull base image (node:20)           <- Cached by Dagger
2. apt-get install packages            <- Cached if same packages
3. Run setup commands (claude install)  <- Cached if same commands
4. Mount npm cache volume              <- Persistent across builds
5. Mount Go MCP binary from host       <- Cached if binary unchanged
6. Inject secrets                       <- LATE — after cacheable layers
7. git clone repo                       <- Always runs (repo may have changed)
```

Secrets are injected late so they don't invalidate Dagger's layer cache for the expensive install steps. Secrets come only from the agent's `secrets` config — no implicit token injection.
