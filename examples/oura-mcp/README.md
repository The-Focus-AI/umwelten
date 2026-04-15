# oura-mcp — Oura Ring as a Multi-User MCP Server

An MCP server that exposes Oura Ring health data (sleep, readiness, activity, stress, heart rate) as MCP tools. Built on the **`mcp-serve`** library (`src/habitat/mcp-serve/`), which provides the HTTP server, OAuth 2.1 authorization server, MCP transport, and Neon Postgres store. This example only needs to implement the Oura-specific OAuth provider and tool registration.

## Architecture

The `mcp-serve` library handles two layers of OAuth:

- **MCP OAuth** — authenticates MCP clients (Claude, Amp, Cursor). The library acts as its own Authorization Server, implementing dynamic client registration, authorization, and token endpoints.
- **Upstream OAuth** — chained during the MCP auth flow. The `OuraProvider` implements the `UpstreamOAuthProvider` interface to redirect users to Oura for health data access. Tokens are stored per-user in Neon Postgres via `NeonStore`.

```
MCP Client ──► mcp-serve library ──► OuraProvider ──► Oura API
  (Claude)     (OAuth AS + MCP)       (upstream OAuth)  (health data)
               (NeonStore / Postgres)
```

**Public URL:** On Fly.io, OAuth `issuer`, `resource_metadata`, and Oura `redirect_uri` are derived from **`X-Forwarded-Proto` and `Host`** so they match the browser even if `BASE_URL` is wrong or unset. Locally, set `BASE_URL` or rely on `http://localhost:<port>` from `Host`.

## Prerequisites

- Node.js 22+
- A [Neon](https://neon.tech) database (free tier works)
- An [Oura developer app](https://cloud.ouraring.com/oauth/applications) with:
  - Redirect URI (dev): `http://localhost:8080/oauth/upstream-callback`
  - Redirect URI (prod): `https://<your-fly-app>.fly.dev/oauth/upstream-callback` (must match the hostname users hit; e.g. if `fly.toml` has `app = "focus-oura-mcp"`, use `https://focus-oura-mcp.fly.dev/oauth/upstream-callback`)
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

## Wrapping another API with `mcp-serve`

The `mcp-serve` library (`src/habitat/mcp-serve/`) provides the full HTTP server, OAuth 2.1 authorization server, MCP transport, and Neon Postgres store. To wrap a new API:

### 1. Implement `UpstreamOAuthProvider`

Create a class (like `OuraProvider`) that implements `buildAuthorizeUrl()`, `exchangeCode()`, and `refreshToken()` for your upstream service.

### 2. Implement `McpToolRegistrar`

Write a function `(server, userId, getUpstreamToken) => Promise<void>` that registers MCP tools. Each tool calls `getUpstreamToken()` to get a valid access token, then fetches from your API.

### 3. Wire it up

```ts
import { createMcpServer, NeonStore } from 'umwelten/mcp-serve';

const server = createMcpServer({
  name: 'my-service-mcp',
  upstream: myProvider,
  registerTools: myToolRegistrar,
  store: new NeonStore(DATABASE_URL),
});
server.listen(8080);
```

### Checklist

| Step | What to do |
|------|------------|
| Provider | Implement `UpstreamOAuthProvider` for your service's OAuth |
| Tools | Write a `McpToolRegistrar` with `fetch` calls to your API |
| DB | Run `store.setupTables()` once to create the schema |
| Deploy | Same Fly + Neon pattern; register redirect URIs for `<host>/oauth/upstream-callback` |

## Environment variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon Postgres connection string |
| `OURA_CLIENT_ID` | From [Oura developer portal](https://cloud.ouraring.com/oauth/applications) |
| `OURA_CLIENT_SECRET` | From Oura developer portal |
| `BASE_URL` | Public origin for OAuth when **not** behind a proxy that sets `X-Forwarded-Proto` (local dev). On Fly, usually omitted. |
| `TOKEN_SECRET` | Secret for hashing MCP tokens (`openssl rand -hex 32` in production) |
| `PORT` | HTTP port (default `8080`; Fly sets `internal_port` in `fly.toml`) |

## Key files

| Path | Role |
|------|------|
| `src/server.ts` | Entry point — creates the MCP server via `mcp-serve` library |
| `src/oura-provider.ts` | `UpstreamOAuthProvider` for Oura Ring OAuth |
| `src/oura-tool-set.ts` | `McpToolRegistrar` — Oura REST → MCP tools |
| `src/db-setup.ts` | Creates DB tables via `NeonStore.setupTables()` |
| `habitat/` | Habitat config, stimulus, secrets store |
