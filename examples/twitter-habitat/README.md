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
pnpm test:run       # runs the token-store + OAuth unit tests (vitest)
```

> Status: scaffolding in progress. This issue (#150) ships the **authentication
> foundation** — the X OAuth token store + the one-shot bootstrap script. The
> tools, persona, feed reader, and fly deploy land in #151–#155.

## Two data sources, split by privacy

- **Private** (bookmarks, mentions, my timeline) → official X API v2 via my own
  OAuth user token. Handled by the **X token store** (`src/token-store.ts` →
  `XTokenStore`).
- **Public** (specific people, lists, digests, engagement) → read from the Neon
  database that the existing `twitter-feed` pipeline syncs. (Issue #153.)

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
