---
name: person_recent
description: "Show a specific person's recent tweets from the tracked public feed (the twitter-feed Neon store). Use whenever the user asks what someone has been posting or saying — e.g. \"what's @karpathy been up to?\" or \"show me swyx's latest tweets\". Public data, read-only, no X login required. Takes a handle (with or without @) and an optional limit / sinceHours; returns each tweet's text, author, engagement metrics, and a permalink."
---

Show a specific person's recent tweets, most-recent first.

Public data, read from the Neon database the `twitter-feed` pipeline syncs (no
twitterapi.io key, no X OAuth — only `DATABASE_URL`). `handle` is the X @handle
(with or without the leading `@`). Optional `limit` (default 20, max 100) and
`sinceHours` (restrict to a recent window).
