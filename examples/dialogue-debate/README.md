# Dialogue example: moderated debate

Two personas (Advocate and Skeptic) debate a topic. A moderator model picks
who speaks each round and ends the debate when it has run its course.

```bash
dotenvx run -- pnpm tsx examples/dialogue-debate/debate.ts "Is TypeScript worth it for small scripts?"
```

Override the model with `DEBATE_PROVIDER` / `DEBATE_MODEL` env vars.

The same engine powers the `umwelten converse` CLI command and the habitat
`agent_converse` tool — see `docs/guide/agent-dialogues.md`.

```bash
# The CLI equivalent of this script:
dotenvx run -- pnpm run cli converse "Is TypeScript worth it for small scripts?" \
  --persona "Advocate=You argue in favor. 2-4 sentences per turn." \
  --persona "Skeptic=You argue against. 2-4 sentences per turn." \
  -p openrouter -m google/gemini-3.1-flash-lite --moderator
```
