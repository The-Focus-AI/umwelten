# Phase 4: Unified Container Server

Unify MCP, chat, web UI, artifacts, sessions, and settings under a single container HTTP server.

## Acceptance criteria

- [x] Create `src/habitat/container-server.ts`
- [x] Mount MCP at `/mcp`, chat at `/api/chat`, routes, and static UI at `/`
- [x] Add bearer-token auth with `HABITAT_API_KEY`; health/static UI remain open
- [x] Create minimal no-build chat UI
- [x] Stream AI SDK UI message stream with markdown and tool calls
- [x] Support reasoning/thinking blocks end-to-end
- [x] Add artifact tools and `/api/artifacts` endpoint
- [x] Show artifacts pane with thumbnails/detail overlay
- [x] Add sessions browser tab and settings tab
- [x] Add `/api/settings` endpoint
- [x] Serve `/files/*` from work dir with MIME and sandbox checks
- [x] Add platform instructions for artifacts and `/files/` URLs
- [x] Update `habitat serve` CLI to use unified server by default with `--mcp-only` legacy mode
- [x] Export `startContainerServer`
- [x] Integration tested: health, UI, API, artifacts, sessions
