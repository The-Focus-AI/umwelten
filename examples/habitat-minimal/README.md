# Minimal Habitat example

This folder documents the smallest useful **Habitat work directory** layout. Paths are relative to your chosen work dir (e.g. `~/habitats` or a project-specific directory).

## Layout

```
my-habitat/
├── config.json           # required after onboarding (defaults set by CLI)
├── STIMULUS.md          # optional; merged into stimulus (see habitat load-prompts)
├── CLAUDE.md / README.md # optional additional prompt sources
├── tools/               # optional TOOL.md + handlers
└── agents/              # optional cloned sub-agent repos
```

Sessions and `transcript.jsonl` files live under the **sessions directory** (default sibling to work dir, e.g. `habitats-sessions`).

## Run

From the umwelten repo (or with `umwelten` on your PATH):

```bash
dotenvx run -- pnpm run cli -- habitat --work-dir /path/to/my-habitat
```

Add `--sessions-dir` if you keep sessions elsewhere.

## Introspect native sessions

```bash
pnpm run cli -- sessions habitat list --work-dir /path/to/my-habitat
pnpm run cli -- sessions habitat show <session-prefix>
```

## Evaluations

See **[`examples/model-showdown/README.md`](../model-showdown/README.md)** for a multi-dimension evaluation + `eval combine` example.
