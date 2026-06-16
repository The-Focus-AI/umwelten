# X (Twitter) API v2 OAuth 2.0 — Token Refresh Lifecycle for a Long-Running Daemon

**Date:** 2026-06-16
**Scope:** Practical guidance for a single-user "token store" module that holds a refresh token and must keep a valid access token available for weeks without human intervention, using the OAuth 2.0 Authorization Code flow with PKCE.

---

## Abstract

X (formerly Twitter) API v2 issues OAuth 2.0 access tokens that are valid for **2 hours (`expires_in: 7200`)** and, when the `offline.access` scope is requested, a **refresh token valid for ~6 months**. The critical operational fact for a token-store is that **refresh tokens are rotated: every successful `refresh_token` grant returns a NEW refresh token, and the old one is consumed (single-use).** If your process performs a refresh but fails to persist the returned refresh token, you have lost the chain and the operator must re-authenticate from scratch. This makes the refresh call a transactional, must-persist operation and makes concurrent refreshes the single largest cause of "my daemon randomly died" failures: two callers racing on the same refresh token will have one succeed and rotate the token out from under the other, which then fails with `invalid_request` / "Value passed for the token was invalid." The mitigation is a strict single-flight (mutex / distributed lock) around refresh, plus persisting the rotated token *before* releasing the lock. This report gives concrete decision rules for when to refresh (proactively, ~5–10 min before expiry), how to interpret a 401 on an API call vs. a 400/401 on the token endpoint, and how to surface an unrecoverable "operator must re-bootstrap" state instead of hammering the endpoint into a rate limit.

---

## 1. Refresh token rotation (single-use) — the central fact

**Refresh tokens on X are rotated and effectively single-use.** Each call to the `refresh_token` grant returns a *fresh pair* — a new `access_token` **and** a new `refresh_token` — and the refresh token you presented is consumed.

- The widely used `node-twitter-api-v2` library documents the contract explicitly: `refreshOAuth2Token(refreshToken)` returns `{ accessToken, refreshToken: newRefreshToken }` and instructs you to "**store refreshed `accessToken` and `newRefreshToken` to replace the old ones**" ([node-twitter-api-v2 auth docs](https://github.com/PLhery/node-twitter-api-v2/blob/master/doc/auth.md)). Community guidance describes a token refresh as "a dedicated call to have a fresh, new couple of access+refresh tokens."
- The community consensus and multiple operators report the access token is valid 2h and **the refresh token is valid ~6 months and is "designed for one-time use"** ([X developer community — rate limit thread summary](https://devcommunity.x.com/t/twitter-api-ratelimit-for-the-oauth2-token-endpoint/196358); [What is the RateLimit for refresh token?](https://devcommunity.x.com/t/what-is-the-ratelimit-for-refresh-token/218498)).

**Consequence of a refresh that succeeds but is not persisted.** This is the dangerous failure mode. X has already rotated server-side: the old refresh token is now dead, and the new one only exists in the HTTP response you just dropped. There is no recovery — the next refresh attempt with the old token returns an error and **the operator must re-run the full Authorization Code + PKCE bootstrap**. Therefore the refresh call must be treated as a transaction: **persist the new refresh token durably *before* you consider the refresh "done," and before you release any lock or return the new access token to callers.**

**Does the old token become invalid immediately?** Yes — once a refresh succeeds the presented refresh token is consumed. In practice operators also report *intermittent* premature invalidation (see §6) that is best explained by concurrent refreshes consuming the token; treat "old token invalid" as the normal post-rotation state.

**Design rule:** Write order must be: `acquire lock → call refresh → on 2xx, atomically persist {access_token, refresh_token, expires_at} → release lock`. If the persist step fails, you must surface a hard error and stop — do **not** retry the refresh with the (now-dead) old token.

---

## 2. Access token lifetime and proactive refresh

- **`expires_in` is `7200` seconds (2 hours)** for the user-context access token created via Authorization Code with PKCE. This is the documented default ([X OAuth 2.0 user-access-token docs](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token); [OAuth 2.0 Tokens and the Twitter API — Medium](https://medium.com/@abhiruchichaudhari/oauth-2-0-tokens-and-twitter-api-everything-you-need-to-know-bddaf9a7f120)).
- **Refresh proactively.** Do not wait for a 401. Compute `expires_at = now + expires_in` at refresh time and refresh when `now >= expires_at - skew`. A **skew of 5 minutes (300 s)** is the common, safe choice; 10 minutes is fine for a daemon that polls infrequently and wants headroom against clock drift and slow networks. The cost of refreshing slightly early is one extra token rotation; the cost of refreshing late is a failed API call.
- Always trust the server's `expires_in` from the *latest* response rather than assuming a constant; store an absolute `expires_at` so restarts/clock changes are handled correctly.

**Design rule:** `needsRefresh = now >= (expires_at − 300s)`. Refresh on that condition *or* reactively on a 401 from an API call (see §5), whichever comes first.

---

## 3. The `offline.access` scope

- **You only get a refresh token if you request `offline.access` in the initial authorization request.** "If the scope `offline.access` is applied an OAuth 2.0 refresh token will be issued… If this scope is not passed, we will not generate a refresh token" ([X docs](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token); [Refresh token expiring (with offline.access scope) — community](https://devcommunity.x.com/t/refresh-token-expiring-with-offline-access-scope/168899)).
- Without `offline.access`, the access token still works for 2 hours, then there is **no way to refresh** — the only path is a fresh interactive authorization. For a weeks-long daemon this scope is mandatory.
- Include it alongside whatever functional scopes you need (e.g. `tweet.read`, `users.read`, `tweet.write`), space-separated, at the `/i/oauth2/authorize` step.

---

## 4. Confidential vs public clients & the token endpoint

**Token endpoint:** `https://api.x.com/2/oauth2/token` (the host migrated from `api.twitter.com` to `api.x.com` — see §8; the legacy host still works). `Content-Type: application/x-www-form-urlencoded` is required ([X docs](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token)).

**Public client** (no client secret) — refresh body:
```
POST https://api.x.com/2/oauth2/token
Content-Type: application/x-www-form-urlencoded

refresh_token=<TOKEN>&grant_type=refresh_token&client_id=<CLIENT_ID>
```

**Confidential client** (has a client secret) — send HTTP Basic auth and **omit `client_id` from the body**:
```
POST https://api.x.com/2/oauth2/token
Authorization: Basic base64("<CLIENT_ID>:<CLIENT_SECRET>")
Content-Type: application/x-www-form-urlencoded

refresh_token=<TOKEN>&grant_type=refresh_token
```

**Gotchas:**
- The same Basic-auth requirement applies to **both** the initial code-exchange **and** every refresh call for a confidential client. A very common bug is sending Basic auth on the code exchange but forgetting it on refresh (or vice-versa), which yields auth errors on the token endpoint. Be consistent across both calls ([X docs](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token); [node-twitter-api-v2 auth docs](https://github.com/PLhery/node-twitter-api-v2/blob/master/doc/auth.md)).
- For a confidential client, do **not** also pass `client_id` in the body — credentials go in the Basic header.
- Your app's client type (public vs confidential) is set in the X developer portal; it must match how you call the token endpoint.

---

## 5. Error handling — distinguishing "refresh" from "re-bootstrap"

There are two distinct 401-class situations a daemon must tell apart:

### (a) Access token expired/invalid → just refresh
A normal API call (e.g. `GET /2/users/me`) with an expired access token returns **HTTP 401 Unauthorized** with a JSON body indicating an unauthorized/invalid token. **This is routine and recoverable**: run the refresh flow (under the lock), get a new access token, and retry the original request **once**. Do not re-bootstrap.

### (b) Refresh token dead → operator must re-auth
A call to the **token endpoint** with a bad/expired/revoked/already-rotated refresh token fails on the token endpoint itself. Reported shapes:
- OAuth-standard `invalid_grant` for an expired/revoked/consumed refresh token (the canonical OAuth meaning of `invalid_grant` is "the provided authorization grant or refresh token is invalid, expired, or revoked") ([Truto — fixing invalid_grant](https://truto.one/blog/fixing-oauth-20-errors-a-developers-guide-to-invalidgrant-more); [Nango — invalid_grant](https://nango.dev/blog/salesforce-oauth-refresh-token-invalid-grant/)).
- X has also been widely observed returning **`invalid_request`** with description **"Value passed for the token was invalid"** when the refresh token is rejected — frequently the symptom of a token that was already consumed by a concurrent refresh ([X API v2 invalid_request thread](https://devcommunity.x.com/t/x-api-2-oauth2-0-refresh-token-endpoint-got-error-invalid-request-and-error-description-value-passed-for-the-token-was-invalid/224953); [Value passed for the token was invalid](https://devcommunity.x.com/t/value-passed-for-the-token-was-invalid/182084)).

**Decision rule for the token store:**

| Where the error occurred | Status / error | Meaning | Action |
|---|---|---|---|
| API resource call | 401 (invalid/expired token) | Access token stale | Refresh (single-flight), retry call once |
| Token endpoint | `invalid_grant` | Refresh token expired/revoked/consumed | **Unrecoverable** — mark `NEEDS_REAUTH`, stop, alert operator |
| Token endpoint | `invalid_request` / "Value passed for the token was invalid" | Usually a consumed/rotated-away token (often concurrency) | Treat as **likely unrecoverable**; if you had a concurrency race, one *narrow* bounded retry after re-reading the persisted token may recover; otherwise → `NEEDS_REAUTH` |
| Token endpoint | 429 `rate_limited` | Too many token calls | Back off (see §7); do **not** mark dead |
| Token endpoint | 5xx / HTML page | Transient server / wrong host | Retry with backoff; verify host (§8) |

**Surface "operator must re-bootstrap" as a distinct state.** When refresh fails with `invalid_grant` (or a persistently-failing `invalid_request`), set the integration to a terminal `NEEDS_REAUTH` status and **stop scheduling refreshes**. "No amount of retry will fix a revoked token, and continuing to hammer the token endpoint will just burn your rate-limit budget" — mark the account `needs_reauth` and stop on a non-retryable 400/401/403/`invalid_grant` ([rate-limit / revoked-token guidance synthesized from X community + OAuth best practice](https://devcommunity.x.com/t/twitter-api-ratelimit-for-the-oauth2-token-endpoint/196358); [Truto](https://truto.one/blog/fixing-oauth-20-errors-a-developers-guide-to-invalidgrant-more)).

---

## 6. Concurrency — the #1 cause of token-store death

If two code paths both notice the access token is near-expiry and both call `refresh_token` with the **same** refresh token, the rotation makes this a race:

- One request wins, rotates the token, gets a new pair. The other request is now presenting a **consumed** refresh token and fails — typically with `invalid_request` / "Value passed for the token was invalid." This exactly matches the widely reported intermittent failures where "retrying the exact same request 2 minutes later sometimes works and sometimes not" ([X invalid_request thread](https://devcommunity.x.com/t/x-api-2-oauth2-0-refresh-token-endpoint-got-error-invalid-request-and-error-description-value-passed-for-the-token-was-invalid/224953)).
- Worse, the loser can *overwrite* the freshly-persisted good token with a stale value if your persist logic isn't ordered correctly — "the last process to complete might overwrite the 'good' new token with an already-expired one… forcing user re-authentication" ([Nango — concurrency with OAuth token refreshes](https://nango.dev/blog/concurrency-with-oauth-token-refreshes/)).

**Recommended pattern — single-flight refresh:**
- **Single process:** an in-memory mutex / promise-coalescing "token manager." If a refresh is already in flight for this connection, *await the same promise* instead of starting a second refresh; all callers receive the one new access token. The popular `twitter-api-v2-plugin-token-refresher` does exactly this — but explicitly warns it only guarantees one refresh "**in a single-process context only! no support for concurrency within multiple processes**" ([token-refresher plugin](https://github.com/alkihis/twitter-api-v2-plugin-token-refresher)).
- **Multiple processes / instances:** a **distributed lock** (e.g. Redis `SET NX PX 30000`). Only the lock holder refreshes; others poll for the new token to land, then read it from the shared store. Use a lock TTL (~30 s) so a crashed holder can't deadlock the integration ([Nango](https://nango.dev/blog/concurrency-with-oauth-token-refreshes/)).
- **No API requests should use a token while it is being refreshed** — block consumers during the refresh window so an in-flight call can't tear across the rotation.
- After acquiring the lock, **re-read the persisted token first**: another holder may have refreshed microseconds earlier, in which case you skip the refresh entirely (double-checked locking). This both avoids needless rotations and prevents the consumed-token error.

**Design rule:** Exactly one refresh per token at a time; persist-before-release; double-check-after-lock; block reads during refresh.

---

## 7. Rate limits on the token endpoint & backoff

- The token endpoint (`POST /2/oauth2/token`) is rate-limited. Operators report being throttled with **HTTP 429** and error `rate_limited`, and — notably — **the token endpoint does not return the usual `x-rate-limit-*` headers**, so you can't read your remaining budget from the response ([Twitter API ratelimit for the /oauth2/token endpoint](https://devcommunity.x.com/t/twitter-api-ratelimit-for-the-oauth2-token-endpoint/196358); [Rate limit on POST /2/oauth2/token](https://devcommunity.x.com/t/rate-limit-on-post-2-oauth2-token/179085); [What is the RateLimit for refresh token?](https://devcommunity.x.com/t/what-is-the-ratelimit-for-refresh-token/218498)). X has not published an exact official number for this endpoint in these threads.
- **Practical implications for a token store:**
  - With a 2-hour token you should be refreshing roughly **12 times/day** for one user — orders of magnitude under any reasonable limit. If you're hitting 429s, you have a bug (tight retry loop, missing single-flight, or refreshing on every request instead of on expiry).
  - On **429**: exponential backoff with jitter (e.g. 1s → 2s → 4s → … capped at a few minutes). Because there are no rate-limit headers, you can't compute a precise reset; back off conservatively.
  - On **5xx / transient network**: retry with backoff (a few attempts), then give up for this cycle — your access token may still be valid, so don't panic.
  - **Never retry-loop on `invalid_grant`** — that is terminal (§5). Distinguish "retryable" (429/5xx/network) from "terminal" (`invalid_grant`) before deciding to back off vs. stop.

---

## 8. Recent (2024–2026) OAuth 2.0 changes

- **Host migration `api.twitter.com` → `api.x.com`.** The current documented token endpoint is `https://api.x.com/2/oauth2/token`; the legacy `https://api.twitter.com/2/oauth2/token` continues to function. Documentation itself moved from `developer.twitter.com` to **`docs.x.com`** (the old developer.twitter.com URLs now 307-redirect to docs.x.com) ([X OAuth user-access-token docs](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token); [OAuth 2.0 overview](https://docs.x.com/fundamentals/authentication/oauth-2-0/overview)).
- **Authorize URL is unchanged:** the interactive consent step is still `https://x.com/i/oauth2/authorize` (historically `https://twitter.com/i/oauth2/authorize`) — used only at bootstrap, not by the daemon's refresh loop.
- **`api.x.com` HTML-error gotcha.** Some operators hitting `https://api.x.com/2/oauth2/token` have received an **HTML "page doesn't exist" error page instead of JSON** — variously attributed to transient outages, IP-based behavior, or host edge issues; a reported workaround was falling back to the `api.twitter.com` host ([api.x.com/2/oauth2/token returns HTML error page](https://devcommunity.x.com/t/api-x-com-2-oauth2-token-endpoint-returns-html-error-page/254157); [Endpoint /2/oauth2/token falls on "This page is down"](https://devcommunity.x.com/t/endpoint-2-oauth2-token-falls-on-this-page-is-down/212156)). **Defensive measure:** if the token endpoint returns a non-JSON / HTML body or a 5xx, treat it as transient, back off, and consider a host fallback — do **not** interpret it as a dead refresh token.
- **Access tiers / pricing churn (2023→2026).** The free tier was sharply curtailed and paid tiers reshuffled; this affects *which API calls* you can make but does **not** change the OAuth refresh mechanics described here. Worth knowing because a daemon that suddenly gets 403s on resource calls may be a plan/scope problem, not a token problem.

---

## Conclusion — concrete rules for the token store

1. **Treat refresh as a persist-or-die transaction.** On every successful refresh, atomically store the new `access_token`, the new `refresh_token`, and `expires_at` *before* releasing the lock or handing the access token to callers. Losing the rotated refresh token = full re-bootstrap.
2. **Refresh proactively** when `now ≥ expires_at − 300s` (2h tokens), and reactively on a 401 from an API call — retry that call once after refreshing.
3. **Single-flight every refresh.** In-process: coalesce concurrent refreshes onto one promise. Multi-process: Redis lock with ~30s TTL + double-checked re-read of the stored token after acquiring the lock. Block token reads during the refresh window.
4. **Classify token-endpoint errors:** `429/5xx/network/HTML-page` → retryable (backoff, maybe host fallback); `invalid_grant` (and persistently-failing `invalid_request` "Value passed for the token was invalid") → **terminal**, set `NEEDS_REAUTH`, stop refreshing, alert the operator.
5. **Confidential clients:** send `Authorization: Basic base64(client_id:client_secret)` on **both** code-exchange and refresh, and omit `client_id` from the body.
6. **Require `offline.access`** at authorization or there is no refresh token at all.
7. **Don't hammer.** Healthy steady state is ~12 refreshes/day/user; 429s mean a bug, not a need for more retries.

---

## References

1. X — OAuth 2.0 Authorization Code Flow with PKCE / user access token. https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token
2. X — OAuth 2.0 Overview. https://docs.x.com/fundamentals/authentication/oauth-2-0/overview
3. node-twitter-api-v2 — auth documentation (refreshOAuth2Token, token replacement, Basic auth). https://github.com/PLhery/node-twitter-api-v2/blob/master/doc/auth.md
4. twitter-api-v2-plugin-token-refresher — single-process refresh coalescing + onTokenUpdate persistence. https://github.com/alkihis/twitter-api-v2-plugin-token-refresher
5. Nango — How to handle concurrency with OAuth token refreshes (in-memory + Redis distributed lock patterns). https://nango.dev/blog/concurrency-with-oauth-token-refreshes/
6. Nango — Salesforce OAuth refresh token invalid_grant (semantics of invalid_grant). https://nango.dev/blog/salesforce-oauth-refresh-token-invalid-grant/
7. Truto — Fixing OAuth 2.0 Errors: invalid_grant & more. https://truto.one/blog/fixing-oauth-20-errors-a-developers-guide-to-invalidgrant-more
8. X Developer Community — invalid_request "Value passed for the token was invalid" on /2/oauth2/token. https://devcommunity.x.com/t/x-api-2-oauth2-0-refresh-token-endpoint-got-error-invalid-request-and-error-description-value-passed-for-the-token-was-invalid/224953
9. X Developer Community — Value passed for the token was invalid. https://devcommunity.x.com/t/value-passed-for-the-token-was-invalid/182084
10. X Developer Community — Refresh token expiring (with offline.access scope). https://devcommunity.x.com/t/refresh-token-expiring-with-offline-access-scope/168899
11. X Developer Community — Twitter API ratelimit for the /oauth2/token endpoint. https://devcommunity.x.com/t/twitter-api-ratelimit-for-the-oauth2-token-endpoint/196358
12. X Developer Community — Rate limit on POST /2/oauth2/token. https://devcommunity.x.com/t/rate-limit-on-post-2-oauth2-token/179085
13. X Developer Community — What is the RateLimit for refresh token? https://devcommunity.x.com/t/what-is-the-ratelimit-for-refresh-token/218498
14. X Developer Community — api.x.com/2/oauth2/token endpoint returns HTML error page. https://devcommunity.x.com/t/api-x-com-2-oauth2-token-endpoint-returns-html-error-page/254157
15. X Developer Community — Endpoint /2/oauth2/token falls on "This page is down". https://devcommunity.x.com/t/endpoint-2-oauth2-token-falls-on-this-page-is-down/212156
16. X Developer Community — Twitter API, Refreshing access tokens. https://devcommunity.x.com/t/twitter-api-refreshing-access-tokens/214281
17. Abhiruchi Chaudhari — OAuth 2.0 Tokens and Twitter API: Everything You Need to Know (Medium). https://medium.com/@abhiruchichaudhari/oauth-2-0-tokens-and-twitter-api-everything-you-need-to-know-bddaf9a7f120

---

*Note on sourcing: the official X OAuth pages (docs.x.com) and GitHub library docs were fetched directly. The `devcommunity.x.com` forum blocked automated full-page fetches (HTTP 403), so those threads are cited via their indexed search summaries; the substantive claims drawn from them (rotation, single-use, intermittent invalid_request under concurrency, no rate-limit headers on the token endpoint) are corroborated across multiple independent threads and by the vendor-neutral engineering writeups (Nango, Truto) and the node-twitter-api-v2 contract.*
