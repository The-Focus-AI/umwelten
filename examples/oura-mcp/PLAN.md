# oura-mcp: Multi-User Oura Ring MCP Server

## What this is

A self-contained, deployable MCP server that exposes Oura Ring data as tools.
Multiple users connect via Claude/Amp/Cursor, each with their own Oura account.
Deployed on fly.io.

## The auth flow (two layers)

```
Claude (User A)                oura-mcp server                    Oura API
     │                              │                                │
     │ 1. POST /mcp (no token)      │                                │
     │─────────────────────────────▶│                                │
     │◀── 401 + WWW-Authenticate    │                                │
     │                              │                                │
     │ 2. GET /.well-known/         │                                │
     │    oauth-protected-resource  │                                │
     │─────────────────────────────▶│                                │
     │◀── { authorization_servers } │                                │
     │                              │                                │
     │ 3. GET /.well-known/         │                                │
     │    oauth-authorization-server│                                │
     │─────────────────────────────▶│                                │
     │◀── { authorize, token, ...}  │                                │
     │                              │                                │
     │ 4. POST /oauth/register (DCR)│                                │
     │─────────────────────────────▶│                                │
     │◀── { client_id }             │                                │
     │                              │                                │
     │ 5. Browser → GET /oauth/     │                                │
     │    authorize?client_id=...   │                                │
     │    &code_challenge=...       │                                │
     │─────────────────────────────▶│                                │
     │                              │ 6. 302 → Oura OAuth            │
     │                              │──cloud.ouraring.com/authorize──▶│
     │                              │   (scope=daily+heartrate+...)  │
     │                              │                                │
     │         User sees Oura consent page, clicks "Allow"           │
     │                              │                                │
     │                              │◀── redirect with ?code=OURA123 │
     │                              │                                │
     │                              │ 7. Exchange Oura code           │
     │                              │──POST api.ouraring.com/token──▶│
     │                              │◀── { access_token,             │
     │                              │      refresh_token }           │
     │                              │                                │
     │                              │ 8. Store Oura tokens            │
     │                              │    keyed to MCP user            │
     │                              │                                │
     │◀── redirect to Claude with   │                                │
     │    ?code=MCP_AUTH_CODE        │                                │
     │                              │                                │
     │ 9. POST /oauth/token         │                                │
     │    code=MCP_AUTH_CODE         │                                │
     │    &code_verifier=...        │                                │
     │─────────────────────────────▶│                                │
     │◀── { access_token: "mcp-x"} │                                │
     │                              │                                │
     │ 10. POST /mcp                │                                │
     │    Authorization: Bearer mcp-x                                │
     │    { tools/list }            │                                │
     │─────────────────────────────▶│                                │
     │◀── oura_sleep, oura_readiness, oura_activity, ...             │
     │                              │                                │
     │ 11. POST /mcp                │ 12. Fetch with user's          │
     │    { tools/call oura_sleep } │     Oura token                 │
     │─────────────────────────────▶│──GET api.ouraring.com/v2/...──▶│
     │                              │◀── { data: [...] }             │
     │◀── { sleep_score: 81, ...}   │                                │
```

## File structure

```
examples/oura-mcp/
├── package.json             # deps: umwelten, @modelcontextprotocol/sdk, @neondatabase/serverless, zod
├── tsconfig.json
├── Dockerfile
├── fly.toml
├── README.md
│
├── habitat/                 # Habitat work directory (the deployable unit)
│   ├── config.json          # habitat config (name, defaultProvider optional)
│   ├── stimulus.md          # "You are an Oura Ring health data assistant..."
│   └── secrets.json.example # template for OURA_CLIENT_ID, OURA_CLIENT_SECRET, etc.
│
└── src/
    ├── server.ts            # Boot Habitat, register oura tools, HTTP server for /mcp + /oauth/*
    ├── mcp-handler.ts       # Bridge: habitat.getTools() → McpServer, with per-user auth context
    ├── oura-tool-set.ts     # ToolSet: oura tools (sleep, readiness, activity, stress, hr)
    │
    ├── oauth/
    │   ├── metadata.ts      # /.well-known/oauth-authorization-server + /oauth-protected-resource
    │   ├── register.ts      # POST /oauth/register — dynamic client registration
    │   ├── authorize.ts     # GET /oauth/authorize — chains to Oura, handles callback
    │   └── token.ts         # POST /oauth/token — exchange code/refresh for MCP tokens
    │
    └── store.ts             # Neon Postgres: oauth_clients, auth_sessions, mcp_tokens, oura_tokens
```

### How habitat fits in

```typescript
// server.ts (simplified)
import { Habitat } from 'umwelten';
import { ouraToolSet } from './oura-tool-set.js';

// 1. Boot habitat from work directory
const habitat = await Habitat.create({
  workDir: './habitat',
  skipBuiltinTools: true,  // we only want oura tools over MCP
});

// 2. Register oura tools (reads OURA_CLIENT_ID etc from habitat secrets)
habitat.addToolSet(ouraToolSet);

// 3. Serve habitat tools over MCP with OAuth
// mcp-handler.ts iterates habitat.getTools() and registers each with McpServer
startMcpServer({ habitat, port: 8080 });
```

The key: `ouraToolSet` is a standard `ToolSet` (same interface as `fileToolSet`,
`searchToolSet`, etc.). It receives the habitat context and reads secrets from it.
The server.ts just wires habitat → MCP. Swap `ouraToolSet` for `twitterToolSet`
and you have a Twitter MCP server with the same server code.

## Storage (Neon serverless Postgres)

Uses `@neondatabase/serverless` with the `neon()` tagged template function —
HTTP-based, no WebSocket setup, perfect for serverless/fly.io. One-shot queries
for reads, `sql.transaction()` for multi-statement writes.

```sql
-- MCP clients registered via DCR
CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  redirect_uris JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pending authorization flows (short-lived, cleaned up by TTL)
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,           -- random UUID
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  state TEXT,                    -- client's state param
  resource TEXT,                 -- RFC 8707 resource indicator
  oura_state TEXT,               -- our state for Oura OAuth
  mcp_auth_code TEXT,            -- MCP auth code we issue (after Oura callback)
  user_id TEXT,                  -- assigned after Oura callback
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes'
);

-- MCP access/refresh tokens → user mapping
CREATE TABLE mcp_tokens (
  token_hash TEXT PRIMARY KEY,   -- SHA-256 of the token
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  token_type TEXT NOT NULL,      -- 'access' or 'refresh'
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user Oura credentials
CREATE TABLE oura_tokens (
  user_id TEXT PRIMARY KEY,      -- derived from Oura personal_info
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  scopes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Periodic cleanup: DELETE FROM auth_sessions WHERE expires_at < now();
-- Periodic cleanup: DELETE FROM mcp_tokens WHERE expires_at < now();
```

## Key design decisions

### User identity
The user_id comes from Oura itself — after the Oura OAuth callback, we call
`GET /v2/usercollection/personal_info` with their token to get their Oura user ID.
That becomes the canonical user identity. No separate user registration needed.

### MCP tokens
We issue our own opaque tokens (random UUIDs). We hash them for storage
and look up the user_id on each request. Short-lived access tokens (1 hour),
long-lived refresh tokens (30 days).

### Oura token refresh
Oura access tokens expire. Before each API call, check expiry. If expired,
use the stored refresh_token to get a new one. Oura refresh tokens are
single-use, so we store the new refresh_token each time.

### Habitat is the core
The habitat manages tools (oura ToolSet), secrets (OURA_CLIENT_ID/SECRET,
TOKEN_SECRET), and config. It's the unit of deployment — the MCP server just
exposes whatever tools the habitat has. This means if you swap the oura ToolSet
for a twitter ToolSet, the same server code works unchanged.

Neon handles what habitat doesn't do today: multi-user OAuth state. The four
tables (oauth_clients, auth_sessions, mcp_tokens, oura_tokens) are the
multi-user auth layer that sits *in front of* the habitat.

### No LLM needed (but opt-in)
This server has no default model — it's a pure tool server. MCP clients bring
their own LLM. But because it's a habitat, you *can* add a model + stimulus
and also chat with it directly via gaia-server/telegram/discord.

### Stateless MCP transport
Each /mcp POST creates a fresh McpServer + StreamableHTTPServerTransport
(same pattern as bridge/server.ts). The auth context (user_id) is extracted
from the Bearer token and threaded into tool handlers.

## Environment variables (fly secrets)

```
DATABASE_URL=postgres://...@....neon.tech/neondb  # Neon connection string
OURA_CLIENT_ID=...           # From cloud.ouraring.com/oauth/applications
OURA_CLIENT_SECRET=...       # Same
BASE_URL=https://oura-mcp.fly.dev  # Public URL for OAuth redirects
TOKEN_SECRET=...             # Secret for signing/hashing tokens
```

## Implementation order

1. `store.ts` — SQLite schema + CRUD operations
2. `oauth/metadata.ts` — Well-known endpoints (simplest, no logic)
3. `oauth/register.ts` — DCR endpoint
4. `oauth/authorize.ts` — The chain: MCP authorize → Oura OAuth → callback → issue MCP code
5. `oauth/token.ts` — Code exchange + refresh
6. `tools.ts` — Oura API tools with per-user token lookup
7. `mcp-handler.ts` — Wire McpServer + tools + auth context
8. `server.ts` — HTTP router, glue everything together
9. `Dockerfile` + `fly.toml` — Deployment
10. `README.md` — Documentation

## Oura tools exposed

| Tool | Oura endpoint | Description |
|------|---------------|-------------|
| `oura_sleep` | `/v2/usercollection/daily_sleep` | Daily sleep scores |
| `oura_sleep_detail` | `/v2/usercollection/sleep` | Detailed sleep periods (deep/REM/light/HR/HRV) |
| `oura_readiness` | `/v2/usercollection/daily_readiness` | Readiness scores + contributors |
| `oura_activity` | `/v2/usercollection/daily_activity` | Steps, calories, activity score |
| `oura_stress` | `/v2/usercollection/daily_stress` | Stress/recovery minutes |
| `oura_heart_rate` | `/v2/usercollection/heartrate` | Time-series heart rate |

All tools take `start_date` (required) and `end_date` (optional, defaults to start_date).

## Size estimate

| File | Lines |
|------|-------|
| store.ts | ~100 |
| oauth/metadata.ts | ~40 |
| oauth/register.ts | ~40 |
| oauth/authorize.ts | ~120 |
| oauth/token.ts | ~80 |
| tools.ts | ~100 |
| mcp-handler.ts | ~60 |
| server.ts | ~80 |
| **Total** | **~620** |
