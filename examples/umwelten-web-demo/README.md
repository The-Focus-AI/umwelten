# umwelten-web-demo

Reference app for the `umwelten-web` framework. Shows a React + `useChat`
frontend talking to a `startWebServer`-backed habitat, with the dev auth
provider pinning every request to `userId = "dev"`.

## Run

Two processes — one for the API, one for the Vite dev server:

```bash
# terminal 1 — API server on :3000
dotenvx run -- pnpm --filter umwelten-web-demo exec tsx src/server.ts

# terminal 2 — Vite dev server on :5173 (proxies /api to :3000)
pnpm --filter umwelten-web-demo dev:client
```

Then open http://localhost:5173.

For a production-style single-process run:

```bash
pnpm --filter umwelten-web-demo build:client
dotenvx run -- pnpm --filter umwelten-web-demo exec tsx src/server.ts
# open http://localhost:3000 — server serves the built SPA from ./public
```

## What it exercises

- `POST /api/chat` → `WebAdapter` → `ChannelBridge` → `Interaction.streamText`
  with a `StreamObserver` feeding the AI SDK UI Message Stream Protocol back
  to `useChat`.
- `GET /api/sessions` for the thread sidebar.
- `GET /api/me` for the authenticated user banner.
- `current_time` tool — ask "what time is it?" to see a tool-call card render.
