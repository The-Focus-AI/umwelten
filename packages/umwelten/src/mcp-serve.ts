/**
 * umwelten/mcp-serve — Backwards-compatible re-export.
 * Prefer importing from '@umwelten/protocols' directly.
 */
export {
  createMcpServer,
  NeonStore,
  getPublicBaseUrl,
  hashToken,
} from "@umwelten/protocols";

export type {
  McpHttpServer,
  UpstreamOAuthProvider,
  UpstreamTokens,
  McpToolRegistrar,
  McpServeConfig,
  McpServeStore,
  OAuthClient,
  AuthSession,
  McpTokenRow,
} from "@umwelten/protocols";
