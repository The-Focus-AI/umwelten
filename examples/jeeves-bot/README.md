# Jeeves Bot

A butler-style assistant that runs on the CLI and over Telegram. It can read/write files, list directories, manage agents (projects with Claude Code session data), and list or inspect Claude Code sessions for those agents.

## Features

- **File operations**: Read file, write file (creates parent directories), list directory. By default paths are in the Jeeves work directory; optional `agentId` targets an agent’s project. Paths are sandboxed to the work dir and configured agent project roots.
- **Agent management**: List, add, update, and remove agents. Each agent has an id, name, project path (e.g. git clone path), optional git remote, and optional secret key references.
- **Session integration**: For each agent’s project path, list Claude Code sessions, show session summary, get messages, and get token/cost/duration stats (read-only; no writing to Claude sessions).
- **Current time**: Returns the current date and time (ISO and locale string). Optional IANA timezone (e.g. `America/New_York`) for “what time is it in X?”
- **Web search**: Optional [Tavily](https://tavily.com) search tool. Set `TAVILY_API_KEY` in `.env` to enable; the bot can then look up current information, facts, or recent events when asked.
- **wget**: Fetch a URL and return raw response (status, content-type, body). From main umwelten; useful for APIs or plain text.
- **markify**: Fetch a URL and convert the page to readable markdown. Uses built-in conversion (no config). Optionally set `MARKIFY_URL` to use the Markify service instead. From main umwelten.

## Setup (env)

Copy `env.example` to `.env` in this directory (or export the variables in your shell):

```bash
cd examples/jeeves-bot
cp env.example .env
# Edit .env and set at least JEEVES_WORK_DIR and any API keys / Telegram token.
```

Load it before running (e.g. `set -a && source .env && set +a`, or use [dotenv](https://www.npmjs.com/package/dotenv)/[dotenvx](https://github.com/dotenvx/dotenvx)).

- **JEEVES_WORK_DIR**: Main work folder for the bot. Agent config and other bot data are stored here. Default if unset: `~/.jeeves`. Use an absolute path (or path relative to the current working directory).
- **JEEVES_CONFIG_PATH**: Optional. Override path to the config file; if unset, config is `<JEEVES_WORK_DIR>/config.json`.

**AGENT.md**: If `<JEEVES_WORK_DIR>/AGENT.md` exists, it is loaded on startup and appended to the bot’s context. Use it for extra personality or project-specific instructions.

- **TELEGRAM_BOT_TOKEN**, **JEEVES_PROVIDER**, **JEEVES_MODEL**, and provider API keys – see `env.example`.
- **TAVILY_API_KEY** (optional): Enables the web search tool. Get a key at [app.tavily.com](https://app.tavily.com); without it, the search tool will report that the key is missing.

## Butler persona and learning (JEEVES_PROMPT.md)

The file `JEEVES_PROMPT.md` in this directory is loaded on every startup and defines a butler persona that learns about the person it assists. It instructs the bot to maintain three files in the **work directory** (paths relative to work dir, no `agentId`):

| File | Purpose |
|------|---------|
| **memories.md** | Running list of specific things the user said about themselves (with date). Updated whenever something worth remembering is shared. |
| **facts.md** | Short, scannable summary of what the bot knows about the person (work, preferences, people, projects). Updated after adding memories or when the summary is outdated. |
| **private journal.md** | Daily reflections on interactions so the bot can serve the user better later. One section per day; not shared unless the user explicitly asks. |

You can edit `JEEVES_PROMPT.md` to change how the butler behaves or how these files are maintained. AGENT.md (in the work dir) is loaded after it and can override or add to this behavior.

## Config

- **Config file**: `<JEEVES_WORK_DIR>/config.json` (or `JEEVES_CONFIG_PATH` if set).
- **Shape**: `{ "agents": [ { "id": "...", "name": "...", "projectPath": "/absolute/path", "gitRemote": "https://...", "secrets": ["ENV_VAR_NAME"] } ] }`
- **Secrets**: `secrets` are references only (e.g. env var names). Jeeves does not store secret values; keep actual secrets in the environment or a secrets manager.

## Path and safety rules

- **Default (no `agentId`)**: Paths are relative to the **Jeeves work directory** (`JEEVES_WORK_DIR` or `~/.jeeves`). Use `list_directory` with path `"."` to list the work dir; read/write files there (e.g. `notes.md`, `scratch.txt`).
- **With `agentId`**: Paths are relative to that agent’s `projectPath`. Use this when the user asks about a specific agent or project.
- File tools only allow paths under the work directory or under a configured agent project. Requests outside those roots return `OUTSIDE_ALLOWED_PATH`. No agents need to be configured to use the work directory.

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

Media files (photos, documents, audio, video) sent to the bot are stored in:
```
{jeeves-bot-directory}/jeeves-bot-data-dir/media/
```

Files are named using Telegram's `file_unique_id` with appropriate extensions. The directory is created automatically when the first media file is received.

## Sessions (read-only)

Agent sessions are **Claude Code** sessions stored under `~/.claude/projects/<encoded-path>/`. Jeeves only reads them (list, show, messages, stats). It does not create or modify Claude sessions. To “continue” or send prompts to Claude you would need the Claude API or CLI separately.

## No daemon

This example does not start any background daemon. The Telegram bot is a single long-running process; the CLI is either a one-shot run or an interactive REPL. No auto-sync, auto-commit, or auto-push is used.
