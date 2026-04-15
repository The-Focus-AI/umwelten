# Setting Up a Habitat — The Complete Walkthrough

A step-by-step guide for creating a Habitat from scratch, customizing it, and running it across all available interfaces: CLI REPL, Telegram, Discord, and Web.

**Time Required:** 20-30 minutes  
**Prerequisites:** Node.js 20+, pnpm, at least one LLM API key  
**Optional:** Telegram bot token, Discord bot token, Tavily API key, Dagger

## What You'll Build

By the end of this walkthrough you'll have:

1. A working habitat at `~/habitats` with a custom persona
2. Tools loaded from the work directory (including web search)
3. A registered sub-agent for a git project
4. A running CLI REPL
5. Optionally: Telegram bot, Discord bot, and/or web interface — all sharing the same habitat
6. Understanding of how routing, tools, and agents fit together

## Part 1: Install & Environment

### Clone and install

```bash
git clone https://github.com/The-Focus-AI/umwelten.git
cd umwelten
pnpm install

# Verify it works
pnpm run cli --help
```

You should see the list of commands including `habitat`.

### Set up API keys

Create a `.env` file in the repo root (or use `examples/jeeves-bot/.env` as a starting point):

```bash
# Required — at least one LLM provider
GOOGLE_GENERATIVE_AI_API_KEY=your-google-api-key

# Optional — web search tool
TAVILY_API_KEY=your-tavily-key

# Optional — bot interfaces
TELEGRAM_BOT_TOKEN=your-telegram-token
DISCORD_BOT_TOKEN=your-discord-token
```

::: tip dotenvx prefix
**Always** prefix CLI commands with `dotenvx run --` so your `.env` keys are loaded:
```bash
dotenvx run -- pnpm run cli -- habitat -p google -m gemini-3-flash-preview
```
The repo also includes **mise tasks** that handle this automatically (see [Part 4](#part-4-mise-tasks-the-easy-way)).
:::

## Part 2: First Run — CLI REPL

### Start the habitat

```bash
dotenvx run -- pnpm run cli -- habitat -p google -m gemini-3-flash-preview
```

On first run, the habitat detects that `~/habitats` doesn't exist and runs onboarding automatically:

```
[habitat] Work directory not set up. Running onboarding...
[habitat] Created: config.json, STIMULUS.md (minimal), skills/, tools/, tools/search/, tools/run_bash/
[habitat] Work directory: /Users/you/habitats
[habitat] google/gemini-3-flash-preview
[habitat] Work dir: /Users/you/habitats
[habitat] 16 tools, 0 skills, 0 agents
[habitat] Session: cli-1707580000000
Habitat agent ready. Type a message and press Enter.
Commands: /exit, /agents, /agent-start <id>, /agent-stop <id>, /agent-status [id], /skills, /tools, /context, /onboard, /compact [strategy], /compact help
```

### Explore the REPL

Try these commands:

```
You: /tools
Tools (16): read_file, write_file, list_directory, ripgrep, current_time, wget, markify, parse_feed, agents_list, agents_add, agents_update, agents_remove, agent_clone, agent_ask, agent_logs, agent_status

You: /agents
No agents registered. Use agent_clone or agents_add tools to register agents.

You: /context
[Context: 2 messages, ~0.3K tokens]

You: What tools do you have?
Habitat: I have the following tools available: ...

You: /exit
```

### Explore the work directory

```bash
ls ~/habitats/
```

```
STIMULUS.md    config.json    skills/    tools/
```

```bash
ls ~/habitats/tools/
```

```
run_bash/    search/
```

Each tool subdirectory has a `TOOL.md` and `handler.ts`:

```bash
ls ~/habitats/tools/search/
```

```
TOOL.md    handler.ts
```

## Part 3: Customize Your Habitat

### Edit the persona

Edit `~/habitats/STIMULUS.md` to give your agent a personality:

```markdown
---
role: "research assistant"
objective: "Help the user research topics, manage projects, and stay organized"
instructions:
  - "When asked to research something, use the search tool to find current information"
  - "When managing projects, use agent tools to monitor their status"
  - "Keep memories.md and facts.md up to date"
  - "Be concise but thorough"
maxToolSteps: 15
---

# Research Assistant

You are a research assistant that helps with:

1. **Web research** — Use the `search` tool for current information
2. **Project management** — Monitor and interact with registered sub-agents
3. **File management** — Read, write, and organize files in the work directory
4. **Memory** — Maintain memories.md with things the user shares
```

### Configure model defaults

Edit `~/habitats/config.json` so you don't need `--provider` and `--model` every time:

```json
{
  "defaultProvider": "google",
  "defaultModel": "gemini-3-flash-preview",
  "agents": [],
  "skillsDirs": ["./skills"],
  "toolsDir": "tools",
  "memoryFiles": {
    "enabled": true,
    "files": ["memories.md", "facts.md"],
    "journalFile": "private journal.md"
  }
}
```

Now start with just:

```bash
dotenvx run -- pnpm run cli -- habitat
```

### Add a custom tool

Create a `ping_url` tool that checks if a URL is reachable:

```bash
mkdir -p ~/habitats/tools/ping_url
```

Create `~/habitats/tools/ping_url/TOOL.md`:

```markdown
---
name: ping_url
description: "Check if a URL is reachable. Returns status code and response time."
---
```

Create `~/habitats/tools/ping_url/handler.ts`:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export default tool({
  description: 'Check if a URL is reachable. Returns status code and response time.',
  parameters: z.object({
    url: z.string().url().describe('The URL to check'),
  }),
  execute: async ({ url }) => {
    const start = Date.now();
    try {
      const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
      return { url, status: response.status, ok: response.ok, responseTimeMs: Date.now() - start };
    } catch (err) {
      return { url, error: err instanceof Error ? err.message : String(err), responseTimeMs: Date.now() - start };
    }
  },
});
```

Restart the habitat and verify:

```
You: /tools
Tools (17): ..., ping_url

You: Is github.com up?
Habitat: [Uses ping_url tool]
Yes! github.com returned HTTP 200 in 145ms.
```

### Register a sub-agent

```
You: Clone https://github.com/octocat/Hello-World.git as "Hello World"
Habitat: [Uses agent_clone tool]
Cloned and registered.

You: /agents
Agents (1):
  hello-world — Hello World (/Users/you/habitats/repos/hello-world)

You: Ask hello-world to explore its project and tell me what it does
Habitat: [Uses agent_ask — the sub-agent reads files in the project]
...
```

## Part 4: mise Tasks — The Easy Way

The repo includes [mise](https://mise.jdx.dev) tasks that handle env vars and work directory automatically. First, set up `examples/jeeves-bot/.env`:

```bash
cp examples/jeeves-bot/env.example examples/jeeves-bot/.env
# Edit .env with your API keys
```

Then run any interface with a single command:

| Command | Interface | Notes |
|---------|-----------|-------|
| `mise run habitat` | CLI REPL | Interactive conversation |
| `mise run habitat-web` | Gaia web server | http://localhost:3000 |
| `mise run habitat-telegram` | Telegram bot | Needs `TELEGRAM_BOT_TOKEN` |
| `mise run habitat-discord` | Discord bot | Needs `DISCORD_BOT_TOKEN` |
| `mise run habitat-discord-check` | Discord setup check | Verifies env and bot config |

All mise tasks share **one work directory** (`examples/jeeves-bot/jeeves-bot-data-dir`), so agents, persona, memories, and tools stay consistent across interfaces.

## Part 5: All Four Interfaces

Every interface attaches to the same Habitat — sharing config, tools, skills, agents, sessions, and the ChannelBridge routing layer.

### CLI REPL (default)

```bash
# Direct (with dotenvx)
dotenvx run -- pnpm run cli -- habitat -p google -m gemini-3-flash-preview

# With mise
mise run habitat

# One-shot prompt
dotenvx run -- pnpm run cli -- habitat -p google -m gemini-3-flash-preview "list my agents"

# Custom work directory
dotenvx run -- pnpm run cli -- habitat -w ~/my-agent
```

REPL commands:

| Command | Description |
|---------|-------------|
| `/exit` | Save session and quit |
| `/agents` | List registered agents |
| `/agent-start <id>` | Start an agent's MCP server |
| `/agent-stop <id>` | Stop an agent's MCP server |
| `/agent-status [id]` | Check agent health (all if no ID) |
| `/skills` | List loaded skills |
| `/tools` | List registered tools |
| `/context` | Show context size |
| `/onboard` | Re-run onboarding |
| `/compact [strategy]` | Compact conversation context |
| `/compact help` | List compaction strategies |

### Local Agent Mode

Talk directly to a sub-agent rooted at a project directory:

```bash
# Use current directory as the project
dotenvx run -- pnpm run cli -- habitat local

# Or specify a project
dotenvx run -- pnpm run cli -- habitat local --project ~/projects/my-app

# One-shot
dotenvx run -- pnpm run cli -- habitat local "What does this project do?"
```

This automatically registers the directory as a managed agent, configures it (reads README, package.json, etc.), and gives you a REPL talking directly to that project's sub-agent.

### Telegram Bot

```bash
# Direct
dotenvx run -- pnpm run cli -- habitat telegram --token $TELEGRAM_BOT_TOKEN -p google -m gemini-3-flash-preview

# With mise
mise run habitat-telegram
```

Features:
- Multi-turn conversations per chat
- Media support (photos, documents, audio, video)
- `/start`, `/reset`, `/help` commands
- Session-specific media storage and transcripts
- Markdown formatting

**Getting a bot token:** Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → follow the prompts → save the token.

### Discord Bot

```bash
# Direct
dotenvx run -- pnpm run cli -- habitat discord --token $DISCORD_BOT_TOKEN -p google -m gemini-3-flash-preview

# With Jeeves preset
dotenvx run -f examples/jeeves-bot/.env -- pnpm run cli -- habitat discord \
  -w examples/jeeves-bot/jeeves-bot-data-dir --env-prefix JEEVES

# With mise
mise run habitat-discord
```

Features:
- Channel → agent routing via `routing.json`
- Runtime modes: `habitat` (default) or `claude-sdk` (Claude Agent SDK pass-through)
- Startup REST backfill for messages sent while bot was offline
- Stable thread sessions with transcript resume
- Per-channel slash commands: `/switch`, `/status`, `/reset`, `/agents`

**Setup:**
1. Create an application at [discord.com/developers/applications](https://discord.com/developers/applications)
2. Bot → Enable **Message Content Intent**
3. OAuth2 → URL Generator → scopes: `bot`, `applications.commands` → permissions: Send Messages, Read Message History, Manage Messages
4. Use the generated URL to invite the bot to your server

**Verify setup:**
```bash
mise run habitat-discord-check
```

### Web Interface (Gaia)

```bash
# Direct
dotenvx run -- pnpm run cli -- habitat web -p google -m gemini-3-flash-preview --port 3000

# With mise
mise run habitat-web
```

Starts an HTTP server with a REST API and web UI at `http://localhost:3000`.

## Part 6: Channel Routing

The **ChannelBridge** is the unified adapter layer that all platform interfaces go through. It handles:

- **Interaction caching** — one interaction per channel key
- **Route resolution** — which agent handles which channel
- **Transcript resume** — reload recent messages on restart
- **Transcript persistence** — write to session dir on every update
- **Unified slash commands** — work identically on Discord, Telegram, and Web

### routing.json

Create `routing.json` in your work directory to map channels to specific agents:

```json
{
  "channels": {
    "discord:123456789": { "agentId": "ops-agent", "runtime": "default" },
    "discord:987654321": { "agentId": "dev-agent", "runtime": "claude-sdk" },
    "telegram:42": { "agentId": "research-agent" }
  },
  "platformDefaults": {
    "discord": { "agentId": "jeeves" }
  },
  "defaultAgentId": "main-agent"
}
```

**Resolution order:**
1. Exact channel key match (`discord:123456789`)
2. Parent channel match (threads inherit from parent)
3. Platform default (`platformDefaults.discord`)
4. Global default (`defaultAgentId`)
5. Main habitat persona (no agent — uses `STIMULUS.md`)

### Slash commands (all platforms)

These commands work the same on Discord, Telegram, and Web:

| Command | Description |
|---------|-------------|
| `/reset` or `/start` | Clear conversation and start fresh |
| `/agents` | List available agents |
| `/switch <agent-id>` | Switch channel to a specific agent |
| `/switch main` | Switch back to main habitat persona |
| `/switch-claude <agent-id>` | Switch to Claude SDK pass-through |
| `/status` | Show current routing for this channel |
| `/help` | Show available commands |

### Legacy discord.json

If you have an existing `discord.json`, it's automatically merged into the routing — channel IDs are prefixed with `discord:`. You can migrate to `routing.json` at your leisure.

## Part 7: Secrets Management

Habitats have a built-in secrets store (`secrets.json`, mode 0600):

```bash
# List secrets
dotenvx run -- pnpm run cli -- habitat secrets list

# Set a secret
dotenvx run -- pnpm run cli -- habitat secrets set TAVILY_API_KEY "tvly-..."

# Set from 1Password
dotenvx run -- pnpm run cli -- habitat secrets set OPENAI_KEY --from-op "op://vault/item/key"

# Remove a secret
dotenvx run -- pnpm run cli -- habitat secrets remove OLD_KEY
```

Secrets are stored in `~/habitats/secrets.json` and available to tools at runtime.

## Part 8: Agent MCP Servers

Agents can run as standalone MCP servers. This is useful for long-running, isolated environments:

```bash
# Start an agent's MCP server
dotenvx run -- pnpm run cli -- habitat agent start my-agent

# Check status of all agents
dotenvx run -- pnpm run cli -- habitat agent status

# Check a specific agent
dotenvx run -- pnpm run cli -- habitat agent status my-agent

# Stop an agent
dotenvx run -- pnpm run cli -- habitat agent stop my-agent
```

From the REPL:
```
You: /agent-start my-agent
✅ Agent "My Agent" Bridge MCP server started on port 12345
   Endpoint: http://localhost:12345/mcp

You: /agent-status
🟢 My Agent (my-agent)
   Status: running
   Port: 12345
   Tools: 5 available

You: /agent-stop my-agent
✅ Agent "My Agent" MCP server marked as stopped
```

## Part 9: Remote MCP Chat

Connect to any remote MCP server with OAuth support:

```bash
# Interactive REPL
dotenvx run -- pnpm run cli -- mcp chat --url https://oura-mcp.fly.dev/mcp

# One-shot
dotenvx run -- pnpm run cli -- mcp chat --url https://oura-mcp.fly.dev/mcp --one-shot "how did I sleep?"

# Clear saved OAuth credentials
dotenvx run -- pnpm run cli -- mcp chat --url https://oura-mcp.fly.dev/mcp --logout
```

On first connection, the CLI opens a browser for OAuth login. Tokens are saved to `~/.umwelten/mcp-auth/` for subsequent runs. In-REPL commands: `/tools`, `/logout`, `/exit`.

## Part 10: Environment Variables

### Provider keys

| Variable | Provider |
|----------|----------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini |
| `OPENROUTER_API_KEY` | OpenRouter (OpenAI, Anthropic, etc.) |
| `DEEPINFRA_API_KEY` | DeepInfra |
| `TOGETHER_API_KEY` | Together AI |
| `GITHUB_TOKEN` | GitHub Models |
| `ANTHROPIC_API_KEY` | Claude SDK pass-through |

### Habitat configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HABITAT_WORK_DIR` | `~/habitats` | Work directory |
| `HABITAT_SESSIONS_DIR` | `~/habitats-sessions` | Sessions directory |
| `HABITAT_CONFIG_PATH` | `{workDir}/config.json` | Config file override |
| `HABITAT_PROVIDER` | (none) | Default LLM provider |
| `HABITAT_MODEL` | (none) | Default LLM model |

### Bot tokens

| Variable | Interface |
|----------|-----------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot |
| `DISCORD_BOT_TOKEN` | Discord bot |
| `DISCORD_GUILD_ID` | Register slash commands in one guild (faster) |
| `TAVILY_API_KEY` | Web search tool |

### Custom env prefix

Change the prefix with `--env-prefix` to run multiple habitats with different configs:

```bash
# Uses JEEVES_WORK_DIR, JEEVES_PROVIDER, JEEVES_MODEL
dotenvx run -- pnpm run cli -- habitat --env-prefix JEEVES

# Uses MYBOT_WORK_DIR, MYBOT_PROVIDER, etc.
dotenvx run -- pnpm run cli -- habitat --env-prefix MYBOT
```

## Part 11: Testing

### Automated tests

```bash
# All tests (use test:run, never test — it watches)
pnpm test:run

# Habitat tests specifically
pnpm test:run src/habitat/

# ChannelBridge routing & command tests
pnpm test:run src/ui/bridge/

# Discord adapter tests
pnpm test:run src/ui/discord/
```

### Manual verification checklist

1. **Start REPL**: `dotenvx run -- pnpm run cli -- habitat -p google -m gemini-3-flash-preview`
2. **Check tools**: `/tools` — verify 16+ tools listed
3. **Check agents**: `/agents`
4. **Test search**: "Search for the latest TypeScript news" (needs `TAVILY_API_KEY`)
5. **Clone an agent**: "Clone https://github.com/octocat/Hello-World.git as Hello World"
6. **Ask the agent**: "Ask hello-world what this project does"
7. **Check context**: `/context`
8. **Exit and restart**: `/exit`, then re-run — verify session persists
9. **Compact**: After a long conversation, `/compact` to reduce context size

## Putting It All Together

```
Habitat.create()
  │
  ├── resolveWorkDir (~/habitats, env, or --work-dir)
  ├── loadConfig (config.json)
  ├── register standard tool sets (file, time, url, agent, session, …)
  ├── loadToolsFromDirectory (search, run_bash, ping_url, …)
  │     ├── Direct exports → registered as-is
  │     └── Factory exports → called with habitat context
  ├── registerCustomTools (if any)
  │
  ├── getStimulus()
  │     ├── loadStimulusOptionsFromWorkDir (STIMULUS.md, AGENT.md, memory)
  │     ├── register all tools into stimulus
  │     └── load skills (local + git)
  │
  └── Interface starts
        ├── CLI REPL: readline loop + streaming
        ├── Telegram: grammY bot + ChannelBridge
        ├── Discord: discord.js bot + ChannelBridge + routing.json
        └── Web: HTTP server + ChannelBridge
```

All interfaces share the same Habitat, tools, skills, agents, and the ChannelBridge routing layer.

## Work Directory Reference

```
~/habitats/                     ← the habitat work directory
  config.json                   ← agents, skills, model defaults
  secrets.json                  ← API keys (mode 0600)
  STIMULUS.md                   ← base persona / system prompt
  AGENT.md                      ← additional context (optional)
  routing.json                  ← channel→agent routing (all platforms)
  repos/                        ← git-cloned skill repos
  skills/                       ← local skills
  tools/                        ← work-dir tools
    search/TOOL.md + handler.ts
    run_bash/TOOL.md + handler.ts
    ping_url/TOOL.md + handler.ts
  agents/                       ← managed agent workspaces
    {agentId}/
      repo/                     ← cloned project
      logs/bridge.log
      state.json
  memories.md, facts.md         ← memory files
  private journal.md            ← optional journal
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "No model configured" | Set `--provider` + `--model`, add defaults to `config.json`, or set `HABITAT_PROVIDER` / `HABITAT_MODEL` |
| Tool not loading | Check `TOOL.md` has `description` in frontmatter; `handler.ts` must default-export a Tool or factory |
| "TAVILY_API_KEY is not set" | Set `TAVILY_API_KEY` in your `.env`. Get one at [app.tavily.com](https://app.tavily.com) |
| Agent not found | Check `config.json` agents array. Use `/agents` or clone one with `agent_clone` |
| Discord bot not responding | Enable **Message Content Intent** in Discord Developer Portal → Bot settings |
| Env vars not loading | Use `dotenvx run --` prefix or `mise` tasks — don't run bare `pnpm run cli` |
| Routing not applying | Check `routing.json` channel keys match format `platform:id` (e.g. `discord:123456`) |

## What's Next

- **[Habitat Interfaces](../guide/habitat-interfaces.md)** — detailed docs for each surface
- **[Channel Routing](../guide/habitat-routing.md)** — deep dive into routing.json and ChannelBridge
- **[Habitat Agents](../guide/habitat-agents.md)** — sub-agents and bridge agents
- **[Habitat Testing](../guide/habitat-testing.md)** — automated and manual test procedures
- **[MCP Chat](../guide/mcp-chat.md)** — remote MCP server integration
- **[Jeeves Discord Guide](../guide/jeeves-discord.md)** — opinionated Discord bot preset
