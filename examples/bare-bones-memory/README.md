# Bare Bones Memory

A minimal Stimulus + Interaction chat app that follows the [Bare Bones Memory](https://gist.github.com/southpolesteve/b39a3528790bc99fe3f2c2b9e3263ef8) AGENTS.md protocol.

**44 lines of code.** Uses the existing `createFileTools` from Habitat and `CLIInterface`.

## How it works

The agent has file tools (read, write, list, ripgrep) sandboxed to `memory/`. On each session it follows AGENTS.md:
1. Reads `active-projects.md` and recent session logs
2. Uses project files in `memory/projects/` for ongoing work
3. Writes session logs to `memory/logs/YYYY-MM-DD-session-NNN.md`

## Run

From the repository root:

```bash
pnpm exec tsx examples/bare-bones-memory/chat.ts
```

With a different model:
```bash
BARE_MEMORY_PROVIDER=openrouter BARE_MEMORY_MODEL=openai/gpt-4o pnpm exec tsx examples/bare-bones-memory/chat.ts
```

## Environment

- `BARE_MEMORY_PROVIDER` — LLM provider (default: `ollama`)
- `BARE_MEMORY_MODEL` — Model name (default: `gemma4:26b`)
- No API keys needed for Ollama.

## Related

If you want a simpler starting point that already loads `AGENTS.md` and a `skills/` directory via a single `createAgentKit({ workspaceDir })` call, see [`examples/simple-agent/`](../simple-agent/).

## REPL commands

Built-in from `getAgentCommands()`: `/?`, `/reset`, `/history`, `/mem`, `/stats`, `/info`, `/exit`.
