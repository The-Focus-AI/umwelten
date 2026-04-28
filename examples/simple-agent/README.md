# Simple Agent

The minimal "agent in a box" example. One factory call wires up filesystem,
bash, math, an optional `AGENTS.md` system prompt, and an optional `skills/`
directory.

## Layout

The example directory **is** the agent's home — there's no separate workspace
subdir. AGENTS.md, chat.ts, skills/, and any artifacts the agent creates all
live side-by-side here:

```
examples/simple-agent/
  chat.ts        # entry point
  AGENTS.md      # loaded into Stimulus.systemContext
  README.md
  skills/        # optional; if it has any SKILL.md, the `skill` tool is auto-registered
  ...artifacts the agent writes...
```

## Run

From the repository root:

```bash
pnpm exec tsx examples/simple-agent/chat.ts
```

With a different model:

```bash
SIMPLE_AGENT_PROVIDER=openrouter SIMPLE_AGENT_MODEL=openai/gpt-4o \
  pnpm exec tsx examples/simple-agent/chat.ts
```

Default is `ollama:gemma4:26b` — no API keys needed.

## What's in the kit

`createAgentKit({ workspaceDir })` returns:

| Tool | Notes |
|---|---|
| `read` | Reads under `workspaceDir` or any `extraRoots`. |
| `write` | Writes under `workspaceDir` or any `extraRoots`. Creates parent dirs. |
| `create_directory` | `mkdir -p` inside the sandbox. |
| `list_directory` | Use `"."` to list the workspace root. |
| `ripgrep` | Fast text search. |
| `bash` | Shell with `cwd` set to `workspaceDir`. **Not sandboxed** — see below. |
| `skill` | Auto-registered if `<workspaceDir>/skills/` contains any `SKILL.md`. |

It also returns:
- `systemContext` — contents of `<workspaceDir>/AGENTS.md` if present (attach to `Stimulus.systemContext`).
- `skills` — list of skill names discovered under `<workspaceDir>/skills/`.

This example sets `workspaceDir` to the example directory itself and passes
`extraRoots: [repoRoot]`, so the agent can also read and edit the surrounding
umwelten source.

## Sandbox honesty

Path-based sandboxing confines `read`, `write`, `create_directory`,
`list_directory`, and `ripgrep` to `workspaceDir` plus `extraRoots`. **It does
NOT contain `bash`.** A bash command can `cd ..`, write anywhere on disk,
`curl` the internet, install packages, etc. The `bash` tool only sets the
shell's `cwd`.

For real isolation, use Habitat with the Dagger-backed `run_project` tool
(see `src/habitat/tools/run-project/`).

## Adding your own tool

Tools are plain Vercel AI SDK tools. Combine your own with the kit by spreading
into a record:

```ts
import { tool } from 'ai';
import { z } from 'zod';

const greetTool = tool({
  description: 'Greet someone by name',
  inputSchema: z.object({ name: z.string() }),
  execute: async ({ name }) => ({ message: `Hello, ${name}!` }),
});

const stimulus = new Stimulus({
  tools: { ...kit.tools, greet: greetTool },
});
```

## Adding skills

Drop a directory under `skills/` containing a `SKILL.md` with frontmatter:

```
skills/research/
  SKILL.md          # name + description in frontmatter, instructions in body
  scripts/...       # optional bundled resources
  references/...
```

The `skill` tool is auto-registered when `createAgentKit` discovers any skill.
The model invokes it with `{ skill: 'research', arguments?: '...' }` to get the
activation payload. See `src/stimulus/skills/` for the spec.

## Related

- `examples/bare-bones-memory/` — the same idea plus the [Bare Bones Memory](https://gist.github.com/southpolesteve/b39a3528790bc99fe3f2c2b9e3263ef8) protocol layered on top.
- `src/habitat/` — full agent container with persistent sessions, sub-agents, secrets, and Dagger-isolated execution.
