# Context retrieval routes — codebase research (issue #116)

Date: 2026-06-10. Scope: everything needed to expose `GET /api/contexts/{contextId}`
and `GET /api/contexts/{contextId}/transcript` on the habitat container server,
proxied by Gaia. No new external libraries are introduced; prior tech reports
(`2026-05-04-a2a-mcp-skills-implementation.md`, `2026-05-07-acp-a2a-mcp-agent-protocols.md`,
`2026-05-22-jsonl-persistence-nodejs.md`) cover A2A and JSONL persistence.

## contextId → session mapping (the channel-key convention)

- `packages/habitat/src/a2a-handler.ts:123` — every A2A message uses
  `channelKey = \`a2a:${contextId}\``.
- `packages/habitat/src/bridge/channel-bridge.ts:354-359` — splits the key into
  platform `a2a` and identifier `contextId`, then calls
  `host.getOrCreateSession('a2a', contextId)`.
- `packages/habitat/src/session-manager.ts` (generic branch, ~line 150) — for
  non-discord/telegram/cli types, `sessionId = String(identifier)`.

**Therefore the session directory for a contextId is exactly
`{sessionsDir}/{contextId}/`.** The resolver is a pure function over that.

## Session directory layout

- `meta.json` — `HabitatSessionMetadata` (`packages/habitat/src/types.ts:387-406`):
  `sessionId`, `created`, `lastUsed`, `type`, optional `agentId`, `routeSignature`,
  extensible `metadata` record. `nativeSessionRef` does **not** exist yet — issue
  #118 adds it concurrently, so this slice reads it structurally (top-level or
  under `metadata`) instead of changing the shared type.
- Transcript: live `transcript.jsonl` plus frozen segments
  `transcript.<ISO>.jsonl`, ordered by
  `listHabitatTranscriptReadPaths()` (`packages/core/src/session-record/transcript-segments.ts`).
- Message loading: `loadHabitatSessionTranscriptMessages(sessionDir)`
  (`packages/core/src/session-record/habitat-transcript-load.ts`) reads all
  segments, skips compaction markers. Normalization:
  `sessionMessagesToNormalized()`
  (`packages/core/src/interaction/persistence/session-parser.ts:497`).

## Container server routing + auth

- `packages/habitat/src/container-server.ts:242` — `const routes = defaultRoutes()`
  from `packages/habitat/src/web/routes/index.ts`; dispatched in the
  "Registered routes" loop (~line 980) which **applies bearer auth automatically**
  when `HABITAT_API_KEY` is set and the route doesn't set `skipAuth`.
- Bearer auth: `packages/habitat/src/web/auth/bearer-auth.ts` — parses
  `Authorization: Bearer <token>`, 401 `{ error: "Unauthorized" }` on mismatch.
- Route handler shape: `RouteHandler { method, path (':param' segments), handle(ctx, params), skipAuth? }`
  (`packages/habitat/src/web/types.ts:63-70`). Prior art:
  `packages/habitat/src/web/routes/sessions.ts`.

So: registering the two contexts routes in `defaultRoutes()` gives us dispatch,
`:contextId` extraction, and bearer gating for free.

## Gaia proxy

- `packages/habitat/src/tools/gaia/routes.ts:280-310` — explicit `proxyRoutes`
  allowlist; nothing is forwarded automatically. Wildcard support exists
  (`/api/habitats/:id/files/*` → `/files/` + remainder). `proxyRequest()`
  (`tools/gaia/proxy.ts`) injects `Authorization: Bearer ${entry.apiKey}`.
- Plan: add `{ pattern: "/api/habitats/:id/contexts/*", target: "/api/contexts/" }`
  and generalize the wildcard target concatenation (currently special-cased to
  `/files/`) into a pure exported helper so it's unit-testable.

## Testing prior art

- Fixture session dirs: `packages/habitat/src/adapters/habitat-session-adapter.test.ts`
  (creates `meta.json` + `transcript.jsonl` in `mkdtemp` dirs) and
  `packages/core/src/session-record/habitat-flow.test.ts` (frozen + live segments).
- Handler-level tests without a real HTTP server:
  `packages/habitat/src/web/WebAdapter.test.ts` — mock req (PassThrough +
  headers) and res (accumulating writeHead/write/end object), call the handler
  directly.
- Gaia tests mock the exec layer (`gaia-tools-*.test.ts`) — no real Docker.

## Risks / notes

- Path traversal: `contextId` comes from the URL; the resolver must reject
  separators and `..` before joining paths.
- #118 lands `nativeSessionRef` concurrently — reading it structurally avoids a
  merge conflict on `HabitatSessionMetadata`.
- A2A defines no history-retrieval RPC; these routes are protocol-adjacent
  extensions, same posture as `/api/artifacts`.
