---
kind: spec
id: protocols-and-extensions
title: A2A, MCP Client/Server, CLI Bundle, and Installable Pi Extensions
layer: interfaces
version: 1
uses:
  - standards/portable-agent-skills@1
  - standards/per-speaker-agent-identity@1
---

## Intent

Expose Umwelten capabilities through standard network protocols (A2A v1.0, OAuth 2.1 MCP server, `@earendil-works/pi-mcp` client), the `umwelten` CLI binary, and an installable `@umwelten/pi` extension package (`pi-package`) that works inside both the `pi` CLI and `pi-durable`.

## Invariants

- **[preserve-mcp-ui-embedded-resources]** (*NEVER*): `RemoteMcpClient` (built on `@earendil-works/pi-mcp`) **NEVER** strips `ui://` `EmbeddedResource` payloads or `_meta` from `callTool` results; UI resources pass through `_uiResources` while concise text goes to the model.
- **[no-custom-mcp-jsonrpc-client]** (*NEVER*): `@umwelten/protocols` **NEVER** maintains a hand-rolled JSON-RPC MCP client or custom stdio/HTTP transport; both `RemoteMcpClient` and `MCPStimulusManager` delegate directly to `@earendil-works/pi-mcp` (`McpClient`, `StdioTransport`, `StreamableHttpTransport`).
- **[self-contained-published-cli]** (*NEVER*): Building `packages/umwelten` (`pnpm -r build`) **NEVER** leaves unresolved workspace imports or CJS dynamic-require crashes in `dist/cli/entry.js --help`.

## Acceptance Criteria

- **[durable-a2a-v1-endpoint]**: Mounting `DurableHabitat.createA2ASurface()` (`@leocavalcante/pi-a2a/durable`) serves `GET /.well-known/agent-card.json` and `POST /a2a` (`A2A-Version: 1.0`), deduplicating retries by `messageId` and returning committed task artifacts.
- **[installable-pi-extension-package]**: Loading `@umwelten/pi` into a Pi `ExtensionAPI` host registers `umwelten_session_search`, `umwelten_promote_knowledge`, and `/umwelten-explorations` without duplicating Pi's native provider/`models.json` layer, while `@umwelten/pi/durable` exports the `pi-durable` Harness extensions.

## Implementation Notes

- **A2A version header**: `@a2a-js/sdk` v1.x defaults missing `A2A-Version` HTTP headers to `"0.3"`; callers speaking A2A 1.0 JSON-RPC to `@leocavalcante/pi-a2a/server` must include `A2A-Version: 1.0` (sent automatically by `@a2a-js/sdk` v1.3 `Client`).

## Verification

1. **Protocols, Pi Extension & Published Binary Check**: Run `pnpm exec vitest run packages/protocols/ packages/pi/ packages/cli/` followed by `pnpm -r build && node packages/umwelten/dist/cli/entry.js --help`.
