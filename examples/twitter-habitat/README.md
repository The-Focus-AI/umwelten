# Twitter habitat

A deployable umwelten Habitat whose Agent answers Twitter/X questions
conversationally over A2A (PRD #149). This is a **self-contained example agent**
(like `examples/twitter-mcp`) — its own `package.json`, `pnpm-workspace.yaml`,
`tsconfig.json`, and lockfile, installed and tested independently of the
monorepo workspace. The deep modules live here under `src/`, not in the umwelten
library packages.

## Develop / test

```bash
cd examples/twitter-habitat
pnpm install        # standalone install (this dir is its own pnpm root)
pnpm test:run       # token-store + OAuth + X read-client unit tests (vitest)
```

> Status: scaffolding in progress. #150 shipped the **auth foundation** (X OAuth
> token store + bootstrap). #151 adds the **habitat work dir** (config + persona +
> `tools/`) and the first read tool — **bookmarks** — chattable end-to-end. The
> X read client is introduced here (bookmarks call only). #153 adds the **Neon
> feed reader** (public-data path) + the `person_recent`, `list_digest`, and
> `high_engagement` tools. The full persona ("what's new" briefing) and the fly
> deploy land in #154–#155.

## Run it as a habitat

This directory doubles as the habitat work dir (`config.json` + `STIMULUS.md` +
`tools/`). Boot it with the monorepo CLI and chat over A2A. (Run these from the
**repo root**, which has the umwelten CLI + `.env`.)

```bash
# 1. Seed the X credentials as habitat secrets (one-time; see bootstrap below).
dotenvx run -- pnpm run cli habitat secrets set TWITTER_CLIENT_ID     '...' --work-dir examples/twitter-habitat
dotenvx run -- pnpm run cli habitat secrets set TWITTER_CLIENT_SECRET '...' --work-dir examples/twitter-habitat
dotenvx run -- pnpm run cli habitat secrets set TWITTER_REFRESH_TOKEN '...' --work-dir examples/twitter-habitat

# 2. Serve the habitat (A2A + chat). Uses openrouter by default (config.json);
#    override with --provider/--model. Needs OPENROUTER_API_KEY in .env.
dotenvx run -- pnpm run cli habitat serve --work-dir examples/twitter-habitat --port 7430

# 3. In another terminal, chat with it:
dotenvx run -- pnpm run cli habitat chat --url http://localhost:7430 --one-shot "show my bookmarks"
```

The `bookmarks` tool (`tools/bookmarks/`) is a factory-pattern Agent tool: it
pulls the X credentials from Habitat secrets, drives the token store → X read
client, and returns your real bookmarks (text, author, engagement, permalink),
streamed back through the chat.

> The handler in `tools/bookmarks/handler.ts` imports `ai`/`zod` and the `src/`
> modules; it is loaded and run by the **monorepo** habitat runtime, so it is not
> part of this example's standalone `tsc`/`vitest` build (which only covers
> `src/`). The deep modules it calls (`token-store`, `x-read-client`) are unit-tested.

## Two data sources, split by privacy

- **Private** (bookmarks, mentions, my timeline) → official X API v2 via my own
  OAuth user token. Handled by the **X token store** (`src/token-store.ts` →
  `XTokenStore`).
- **Public** (specific people, lists, digests, engagement) → read from the Neon
  database that the existing `twitter-feed` pipeline syncs. Handled by the
  **feed reader** (`src/feed-reader.ts` → `FeedReader`), surfaced as the
  `person_recent`, `list_digest`, and `high_engagement` tools (#153).

## Public-data tools (the feed reader)

The `FeedReader` (`src/feed-reader.ts`) is a read-only consumer of the Neon tables
the `twitter-feed` pipeline populates (`cached_tweets`, `twitter_profiles`,
`twitter_lists` / `twitter_list_members`, `summaries`). It holds **no**
twitterapi.io key — only a `DATABASE_URL` (a habitat secret, or the `DATABASE_URL`
env var; fly.io injects secrets as env). Engagement is ranked by
`likes + retweets + replies`, matching the pipeline's own formula. The Postgres
boundary is an injected `QueryExecutor`, bound to `@neondatabase/serverless`'s
`neon()` in production and a seeded in-memory fake in unit tests. Schema +
driver notes: `reports/2026-06-16-twitter-feed-neon-schema.md` and
`reports/2026-06-16-neon-serverless-readonly-driver.md`.

Three factory-pattern Agent tools (`tools/{person-recent,list-digest,high-engagement}/`):

| Tool             | Question it answers                    | Key args                    |
| ---------------- | -------------------------------------- | --------------------------- |
| `person_recent`  | "what's @person been posting?"         | `handle`, `limit`, `sinceHours` |
| `list_digest`    | "digest the AI engineers list"         | `list` (slug or name), `limit`, `sinceHours` |
| `high_engagement`| "what's notable right now?"            | `limit`, `sinceHours`       |

```bash
# Seed the Neon connection string (the public-data path needs only this secret):
dotenvx run -- pnpm run cli habitat secrets set DATABASE_URL 'postgres://...' --work-dir examples/twitter-habitat

# Serve, then chat:
dotenvx run -- pnpm run cli habitat serve --work-dir examples/twitter-habitat --port 7430
dotenvx run -- pnpm run cli habitat chat --url http://localhost:7430 --one-shot "what's @karpathy been posting?"
dotenvx run -- pnpm run cli habitat chat --url http://localhost:7430 --one-shot "digest the ai-engineers list"
dotenvx run -- pnpm run cli habitat chat --url http://localhost:7430 --one-shot "what are the top tweets right now?"
```

An unknown list degrades to a friendly "I don't track that list"; a missing
`DATABASE_URL` returns an actionable config error rather than crashing.

## Authentication: the X token store

The habitat authenticates as a single X account via a stored refresh token. The
token store (`XTokenStore`) keeps a valid access token available without a login
UI:

- returns the cached access token while valid (no network call);
- refreshes via the `refresh_token` grant on expiry (5-min skew) or on a forced
  reactive refresh after a 401;
- persists the rotated, single-use refresh token back to Habitat secrets before
  returning (so a container restart stays authenticated);
- coalesces concurrent refreshes into one in-flight grant (presenting the
  single-use refresh token twice would invalidate it);
- throws an actionable `needs_reauth` error when no refresh token is present.

See the design notes in `reports/2026-06-16-x-oauth2-token-refresh.md`.

### Secrets

| Secret                  | Where it comes from                          |
| ----------------------- | -------------------------------------------- |
| `TWITTER_CLIENT_ID`     | X developer portal (your app)                |
| `TWITTER_CLIENT_SECRET` | X developer portal (your app)                |
| `TWITTER_REFRESH_TOKEN` | the bootstrap script (seed); then self-rotated |

## One-time OAuth bootstrap

Run once on your machine to mint the initial refresh token:

```bash
TWITTER_CLIENT_ID=... TWITTER_CLIENT_SECRET=... \
  pnpm tsx examples/twitter-habitat/bootstrap-oauth.ts
```

It prints an authorize URL, catches the redirect on
`http://localhost:9876/callback` (register this exact Callback URI in the X app's
OAuth 2.0 settings), exchanges the code, and prints the three secret values to
store on the habitat. The refresh token it prints is only a **seed** — once the
habitat refreshes, X rotates it and the habitat persists the new one itself.
