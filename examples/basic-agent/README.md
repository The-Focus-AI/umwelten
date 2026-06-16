# basic-agent — a minimal habitat agent (default runtime)

The smallest complete habitat: a persona, a model, and one custom tool. Chatting
with it runs the **default Interaction runtime** (LLM + tools) — the standard
conversational path.

Self-contained: no machine-specific paths, no external state. Runtime files
(`secrets.json`, `sessions/`) are gitignored.

## Layout

```
basic-agent/
  config.json              # name, provider/model, toolsDir
  STIMULUS.md              # the persona
  tools/coin_flip/
    TOOL.md                # tool frontmatter (name + description)
    handler.ts            # factory: (habitat) => Tool — reads secrets if needed
```

## Run it

From the repo root (needs a provider key in `.env`; this example uses
OpenRouter — change `defaultProvider`/`defaultModel` in `config.json` for
another):

```bash
# Terminal 1 — serve the habitat over A2A
dotenvx run -- pnpm run cli habitat serve --work-dir examples/basic-agent --port 7470 --host 127.0.0.1

# Terminal 2 — chat with it (streaming A2A client)
dotenvx run -- pnpm run cli habitat chat --url http://127.0.0.1:7470 --one-shot "Who are you?"
dotenvx run -- pnpm run cli habitat chat --url http://127.0.0.1:7470 --one-shot "Flip a coin."
```

Expected: it introduces itself as Scout, and "Flip a coin" invokes the custom
`coin_flip` tool.

## The custom tool pattern

`tools/<name>/` is auto-loaded by `Habitat.create` (`toolsDir` in config). Each
tool is a `TOOL.md` (frontmatter) plus a `handler.ts` that default-exports a
Vercel AI SDK `tool()`. Use the **factory form** `(habitat) => tool(...)` when
the tool needs habitat context — e.g. `habitat.getSecret("SOME_TOKEN")`. This is
exactly the shape the Twitter habitat's tools use.
