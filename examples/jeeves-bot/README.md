# Jeeves Bot

A butler-style assistant that runs on the CLI and over Telegram. It can read/write files, list directories, manage agents (projects with Claude Code / Cursor data), and list or inspect external interactions (Claude Code, Cursor conversation history) for those agents.

## Features

- **File operations**: Read file, write file (creates parent directories), list directory. By default paths are in the Jeeves work directory; optional `agentId` targets an agent’s project. Paths are sandboxed to the work dir and configured agent project roots.
- **Agent management**: List, add, update, and remove agents. Each agent has an id, name, project path (e.g. git clone path), optional git remote, and optional secret key references.
- **External interactions**: For each agent's project path, list external interactions (Claude Code, Cursor), show summary, get messages, and get token/cost/duration stats (read-only).
- **Current time**: Returns the current date and time (ISO and locale string). Optional IANA timezone (e.g. `America/New_York`) for “what time is it in X?”
- **Web search**: Optional [Tavily](https://tavily.com) search tool. Set `TAVILY_API_KEY` in `.env` to enable; the bot can then look up current information, facts, or recent events when asked.
- **wget**: Fetch a URL and return raw response (status, content-type, body). Large content (>500 lines or >1KB) is automatically saved to the session directory and a file path is returned instead. From main umwelten; useful for APIs or plain text.
- **markify**: Fetch a URL and convert the page to readable markdown. Uses built-in conversion (no config). Large content (>500 lines or >1KB) is automatically saved to the session directory. Optionally set `MARKIFY_URL` to use the Markify service instead. From main umwelten.
- **parse_feed**: Fetch a URL and parse it as XML, RSS, or Atom. Returns feed metadata and a list of items (title, link, description, pubDate). From main umwelten.
- **run_bash**: Execute bash commands in Dagger-managed containers with experience-based state management. Supports chaining commands by maintaining isolated experience directories. Changes are isolated until explicitly committed.

## Setup (env)

Copy `env.example` to `.env` in this directory (or export the variables in your shell):

```bash
cd examples/jeeves-bot
cp env.example .env
# Edit .env and set at least JEEVES_WORK_DIR and any API keys / Telegram token.
```

Load it before running (e.g. `set -a && source .env && set +a`, or use [dotenv](https://www.npmjs.com/package/dotenv)/[dotenvx](https://github.com/dotenvx/dotenvx)). For a quick local test without touching `~/.jeeves`, see [Testing the work directory](#testing-the-work-directory).

- **JEEVES_WORK_DIR**: Main work folder for agent config, memories, facts, and journal. Default if unset: `~/.jeeves`. Use an absolute path (or path relative to the current working directory).
- **JEEVES_SESSIONS_DIR**: Sessions directory for storing all interactions, media files, and downloaded content. Each session gets its own subdirectory. Default if unset: `~/.jeeves-sessions`. Media from Telegram, large downloads from `wget` or `markify` go here.
- **JEEVES_CONFIG_PATH**: Optional. Override path to the config file; if unset, config is `<JEEVES_WORK_DIR>/config.json`.

**AGENT.md**: If `<JEEVES_WORK_DIR>/AGENT.md` exists, it is loaded on startup and appended to the bot’s context. Use it for extra personality or project-specific instructions.

- **TELEGRAM_BOT_TOKEN**, **JEEVES_PROVIDER**, **JEEVES_MODEL**, and provider API keys – see `env.example`.
- **TAVILY_API_KEY** (optional): Enables the web search tool. Get a key at [app.tavily.com](https://app.tavily.com); without it, the search tool will report that the key is missing.

## Work directory layout

Everything the bot needs (and can edit) lives under the work directory (`JEEVES_WORK_DIR`):

| Path | Purpose |
|------|---------|
| **config.json** | Agents and optional `skillsDirs`, `skillsFromGit`, `toolsDir`, `stimulusFile`. |
| **AGENT.md** | Extra personality or project-specific instructions (loaded after main prompt). |
| **STIMULUS.md** or **prompts/** | Main persona: role, objective, instructions, system context. Single file with YAML frontmatter, or multiple files in `prompts/` (e.g. `prompts/main.md`). If missing, a built-in default is used. |
| **tools/** | Optional. Each subdirectory with `TOOL.md` (and optional `handler.ts` or `handler.js`) defines one tool. Handlers default-export a Vercel AI SDK Tool. |
| **skills/** | Optional. Each subdirectory with `SKILL.md` is a skill (Agent Skills spec). Config can also list `skillsFromGit` to load skills from Git. |
| **memories.md**, **facts.md**, **private journal.md** | Maintained by the bot (see below). |

The bot's file tools are sandboxed to the work directory and configured agent projects, so the bot can read and edit STIMULUS.md, AGENT.md, config.json, tools, and skills in the work dir. Changes to prompts, tools, or skills take effect on the next session (or restart).

### Onboarding

On first run (or when the work dir is missing **config.json** or **STIMULUS.md**), the CLI runs an **onboarding** step that creates:

- **config.json** (with `agents: []`, `skillsDirs: ["./skills"]`, `toolsDir: "tools"`) if not present
- **STIMULUS.md** (copy of the example persona from the package) if not present
- **skills/** and **tools/** directories if not present

So everything the bot needs lives in the work dir. You can run onboarding again anytime with **`/onboard`** in the REPL to recreate any missing files or directories (existing files are left unchanged).

## Butler persona and learning (STIMULUS.md)

The main persona is loaded from the **work directory**: `<JEEVES_WORK_DIR>/STIMULUS.md` (or `config.stimulusFile`, or `prompts/main.md` / `prompts/*.md`). If none exist, a built-in default is used. You can copy `examples/jeeves-bot/JEEVES_PROMPT.md` to your work dir as `STIMULUS.md` to customize. STIMULUS.md can use YAML frontmatter for `role`, `objective`, `instructions` (array or string), and `maxToolSteps`; the body is the system context (persona and file-maintenance instructions).

The persona instructs the bot to maintain three files in the work directory (paths relative to work dir, no `agentId`):

| File | Purpose |
|------|---------|
| **memories.md** | Running list of specific things the user said about themselves (with date). Updated whenever something worth remembering is shared. |
| **facts.md** | Short, scannable summary of what the bot knows about the person (work, preferences, people, projects). Updated after adding memories or when the summary is outdated. |
| **private journal.md** | Daily reflections on interactions so the bot can serve the user better later. One section per day; not shared unless the user explicitly asks. |

AGENT.md (in the work dir) is loaded after the main prompt and can override or add to this behavior.

## Config

- **Config file**: `<JEEVES_WORK_DIR>/config.json` (or `JEEVES_CONFIG_PATH` if set).
- **Shape**: `{ "agents": [ ... ], "skillsDirs": ["./skills"], "skillsFromGit": ["owner/repo"], "toolsDir": "tools", "stimulusFile": "STIMULUS.md" }`
  - **agents** (required): Array of agent entries (id, name, projectPath, optional gitRemote, secrets, commands).
  - **skillsDirs** (optional): Paths relative to work dir; each dir contains subdirs with `SKILL.md`. Default `["./skills"]` if present.
  - **skillsFromGit** (optional): Git repo URLs or `owner/repo` for skills (cloned into cache).
  - **toolsDir** (optional): Path relative to work dir for tool subdirs (each with TOOL.md and optional handler). Default `"tools"`.
  - **stimulusFile** (optional): Path relative to work dir for main prompt file (e.g. `"STIMULUS.md"` or `"prompts/main.md"`).
- **Secrets**: `secrets` are references only (e.g. env var names). Jeeves does not store secret values; keep actual secrets in the environment or a secrets manager.
- **Commands**: optional `commands` map (e.g. `cli`, `run`) for how to interact with that habitat. Not used by tools yet; reserved for future “spin up” / run behavior.

## Concepts (Habitat model)

- **Habitat**: Agent + tools + interactions + memory + experiences. Jeeves runs in one habitat; each configured **agent** is a reference to another habitat (codebase, git, secrets, optional `commands`).
- **Interactions**: Conversations (Jeeves’ own or external). **External interactions** are read-only histories from Claude Code / Cursor for an agent’s project.
- **Experiences**: Isolated execution states (e.g. `run_bash`), used to chain commands and optionally commit changes back.
- **Memory**: Work directory (memories, facts, journal) and agent config.

## Path and safety rules

- **Default (no `agentId`)**: Paths are relative to the **Jeeves work directory** (`JEEVES_WORK_DIR` or `~/.jeeves`). Use `list_directory` with path `"."` to list the work dir; read/write files there (e.g. `notes.md`, `scratch.txt`).
- **With `agentId`**: Paths are relative to that agent’s `projectPath`. Use this when the user asks about a specific agent or project.
- File tools only allow paths under the work directory or under a configured agent project. Requests outside those roots return `OUTSIDE_ALLOWED_PATH`. No agents need to be configured to use the work directory.

## Testing the work directory

Use a local directory to verify prompts, tools, and skills load from the work dir without touching `~/.jeeves`. **Onboarding runs automatically** on first run: if the work dir is missing config.json or STIMULUS.md, the CLI creates them (plus skills/ and tools/).

### 1. Create a test work directory

From the **repository root**:

```bash
# Create work dir (gitignored as jeeves-bot-data-dir)
mkdir -p examples/jeeves-bot/jeeves-bot-data-dir
cd examples/jeeves-bot
```

(You can skip manually creating config.json and STIMULUS.md; onboarding will create them on first run.)

### 2. Set env and run the CLI

From **examples/jeeves-bot** (with `.env` that has `GOOGLE_GENERATIVE_AI_API_KEY` or your provider key and `JEEVES_WORK_DIR`):

```bash
# Use the test work dir
export JEEVES_WORK_DIR="$(pwd)/jeeves-bot-data-dir"

# One-shot: list work dir (bot will list . and show config.json, STIMULUS.md, etc.)
pnpm run cli -- "list directory"

# Or interactive REPL
pnpm run cli
```

From the **repository root** (no need to cd into jeeves-bot):

```bash
export JEEVES_WORK_DIR="$(pwd)/examples/jeeves-bot/jeeves-bot-data-dir"
# Load provider key if not in env
export GOOGLE_GENERATIVE_AI_API_KEY="your-key"

pnpm exec tsx examples/jeeves-bot/cli.ts "list directory"
pnpm exec tsx examples/jeeves-bot/cli.ts "what time is it?"
```

### 3. Optional: test skills and tools from the work dir

**Skills** — add a local skill:

```bash
mkdir -p jeeves-bot-data-dir/skills/hello-skill
cat > jeeves-bot-data-dir/skills/hello-skill/SKILL.md << 'EOF'
---
name: hello-skill
description: Say hello and remind the user of this skill. Use when the user says hello or asks who you are.
---
When activated, greet the user and mention you have a custom skill from the work directory.
EOF
```

Ensure `config.json` has skills loaded from the work dir (default when `skills/` exists):

```bash
cat jeeves-bot-data-dir/config.json
# If you want to be explicit: {"agents":[],"skillsDirs":["./skills"]}
```

Restart the CLI and ask: "Say hello" or "What skills do you have?" — the bot should list and use `hello-skill`.

**Tools** — add a work-dir tool (optional; requires a handler that exports a Vercel AI SDK `Tool`):

```bash
mkdir -p jeeves-bot-data-dir/tools/echo-tool
cat > jeeves-bot-data-dir/tools/echo-tool/TOOL.md << 'EOF'
---
name: echo_tool
description: Echo the user message back. Use when the user asks to echo or repeat something.
EOF
# Handler would go in tools/echo-tool/handler.ts (default export a tool from "ai").
# Without a handler, this tool is not loaded; add handler.ts to test.
```

### 4. Verify what the bot sees

- "List directory" (no `agentId`) — should show the work dir: `config.json`, `STIMULUS.md`, `skills/`, etc.
- "What's in config.json?" — bot can read and summarize it.
- "What time is it?" — uses built-in `current_time` tool.

Use `jeeves-bot-data-dir` for local testing; switch `JEEVES_WORK_DIR` back to `~/.jeeves` or another path for normal use.

## CLI

By default the CLI uses **streaming**: you see tool calls, tool results, and reasoning/thinking as they happen, then the final reply. Use `--quiet` / `-q` to show only the final reply.

**From the `jeeves-bot` directory** (after `cd examples/jeeves-bot` and setting up `.env`):

```bash
# REPL (interactive)
pnpm run cli

# One-shot
pnpm run cli -- "list agents"

# Quiet: only print final reply (no tool calls, results, or reasoning)
pnpm run cli -- -q "list agents"
pnpm run cli -- --quiet

# With provider/model
pnpm run cli -- --provider google --model gemini-2.0-flash "list agents"
```

Or with `tsx` directly (works from repo root or from `jeeves-bot`):

```bash
pnpm exec tsx cli.ts
pnpm exec tsx cli.ts "list agents"
```

### Commands

- **`/exit`** or **`/quit`** – Exit the REPL.
- **`/onboard`** – Run the onboarding wizard again: ensure work dir has config.json, STIMULUS.md, skills/, and tools/ (creates only what’s missing).
- **`/time`** – Show current date and time (full format).
- **`/context`** – Print current context size.
- **`/checkpoint`** – Mark the current point as the start of this thread. Use before a long run so you can compact later.
- **`/compact`** – Condense the segment from the last checkpoint (or from the start) to the end of the last assistant reply into a short summary, using the default strategy (`through-line-and-facts`). Uses the same model to summarize; reduces context size.
- **`/compact <strategyId>`** – Same but with a specific strategy (e.g. `truncate`).
- **`/compact help`** – List compaction strategies.

### Context and compaction

After each reply the CLI prints context size (e.g. `[Context: 12 messages, ~8.2K tokens]`). Use `/checkpoint` before starting a long task, then `/compact` when done to condense that segment into a summary.

**From the repository root:**

```bash
pnpm exec tsx examples/jeeves-bot/cli.ts
pnpm exec tsx examples/jeeves-bot/cli.ts "list agents"
```

## Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather) and get the token.
2. Set `TELEGRAM_BOT_TOKEN` in `.env` or pass `--token`.

**From the `jeeves-bot` directory:**

```bash
pnpm run telegram
# or with options:
pnpm run telegram -- --provider google --model gemini-2.0-flash
```

**From the repository root:**

```bash
TELEGRAM_BOT_TOKEN=your_token pnpm exec tsx examples/jeeves-bot/telegram.ts
pnpm exec tsx examples/jeeves-bot/telegram.ts --token your_token --provider google --model gemini-2.0-flash
```

Standard commands: `/start`, `/reset`, `/help`. To list agents, send a message like “list agents” and the bot will use the tools.

### Media Files

Media files (photos, documents, audio, video) sent to the bot are stored in session-specific directories:
```
{JEEVES_SESSIONS_DIR}/telegram-{chatId}/media/
```

Files are named using Telegram's `file_unique_id` with appropriate extensions. The directory is created automatically when the first media file is received.

**Note**: The sessions directory (`JEEVES_SESSIONS_DIR`) is configurable in `.env` (default: `~/.jeeves-sessions`). Each Telegram chat gets its own session directory, keeping media files organized per conversation.

### CLI sessions

Each CLI run (one-shot or REPL) creates a session under `JEEVES_SESSIONS_DIR` (e.g. `cli-{timestamp}-{id}`). The session directory contains `meta.json` (sessionId, type, created, lastUsed, `metadata.firstPrompt`, `metadata.messageCount`) and **`transcript.jsonl`** — Claude-style JSONL with **full tool call history**:

- **User messages**: `type: "user"` with text content
- **Assistant messages**: `type: "assistant"` with text or `tool_use` content blocks
- **Tool results**: `type: "user"` with `tool_result` content blocks (tool call ID, output, is_error)

**Transcript format (JSONL)** — One JSON object per line, Claude-style. Each entry has `type`, `uuid`, `timestamp`, and `message: { role, content }`. Tool calls use `content: [{ "type": "tool_use", "id", "name", "input" }]`; tool results use `content: [{ "type": "tool_result", "tool_use_id", "content", "is_error" }]`. Full tool call history (inputs and outputs) is persisted so `sessions_show`, `sessions_messages`, and `sessions_stats` reflect the complete interaction.

Session tools use **session-parser** (`parseSessionFile`, `summarizeSession`, `extractConversation`, `extractTextContent`) and mirror **external-interactions** (list, show, messages, stats, read_file):

- **`sessions_list`**: List sessions (sessionId, shortId, firstPrompt, messageCount, created, modified).
- **`sessions_show`**: Summary for a session (full or short prefix match); tokens/cost when present.
- **`sessions_messages`**: User/assistant messages (interleaved by timestamp).
- **`sessions_stats`**: Message counts, token usage, cost, duration (same shape as external-interactions).
- **`sessions_read_file`**: Read any file in a session dir (e.g. `transcript.jsonl`, media).

Interactions are stored directly to disk and reloaded from disk. Run `pnpm run verify-sessions` to confirm store-and-reload behavior.

## run_bash: Dagger Container Execution

The `run_bash` tool executes bash commands in isolated Dagger-managed containers with experience-based state management. This allows you to chain commands together while keeping changes isolated from your original files until you're ready to commit them.

### Experience-Based State Management

Each `run_bash` call can be part of an **experience** that maintains state between commands:

- **Isolated directories**: Each experience gets its own directory in a sibling folder `<parent>/<workDirName>-dagger-experiences/<experienceId>/` (outside the work directory to avoid circular copies)
- **Stateful chaining**: Commands in the same experience see changes from previous commands
- **Safe experimentation**: Changes don't affect original files until you commit
- **Multiple experiences**: Run concurrent isolated experiences

### Experience Actions

- **`start`**: Create a new experience (copies source directory to experience)
- **`continue`** (default): Continue existing experience or auto-start if it doesn't exist
- **`commit`**: Export experience changes back to original directory and delete experience
- **`discard`**: Delete experience without exporting changes

### Usage Examples

**Single command (auto-creates experience):**
```
run_bash({ command: 'echo "hello" > test.txt' })
```

**Chained commands (same experience):**
```
# Command 1: Create file
run_bash({ command: 'echo "hello" > test.txt', experienceId: 'my-experience' })

# Command 2: Read the file (sees previous changes)
run_bash({ command: 'cat test.txt', experienceId: 'my-experience' })

# Command 3: Commit changes back
run_bash({ command: 'ls', experienceId: 'my-experience', action: 'commit' })
```

**With agent project:**
```
run_bash({ 
  command: 'npm install', 
  agentId: 'my-project',
  experienceId: 'install-experience'
})
```

### Parameters

- `command` (required): Bash command or script to execute
- `agentId` (optional): Use agent's project path instead of work directory
- `experienceId` (optional): Experience identifier for chaining commands. Auto-generated if omitted.
- `action` (optional): `start` | `continue` | `commit` | `discard` (default: `continue`)
- `image` (optional): Base container image (default: `ubuntu:22.04`)
- `timeout` (optional): Execution timeout in seconds (default: 300)
- `workdir` (optional): Working directory inside container (default: `/workspace`)

### Requirements

- **Dagger CLI**: Must be installed and available in PATH. Install from [dagger.io/install](https://docs.dagger.io/install/)
- **Container runtime**: Docker, Podman, or nerdctl must be running

### Limitations

- **Non-interactive**: Commands run as one-off executions. No interactive shells or prompts (e.g. `vim`, `npm init`).
- **One-off executions**: Each `run_bash` call runs a single command. Chain commands in the same experience to build up state, or use `;` / `&&` in a single command where appropriate.

### Experience Storage

Experiences are stored in a **sibling directory** of the work directory to avoid circular copies: `<parent>/<workDirName>-dagger-experiences/<experienceId>/`. For example, if your work directory is `~/.jeeves`, experiences are stored in `~/.jeeves-dagger-experiences/<experienceId>/`.

Each experience directory contains:
- A copy of the source directory (work dir or agent project)
- `meta.json`: Experience metadata (created, last used, source path)

Experiences persist until explicitly committed or discarded. Consider cleaning up old experiences periodically.

## External interactions (read-only)

External interactions are **Claude Code** or **Cursor** conversation histories. Claude Code stores them under `~/.claude/projects/<encoded-path>/`. Jeeves only reads them (list, show, messages, stats). It does not create or modify them. To “continue” or send prompts you would use the Claude API/CLI or Cursor directly.

## No daemon

This example does not start any background daemon. The Telegram bot is a single long-running process; the CLI is either a one-shot run or an interactive REPL. No auto-sync, auto-commit, or auto-push is used.
