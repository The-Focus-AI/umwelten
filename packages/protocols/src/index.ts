/**
 * `@umwelten/protocols` — OAuth 2.1 MCP server (`mcp-serve`) and remote MCP
 * client on the official `@modelcontextprotocol` SDK 2.x (protocol revision
 * 2026-07-28, preserving `ui://` `EmbeddedResource`s), the MCP Skills extension
 * host (`McpSkillHost`), endpoint discovery, and the `@leocavalcante/pi-a2a`
 * durable A2A 1.0 surface.
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
  EndpointCapabilityKind,
  EndpointKind,
  EndpointAuth,
  DiscoverOptions,
} from "./discovery/discover.js";

// ── MCP Client (`@modelcontextprotocol/client` 2.x + OAuth PKCE + `ui://` preservation)
export {
  RemoteMcpClient,
  type RemoteMcpClientOptions,
  type RemoteMcpExecutableTool,
} from "./mcp/client/remote.js";
export {
  Client as McpClient,
  StreamableHTTPClientTransport,
  UnauthorizedError as McpUnauthorizedError,
} from "@modelcontextprotocol/client";
export { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// ── MCP Skills extension (`io.modelcontextprotocol/skills`, SEP-2640) ───
export {
  McpSkillHost,
  MemorySkillApprovalStore,
  FileSkillApprovalStore,
  SkillApprovalRequiredError,
  SkillChangedError,
  assertOutsideSkillDiscoveryPaths,
  formatMcpSkillForModel,
  manifestHashOf,
  mcpSkillKey,
  IGNORED_MCP_SKILL_FIELDS,
  SKILL_DISCOVERY_DIRS,
  type McpSkillHostOptions,
  type McpSkillRecord,
  type McpSkillRef,
  type McpSkillSource,
  type LoadedMcpSkill,
  type SkillApprovalStore,
  type SkillRefreshResult,
} from "./mcp/skills/host.js";
export {
  a2aSkillsForServedMcpSkills,
  mcpSkillUriFromA2ASkillId,
  MCP_SKILL_A2A_ID_PREFIX,
  MCP_SKILL_A2A_TAG,
  type A2AAgentSkillJson,
} from "./mcp/skills/a2a.js";
export {
  SkillsClient,
  SkillVerificationError,
  type Skill as McpSkillEntry,
} from "@modelcontextprotocol/client/ext/skills";
export { loadSkills, nodeSkillFiles } from "@modelcontextprotocol/server/ext/skills/node";
export {
  SkillsExtension,
  SkillCatalog,
  memorySkillFiles,
} from "@modelcontextprotocol/server/ext/skills";

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
