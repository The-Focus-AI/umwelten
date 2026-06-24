---
name: list_digest
description: "Digest a tracked X list (e.g. \"ai-engineers\" / \"AI Engineers\"): its members, their high-signal recent tweets ranked by engagement, and the latest pre-generated summary when one exists. Use when the user asks to digest or summarize a list, or \"what's the AI engineers list up to?\". Public data, read-only, no X login required. Takes a list slug or name plus optional limit / sinceHours. Unknown lists return found=false instead of erroring."
---

Digest a tracked list.

Resolves the list by its `file_id` slug (e.g. `ai-engineers`) or display name,
then returns its members, their top recent tweets ranked by engagement
(`likes + retweets + replies`), and the latest summary the `twitter-feed`
pipeline generated, if any. Public data from Neon (`DATABASE_URL` only). Optional
`limit` (top tweets, default 20) and `sinceHours` (window, default 48). An
unknown list degrades gracefully to `found: false`.
