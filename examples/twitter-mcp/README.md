# twitter-mcp

Multi-user Twitter/X MCP server. Each connecting user authenticates with their own Twitter account via OAuth. Built on the `mcp-serve` library from umwelten.

## How it works

```
Claude/Amp/Cursor ──MCP OAuth──▶ twitter-mcp ──Twitter OAuth──▶ Twitter API
     (user A)                    (this server)                  (user A's account)
```

1. User connects to `https://your-server/mcp` from their MCP client
2. Server challenges with 401 → client discovers OAuth endpoints
3. User's browser is redirected to Twitter to authorize
4. Server stores per-user Twitter tokens in Neon Postgres
5. MCP tools (post, search, timeline, etc.) use the user's own Twitter credentials

## Architecture

This example uses the **`mcp-serve`** library (`src/habitat/mcp-serve/`), which provides:
- OAuth server (DCR, PKCE, token exchange)
- MCP Streamable HTTP transport
- Per-user upstream token management

The Twitter-specific code is just two files:
- `twitter-provider.ts` — Twitter OAuth flow (authorize URL, code exchange, token refresh)
- `twitter-tools.ts` — MCP tool definitions that call the Twitter API v2

## Setup

### 1. Twitter Developer App

1. Go to [developer.twitter.com](https://developer.twitter.com/en/portal/dashboard)
2. Create a project and app
3. In "User authentication settings":
   - Type: **Web App, Automated App or Bot**
   - Permissions: **Read and Write**
   - Callback URI: `https://your-server/oauth/upstream-callback`
   - Website URL: `https://your-server`
4. Copy **Client ID** and **Client Secret**

### 2. Neon Database

1. Create a database at [neon.tech](https://neon.tech)
2. Copy the connection string

### 3. Environment Variables

```bash
DATABASE_URL=postgres://...@....neon.tech/neondb
TWITTER_CLIENT_ID=...
TWITTER_CLIENT_SECRET=...
```

### 4. Initialize Database

```bash
DATABASE_URL=... pnpm tsx src/db-setup.ts
```

### 5. Run

```bash
# Development
pnpm dev

# Production
pnpm build && pnpm start
```

### 6. Connect

From Claude Code, Amp, or any MCP client:
```bash
# Amp
dotenvx run -- pnpm run cli mcp chat --url https://your-server/mcp

# Claude Code
claude mcp add twitter-mcp --url https://your-server/mcp
```

## Available Tools

| Tool | Description |
|------|-------------|
| `twitter_me` | Get authenticated user profile |
| `twitter_user` | Look up user by username |
| `twitter_post` | Post a tweet |
| `twitter_delete_tweet` | Delete a tweet |
| `twitter_tweet` | Get a tweet by ID |
| `twitter_my_tweets` | Get my recent tweets |
| `twitter_timeline` | Home timeline |
| `twitter_search` | Search recent tweets |
| `twitter_like` | Like a tweet |
| `twitter_retweet` | Retweet |
| `twitter_lists` | Get my lists |
| `twitter_list_tweets` | Get tweets from a list |

## Deploy to Fly.io

```bash
fly launch
fly secrets set DATABASE_URL=... TWITTER_CLIENT_ID=... TWITTER_CLIENT_SECRET=...
fly deploy
```

Update your Twitter app's callback URI to `https://your-app.fly.dev/oauth/upstream-callback`.

## Creating Your Own Service MCP

To wrap another API as a hosted MCP server, you need two things:

1. **An `UpstreamOAuthProvider`** — implements `buildAuthorizeUrl()`, `exchangeCode()`, `refreshToken()`
2. **A tool registrar** — registers MCP tools that call the upstream API with per-user tokens

See `twitter-provider.ts` and `twitter-tools.ts` as templates. The `mcp-serve` library handles everything else (OAuth server, MCP transport, token storage).
