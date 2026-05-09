# @umwelten/habitat

Agent container runtime — habitats, tools, sessions, Gaia orchestrator, web/A2A server, and channel bridge.

## Install

```bash
pnpm add @umwelten/habitat
```

## Quick start

```typescript
import { Habitat } from '@umwelten/habitat';

const habitat = await Habitat.create({ workDir: './my-agent' });
const { interaction } = await habitat.createInteraction();
await interaction.chat('List my agents');
```

## What's inside

- **habitat.ts** — `Habitat` class, agent management
- **tools/** — File ops, time, agents, sessions, search, secrets, self-modify, artifacts
- **gaia/** — Multi-habitat orchestrator (registry, Docker, secrets vault, dashboard)
- **bridge/** — `ChannelBridge` message routing, diagnosis/monitor agents
- **web/** — HTTP server, routes, auth (`startWebServer`)
- **container-server.ts** — Unified HTTP: MCP + A2A + chat + web UI + files
- **a2a-handler.ts** — Agent-to-Agent protocol handler
