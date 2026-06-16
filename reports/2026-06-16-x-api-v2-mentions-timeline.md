# X API v2 READ endpoints: User Mentions + Reverse-Chronological Home Timeline

**Date:** 2026-06-16
**Scope:** Implementation notes for two new methods on the existing thin `XReadClient` (`examples/twitter-habitat/src/x-read-client.ts`), which already does `GET /2/users/:id/bookmarks` with an OAuth 2.0 user-context bearer token.
**Audience:** the engineer adding `getMentions()` and `getHomeTimeline()`.

---

## TL;DR

| | User mentions | Home timeline (reverse-chron) |
|---|---|---|
| Path | `GET /2/users/{id}/mentions` | `GET /2/users/{id}/timelines/reverse_chronological` |
| `{id}` | the user you want mentions *of* (use **me**) | **MUST be the authenticated user's own id** |
| `max_results` | min **5**, max **100**, default 10 | min **1**, max **100**, default 10 |
| Auth | User-context **or** App-only | **User-context only** (no app-only/bearer-app) |
| OAuth 2.0 scopes | `tweet.read`, `users.read` | `tweet.read`, `users.read`, **`follows.read`** |
| Rate limit (per user) | 300 / 15 min | 180 / 15 min |
| Rate limit (per app) | 450 / 15 min | — (per-user only) |
| Lookback ceiling | 800 most-recent mentions | 3,200 posts, or last 7 days |

Both share the **same** `public_metrics` field names as bookmarks, so the existing parsing maps over unchanged.

**Canonical host: `https://api.x.com/2`.** The X-docs curl examples now use `api.x.com`; `api.twitter.com` still resolves (alias) but `api.x.com` is the current canonical host and is what your client already uses. Keep `DEFAULT_BASE_URL = 'https://api.x.com/2'`.

---

## 1. User Mentions Timeline — "who replied to / mentioned me"

### Path
```
GET /2/users/{id}/mentions
```
`{id}` is the user whose mentions you want. For "mentions of me", pass the authenticated user's id (you already cache it via `getMe()`). Unlike the home timeline, `{id}` does **not** have to be the authenticated user — but for this client's purpose it always will be.

### Query parameters
| Param | Notes |
|---|---|
| `max_results` | Range **5–100** (note: min is 5, not 1, unlike bookmarks/timeline). Default 10. |
| `tweet.fields` | Comma list. Use `created_at,public_metrics,author_id`. |
| `expansions` | `author_id` to hydrate the mentioning user into `includes.users[]`. |
| `user.fields` | `username,name` (matches bookmarks). |
| `pagination_token` | Pass `meta.next_token` from the prior page to go forward. |
| `start_time` / `end_time` | `YYYY-MM-DDTHH:mm:ssZ`. Window by time. |
| `since_id` / `until_id` | Bound by tweet id. `since_id` **takes precedence over** `start_time`; `until_id` over `end_time`. `since_id` is the clean way to poll "new since last seen". |
| `media.fields`, `poll.fields`, `place.fields` | Available; not needed for this client. |

### Response shape
```jsonc
{
  "data": [
    {
      "id": "1234567890",
      "text": "@you nice work",
      "created_at": "2026-06-16T12:00:00.000Z",
      "author_id": "999",
      "public_metrics": {
        "like_count": 0, "retweet_count": 0,
        "reply_count": 0, "quote_count": 0
      }
    }
  ],
  "includes": {
    "users": [ { "id": "999", "username": "someone", "name": "Some One" } ]
  },
  "meta": {
    "result_count": 1,
    "newest_id": "...",
    "oldest_id": "...",
    "next_token": "...",
    "previous_token": "..."
  }
}
```
Identical structural shape to bookmarks: `data[]` tweets, `includes.users[]` to join on `author_id`, `meta` for pagination. **Reuse the bookmarks parsing verbatim.**

### Scopes (OAuth 2.0 user-context)
- `tweet.read`
- `users.read`

(No `follows.read` — mentions are not follow-graph-scoped.)

### Rate limits
- Per user: **300 / 15 min**
- Per app: **450 / 15 min**
- Hard ceiling: only the **800 most recent** mentions are reachable via pagination.

---

## 2. Reverse-Chronological Home Timeline — the authenticated user's feed

### Path
```
GET /2/users/{id}/timelines/reverse_chronological
```

### `{id}` MUST be the authenticated user — CONFIRMED
This endpoint returns "the most recent Posts, Retweets and replies posted by **you and the accounts you follow**." It is **user-context only** (app-only / app-bearer auth is rejected), and the `{id}` must be the id of the authenticated (token-owning) user. Passing any other user's id is not a supported "read someone else's home feed" operation. In code: always pass `me.id` from `getMe()`; do not accept an arbitrary id from the caller.

### Query parameters
| Param | Notes |
|---|---|
| `max_results` | Range **1–100**, default 10. |
| `tweet.fields` | `created_at,public_metrics,author_id`. |
| `expansions` | `author_id`. |
| `user.fields` | `username,name`. |
| `pagination_token` | `meta.next_token` to page forward. |
| `start_time` / `end_time` | Same `YYYY-MM-DDTHH:mm:ssZ` windowing. |
| `since_id` / `until_id` | Same precedence rules as mentions. `since_id` is the poll-for-new primitive. |

### Response shape
Same envelope as mentions/bookmarks: `data[]`, `includes.users[]`, `meta`. The home feed mixes original posts, retweets and replies; if you later want to distinguish them, add `referenced_tweets` to `tweet.fields` (a retweet has a `referenced_tweets[].type === "retweeted"`). Not required for a first pass.

> Caveat from the dev community: this endpoint's `public_metrics` are returned, but some *non-public* metric fields are not available on the timeline endpoint the way they are on `/2/users/:id/tweets`. `public_metrics` (the four counts you use) **are** present — no change for this client.

### Scopes (OAuth 2.0 user-context)
- `tweet.read`
- `users.read`
- **`follows.read`** ← required because the feed is derived from your follow graph. This is the one scope difference vs. bookmarks/mentions.

Make sure the OAuth authorize step (`x-oauth.ts`) requests `follows.read` (and `offline.access` for refresh) or this call returns 403 even with a valid token. If the existing token was minted without `follows.read`, **the home-timeline call will 403 and the user must re-authorize** with the expanded scope set — a forced `forceRefresh` will NOT fix it (refresh cannot widen scope).

### Rate limits
- Per user: **180 / 15 min**
- No per-app limit (the endpoint is inherently per-user).
- Reachable history: last **3,200 posts** or **7 days**, whichever is hit first.

---

## Gotchas / Access-Tier

1. **Host.** Use `https://api.x.com/2`. Already correct in the client. `api.twitter.com` is a legacy alias; don't switch to it.

2. **`public_metrics` field names match bookmarks exactly.** `like_count`, `retweet_count`, `reply_count`, `quote_count`. Your existing `PublicMetrics` interface and flat-mapping (`likes/retweets/replies/quotes`) work unchanged for both new endpoints.

3. **`max_results` minimum differs.** Bookmarks and home-timeline accept min 1; **mentions requires min 5**. If you clamp with the bookmarks helper `Math.min(Math.max(n,1),100)`, a caller asking for `maxResults: 2` on mentions will send `2` and get a 400. For mentions, clamp to **`Math.min(Math.max(n,5),100)`**.

4. **Home timeline is user-context only and follow-scoped.** App-bearer tokens are rejected outright; needs `follows.read`. This is the most likely source of a "works for bookmarks, 403 for timeline" surprise. The fix is a scope change at authorize time, not a token refresh.

5. **Access tier — the big one (2025–2026).** Both endpoints are **not on the Free tier** for general use. As of the 2025 tier model they require **Basic ($) or higher**; X's Free tier is write-mostly (post/delete + `/users/me`) and read endpoints like timelines/mentions are gated. **As of ~Feb 2026, X moved to a pay-per-use default model** replacing the old fixed tiers for new apps; the practical effect is the same — these reads consume paid quota / require an enrolled (project-attached, paid) app. If the habitat's X app is on Free/unenrolled, **both calls will fail with 403 `client-not-enrolled`** regardless of correct scopes. This is an account/billing problem, surface it as such, do not retry.

6. **Monthly post-pull cap.** On Basic, pulled posts count against a monthly cap (e.g. the documented ~10k–15k/month Basic read cap historically). A high-`max_results` polling loop on the home timeline can exhaust it fast. Keep `max_results` modest and lean on `since_id` to avoid re-pulling.

### Error responses — distinguishing "needs reauth" from "tier doesn't allow this"

| Status | Meaning | Client action |
|---|---|---|
| **401 Unauthorized** | Token missing/expired/invalid. | This is the **reauth/refresh** signal. Your existing 401→`forceRefresh`→retry-once logic handles the "stale token" case. If it 401s *again after* a forced refresh, the token is truly dead → surface "needs re-login". |
| **403 Forbidden, `client-not-enrolled`** (with `required_enrollment: "Appropriate Level of API Access"`) | App is not attached to a paid/enrolled project, or the tier doesn't include this endpoint. | **Tier/billing problem.** Do NOT refresh, do NOT retry. Surface "your X app needs Basic+ / pay-per-use enrollment." |
| **403 Forbidden, missing scope** | Token valid but lacks `follows.read` (home timeline) or the needed scope. | **Re-authorize with wider scope.** A refresh will not help (refresh can't widen scope). Surface "re-connect X to grant the home-timeline permission." |
| **400 Bad Request** | Bad param — most commonly `max_results` below the per-endpoint minimum (5 for mentions). | Fix the request; not auth-related. |
| **429 Too Many Requests** | Rate limit hit. Honor `x-rate-limit-reset` header. | Back off; not auth-related. |

**Key distinction for the client:** `401` ⇒ token problem (your refresh-and-retry path). `403` ⇒ permission/tier problem (refresh won't help — either re-authorize for scope, or fix enrollment/billing). The current client throws a generic `Error("X read failed: <status> ...")` for any non-OK; consider branching so `401` keeps the refresh path while `403` raises a distinct, non-retryable "needs reauth/enrollment" error that the agent surfaces to the user.

---

## TypeScript-shaped implementation notes

The two new methods are near-clones of `getBookmarks()`. They differ only in path, the `max_results` clamp (mentions), and (for the type system) nothing — the response envelope and parsing are identical.

### `getMentions()`
```ts
async getMentions(opts: { maxResults?: number; sinceId?: string; paginationToken?: string } = {}): Promise<XBookmark[]> {
  const max = Math.min(Math.max(opts.maxResults ?? 20, 5), 100); // NOTE: min 5, not 1
  const me = await this.getMe();
  const params = new URLSearchParams({
    max_results: String(max),
    'tweet.fields': 'created_at,public_metrics,author_id',
    expansions: 'author_id',
    'user.fields': 'username,name',
  });
  if (opts.sinceId) params.set('since_id', opts.sinceId);
  if (opts.paginationToken) params.set('pagination_token', opts.paginationToken);

  const body = (await this.authedGetJson(
    `/users/${me.id}/mentions?${params.toString()}`,
  )) as { data?: RawTweet[]; includes?: { users?: RawUser[] } };

  return this.shapeTweets(body); // factor the bookmarks map() into a shared private helper
}
```

### `getHomeTimeline()`
```ts
async getHomeTimeline(opts: { maxResults?: number; sinceId?: string; paginationToken?: string } = {}): Promise<XBookmark[]> {
  const max = Math.min(Math.max(opts.maxResults ?? 20, 1), 100);
  const me = await this.getMe(); // id MUST be the authenticated user — always me.id
  const params = new URLSearchParams({
    max_results: String(max),
    'tweet.fields': 'created_at,public_metrics,author_id',
    expansions: 'author_id',
    'user.fields': 'username,name',
  });
  if (opts.sinceId) params.set('since_id', opts.sinceId);
  if (opts.paginationToken) params.set('pagination_token', opts.paginationToken);

  const body = (await this.authedGetJson(
    `/users/${me.id}/timelines/reverse_chronological?${params.toString()}`,
  )) as { data?: RawTweet[]; includes?: { users?: RawUser[] } };

  return this.shapeTweets(body);
}
```

### Suggested refactor
Extract the bookmarks `.map(...)` block into a private `shapeTweets(body): XBookmark[]` so all three methods share it. The `XBookmark` shape (id/text/createdAt/author/metrics/url) is already generic enough to represent a mention or a timeline post; either reuse it or rename to a neutral `XTweet` and alias `XBookmark = XTweet`.

### Response parsing pulls (unchanged from bookmarks)
- `body.data[]` → tweets.
- Build `Map<author_id, user>` from `body.includes.users[]`.
- Per tweet: `id`, `text`, `created_at`, `author_id` → joined user; `public_metrics.{like_count,retweet_count,reply_count,quote_count}` → flat `{likes,retweets,replies,quotes}` (default 0).
- `url`: `https://x.com/${author.username}/status/${id}` when the handle is known.
- For pagination/polling, also read `body.meta.next_token` and `body.meta.newest_id` (expose if you add looping later — not in scope for a first pass).

### Scope reminder for `x-oauth.ts`
Authorize scope set must include, at minimum: `tweet.read users.read follows.read offline.access`. The first two cover mentions; `follows.read` is mandatory for the home timeline; `offline.access` is what gives you the refresh token the client's 401-retry relies on. If the stored token predates `follows.read`, the home-timeline method 403s and the user must reconnect.

---

## Sources (official X developer docs + dev community)

- User mentions timeline reference — https://docs.x.com/x-api/posts/user-mention-timeline-by-user-id
- User mentions quickstart — https://docs.x.com/x-api/posts/timelines/quickstart/user-mention-quickstart
- Reverse-chronological home timeline quickstart — https://docs.x.com/x-api/posts/timelines/quickstart/reverse-chron-quickstart
- Timelines integration guide (auth requirements, lookback ceilings) — https://docs.x.com/x-api/posts/timelines/integrate
- Timelines introduction — https://docs.x.com/x-api/posts/timelines/introduction
- Data dictionary (Tweet / User / public_metrics fields) — https://docs.x.com/x-api/fundamentals/data-dictionary
- Rate limits reference — https://docs.x.com/x-api/fundamentals/rate-limits
- Reverse-chronological reference (legacy) — https://developer.x.com/en/docs/x-api/tweets/timelines/api-reference/get-users-id-reverse-chronological
- Reverse-chron vs `/users/:id/tweets` (metrics caveat) — https://devcommunity.x.com/t/what-is-the-difference-between-2-users-id-timelines-reverse-chronological-and-2-users-id-tweets-and-why-cant-timeline-endpoint-return-non-public-metrics/192842
- Reverse-chron home timeline & Basic-tier monthly cap — https://devcommunity.x.com/t/reverse-chronological-home-timeline-and-basic-tier-monthly-tweet-pull-cap/191136
- 403 `client-not-enrolled` (tier/enrollment, not scope/auth) — https://devcommunity.x.com/t/403-forbidden-with-reason-client-not-enrolled/259555 and https://devcommunity.x.com/t/pay-per-use-apps-returning-403-on-all-v2-endpoints-client-not-enrolled/262449
- HTTP 401 vs 403 semantics — https://en.wikipedia.org/wiki/HTTP_403
