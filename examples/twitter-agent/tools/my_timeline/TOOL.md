---
name: my_timeline
description: "Show the authenticated user's X (Twitter) home timeline — the recent posts, retweets, and replies from the accounts they follow, newest first. Use this whenever the user asks 'what's on my timeline?', 'my home feed', or 'what are the people I follow posting?'. Returns each post's text, author, engagement metrics, and a permalink. Reads the user's own X OAuth token from Habitat secrets — no argument needed beyond an optional limit."
---

Show the authenticated user's reverse-chronological home timeline (people they follow).

Private data, read through the user's own official X OAuth token (managed by the
X token store, which refreshes and rotates it automatically). Optional `limit`
controls how many posts to return (default 20, max 100).

The home timeline requires the `follows.read` OAuth scope; if the stored token was
authorized without it, this tool returns a "needs reauth" message and the operator
must re-run the OAuth bootstrap to re-authorize.
