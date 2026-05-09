/**
 * @umwelten/server — Network protocol layer.
 *
 * MCP server framework (OAuth, Neon store), MCP client (OAuth PKCE),
 * MCP-to-AI-SDK integration, and A2A (Agent-to-Agent) client + server
 * scaffolding.
 */

// ── A2A (client + server scaffolding) ───────────────────────────────────
export {
  fetchAgentCard,
  sendA2AMessage,
  createA2AServer,
} from "./a2a/index.js";
export type {
  A2AEndpoint,
  AgentCardSummary,
  A2AMessageResponse,
  A2AServer,
  A2AServerOptions,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  AgentCard,
  AgentSkill,
} from "./a2a/index.js";

// ── MCP Serve (OAuth MCP server framework) ──────────────────────────────
export { createMcpServer } from "./mcp-serve/server.js";
export type { McpHttpServer } from "./mcp-serve/server.js";
export { NeonStore } from "./mcp-serve/neon-store.js";
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

// ── MCP Client (remote connection with OAuth PKCE) ──────────────────────
export { RemoteMcpClient } from "./mcp/client/remote.js";

// ── MCP Legacy Client (custom protocol) ─────────────────────────────────
export { MCPClient, createMCPClient, createStdioConfig } from "./mcp/client/client.js";

// ── MCP Integration (bridge MCP tools → AI SDK tools) ───────────────────
export {
  MCPStimulusManager,
  createMCPStimulusManager,
  mcpToolToToolDefinition,
} from "./mcp/integration/stimulus.js";
export type {
  MCPStimulusConfig,
  MCPStimulusBaseConfig,
  MCPStimulusStdioConfig,
  MCPStimulusTransportWrapperConfig,
} from "./mcp/integration/stimulus.js";

// ── MCP Server (expose umwelten as MCP tool provider) ───────────────────
export { MCPServer, MCPServerBuilder, createMCPServer } from "./mcp/server/server.js";

// ── MCP Types ───────────────────────────────────────────────────────────
export type { TransportConfig } from "./mcp/types/transport.js";
