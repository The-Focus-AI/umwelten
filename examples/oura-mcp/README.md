# oura-mcp — Oura Ring as a Multi-User MCP Server

A habitat-based MCP server that exposes Oura Ring health data (sleep, readiness, activity, stress, heart rate) as MCP tools. Multiple users connect via Claude/Amp/Cursor, each with their own Oura account. Deployed on Fly.io with Neon Postgres for storage.

## Architecture

The server uses two layers of OAuth:

- **MCP OAuth** — authenticates MCP clients (Claude, Amp, Cursor). This server acts as its own Authorization Server, implementing dynamic client registration, authorization, and token endpoints.
- **Oura OAuth** — chained during the MCP auth flow. When a user authorizes, the server redirects them to Oura to grant access to their health data. Oura tokens are stored per-user in Neon Postgres.
- **Habitat** — deployable work directory (`habitat/`): metadata (`config.json`), agent-facing instructions (`stimulus.md`), and optional `secrets.json`. The process boots `Habitat.create({ workDir, skipBuiltinTools: true })` so you get Habitat config and secrets without loading the full Umwelten management tool sets. Domain MCP tools are registered in code (see below).

```
MCP Client ──► oura-mcp server ──► Oura API
  (Claude)     (OAuth AS + MCP)    (health data)
               (Neon Postgres)
               (Habitat work dir + MCP tool registration)
```

**Public URL:** On Fly.io, OAuth `issuer`, `resource_metadata`, and Oura `redirect_uri` are derived from **`X-Forwarded-Proto` and `Host`** (see `src/public-url.ts`) so they match the browser even if `BASE_URL` in secrets is wrong or unset. Locally, set `BASE_URL` or rely on `http://localhost:<port>` from `Host`.

## Prerequisites

- Node.js 22+
- A [Neon](https://neon.tech) database (free tier works)
- An [Oura developer app](https://cloud.ouraring.com/oauth/applications) with:
  - Redirect URI (dev): `http://localhost:8080/oauth/oura-callback`
  - Redirect URI (prod): `https://<your-fly-app>.fly.dev/oauth/oura-callback` (must match the hostname users hit; e.g. if `fly.toml` has `app = "focus-oura-mcp"`, use `https://focus-oura-mcp.fly.dev/oauth/oura-callback`)
  - Scopes: daily, heartrate, personal
- [Fly.io](https://fly.io) account (for deployment)

## Local development

```bash
cd examples/oura-mcp
pnpm install

# Environment variables (see table below)
export DATABASE_URL="postgres://..."
export OURA_CLIENT_ID="..."
export OURA_CLIENT_SECRET="..."
export BASE_URL="http://localhost:8080"
export TOKEN_SECRET="dev-secret"

pnpm run db:setup
pnpm run dev
```

If you use **dotenvx** and a `.env` file in this directory:

```bash
dotenvx run -- pnpm run dev
dotenvx run -- pnpm run db:setup
```

## Docker

Build context **must** be this directory only (no `..`):

```bash
cd examples/oura-mcp
docker build -t oura-mcp .
```

The image installs dependencies from npm, including the published **`umwelten`** package (same major line as in `package.json`), so the image does not need the parent monorepo.

## Deploying to Fly.io

From **`examples/oura-mcp`** (where `fly.toml` and `Dockerfile` live):

```bash
cd examples/oura-mcp
fly launch   # if you have not already; creates/updates fly.toml
```

**Database:** Run migrations once against Neon (from your machine):

```bash
cd examples/oura-mcp
# DATABASE_URL must point at the same DB Fly will use
pnpm run db:setup
```

**Secrets:** Set variables your app reads at runtime (`DATABASE_URL`, `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `TOKEN_SECRET`). `BASE_URL` is **optional on Fly** if the proxy sends `X-Forwarded-Proto` / `Host` (see Architecture).

Import from a file (values should be `KEY=value` per line; avoid extra quotes if `fly secrets import` stores them literally):

```bash
cd examples/oura-mcp
grep -v '^\s*#' .env | grep -v '^\s*$' | fly secrets import
```

Or explicit `fly secrets set`:

```bash
fly secrets set \
  DATABASE_URL="postgresql://..." \
  OURA_CLIENT_ID="..." \
  OURA_CLIENT_SECRET="..." \
  TOKEN_SECRET="$(openssl rand -hex 32)"
```

Then:

```bash
fly deploy
```

## Connecting from Claude Code

```bash
claude mcp add --transport http oura https://<your-fly-app>.fly.dev/mcp
```

Use **`--scope user`**, **`project`**, or default **local** as needed ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp)).

## Connecting from other MCP clients (JSON)

Many clients expect **streamable HTTP** and your public `/mcp` URL:

```json
{
  "mcpServers": {
    "oura": {
      "type": "streamable-http",
      "url": "https://<your-fly-app>.fly.dev/mcp"
    }
  }
}
```

On first connect, complete OAuth; you will be sent through Oura to link the ring account.

## Available tools

| Tool | Oura Endpoint | Description |
|------|---------------|-------------|
| `oura_sleep` | `/v2/usercollection/daily_sleep` | Daily sleep scores and contributors |
| `oura_sleep_detail` | `/v2/usercollection/sleep` | Detailed sleep periods (deep/REM/light/lowest HR/avg HRV) |
| `oura_readiness` | `/v2/usercollection/daily_readiness` | Readiness scores, temperature deviation, HRV balance |
| `oura_activity` | `/v2/usercollection/daily_activity` | Steps, calories, activity score |
| `oura_stress` | `/v2/usercollection/daily_stress` | Stress/recovery minutes, day summary |
| `oura_heart_rate` | `/v2/usercollection/heartrate` | Time-series heart rate data |

All tools take `start_date` (required, YYYY-MM-DD) and `end_date` (optional, defaults to `start_date`).

## How it works

1. MCP client connects to `/mcp` → may receive **401** with `WWW-Authenticate` and `resource_metadata` for the protected-resource document.
2. Client discovers OAuth endpoints via `/.well-known/oauth-authorization-server`.
3. Client registers dynamically via `POST /oauth/register`.
4. Client redirects the user to `/oauth/authorize` with a PKCE challenge.
5. Server chains to Oura OAuth; user authorizes Oura; tokens are stored per user in Postgres.
6. Server issues an MCP authorization code and redirects back to the client.
7. Client exchanges the code at `POST /oauth/token`.
8. Authenticated `/mcp` requests use `Authorization: Bearer <mcp-token>`; the server resolves the user and registers Oura-backed tools for that session.

## Wrapping an API endpoint with Habitat (this pattern)

This repo shows how to ship an **HTTP API** as **MCP tools** while using **Habitat** as the deployable shell.

### 1. Habitat work directory

Add a `habitat/` folder next to your server with at least:

- **`config.json`** — name/description of the “agent” or product.
- **`stimulus.md`** (optional) — instructions for any future Umwelten `Interaction` / agent that shares this workspace.
- **`secrets.json`** — created at runtime; the server can mirror env secrets into it via `habitat.setSecret` so Habitat-aware code reads one place.

Boot once at process start:

```ts
const habitat = await Habitat.create({
  workDir: pathToHabitatDir,
  skipBuiltinTools: true, // MCP server: no session/file/search tool sets unless you want them
});
```

Use **`skipBuiltinTools: true`** when the only tools you expose are your API wrappers on the MCP server (typical for a focused remote MCP).

### 2. Per-user API credentials

Whatever the API uses (OAuth refresh token, API key, etc.), persist it **keyed by your MCP user id** (here: `store.ts` + Neon). The MCP layer must never mix tokens between users.

### 3. Register one MCP tool per API surface

In **`oura-tool-set.ts`**, each tool:

1. Defines a name, description, and **Zod** input schema (what the model passes in).
2. In the handler, loads/refreshes the **user’s** API token, calls **`fetch`** (or your HTTP client) against the upstream REST path, maps query/body as needed.
3. Returns MCP **`content`** (e.g. JSON as text) or **`isError: true`** on failure.

That is the core of “wrapping” an endpoint: **MCP tool ↔ HTTP request to your vendor API**, with auth from your store.

### 4. Wire tools into the MCP request path

In **`mcp-handler.ts`**, after you verify the MCP Bearer token and know `userId`, create an `McpServer`, call **`registerOuraTools(...)`** (or your equivalent), then attach **`StreamableHTTPServerTransport`** and forward the HTTP request. Each authenticated session gets tools bound to that user.

### 5. Optional: full Umwelten tool sets

Inside a **full Habitat agent** (REPL, sub-agents, etc.), you would **`habitat.addToolSet(...)`** or **`registerCustomTools`** with Umwelten `ToolSet` objects. This **MCP-only** service instead registers tools directly on **`@modelcontextprotocol/sdk`’s `McpServer`**, which is simpler for a standalone Fly deployment. You can still use the same `habitat/` directory for config, stimulus, and secrets.

### Checklist for another API (Twitter, Gmail, internal REST, …)

| Step | What to do |
|------|------------|
| Store | Table(s) for OAuth tokens or API keys keyed by MCP `user_id`. |
| OAuth | Reuse this server’s MCP OAuth shell; add a second leg to your provider (like `authorize.ts` + callback for Oura). |
| Tools | New `registerMyApiTools(server, userId, store, …)` with `fetch` to your base URL. |
| Habitat | Keep `habitat/` for config + secrets; point `workDir` at it from `server.ts`. |
| Deploy | Same Fly + Neon pattern; register redirect URIs on the provider for your production host. |

## Making your own fork

Generic pieces: **`server.ts`** (routing, `getPublicBaseUrl`), **`oauth/`**, **`store.ts`**, **`mcp-handler.ts`** (transport + auth gate).

Replace **`registerOuraTools`** and the Oura-specific OAuth leg with your provider and a new `register…Tools` module.

## Environment variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon Postgres connection string |
| `OURA_CLIENT_ID` | From [Oura developer portal](https://cloud.ouraring.com/oauth/applications) |
| `OURA_CLIENT_SECRET` | From Oura developer portal |
| `BASE_URL` | Public origin for OAuth when **not** behind a proxy that sets `X-Forwarded-Proto` (local dev). On Fly, usually omitted; see `src/public-url.ts`. |
| `TOKEN_SECRET` | Secret for hashing MCP tokens (`openssl rand -hex 32` in production) |
| `PORT` | HTTP port (default `8080`; Fly sets `internal_port` in `fly.toml`) |

## Key files

| Path | Role |
|------|------|
| `src/server.ts` | HTTP server, Habitat boot, OAuth + MCP routes |
| `src/public-url.ts` | Public base URL for metadata and redirects |
| `src/mcp-handler.ts` | MCP session, 401/HEAD handling, tool registration |
| `src/oura-tool-set.ts` | Oura REST → MCP tools |
| `src/oauth/*` | MCP authorization server |
| `src/store.ts` | Neon persistence for clients, sessions, tokens |
| `habitat/` | Habitat config, stimulus, secrets store |
