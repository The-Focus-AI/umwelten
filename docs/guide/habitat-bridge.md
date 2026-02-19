# Habitat Bridge System - Implementation Summary

## Overview

The Habitat Bridge System has been successfully implemented! It provides persistent agent containers with MCP-based communication, following the iterative provisioning architecture you requested.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           HABITAT (Host)                            │
│                                                                      │
│  ┌──────────────────┐      ┌──────────────────────────────────────┐│
│  │   BridgeAgent    │──────│   Iterative Provisioning Loop      ││
│  │                  │      │                                      ││
│  │  1. Start basic  │      │  while not ready:                   ││
│  │  2. Analyze      │      │    createBridge()                   ││
│  │  3. Destroy      │      │    analyze()                        ││
│  │  4. Recreate     │      │    if needs update:                 ││
│  │                  │      │      destroyBridge()                ││
│  └──────────────────┘      │      continue with new provisioning ││
│         │                  └──────────────────────────────────────┘│
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────┐      ┌──────────────────────────────────────┐│
│  │ BridgeLifecycle  │──────│  Dagger Container Management       ││
│  │                  │      │                                      ││
│  │  - createBridge  │      │  • Dynamic ports (8080, 8081...)   ││
│  │  - destroyBridge │      │  • Git installation                ││
│  │  - health checks │      │  • Apt package installation        ││
│  │  - get logs      │      │  • Skill repo cloning              ││
│  └──────────────────┘      │  • Bridge server setup             ││
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP + MCP Protocol
                              │
┌─────────────────────────────────────────────────────────────────────┐
│                        DAGGER CONTAINER                             │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │                      Bridge Server                              ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    ││
│  │  │  git/    │  │   fs/    │  │  exec/   │  │  bridge/     │    ││
│  │  │  clone   │  │  read    │  │   run    │  │  health      │    ││
│  │  │  commit  │  │  write   │  │          │  │  logs        │    ││
│  │  │  push    │  │  list    │  │          │  │              │    ││
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘    ││
│  │                                                                   ││
│  │  Streamable HTTP Transport (official MCP SDK)                   ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │                    /workspace (Git Repository)                  ││
│  │                                                                 ││
│  │  All code lives here. Host only has logs and session data.     ││
│  └────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

## Files Created

### Core Bridge Files

- `src/habitat/bridge/server.ts` - MCP bridge server (uses official SDK)
- `src/habitat/bridge/client.ts` - MCP client for host to connect to bridge
- `src/habitat/bridge/lifecycle.ts` - Dagger container lifecycle management
- `src/habitat/bridge/analyzer.ts` - Repository analysis (reuses existing detection logic)
- `src/habitat/bridge/agent.ts` - Iterative provisioning orchestrator
- `src/habitat/bridge/index.ts` - Module exports

### Supporting Files

- `src/mcp/types/transport-tcp.ts` - TCP transport for MCP (alternative)
- Updated `src/habitat/habitat.ts` - Integration with Habitat class
- Updated `package.json` - Added `@modelcontextprotocol/sdk` and esbuild

## Key Features

### 1. Iterative Provisioning

- Starts with `ubuntu:22.04` + git
- Analyzes repo via MCP file tools
- Detects: project type (npm/pip/cargo/etc), tools (imagemagick/jq/etc), skills
- Destroys and recreates with correct provisioning
- No iteration cap - continues until ready
- All decisions made by analyzing code, no manual configuration

### 2. Official MCP SDK

- Uses `@modelcontextprotocol/sdk` v1.26.0
- Streamable HTTP transport (easier debugging than sockets)
- Tools: git/clone, git/status, git/commit, git/push
- Tools: fs/read, fs/write, fs/list, fs/exists, fs/stat
- Tools: exec/run, bridge/health, bridge/logs

### 3. Dynamic Ports

- Each bridge gets unique port (8080, 8081, etc.)
- No conflicts between multiple agents
- Exposed via Dagger port forwarding

### 4. Git Integration

- Uses `GITHUB_TOKEN` env var for private repos
- Shallow clones (`--depth 1`) for speed
- Supports HTTPS and SSH (via token auth)

### 5. Session Persistence

- Session messages stored on host
- Bridge is stateless
- If bridge dies: recreate and continue conversation
- Logs available for debugging via `bridge/logs` tool

## Usage Example

```typescript
import { Habitat } from "./habitat/habitat.js";

const habitat = await Habitat.create({ workDir: "./my-agent" });

// Create bridge agent for remote repo
const bridgeAgent = await habitat.createBridgeAgent(
  "my-project-agent",
  "https://github.com/user/repo.git",
);

// Get the client to interact with the container
const client = await bridgeAgent.getClient();

// Use the client
const files = await client.listDirectory("/workspace");
const content = await client.readFile("/workspace/README.md");
const result = await client.execute("npm test");

// Check health
const health = await client.health();

// Get logs for debugging
const logs = await client.getLogs(100);

// When done
await habitat.destroyBridgeAgent("my-project-agent");
```

## Build Command

```bash
# Build the bridge server bundle
pnpm run build:bridge

# This creates:
# dist/bridge/server.js (bundled, ready to copy into containers)
```

## Detection Logic Reused

The analyzer reuses existing detection logic from:

- `src/evaluation/codebase/context-provider.ts` - Project type detection
- `src/habitat/tools/run-project/project-analyzer.ts` - Tool patterns, env var detection
- `src/habitat/tools/run-project/skill-provisioner.ts` - Skill detection

## Next Steps

1. **Bundle the bridge server**: Run `pnpm run build:bridge`
2. **Test with a sample repo**: Create a test script that uses `createBridgeAgent`
3. **Add more tool patterns**: Extend TOOL_PATTERNS in analyzer.ts as needed
4. **Optimize**: Cache analysis results to speed up recreations
5. **Production**: Consider pre-building container images with common setups

## Design Decisions

1. **TCP over sockets**: Easier to debug with curl/browser
2. **Official MCP SDK**: Standard, well-documented, actively maintained
3. **No iteration cap**: Habitat agent decides when ready based on analysis
4. **Git in every container**: Dynamically installed based on base image
5. **Inline bridge server**: Currently in lifecycle.ts (simplified). For production, use the bundled version
6. **100% auto-discovery**: No manifests, no manual config

## Security

- Bridge server only allows access to `/workspace` and `/opt`
- Git auth uses GITHUB_TOKEN env var
- Dynamic port allocation per agent
- Sandboxed container execution via Dagger
