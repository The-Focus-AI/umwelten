# Jeeves Bot

Jeeves is a butler-style assistant that runs on the CLI and over Telegram. It was the original example of a [Habitat](./habitat.md)-based agent. Now that Habitat is a first-class top-level concept, Jeeves serves as a reference example of how to customize a Habitat with a specific persona and tools.

::: tip Prefer `umwelten habitat` for new setups
You no longer need a separate Jeeves wrapper. The `umwelten habitat` command does everything Jeeves does, with any work directory. See the [Habitat guide](./habitat.md) and the [Habitat Setup Walkthrough](../walkthroughs/habitat-setup-walkthrough.md).

```bash
# Use the Jeeves data dir directly with the habitat command
umwelten habitat -w examples/jeeves-bot/jeeves-bot-data-dir -p google -m gemini-3-flash-preview

# Or as a Telegram bot
umwelten habitat telegram -w ~/.jeeves --env-prefix JEEVES -p google -m gemini-3-flash-preview
```
:::

## Overview

- **CLI**: Interactive REPL or one-shot commands. Can be run via `examples/jeeves-bot/cli.ts` or via `umwelten habitat -w ~/.jeeves --env-prefix JEEVES`.
- **Telegram**: Long-running bot. Can be run via `examples/jeeves-bot/telegram.ts` or via `umwelten habitat telegram -w ~/.jeeves --env-prefix JEEVES`.
- **Work directory**: All config, prompts, tools, and skills live under `JEEVES_WORK_DIR` (default `~/.jeeves`). The bot can edit everything there; file access is sandboxed to the work dir and configured agent project roots.

## How Jeeves manages subagents (agents and habitats)

Jeeves does **not** spawn or run separate “subagent” processes. Instead it uses a **Habitat** model:

- **Habitat**: One agent plus its tools, interactions, memory, and execution experiences. Jeeves itself runs in one habitat.
- **Agents** in config are **references** to other habitats: each entry has an id, name, project path (e.g. a git clone), optional git remote, and optional secret references. Jeeves does not start or stop those projects; it only knows where they are and how to read their data.

What Jeeves can do with agents:

- **List, add, update, remove** agents via tools (config stored in the work dir `config.json`).
- **File operations** with an `agentId`: paths are then relative to that agent’s `projectPath` (read/write/list), so the bot can work inside a project’s codebase.
- **External interactions**: For each agent’s project path, Jeeves can **read** Claude Code and Cursor conversation history (list, show, messages, stats). It does not create or modify those conversations; you use Claude or Cursor to continue them.
- **run_bash**: Optional `agentId` runs the command in a Dagger container with that agent’s project as the workspace (see [Sandboxing](#sandboxing) below).

So “subagents” in Jeeves are **configured agents** — other codebases and projects the bot knows about and can inspect or operate on within strict path and execution sandboxes.

## Secrets

Jeeves does **not** store secret values. Config and tools use **secret references** only (e.g. environment variable names or keys in a secrets manager). Actual values live in:

- The **environment** (e.g. `.env` loaded before running the CLI or Telegram bot), or
- A **secrets manager** that the user configures and that injects env vars or that tools are written to call.

Agent entries in `config.json` can include optional `secrets` (e.g. for API keys or credentials for that project). Those are references only; the bot never writes secret values to disk in config. This keeps credentials out of the work directory and out of version control.

## Sandboxing

Jeeves restricts where the bot can read and write, and how it runs code.

### File tools

- **Default (no `agentId`)**: Paths are relative to the **Jeeves work directory** (`JEEVES_WORK_DIR`). The bot can only read/write/list under that root.
- **With `agentId`**: Paths are relative to that agent’s `projectPath`. The bot can only access that project’s subtree.
- Any path outside the work dir or outside a configured agent’s project is rejected with `OUTSIDE_ALLOWED_PATH`. No agent projects need to be configured to use the work directory alone.

So file access is sandboxed to (1) the work dir and (2) explicitly configured agent project roots.

### run_bash (Dagger)

The `run_bash` tool runs bash commands inside **Dagger-managed containers**:

- Commands run in an isolated container (default image e.g. `ubuntu:22.04`), not on the host.
- **Experiences**: Each “experience” is an isolated copy of a directory (work dir or an agent project). Commands in the same experience see prior changes in that copy; the original directory is unchanged until you **commit** the experience (or you **discard** it). So execution and filesystem changes are sandboxed per run and per experience.
- Experiences live in a sibling directory (e.g. `~/.jeeves-dagger-experiences/<experienceId>/`) so the work dir itself is not duplicated inside the work dir.

So code execution is sandboxed by containers and by experience-based copies; the bot cannot arbitrarily run commands on the host or outside the allowed roots.

## HabitatAgents: delegating to sub-agents

Beyond reading files and external interactions, Jeeves can delegate questions to **HabitatAgents** — sub-agents with persistent memory that understand a specific project. A HabitatAgent is created from a managed project's files (README, CLAUDE.md, package.json) and gets its own persistent session, so it remembers what it learned across conversations.

Tools for working with HabitatAgents:

- **`agent_clone(gitUrl, name)`** — clone a repo and register it as an agent
- **`agent_ask(agentId, message)`** — send a question to a sub-agent (it uses tools like read_file, ripgrep with its agentId)
- **`agent_logs(agentId, ...)`** — read log files using configured patterns
- **`agent_status(agentId)`** — quick health check (status file, recent logs, commands)

For full documentation, see [Habitat Agents](./habitat-agents.md).

---

For step-by-step setup, env vars, work-directory layout, CLI/Telegram usage, and tool reference, see the [Jeeves Bot README](https://github.com/The-Focus-AI/umwelten/blob/main/examples/jeeves-bot/README.md) on GitHub.

## See Also

- [Habitat](./habitat.md) — The top-level container concept (recommended for new setups)
- [Habitat Setup Walkthrough](../walkthroughs/habitat-setup-walkthrough.md) — Step-by-step guide to building a new agent
- [Habitat Agents](./habitat-agents.md) — Sub-agent delegation
