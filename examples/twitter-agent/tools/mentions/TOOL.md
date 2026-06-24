---
name: mentions
description: "Show recent tweets that mention or reply to the authenticated user on X (Twitter). Use this whenever the user asks 'who replied to me?', 'who mentioned me?', or about their recent replies/mentions. Returns each mention's text, author, engagement metrics, and a permalink. Reads the user's own X OAuth token from Habitat secrets — no argument needed beyond an optional limit."
---

Show the tweets that recently mentioned or replied to the authenticated user.

Private data, read through the user's own official X OAuth token (managed by the
X token store, which refreshes and rotates it automatically). Optional `limit`
controls how many mentions to return (default 20, min 5, max 100 — the X mentions
endpoint requires a minimum page size of 5).
