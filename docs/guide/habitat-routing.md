# Channel Routing

The **ChannelBridge** is Umwelten's unified adapter layer that sits between platform-specific transports (Discord, Telegram, Web) and the Habitat core. All interfaces go through it, sharing the same routing, interaction caching, and slash command handling.

## Overview

```
Platform Adapter          ChannelBridge               Habitat Core
─────────────────    ─────────────────────────    ──────────────
Discord Adapter  ──►                             
Telegram Adapter ──►  Route resolution           ──► Stimulus
Web/Gaia Server  ──►  Interaction caching        ──► Interaction
                      Transcript resume/persist  ──► Tools
                      Unified slash commands      ──► Agents
```

Each platform adapter is thin — it receives a message, calls `bridge.handleMessage()`, and formats the response for its platform. The ChannelBridge handles everything else.

## routing.json

Channel routing is configured in `routing.json` in your work directory. This file maps platform-specific channel keys to agents.

### Basic example

```json
{
  "channels": {
    "discord:123456789": { "agentId": "ops-agent" },
    "discord:987654321": { "agentId": "dev-agent", "runtime": "claude-sdk" },
    "telegram:42": { "agentId": "research-agent" }
  }
}
```

Channel keys use the format `platform:identifier`:
- `discord:CHANNEL_ID` — Discord channel or thread
- `telegram:CHAT_ID` — Telegram chat
- `web:SESSION_ID` — Web/Gaia session

### Full configuration

```json
{
  "channels": {
    "discord:123456789": {
      "agentId": "ops-agent",
      "runtime": "default",
      "infoMessageId": "1234567890"
    },
    "discord:987654321": {
      "agentId": "dev-agent",
      "runtime": "claude-sdk"
    }
  },
  "platformDefaults": {
    "discord": { "agentId": "jeeves" },
    "telegram": { "agentId": "research-bot" }
  },
  "defaultAgentId": "main-agent"
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `channels` | `Record<string, ChannelBinding>` | Per-channel agent bindings |
| `platformDefaults` | `Record<string, ChannelBinding>` | Default agent for all channels on a platform |
| `defaultAgentId` | `string` | Global fallback agent |

Each `ChannelBinding` has:

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | `string` | Agent ID from `config.json` |
| `runtime` | `"default" \| "claude-sdk"` | Execution mode (default: `"default"`) |
| `infoMessageId` | `string?` | Discord-specific: pinned binding card message |

### Runtime modes

- **`default`** — Normal Habitat flow: Stimulus → Interaction → LLM with tools
- **`claude-sdk`** — Claude Agent SDK pass-through: messages go to a Claude Code subprocess with full tools (Read, Edit, Bash, etc.) against the agent's project directory. Requires `ANTHROPIC_API_KEY`.

## Route Resolution

When a message arrives, the ChannelBridge resolves which agent should handle it:

1. **Exact match** — look up the channel key in `channels`
2. **Parent channel** — if the message is in a thread, inherit the parent channel's binding
3. **Platform default** — fall back to `platformDefaults` for the platform
4. **Global default** — fall back to `defaultAgentId`
5. **Main habitat** — if nothing matches, use the habitat's own `STIMULUS.md` persona

The resolution is cached per channel key. When routing changes (via `/switch` or file edit), the cache is invalidated and a new Interaction is created.

## Unified Slash Commands

These commands work identically across Discord, Telegram, and Web:

| Command | Description |
|---------|-------------|
| `/reset` (or `/start`) | Clear conversation history and start fresh |
| `/agents` | List available agents |
| `/switch <agent-id>` | Switch this channel to a specific agent |
| `/switch main` | Switch back to the main habitat persona |
| `/switch-claude <agent-id>` | Switch to Claude SDK pass-through mode |
| `/status` | Show current routing for this channel |
| `/help` | List available commands |

### Switching agents

```
/switch ops-agent
→ Switched to agent **ops-agent** (Ops Agent). Next message will use this agent's persona and tools.

/switch main
→ Switched to main habitat persona.

/switch-claude dev-agent
→ Switched to **Claude SDK** pass-through for agent **dev-agent**.
   Messages go directly to Claude Code with full tools against `Dev Agent`.
   Use /switch main to go back.
```

Switching updates `routing.json` on disk, so the change persists across restarts.

## Legacy discord.json Migration

If you have an existing `discord.json`, the routing system automatically reads it as a fallback:

```json
// discord.json (old format)
{
  "channels": {
    "123456789": "ops-agent"
  },
  "defaultAgentId": "jeeves"
}
```

This is equivalent to:

```json
// routing.json (new format)
{
  "channels": {
    "discord:123456789": { "agentId": "ops-agent" }
  },
  "platformDefaults": {
    "discord": { "agentId": "jeeves" }
  }
}
```

Channel IDs from `discord.json` are automatically prefixed with `discord:`. Explicit `routing.json` entries take precedence over `discord.json`. You can migrate at your own pace — or keep both files.

## Transcript Resume

When the bot restarts, the ChannelBridge automatically loads the last few message pairs from the on-disk transcript for each channel. This gives the LLM conversational context without replaying the entire history.

The number of pairs is configurable:

```typescript
const bridge = new ChannelBridge(habitat, {
  resumeMessagePairs: 4,  // default: 4 user+assistant pairs
});
```

## Platform-Specific Instructions

Each adapter can inject platform-specific formatting guidance:

```typescript
// Telegram
const bridge = new ChannelBridge(habitat, {
  platformInstruction: 'You are responding in Telegram. Never use markdown tables. Keep formatting simple.',
});

// Discord
const bridge = new ChannelBridge(habitat, {
  platformInstruction: 'You are responding in Discord. Prefer short paragraphs. Use bullet lists over tables.',
});
```

## Programmatic Usage

```typescript
import { Habitat } from 'umwelten/habitat';
import { ChannelBridge } from 'umwelten/ui/bridge';

const habitat = await Habitat.create({ workDir: '~/my-habitat' });
const bridge = new ChannelBridge(habitat);

// Handle an incoming message
await bridge.handleMessage(
  {
    channelKey: 'custom:user-123',
    text: 'Hello!',
    userId: 'user-123',
  },
  {
    onDone: async (result) => {
      console.log('Response:', result.content);
    },
    onToolCall: (name, input) => {
      console.log(`Tool: ${name}`, input);
    },
    onError: (error) => {
      console.error('Error:', error);
    },
  },
);

// Switch agent for a channel
await bridge.switchAgent('custom:user-123', 'ops-agent');

// Reset a channel
bridge.resetChannel('custom:user-123');

// Resolve routing
const route = await bridge.resolveRoute('custom:user-123');
// → { kind: 'agent', agentId: 'ops-agent', runtime: 'default' }
// or { kind: 'main' }
```

## Key Source Files

| File | Purpose |
|------|---------|
| [`src/ui/bridge/channel-bridge.ts`](../../src/ui/bridge/channel-bridge.ts) | ChannelBridge class — the core adapter |
| [`src/ui/bridge/routing.ts`](../../src/ui/bridge/routing.ts) | Route loading, resolution, and mutation |
| [`src/ui/bridge/commands.ts`](../../src/ui/bridge/commands.ts) | Unified slash command definitions |
| [`src/ui/bridge/types.ts`](../../src/ui/bridge/types.ts) | Shared types (ChannelMessage, RoutingConfig, etc.) |

## See Also

- [Habitat](./habitat.md) — work directory, tools, agents
- [Habitat Interfaces](./habitat-interfaces.md) — all available surfaces
- [Jeeves Discord Guide](./jeeves-discord.md) — opinionated Discord bot preset
- [Habitat Setup Walkthrough](../walkthroughs/habitat-setup-walkthrough.md) — hands-on tutorial
