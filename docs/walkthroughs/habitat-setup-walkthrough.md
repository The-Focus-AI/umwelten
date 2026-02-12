# Setting Up an Agent in Habitat

A step-by-step walkthrough for creating a Habitat from scratch, customizing its persona, adding tools, registering sub-agents, and running it as both a CLI REPL and a Telegram bot.

**Time Required:** 15-20 minutes
**Prerequisites:** Node.js 20+, pnpm, a Google AI API key (or any supported provider)
**Optional:** Telegram bot token, Tavily API key, Dagger installed

## What We'll Build

By the end of this walkthrough you'll have:

1. A working habitat at `~/habitats` with a custom persona
2. Tools loaded from the work directory (including web search)
3. A registered sub-agent for a git project
4. A running CLI REPL and optionally a Telegram bot
5. Understanding of how all the pieces fit together

## Step 1: Install Umwelten

```bash
# Clone and install
git clone https://github.com/The-Focus-AI/umwelten.git
cd umwelten
pnpm install

# Verify it works
pnpm run cli --help
```

You should see the list of commands including `habitat`.

## Step 2: Set Up Environment

Create a `.env` file (or export these in your shell):

```bash
# Required: at least one provider
export GOOGLE_GENERATIVE_AI_API_KEY="your-google-api-key"

# Optional: for web search
export TAVILY_API_KEY="your-tavily-key"

# Optional: for Telegram
export TELEGRAM_BOT_TOKEN="your-telegram-token"
```

## Step 3: First Run — Automatic Onboarding

```bash
pnpm run cli habitat -p google -m gemini-3-flash-preview
```

On first run, the habitat detects that `~/habitats` doesn't exist and runs onboarding:

```
[habitat] Work directory not set up. Running onboarding...
[habitat] Created: config.json, STIMULUS.md (minimal), skills/, tools/, tools/search/, tools/run_bash/
[habitat] Work directory: /Users/you/habitats
[habitat] google/gemini-3-flash-preview
[habitat] Work dir: /Users/you/habitats
[habitat] 16 tools, 0 skills, 0 agents
[habitat] Session: cli-1707580000000
Habitat agent ready. Type a message and press Enter.
Commands: /exit, /agents, /skills, /tools, /context, /onboard, /compact [strategy], /compact help
```

Type `/tools` to see all registered tools:

```
You: /tools
Tools (16): read_file, write_file, list_directory, ripgrep, current_time, wget, markify, parse_feed, agents_list, agents_add, agents_update, agents_remove, agent_clone, agent_ask, agent_logs, agent_status
```

If you have `TAVILY_API_KEY` set and the search tool handler loaded, you'll also see `search` in the list.

Type `/exit` to quit for now.

## Step 4: Explore the Work Directory

Let's see what onboarding created:

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

## Step 5: Customize Your Persona

Edit `~/habitats/STIMULUS.md` to give your agent a personality. Replace the minimal default with something like:

```markdown
---
role: "research assistant"
objective: "Help the user research topics, manage projects, and stay organized"
instructions:
  - "When asked to research something, use the search tool to find current information"
  - "When managing projects, use agent tools to monitor their status"
  - "Keep the user's memories.md and facts.md up to date"
  - "Be concise but thorough in your responses"
maxToolSteps: 15
---

# Research Assistant

You are a research assistant that helps with:

1. **Web research** — Use the `search` tool to look up current information
2. **Project management** — Monitor and interact with registered sub-agents
3. **File management** — Read, write, and organize files in the work directory
4. **Memory** — Maintain memories.md with things the user tells you, and facts.md with a summary

## Memory Files

Maintain these files in the work directory:

- **memories.md** — Running list of things the user shared, with dates
- **facts.md** — Concise summary of what you know about the user
```

## Step 6: Configure Model Defaults

Edit `~/habitats/config.json` to set default provider and model so you don't need `--provider` and `--model` every time:

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

Now you can start with just:

```bash
pnpm run cli habitat
```

## Step 7: Test the REPL

```bash
pnpm run cli habitat
```

Try a few things:

```
You: What tools do you have available?

Habitat: I have the following tools available:
- **read_file** / **write_file** / **list_directory** — File operations
- **ripgrep** — Search file contents
- **search** — Web search via Tavily
- **agent_clone** / **agent_ask** / **agent_logs** / **agent_status** — Agent management
- **current_time** — Get current time
- **wget** / **markify** / **parse_feed** — Web content tools
...

You: Search for the latest news about TypeScript 5.7

Habitat: [Uses search tool]
Here are the latest findings about TypeScript 5.7:
...

You: Remember that I prefer using pnpm over npm

Habitat: I'll remember that! Let me note it in your memories file.
[Uses write_file to update memories.md]
```

Check that your memory was saved:

```
You: /exit
```

```bash
cat ~/habitats/memories.md
```

## Step 8: Register a Sub-Agent

Sub-agents are external projects that your habitat can monitor and interact with. Let's clone a project:

```bash
pnpm run cli habitat
```

```
You: Clone https://github.com/The-Focus-AI/trmnl-image-agent and register it as an agent called "TRMNL Image Agent"

Habitat: [Uses agent_clone tool]
Cloned to /Users/you/habitats/repos/trmnl-image-agent and registered agent.

You: /agents
Agents (1):
  trmnl-image-agent — TRMNL Image Agent (/Users/you/habitats/repos/trmnl-image-agent)
```

Now you can delegate questions to the sub-agent:

```
You: Ask the trmnl-image-agent to explore its project and tell me what it does

Habitat: [Uses agent_ask tool — the sub-agent reads README, package.json, CLAUDE.md]
The TRMNL Image Agent is an automated dashboard image generator for TRMNL e-ink displays.
It uses Chrome/Puppeteer to render HTML templates and push them to the TRMNL API...
```

The sub-agent has persistent memory — it remembers what it learned about the project across conversations.

## Step 9: Add a Custom Tool

Let's create a tool that checks if a URL is reachable:

```bash
mkdir -p ~/habitats/tools/ping_url
```

Create `~/habitats/tools/ping_url/TOOL.md`:

```markdown
---
name: ping_url
description: "Check if a URL is reachable. Returns status code and response time."
---

# Ping URL

Checks if a URL is reachable by making an HTTP HEAD request.
Returns the HTTP status code and response time in milliseconds.
```

Create `~/habitats/tools/ping_url/handler.ts`:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export default tool({
  description: 'Check if a URL is reachable. Returns status code and response time.',
  inputSchema: z.object({
    url: z.string().url().describe('The URL to check'),
  }),
  execute: async ({ url }) => {
    const start = Date.now();
    try {
      const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
      return {
        url,
        status: response.status,
        ok: response.ok,
        responseTimeMs: Date.now() - start,
      };
    } catch (err) {
      return {
        url,
        error: err instanceof Error ? err.message : String(err),
        responseTimeMs: Date.now() - start,
      };
    }
  },
});
```

Restart the habitat and check:

```bash
pnpm run cli habitat
```

```
You: /tools
Tools (17): ..., ping_url

You: Is github.com up?

Habitat: [Uses ping_url tool]
Yes! github.com returned HTTP 200 in 145ms.
```

## Step 10: Add a Factory Tool

Factory tools receive the habitat context, giving them access to `workDir`, `getAgent()`, and `getAllowedRoots()`. This is how `run_bash` works — it needs to know about registered agents.

Create `~/habitats/tools/project_info/TOOL.md`:

```markdown
---
name: project_info
description: "Get info about a registered agent's project (package.json name, version, description)"
---
```

Create `~/habitats/tools/project_info/handler.ts`:

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool } from 'ai';

// Factory function — receives habitat context
export default function(ctx: { getAgent: (id: string) => any }): Tool {
  return tool({
    description: 'Get package.json info for a registered agent project',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID to look up'),
    }),
    execute: async ({ agentId }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent) return { error: `Agent not found: ${agentId}` };

      try {
        const pkg = JSON.parse(
          await readFile(join(agent.projectPath, 'package.json'), 'utf-8')
        );
        return {
          name: pkg.name,
          version: pkg.version,
          description: pkg.description,
          scripts: Object.keys(pkg.scripts || {}),
        };
      } catch {
        return { error: 'No package.json found' };
      }
    },
  });
}
```

Because the handler exports a **function** (not a Tool with `.execute`), the loader detects it as a factory and calls it with the habitat as context.

## Step 11: Add Skills from Git

Skills are reusable prompt templates that get loaded as tools. Add a git-based skill to your config:

Edit `~/habitats/config.json` and add to the `skillsFromGit` array:

```json
{
  "skillsFromGit": ["The-Focus-AI/umwelten-skills"]
}
```

The skills repo will be cloned into `~/habitats/repos/` on the next habitat start.

## Step 12: Run as a Telegram Bot

If you have a Telegram bot token:

```bash
# Set the token
export TELEGRAM_BOT_TOKEN="123456789:AbCdefGhIJKlmNoPQRsTUVwxyZ"

# Start the bot
pnpm run cli habitat telegram -p google -m gemini-3-flash-preview
```

The bot uses the same habitat — same tools, skills, agents, persona:

```
[habitat] google/gemini-3-flash-preview
[habitat] Work dir: /Users/you/habitats
[habitat] 17 tools, 0 skills, 1 agents
[habitat] Telegram bot starting...
```

Now message your bot on Telegram. It has access to everything: search, file tools, agents, memory.

Telegram sessions are separate from CLI sessions — each chat gets its own session directory under `~/habitats-sessions/telegram-{chatId}/`.

### Getting a Bot Token

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Save the token it gives you

## Step 13: Use a Different Work Directory

You can point at any existing work directory:

```bash
# Use a Jeeves-style data dir
pnpm run cli habitat -w examples/jeeves-bot/jeeves-bot-data-dir -p google -m gemini-3-flash-preview

# Use a custom location
pnpm run cli habitat -w ~/projects/my-assistant
```

Any directory with `config.json` + `STIMULUS.md` works. If the directory doesn't have them yet, onboarding creates them automatically.

## Step 14: Using Environment Variables

Instead of passing flags every time, set environment variables:

```bash
export HABITAT_WORK_DIR=~/habitats
export HABITAT_PROVIDER=google
export HABITAT_MODEL=gemini-3-flash-preview
```

Now just run:

```bash
pnpm run cli habitat
```

You can change the prefix with `--env-prefix`:

```bash
# Uses MYBOT_WORK_DIR, MYBOT_PROVIDER, etc.
pnpm run cli habitat --env-prefix MYBOT
```

## Putting It All Together

Here's the complete flow of what happens when you start a habitat:

```
1. Habitat.create()
   - Resolve work dir (~/habitats by default)
   - Load config.json
   - Register 14+ standard tools (file, agent, session, time, url)
   - Load tools/ directory (search, run_bash, ping_url, ...)
     - Direct exports → registered as-is
     - Factory exports → called with habitat context, then registered
   - Call registerCustomTools (if any)

2. Build Stimulus
   - Load STIMULUS.md (persona, role, instructions)
   - Load AGENT.md (extra context)
   - Load memory files (memories.md, facts.md)
   - Register all tools into the stimulus
   - Load skills (local + git)

3. Start Interface
   - CLI REPL: readline loop with streaming responses
   - Telegram: grammY bot with long-polling
   - Both share the same habitat, tools, and stimulus
```

## What's Next

- **More tools**: Create any tool by adding a subdirectory to `tools/` with `TOOL.md` + `handler.ts`
- **More agents**: Clone projects with `agent_clone`, then delegate with `agent_ask`
- **Skills**: Add reusable prompt templates via local `skills/` or `skillsFromGit`
- **Context management**: Use `/compact` in the REPL when context gets large
- **Custom interfaces**: Build your own using `Habitat.create()` + `habitat.createInteraction()` programmatically

## Troubleshooting

### "No model configured"

Set `--provider` and `--model`, or add `defaultProvider`/`defaultModel` to `config.json`, or set `HABITAT_PROVIDER`/`HABITAT_MODEL` env vars.

### Tool not loading

Check that the tool directory has a valid `TOOL.md` with `description` in frontmatter, and that `handler.ts` default-exports either a Tool or a factory function.

### Search tool says "TAVILY_API_KEY is not set"

Set the `TAVILY_API_KEY` environment variable. Get a key at [app.tavily.com](https://app.tavily.com).

### Agent not found

Make sure the agent is registered in `config.json`. Use `/agents` to see registered agents, or clone one with the `agent_clone` tool.

### Onboarding didn't seed tools

Run `/onboard` in the REPL. If the `tools/` directory already exists, existing tools are left untouched. Only new tool subdirectories (like `search/`, `run_bash/`) are added if they don't already exist.
