# Agent Browser

Paste an MCP server URL or an A2A agent URL. The app discovers what lives
there — one probe, both protocols — shows its card (name, auth, tools or
skills), and lets you add it to a chat whose model can then use everything
you've connected.

This is the demo surface for `discoverAgentEndpoint()` in
`@umwelten/protocols` (the unified client-side discovery probe) and for the
"one chat, many endpoints" composition pattern:

- an **MCP endpoint** contributes its tools directly (via `RemoteMcpClient`,
  with optional bearer token, or the interactive OAuth PKCE flow);
- an **A2A endpoint** contributes a single `ask_<agent>` tool that delegates
  to the remote agent over `message/send`, threading one `contextId` per
  chat so the remote side keeps its session.

## Run

```bash
pnpm tsx examples/agent-browser/server.ts
# → http://localhost:7433
```

Model defaults to `ollama/gemma4:26b` (local, no keys); override with
`AGENT_BROWSER_PROVIDER` / `AGENT_BROWSER_MODEL` (hosted providers need
their key in `.env`, run via `dotenvx run --`). `PORT` overrides 7433.

**Fresh-machine walkthrough for testing this PR: see [TESTING.md](./TESTING.md).**

The demo endpoint's `roll_dice` tool returns an mcp-ui-style HTML resource
alongside its JSON — the chat renders it as an interactive sandboxed dice
widget, so the UI-resource flow is testable without any real habitat.

Things to point it at:

```bash
# a habitat's MCP server
dotenvx run -- pnpm run cli habitat serve            # then browse http://localhost:7430/mcp

# any mcp-serve deployment (OAuth flow opens a browser on THIS machine)
https://oura-mcp.fly.dev/mcp

# a habitat's A2A surface (agent card discovered via /.well-known/agent-card.json)
http://localhost:7430
```

## Endpoints

| Route | What it does |
| --- | --- |
| `POST /api/discover` `{url, token?}` | Probe a URL, return its normalized `EndpointCard` |
| `POST /api/connect` `{url, token?}` | Discover + connect + add tools to the chat |
| `POST /api/chat` `{message}` | One turn of the shared chat (max 20 tool steps) |
| `POST /api/disconnect` `{id}` | Drop an endpoint |
| `POST /api/reset` | Clear transcript, mint a fresh A2A `contextId` |
| `GET /api/state` | Endpoints + transcript + model |

## Deploying

The server is a single Node process with no build step and no local state
worth keeping — anywhere that can run `pnpm tsx examples/agent-browser/server.ts`
with the repo installed can host it. Two caveats for a non-local deploy:

- **OAuth-required MCP servers won't work remotely**: the PKCE flow opens a
  browser and a loopback callback server on the machine running this
  process. Deployed instances should stick to open or bearer-token
  endpoints (the UI labels each card's auth).
- There is **one global chat** and no user auth — this is an example, not a
  product. Put it behind something if you expose it.
