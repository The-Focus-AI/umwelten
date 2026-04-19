# twitter-mcp — Twitter/X as a Multi-User MCP Server

An MCP server that exposes Twitter/X (posts, timeline, search, likes, retweets, lists) as MCP tools. Built on the **`mcp-serve`** library (`umwelten/mcp-serve`), which provides the HTTP server, OAuth 2.1 authorization server, MCP transport, and Neon Postgres store. This example implements the Twitter-specific OAuth provider and tool registration.

## Architecture

`mcp-serve` chains two layers of OAuth:

- **MCP OAuth** — authenticates MCP clients (Claude, Amp, Cursor). The library acts as its own Authorization Server, implementing dynamic client registration, authorization, and token endpoints.
- **Upstream OAuth** — chained during the MCP auth flow. The `TwitterProvider` implements `UpstreamOAuthProvider` to redirect users to Twitter. Tokens are stored per-user in Neon Postgres via `NeonStore`.

```
MCP Client ──► mcp-serve library ──► TwitterProvider ──► Twitter API v2
  (Claude)     (OAuth AS + MCP)       (upstream OAuth)    (tweets, timeline, ...)
               (NeonStore / Postgres)
```

**PKCE is required by Twitter.** `TwitterProvider` generates a per-flow code verifier in `buildAuthorizeUrl`, keyed by the upstream state, and consumes it via the `upstreamState` parameter in `exchangeCode`. Without this the authorize endpoint returns `error=invalid_request`.

**Public URL:** On Fly.io, OAuth `issuer`, `resource_metadata`, and Twitter `redirect_uri` are derived from **`X-Forwarded-Proto` and `Host`** so they match the browser even if `BASE_URL` is wrong or unset. Locally, set `BASE_URL` or rely on `http://localhost:<port>` from `Host`.

## Prerequisites

- Node.js 22+
- A [Neon](https://neon.tech) database (free tier works)
- A [Twitter developer app](https://developer.twitter.com/en/portal/dashboard) with:
  - **Type of App:** `Web App, Automated App or Bot` (Confidential client). OAuth 2.0 + PKCE requires this; `Native App` / `Public client` will return `invalid_request`.
  - **App permissions:** `Read` (or `Read and write` if you want `twitter_post`, `twitter_like`, `twitter_retweet`)
  - **Callback URI (dev):** `http://localhost:8080/oauth/upstream-callback`
  - **Callback URI (prod):** `https://<your-fly-app>.fly.dev/oauth/upstream-callback` (must match the hostname users hit; e.g. if `fly.toml` has `app = "focus-twitter-mcp"`, use `https://focus-twitter-mcp.fly.dev/oauth/upstream-callback`)
  - **Scopes requested** (in code): `tweet.read tweet.write users.read list.read list.write like.read like.write bookmark.read bookmark.write offline.access`. Full set matches the `twitter-skill` plugin.
- [Fly.io](https://fly.io) account (for deployment)

## Local development

```bash
cd examples/twitter-mcp
pnpm install

# Environment variables (see table below)
export DATABASE_URL="postgres://..."
export TWITTER_CLIENT_ID="..."
export TWITTER_CLIENT_SECRET="..."
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
cd examples/twitter-mcp
docker build -t twitter-mcp .
```

The image installs dependencies from npm, including the published **`umwelten`** package (which provides `umwelten/mcp-serve`), so the image does not need the parent monorepo.

## Deploying to Fly.io

From **`examples/twitter-mcp`** (where `fly.toml` and `Dockerfile` live):

```bash
cd examples/twitter-mcp
fly launch   # if you have not already; creates/updates fly.toml
```

**Database:** Run migrations once against Neon (from your machine):

```bash
cd examples/twitter-mcp
# DATABASE_URL must point at the same DB Fly will use
pnpm run db:setup
```

**Secrets:** Set variables your app reads at runtime (`DATABASE_URL`, `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`, `TOKEN_SECRET`). `BASE_URL` is **optional on Fly** if the proxy sends `X-Forwarded-Proto` / `Host` (see Architecture).

```bash
fly secrets set \
  DATABASE_URL="postgresql://..." \
  TWITTER_CLIENT_ID="..." \
  TWITTER_CLIENT_SECRET="..." \
  TOKEN_SECRET="$(openssl rand -hex 32)"
```

Then:

```bash
fly deploy
```

## Connecting from Claude Code

```bash
claude mcp add --transport http twitter https://<your-fly-app>.fly.dev/mcp
```

Use **`--scope user`**, **`project`**, or default **local** as needed ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp)).

## Connecting from umwelten

```bash
# REPL chat (OAuth handled automatically, tokens stored in ~/.umwelten/mcp-auth/)
dotenvx run -- pnpm run cli mcp chat --url https://<your-fly-app>.fly.dev/mcp

# One-shot prompt
dotenvx run -- pnpm run cli mcp chat --url https://<your-fly-app>.fly.dev/mcp \
  --one-shot "what's on my timeline?"

# Clear stored OAuth credentials
dotenvx run -- pnpm run cli mcp chat --url https://<your-fly-app>.fly.dev/mcp --logout
```

`mcp chat` defaults to `--max-steps 100` so the LLM can chain tool calls across a turn.

## Connecting from other MCP clients (JSON)

Many clients expect **streamable HTTP** and your public `/mcp` URL:

```json
{
  "mcpServers": {
    "twitter": {
      "type": "streamable-http",
      "url": "https://<your-fly-app>.fly.dev/mcp"
    }
  }
}
```

On first connect, complete OAuth; you will be sent through Twitter to link the account.

## Available tools

| Tool | Twitter Endpoint | Description |
|------|------------------|-------------|
| `twitter_me` | `/2/users/me` | Authenticated user profile |
| `twitter_user` | `/2/users/by/username/:handle` | Look up user by username |
| `twitter_post` | `POST /2/tweets` | Post a new tweet |
| `twitter_delete_tweet` | `DELETE /2/tweets/:id` | Delete a tweet |
| `twitter_tweet` | `/2/tweets/:id` | Get a tweet by ID |
| `twitter_my_tweets` | `/2/users/:id/tweets` | Recent tweets from the authenticated user |
| `twitter_timeline` | `/2/users/:id/timelines/reverse_chronological` | Home timeline |
| `twitter_search` | `/2/tweets/search/recent` | Search recent tweets (last 7 days) |
| `twitter_like` | `POST /2/users/:id/likes` | Like a tweet |
| `twitter_retweet` | `POST /2/users/:id/retweets` | Retweet |
| `twitter_lists` | `/2/users/:id/owned_lists` | Get my Twitter lists |
| `twitter_list_tweets` | `/2/lists/:id/tweets` | Get tweets from a list |
| `twitter_list_members` | `/2/lists/:id/members` | Get members of a list |
| `twitter_list_create` | `POST /2/lists` | Create a new list |
| `twitter_list_delete` | `DELETE /2/lists/:id` | Delete a list |
| `twitter_list_add_member` | `POST /2/lists/:id/members` | Add a user to a list |
| `twitter_list_remove_member` | `DELETE /2/lists/:id/members/:user_id` | Remove a user from a list |
| `twitter_bookmarks` | `/2/users/:id/bookmarks` | Get my bookmarked tweets |
| `twitter_bookmark` | `POST /2/users/:id/bookmarks` | Bookmark a tweet |
| `twitter_unbookmark` | `DELETE /2/users/:id/bookmarks/:tweet_id` | Remove a bookmark |

Write tools (`twitter_post`, `twitter_delete_tweet`, `twitter_like`, `twitter_retweet`, `twitter_bookmark`, `twitter_unbookmark`, `twitter_list_create`, `twitter_list_delete`, `twitter_list_add_member`, `twitter_list_remove_member`) require the Twitter app to have `Read and write` permissions **and** the corresponding scopes (`tweet.write`, `like.write`, `bookmark.write`, `list.write`) in `src/twitter-provider.ts`.

## How it works

1. MCP client connects to `/mcp` → may receive **401** with `WWW-Authenticate` and `resource_metadata` for the protected-resource document.
2. Client discovers OAuth endpoints via `/.well-known/oauth-authorization-server`.
3. Client registers dynamically via `POST /oauth/register`.
4. Client redirects the user to `/oauth/authorize` with a PKCE challenge (MCP-side PKCE).
5. Server chains to Twitter OAuth with its own PKCE challenge (Twitter-side PKCE, required); user authorizes Twitter; tokens are stored per user in Postgres.
6. Server issues an MCP authorization code and redirects back to the client.
7. Client exchanges the code at `POST /oauth/token`.
8. Authenticated `/mcp` requests use `Authorization: Bearer <mcp-token>`; the server resolves the user and registers Twitter-backed tools for that session.

## Environment variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon Postgres connection string |
| `TWITTER_CLIENT_ID` | From [Twitter developer portal](https://developer.twitter.com/en/portal/dashboard) |
| `TWITTER_CLIENT_SECRET` | From Twitter developer portal |
| `BASE_URL` | Public origin for OAuth when **not** behind a proxy that sets `X-Forwarded-Proto` (local dev). On Fly, usually omitted. |
| `TOKEN_SECRET` | Secret for hashing MCP tokens (`openssl rand -hex 32` in production) |
| `PORT` | HTTP port (default `8080`; Fly sets `internal_port` in `fly.toml`) |

## Key files

| Path | Role |
|------|------|
| `src/server.ts` | Entry point — creates the MCP server via `mcp-serve` library |
| `src/twitter-provider.ts` | `UpstreamOAuthProvider` for Twitter OAuth 2.0 with PKCE |
| `src/twitter-tools.ts` | `McpToolRegistrar` — Twitter API v2 → MCP tools |
| `src/db-setup.ts` | Creates DB tables via `NeonStore.setupTables()` |

## Wrapping another API with `mcp-serve`

See the corresponding section in [`examples/oura-mcp/README.md`](../oura-mcp/README.md#wrapping-another-api-with-mcp-serve) — same recipe. If your upstream service requires PKCE (like Twitter), use the `upstreamState` parameter of `exchangeCode` to correlate verifier and exchange; `twitter-provider.ts` is a working reference.
