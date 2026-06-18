# twitter-feed Neon schema + feed-reader design (issue #153)

This is the ground-truth schema the Twitter habitat's **public-data path** reads.
It is populated by the external `twitter-feed` sync pipeline
(`~/The-Focus-AI/twitter-feed`, `src/db-storage.ts`). The habitat is a **read-only
consumer** — it holds no twitterapi.io key, only `DATABASE_URL`.

Captured by reading `twitter-feed/src/db-storage.ts`, `src/tweets.ts`,
`src/types.ts`, and `src/cli.ts` directly (not guessed). If the upstream pipeline
changes its schema, re-read those files.

## Tables the feed-reader uses

### `cached_tweets` — the core feed
| column            | type        | notes                                   |
| ----------------- | ----------- | --------------------------------------- |
| `tweet_id`        | text PK     | X tweet id                              |
| `author_id`       | text        | X user id of author                     |
| `username`        | text        | lowercased handle (no `@`)              |
| `text`            | text        | tweet body                              |
| `created_at`      | timestamptz | tweet time                              |
| `conversation_id` | text null   |                                         |
| `retweet_count`   | int         |                                         |
| `reply_count`     | int         |                                         |
| `like_count`      | int         |                                         |
| `quote_count`     | int         |                                         |
| `bookmark_count`  | int         |                                         |
| `impression_count`| int         |                                         |
| `synced_at`       | timestamptz | when the pipeline last wrote this row   |

`username` is stored **lowercased** (`username.toLowerCase()` on write), so all
lookups must lowercase the handle and strip a leading `@`.

### `twitter_profiles` — for display names / profile metrics
Keyed by `username` (lowercased, UNIQUE). Columns include `twitter_id`,
`display_name`, `description`, `followers_count`, `following_count`,
`tweet_count`, etc. The feed-reader joins this to resolve a handle's display name.

### `twitter_lists` + `twitter_list_members` — tracked lists
- `twitter_lists`: surrogate `id` (PK), `list_id` (X list id or `local-<file_id>`),
  `file_id` (UNIQUE — the slug like `ai-engineers`, matches the JSON file under
  `twitter-feed/lists/`), `name`, `description`, `member_count`, ...
- `twitter_list_members`: `list_id` → **`twitter_lists.id`** (the surrogate, not the
  X list id), `username` (lowercased), `display_name`, `twitter_id`.
  UNIQUE `(list_id, username)`.

A list is addressed by its **`file_id` slug** (e.g. `ai-engineers`). To get a
list's members: join `twitter_lists` (by `file_id` or `name`) → `twitter_list_members`.

### `summaries` — pre-generated list digests (markdown)
| column        | type        | notes                                            |
| ------------- | ----------- | ------------------------------------------------ |
| `id`          | uuid PK     |                                                  |
| `list_id`     | text        | **= the list `file_id` slug** (NOT lists.id)     |
| `report_date` | date/text   |                                                  |
| `report_type` | text        | morning/midday/evening/daily/recent/weekly/other |
| `content`     | text        | markdown report body                             |
| `title`       | text null   | first H1 of content                              |
| `generated_at`| timestamptz |                                                  |
| `sent_at`     | timestamptz |                                                  |

UNIQUE `(list_id, report_date, report_type)`. Latest = `ORDER BY report_date DESC,
generated_at DESC`. Note `summaries.list_id` is the **file_id slug**, while
`twitter_list_members.list_id` is the **surrogate `twitter_lists.id`** — different
keys, easy to confuse.

(Other tables — `cached_replies`, `email_subscriptions` — exist but the v1
feed-reader does not need them.)

## Engagement formula (must match upstream)
`twitter-feed/src/tweets.ts#calculateEngagement`:

```
engagement = like_count + retweet_count + reply_count
```

Quotes/bookmarks/impressions are **not** counted. The feed-reader ranks by this
exact expression so its ordering matches the pipeline's own reports.

## The three queries (issue #153)
1. **person recent** — `WHERE username = $1 ORDER BY created_at DESC LIMIT $2`
   (lowercase + strip `@` first). Optionally also rank-by-engagement.
2. **high engagement** — `ORDER BY (like_count + retweet_count + reply_count) DESC`,
   optionally windowed (`created_at >= now() - interval`) and/or scoped to a list's
   members.
3. **list digest** — resolve list by `file_id`/`name` → members → their top recent
   tweets by engagement; plus the latest `summaries` row (markdown) when present.
   Degrades gracefully: unknown list → empty members + no summary, not an error.

## DB client decision
Use **`@neondatabase/serverless`** `neon()` (HTTP path), matching the repo's
existing `NeonStore` (`packages/protocols/src/mcp-serve/neon-store.ts`,
`@neondatabase/serverless@^1.1.0`). The feed-reader depends on a thin injected
`QueryExecutor = (text, params) => Promise<rows[]>` bound to `sql.query(text,
params)` in production and a fake in unit tests. All queries use `$1` placeholders
+ a params array — never string concatenation. See companion report
`2026-06-16-neon-serverless-readonly-driver.md`.
