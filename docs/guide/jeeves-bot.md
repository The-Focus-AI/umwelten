# Jeeves Bot

Jeeves is a butler-style assistant that runs on the CLI and over Telegram. It can read and write files, manage **agents** (projects with Claude Code / Cursor data), and inspect **external interactions** (conversation history) for those agents. This page gives a high-level view of how Jeeves handles **subagents**, **secrets**, and **sandboxing**. For setup, CLI commands, and work-directory layout, see the [Jeeves README](../../examples/jeeves-bot/README.md) in the repo.

## Overview

- **CLI**: Interactive REPL or one-shot commands from `examples/jeeves-bot` (or via `pnpm exec tsx examples/jeeves-bot/cli.ts`).
- **Telegram**: Long-running bot; one process per deployment. Media and transcripts are stored under `JEEVES_SESSIONS_DIR`.
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

---

For step-by-step setup, env vars, work-directory layout, CLI/Telegram usage, and tool reference, see the [Jeeves Bot README](../../examples/jeeves-bot/README.md).
