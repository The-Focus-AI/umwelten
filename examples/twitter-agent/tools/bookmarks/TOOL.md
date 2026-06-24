---
name: bookmarks
description: "Show the authenticated user's most recent X (Twitter) bookmarks (the tweets they have saved). Use this whenever the user asks about their bookmarks or saved tweets. Returns each bookmark's text, author, engagement metrics, and a permalink. Reads the user's own X OAuth token from Habitat secrets — no argument needed beyond an optional limit."
---

Show the authenticated user's most recent X (Twitter) bookmarks.

Private data, read through the user's own official X OAuth token (managed by the
X token store, which refreshes and rotates it automatically). Optional `limit`
controls how many bookmarks to return (default 20, max 100).
