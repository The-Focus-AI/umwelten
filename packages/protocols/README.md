# `@umwelten/protocols`

- **OAuth 2.1 MCP Server Framework (`mcp-serve`)**: `createMcpServer`, `createMcpServeMount`, `NeonStore`, `MemoryStore` — on `@modelcontextprotocol/server` 2.x `createMcpHandler` (protocol `2026-07-28` plus stateless 2025 fallback). Pass `skills: await loadSkills(dir)` to publish a skills directory (`io.modelcontextprotocol/skills`).
- **Remote MCP Client (`RemoteMcpClient`)**: Built on `@modelcontextprotocol/client` 2.x (`StreamableHTTPClientTransport` + OAuth PKCE, `server/discover` negotiation), preserving `ui://` `EmbeddedResource` payloads and `_meta`; `client.skills` is the SDK `SkillsClient`.
- **MCP Skills host (`McpSkillHost`)**: registry keyed by `(serverLabel, uri)`, lazy listing, approvals bound to the `{uri, digest}` manifest (revoked on change), verified origin-tagged reads, `allowed-tools` ignored, approval stores kept out of skill-discovery paths. `a2aSkillsForServedMcpSkills` maps served MCP skills onto A2A agent-card skills.
- **Same-host test harness (`@umwelten/protocols/mcp/testing.js`)**: `createTestMcpServer` — an SDK 2.x server reachable in-process or on loopback (localhost Host/Origin validation) with `connect(label)` for `RemoteMcpClient`.
- **Endpoint Discovery & Durable A2A 1.0**: `discoverAgentEndpoint` (capabilities tagged `mcp-tool` / `mcp-skill` / `a2a-skill`) and `@leocavalcante/pi-a2a` re-exports.
