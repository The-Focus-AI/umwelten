/**
 * `@umwelten/protocols` — OAuth 2.1 MCP server (`mcp-serve`), `@earendil-works/pi-mcp`
 * remote client (preserving `ui://` `EmbeddedResource`s), endpoint discovery, and
 * `@leocavalcante/pi-a2a` durable A2A 1.0 surface.
 */

// ── MCP Serve (OAuth 2.1 MCP server framework) ──────────────────────────
export { createMcpServer } from "./mcp-serve/server.js";
export type { McpHttpServer } from "./mcp-serve/server.js";
export { createMcpServeMount, isMcpServeMountPath } from "./mcp-serve/mount.js";
export type { McpServeMount, McpServeMountConfig } from "./mcp-serve/mount.js";
export { NeonStore } from "./mcp-serve/neon-store.js";
export { MemoryStore } from "./mcp-serve/memory-store.js";
export type {
  UpstreamOAuthProvider,
  UpstreamTokens,
  McpToolRegistrar,
  McpServeConfig,
  McpServeStore,
  OAuthClient,
  AuthSession,
  McpTokenRow,
} from "./mcp-serve/types.js";
export { getPublicBaseUrl } from "./mcp-serve/public-url.js";
export { hashToken } from "./mcp-serve/oauth/token.js";

// ── Endpoint discovery (unified MCP + A2A probe) ────────────────────────
export { discoverAgentEndpoint, agentCardCandidates } from "./discovery/discover.js";
export type {
  EndpointCard,
  EndpointCapability,
  EndpointKind,
  EndpointAuth,
  DiscoverOptions,
} from "./discovery/discover.js";

// ── MCP Client (`@earendil-works/pi-mcp` + OAuth PKCE + `ui://` preservation)
export {
  RemoteMcpClient,
  type RemoteMcpClientOptions,
  type RemoteMcpExecutableTool,
} from "./mcp/client/remote.js";
export {
  McpClient,
  StdioTransport,
  StreamableHttpTransport,
  PipeTransport,
} from "@earendil-works/pi-mcp";

// ── Pi Durable A2A 1.0 Adapter (`@leocavalcante/pi-a2a`) ────────────────
export {
  createDurableA2A,
  createA2ATools,
  DurableA2A,
  type DurableA2AOptions,
  type Identity as DurableA2AIdentity,
} from "@leocavalcante/pi-a2a/durable";
export {
  a2aHttpHandler,
  bearerAuth as a2aBearerAuth,
  createA2AServer as createDurableA2AServer,
} from "@leocavalcante/pi-a2a/server";
