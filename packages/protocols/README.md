# `@umwelten/protocols`

- **OAuth 2.1 MCP Server Framework (`mcp-serve`)**: `createMcpServer`, `createMcpServeMount`, `NeonStore`, `MemoryStore`.
- **Remote MCP Client (`RemoteMcpClient`)**: Built on `@earendil-works/pi-mcp` (`StreamableHttpTransport` + OAuth PKCE), preserving `ui://` `EmbeddedResource` payloads and `_meta`.
- **Endpoint Discovery & Durable A2A 1.0**: `discoverAgentEndpoint` and `@leocavalcante/pi-a2a` re-exports.
