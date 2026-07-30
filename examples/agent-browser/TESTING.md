# Testing this PR from a fresh machine

Start-to-finish instructions assuming a brand-new checkout: no repo, no
`.env`, no environment variables. The example defaults to a local Ollama
model (`ollama/gemma4:26b`), so no API keys are needed anywhere.

## 0. Prerequisites

- **Node 20+** (`node --version`)
- **pnpm** — this is a pnpm workspace; npm will not wire it correctly:
  ```bash
  corepack enable pnpm        # ships with Node
  # or: mise use -g pnpm
  ```
- **Ollama** running locally with a tool-calling model:
  ```bash
  ollama pull gemma4:26b      # the default; any tool-capable model works
  ```

## 1. Clone and check out the PR branch

```bash
git clone https://github.com/The-Focus-AI/umwelten.git
cd umwelten
git checkout claude/mcp-protocol-agent-interop-m4v5n4
pnpm install
```

## 2. Unit tests (no network, no LLM, ~45s)

```bash
pnpm test:run
```

Expected: all suites green, including `packages/protocols/src/discovery/`
(the new endpoint-discovery tests).

## 3. Start the two processes

Terminal 1 — the demo endpoint (answers as BOTH protocols, no keys):

```bash
pnpm tsx examples/agent-browser/demo-endpoint.ts
# demo endpoint: http://localhost:7434
```

Terminal 2 — the agent browser (defaults to ollama/gemma4:26b):

```bash
pnpm tsx examples/agent-browser/server.ts
# agent-browser: http://localhost:7433
# model: ollama/gemma4:26b
```

To use a different model or provider:

```bash
AGENT_BROWSER_MODEL=qwen3:8b pnpm tsx examples/agent-browser/server.ts
AGENT_BROWSER_PROVIDER=google AGENT_BROWSER_MODEL=gemini-3-flash-preview \
  pnpm tsx examples/agent-browser/server.ts   # needs GOOGLE_GENERATIVE_AI_API_KEY
```

## 4. Walk the UI — http://localhost:7433

1. **Discover the MCP face.** Paste `http://localhost:7434/mcp`, click
   *Discover*. Expect an `MCP` card named **demo-tools**, auth badge
   *open*, tools `add` and `roll_dice`. Click **Add to chat**.
2. **Chat with a tool + widget.** Send: `Roll 4 dice.` Expect a
   `roll_dice` chip under the reply **and an interactive dice widget**
   rendered inline (sandboxed iframe). Click its *Reroll* button — the
   dice re-randomize client-side. That exercises the UI-resource flow.
3. **Discover the A2A face — mid-chat.** Paste `http://localhost:7434`
   (no path), *Discover*. Expect an `A2A` card named **Echo Valet** with
   an *Echo* skill. Click **Add to chat**. **Do not reset.**
4. **Use the new endpoint in the same chat.** Send:
   `Ask the valet what it thinks of my dice roll.` Expect an
   `ask_echo_valet` chip and the valet's courteous echo in the reply.
   (This specifically verifies the fix where endpoints added mid-chat
   required a reset before their tools appeared.)
5. **Reset.** Click *Reset* — transcript clears and a fresh A2A
   `contextId` is minted (visible in the footer).

Same flow via curl, if you prefer the terminal:

```bash
curl -s -X POST localhost:7433/api/connect -H 'content-type: application/json' -d '{"url":"http://localhost:7434/mcp"}'
curl -s -X POST localhost:7433/api/chat    -H 'content-type: application/json' -d '{"message":"Roll 4 dice."}'
curl -s -X POST localhost:7433/api/connect -H 'content-type: application/json' -d '{"url":"http://localhost:7434"}'
curl -s -X POST localhost:7433/api/chat    -H 'content-type: application/json' -d '{"message":"Ask the valet what it thinks of my roll."}'
```

## 5. Optional: point it at real servers

```bash
# a habitat's MCP surface (needs a .env with provider keys for the habitat itself)
dotenvx run -- pnpm run cli habitat serve     # then paste http://localhost:7430/mcp

# a deployed OAuth MCP server — paste https://oura-mcp.fly.dev/mcp
# Discover shows "oauth required"; Add to chat opens the PKCE flow in your
# local browser (works because the agent browser runs on your machine).
```

## 6. Optional: attach the menagerie

Three richer demo agents ship alongside the dice endpoint — each answers as
both protocols and returns a dashboard/chart/map widget with every tool call:

```bash
pnpm tsx examples/agent-browser/demo-house.ts     # Hearthstone · http://localhost:7435
pnpm tsx examples/agent-browser/demo-weather.ts   # Meteora     · http://localhost:7436
pnpm tsx examples/agent-browser/demo-atlas.ts     # Atlas       · http://localhost:7437
```

Add `http://localhost:7435/mcp`, `http://localhost:7436/mcp`, and
`http://localhost:7437/mcp` to the chat (or the bare origins for their A2A
faces), then try:

- `Turn on the porch light and set the furnace to 72` — the house dashboard
  should show the porch glowing amber and the furnace flame lit, with the
  indoor temperature drifting toward target on later calls.
- `What's the 14-day outlook for Chicago?` — a hi/lo temperature band chart
  with precipitation bars and per-day glyph cards. Ask again: forecasts are
  deterministic per location + day, so the numbers agree.
- `Plan a bike route from Harbor Point to the Observatory via the Old Mill` —
  an animated dashed route across Atlas's terrain chart, with numbered stops
  and a per-leg distance/ETA legend. `What landmarks do you know?` pins them.

## Troubleshooting

- **`Unknown command: "tsx"`** — you typed `npm`; use `pnpm`.
- **Workspace import errors** — you installed with npm at some point:
  `rm -rf node_modules && pnpm install`.
- **Chat errors with "model does not support tools"** — pick a
  tool-calling model (`gemma4:26b`, `qwen3`, `llama3.3`).
- **First chat turn is slow** — Ollama is loading the model; subsequent
  turns are fast.
- **Small models stop after one tool call** — that's the model, not the
  app; ask for the steps in separate messages or use a larger model.
- **Port in use** — `PORT=7435 pnpm tsx examples/agent-browser/server.ts`
  (and the demo endpoint honors `PORT` too).
