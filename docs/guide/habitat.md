# Habitat

A **Habitat** is the top-level container for everything an agent needs: work directory, config, tools, skills, sessions, memory, and sub-agents. Any interface — CLI REPL, Telegram bot, TUI, web — runs _inside_ a Habitat, sharing the same environment.

## Overview

```
~/habitats/                     <- the habitat work directory
  config.json                   <- agents, skills, model defaults
  secrets.json                  <- encrypted API keys and tokens
  STIMULUS.md                   <- base persona / system prompt
  repos/                        <- git-cloned skill repositories
  skills/                       <- local skills
  tools/                        <- work-dir tools
    search/TOOL.md + handler.ts
    run_bash/TOOL.md + handler.ts
  agents/                       <- managed agent workspaces + runtime state
    {agentId}/
      repo/                     <- cloned project workspace
      logs/bridge.log           <- persistent container logs
      state.json                <- port, pid, status
  memories.md, facts.md, ...    <- memory files
```

Interfaces attach to the same Habitat:

- `umwelten habitat` — CLI REPL (default)
- `umwelten habitat telegram` — Telegram bot
- Future: `umwelten habitat tui`, `umwelten habitat web`

One habitat, many interfaces. They share config, tools, skills, agents, and sessions.

## Quick Start

```bash
# Start a CLI REPL with Google Gemini
umwelten habitat -p google -m gemini-3-flash-preview

# One-shot prompt
umwelten habitat -p google -m gemini-3-flash-preview "list my agents"

# Custom work directory
umwelten habitat -w ~/my-agent -p openrouter -m anthropic/claude-sonnet-4

# Telegram bot
umwelten habitat telegram --token $TELEGRAM_BOT_TOKEN -p google -m gemini-3-flash-preview
```

On first run, if the work directory doesn't exist, the habitat runs **onboarding** automatically — creating `config.json`, `STIMULUS.md`, `skills/`, `tools/`, and seeding builtin tools.

## CLI Commands

### REPL Mode

```bash
umwelten habitat [options] [prompt...]
```

When no prompt is given, starts an interactive REPL. In the REPL, these slash commands are available:

| Command               | Description                                    |
| --------------------- | ---------------------------------------------- |
| `/exit`               | Save session and quit                          |
| `/agents`             | List registered agents                         |
| `/skills`             | List loaded skills                             |
| `/tools`              | List registered tools                          |
| `/context`            | Show context size (messages, estimated tokens) |
| `/onboard`            | Re-run onboarding (creates missing files/dirs) |
| `/compact [strategy]` | Compact conversation context                   |
| `/compact help`       | List available compaction strategies           |

### Telegram Subcommand

```bash
umwelten habitat telegram [options]
```

Starts a Telegram bot attached to the same habitat. Requires a bot token (via `--token` or `TELEGRAM_BOT_TOKEN` env var).

### Shared Options

Both the REPL and telegram subcommands accept:

| Option                      | Description                                         |
| --------------------------- | --------------------------------------------------- |
| `-p, --provider <provider>` | LLM provider (google, openrouter, ollama, etc.)     |
| `-m, --model <model>`       | Model name                                          |
| `-w, --work-dir <path>`     | Work directory (default: `~/habitats`)              |
| `--sessions-dir <path>`     | Sessions directory (default: `~/habitats-sessions`) |
| `--env-prefix <prefix>`     | Env var prefix (default: `HABITAT`)                 |
| `--skip-onboard`            | Skip automatic onboarding                           |

The telegram subcommand also accepts:

| Option            | Description        |
| ----------------- | ------------------ |
| `--token <token>` | Telegram bot token |

## Work Directory Structure

| Path                 | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| `config.json`        | Agents, skills, model defaults, tool settings                   |
| `STIMULUS.md`        | Main persona / system prompt (YAML frontmatter + body)          |
| `AGENT.md`           | Additional context appended after the main prompt               |
| `tools/`             | Each subdirectory with `TOOL.md` (+ optional handler) is a tool |
| `skills/`            | Each subdirectory with `SKILL.md` is a skill                    |
| `repos/`             | Git-cloned skill repositories                                   |
| `agents/`            | Managed agent workspaces plus runtime state/logs                |
| `memories.md`        | Running list of things the user shared                          |
| `facts.md`           | Summary of known facts                                          |
| `private journal.md` | Daily reflections (optional)                                    |

### Config File (config.json)

```json
{
  "defaultProvider": "google",
  "defaultModel": "gemini-3-flash-preview",
  "agents": [
    {
      "id": "twitter-feed",
      "name": "Twitter Feed",
      "projectPath": "/path/to/twitter-feed",
      "commands": { "run": "pnpm start" },
      "logPatterns": [{ "pattern": "logs/*.jsonl", "format": "jsonl" }],
      "statusFile": "status.md"
    }
  ],
  "skillsDirs": ["./skills"],
  "skillsFromGit": ["owner/repo"],
  "skillsCacheDir": "repos",
  "toolsDir": "tools",
  "memoryFiles": {
    "enabled": true,
    "files": ["memories.md", "facts.md"],
    "journalFile": "private journal.md"
  }
}
```

When `defaultProvider` and `defaultModel` are set in config, you can start the habitat without `--provider` and `--model` flags.

## Tools

### Work Directory Tools

Each subdirectory of `tools/` with a `TOOL.md` file becomes a tool. The TOOL.md uses YAML frontmatter for name and description:

```yaml
---
name: my_tool
description: "What this tool does"
---
# My Tool

Extended documentation here.
```

Handlers can be:

1. **Direct Tool export** — `handler.ts` default-exports a Vercel AI SDK Tool object:

   ```typescript
   import { tool } from "ai";
   import { z } from "zod";

   export default tool({
     description: "My tool",
     parameters: z.object({ query: z.string() }),
     execute: async ({ query }) => {
       return { result: query };
     },
   });
   ```

2. **Factory function** — `handler.ts` default-exports a function that receives the habitat context and returns a Tool:

   ```typescript
   import { tool } from "ai";
   import { z } from "zod";
   import type { Tool } from "ai";

   export default function (context: {
     workDir: string;
     getAgent: Function;
     getAllowedRoots: Function;
   }): Tool {
     return tool({
       description: "My contextual tool",
       parameters: z.object({ command: z.string() }),
       execute: async ({ command }) => {
         // Can use context.workDir, context.getAgent(), etc.
         return { result: command };
       },
     });
   }
   ```

3. **Script tool** — TOOL.md sets `type: script` and `script: path/to/script.ts`:
   ```yaml
   ---
   name: my_script
   description: "Runs a script"
   type: script
   script: ./run.ts
   ---
   ```

### Builtin Tools

New habitats are seeded with two builtin tools during onboarding:

| Tool       | Type          | Description                                                                                                       |
| ---------- | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `search`   | Direct export | Web search via [Tavily](https://tavily.com). Requires `TAVILY_API_KEY` env var.                                   |
| `run_bash` | Factory       | Execute bash in [Dagger](https://dagger.io) containers with experience-based state. Requires `@dagger.io/dagger`. |

These are copied from `src/habitat/builtin-tools/` into your habitat's `tools/` directory. You can customize or delete them.

### Standard Tools (Built-in)

These tools are always registered (unless `skipBuiltinTools` is set):

| Tool                            | Description                                         |
| ------------------------------- | --------------------------------------------------- |
| `read_file`                     | Read a file (sandboxed to work dir and agent roots) |
| `write_file`                    | Write a file (creates parent dirs)                  |
| `list_directory`                | List directory contents                             |
| `ripgrep`                       | Search file contents with regex                     |
| `current_time`                  | Current date/time with optional timezone            |
| `wget`                          | Fetch a URL (raw response)                          |
| `markify`                       | Fetch URL and convert to markdown                   |
| `parse_feed`                    | Parse RSS/Atom/XML feeds                            |
| `agents_list/add/update/remove` | Manage registered agents                            |
| `agent_clone`                   | Clone a git repo and register it                    |
| `agent_ask`                     | Delegate a question to a sub-agent                  |
| `agent_logs`                    | Read agent log files                                |
| `agent_status`                  | Agent health check                                  |
| `sessions_list/show/messages`   | View session history                                |

## Interfaces

### CLI REPL

The default interface. Starts an interactive conversation with streaming responses, tool use, and context management.

```bash
umwelten habitat -p google -m gemini-3-flash-preview
```

### Telegram Bot

A long-running Telegram bot that shares the same habitat environment.

```bash
umwelten habitat telegram --token $TELEGRAM_BOT_TOKEN -p google -m gemini-3-flash-preview
```

Features:

- Multi-turn conversations per chat
- Media support (photos, documents, audio, video)
- `/start`, `/reset`, `/help` commands
- Session-specific media storage and transcripts
- Markdown formatting

### Using an Existing Work Directory

Point at any existing habitat work directory:

```bash
# Use a Jeeves-style work dir
umwelten habitat -w ~/path/to/jeeves-data -p google -m gemini-3-flash-preview

# Use the example jeeves-bot data dir
umwelten habitat -w examples/jeeves-bot/jeeves-bot-data-dir -p google -m gemini-3-flash-preview
```

Any directory with `config.json` + `STIMULUS.md` is a valid habitat.

## Environment Variables

| Variable               | Default                 | Description               |
| ---------------------- | ----------------------- | ------------------------- |
| `HABITAT_WORK_DIR`     | `~/habitats`            | Work directory            |
| `HABITAT_SESSIONS_DIR` | `~/habitats-sessions`   | Sessions directory        |
| `HABITAT_CONFIG_PATH`  | `{workDir}/config.json` | Config file override      |
| `HABITAT_PROVIDER`     | (none)                  | Default LLM provider      |
| `HABITAT_MODEL`        | (none)                  | Default LLM model         |
| `TELEGRAM_BOT_TOKEN`   | (none)                  | Telegram bot token        |
| `TAVILY_API_KEY`       | (none)                  | Tavily web search API key |

The env prefix defaults to `HABITAT` but can be changed with `--env-prefix`. For example, `--env-prefix JEEVES` reads `JEEVES_WORK_DIR`, `JEEVES_PROVIDER`, etc.

## Programmatic Usage

```typescript
import { Habitat } from "umwelten/habitat";

// Create a habitat
const habitat = await Habitat.create({
  workDir: "~/my-habitat",
  defaultWorkDirName: "habitats",
  defaultSessionsDirName: "habitats-sessions",
});

// Onboard if needed
if (!(await habitat.isOnboarded())) {
  await habitat.onboard();
}

// Create an interaction
const { interaction, sessionId } = await habitat.createInteraction({
  modelDetails: { name: "gemini-3-flash-preview", provider: "google" },
  sessionType: "cli",
});

// Chat
interaction.addMessage({ role: "user", content: "Hello!" });
const response = await interaction.streamText();
```

### Custom Tools

Register tools programmatically when creating a habitat:

```typescript
const habitat = await Habitat.create({
  registerCustomTools: async (habitat) => {
    habitat.addTool("my_tool", myTool);
    habitat.addTool("my_factory_tool", createMyTool(habitat));
  },
});
```

## Migration from Jeeves

If you've been using Jeeves with a `~/.jeeves` work directory, you can use it directly with the habitat command:

```bash
# Point at your existing Jeeves data
umwelten habitat -w ~/.jeeves --env-prefix JEEVES -p google -m gemini-3-flash-preview

# Or just copy it to ~/habitats
cp -r ~/.jeeves ~/habitats
umwelten habitat -p google -m gemini-3-flash-preview
```

The work directory format is identical. The only difference is that tools like `search` and `run_bash` now live in `tools/` as TOOL.md + handler.ts instead of being hardcoded. Run `/onboard` to seed them if they're missing.

## Architecture

```
Habitat.create()
  |
  +-- resolveWorkDir (~/habitats, env, or explicit)
  +-- loadConfig (config.json)
  +-- register standard tool sets (file, time, url, agent, session, ...)
  +-- loadToolsFromDirectory(workDir, "tools", habitat)  <-- factory context
  +-- registerCustomTools callback
  |
  +-- getStimulus()
  |     +-- loadStimulusOptionsFromWorkDir (STIMULUS.md, AGENT.md, memory)
  |     +-- register all tools into stimulus
  |     +-- load skills (local + git)
  |
  +-- createInteraction()
        +-- Interaction(modelDetails, stimulus, session)
        +-- wire transcript persistence
```

### Key Files

| File                           | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `src/habitat/habitat.ts`       | Main Habitat class with `create()` factory  |
| `src/habitat/config.ts`        | Directory resolution, config load/save      |
| `src/habitat/types.ts`         | HabitatConfig, HabitatOptions, AgentEntry   |
| `src/habitat/onboard.ts`       | First-run setup, builtin tool seeding       |
| `src/habitat/tool-sets.ts`     | Standard tool set registration              |
| `src/stimulus/tools/loader.ts` | TOOL.md + handler loader (factory support)  |
| `src/habitat/builtin-tools/`   | Reference tool implementations              |
| `src/cli/habitat.ts`           | CLI command with REPL + telegram subcommand |

## Habitat Bridge System

The **Habitat Bridge System** is an optional runtime for managed agents that need isolated execution. It follows a three-phase design: **Create** (clone + register agent), **Start** (launch container), **Inspect** (LLM uses tools to look inside).

### Bridge vs Sub-Agent

| Feature           | HabitatAgent (Sub-Agent) | BridgeAgent (Container)       |
| ----------------- | ------------------------ | ----------------------------- |
| **Location**      | Host filesystem          | Inside Dagger container       |
| **Communication** | Direct function calls    | MCP over HTTP                 |
| **Provisioning**  | Manual (pre-configured)  | Saved provisioning or bare node:20 |
| **Logging**       | Console output           | Persistent log files          |
| **Use case**      | Local project management | Remote repo execution         |

### Three Phases

1. **Create** — `agent_clone(gitUrl, name)`: Clone the repo into `agents/<id>/repo` and register the agent. Nothing runs.
2. **Start** — `bridge_start(agentId)`: Start container with saved provisioning (or bare `node:20`). Returns when MCP server is reachable. No analysis, no iteration loop.
3. **Inspect** — LLM uses `agent_status`, `agent_logs`, `bridge_ls`, `bridge_read`, `bridge_exec` to look inside the container and iterate.

### Starting Bridge Agents

```typescript
const habitat = await Habitat.create();

// Start a bridge for an agent with gitRemote configured
const bridgeAgent = await habitat.startBridge("frontend-app");

// Get the client to interact with the container
const client = await bridgeAgent.getClient();

// Use the client
const files = await client.listDirectory("/workspace");
const result = await client.execute("npm test");

// Check health
const health = await client.health();

// When done
await bridgeAgent.destroy();
```

### Multiple Agents

```typescript
// Start multiple bridges
const frontend = await habitat.startBridge("frontend-app");
const backend = await habitat.startBridge("backend-api");

// Each gets a unique port (10000-20000)
console.log("Frontend port:", frontend.getPort());
console.log("Backend port:", backend.getPort());

// List all running agents
const agentIds = habitat.listBridgeAgents();
console.log("Running agents:", agentIds);

// Stop specific agent
await habitat.destroyBridgeAgent("frontend-app");
```

### Saved Provisioning

After the LLM inspects and configures an agent, the config in `config.json` includes provisioning data so subsequent starts build the container with all packages immediately:

```json
{
  "id": "trmnl-image-agent",
  "gitRemote": "https://github.com/The-Focus-AI/trmnl-image-agent",
  "bridgeProvisioning": {
    "baseImage": "node:20",
    "aptPackages": ["jq", "chromium", "curl", "python3", "imagemagick"],
    "setupCommands": ["curl -fsSL https://claude.ai/install.sh | bash"],
    "detectedTools": ["jq", "chrome", "claude-code", "curl", "python", "imagemagick"],
    "projectType": "shell",
    "skillRepos": [],
    "analyzedAt": "2026-02-19T00:50:00.000Z"
  }
}
```

### Port Management

- Ports allocated from range 10000-20000
- Each agent gets a unique port
- Ports released with a 5-second delay after container destruction

### When to Use Bridge Agents

Use Bridge Agents when you need:

- **Remote repository execution**: Work with repos that don't exist on the host
- **Isolated environments**: Each agent has its own container with specific dependencies
- **Long-running processes**: Containers stay alive for ongoing work
- **Persistent logs**: Track agent activity across restarts

For local project management, use [Habitat Agents](./habitat-agents.md) instead.

### Complete Walkthrough

See the [Habitat Bridge Walkthrough](../walkthroughs/habitat-bridge-walkthrough.md) for a complete guide including MCP tools, curl examples, and the TypeScript client.

## Related

- [Habitat Agents](./habitat-agents.md) — Sub-agents that manage specific projects (local filesystem)
- [Habitat Testing](./habitat-testing.md) — Automated and manual test procedures
- [Telegram Bot](./telegram-bot.md) — Standalone Telegram adapter docs
- [Tool Calling](./tool-calling.md) — How tools work in Umwelten
- [Session Management](./session-management.md) — Sessions and transcripts
