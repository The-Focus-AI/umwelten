# GitHub Copilot Instructions — Umwelten

TypeScript monorepo: LLM runners (Vercel AI SDK), stimuli, interactions, habitat agents, evaluation, CLI.

## Quick reference

- **Package manager**: `pnpm` only (not `npm`).
- **Tests**: `pnpm test:run` (not `pnpm test`, which watches).
- **CLI**: `pnpm run cli` (tsx). For commands that need API keys, use `dotenvx run --` with the project `.env`.
- **Layering**: See `CLAUDE.md` in the repo root for architecture, module map, and CLI examples.

## Conventions

- Match existing patterns in the touched directory (imports, types, test style).
- Run `pnpm exec tsc --noEmit` and relevant tests before finishing a change.
- Prefer focused diffs; avoid unrelated refactors.

For full agent/workspace rules, read **`CLAUDE.md`**.
