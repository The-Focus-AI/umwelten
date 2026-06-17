---
name: high_engagement
description: "Show the most notable tweets across the tracked public feed, ranked by engagement (likes + retweets + replies). Use when the user asks what's notable, popular, or trending among tracked people, or for \"the top tweets right now\". Public data, read-only, no X login required. Optional limit and sinceHours (defaults to the last 24 hours); returns each tweet's text, author, engagement metrics, and a permalink."
---

Show the most notable tweets, ranked by engagement.

Engagement is `likes + retweets + replies` — the same formula the `twitter-feed`
pipeline uses, so the ranking matches its reports. Public data from Neon
(`DATABASE_URL` only). Optional `limit` (default 20, max 100) and `sinceHours`
(look-back window, default 24).
