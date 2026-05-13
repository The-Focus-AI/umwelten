/**
 * mcp-serve: Turn any upstream OAuth service into a hosted MCP server.
 *
 * Usage:
 *   import { createMcpServer, NeonStore } from 'umwelten/mcp-serve';
 *
 *   const server = createMcpServer({
 *     name: 'my-service-mcp',
 *     upstream: myOAuthProvider,
 *     registerTools: myToolRegistrar,
 *     store: new NeonStore(DATABASE_URL),
 *   });
 *   server.listen(8080);
 */

export { createMcpServer } from './server.js';
export type { McpHttpServer } from './server.js';

export { NeonStore } from './neon-store.js';

export type {
  UpstreamOAuthProvider,
  UpstreamTokens,
  McpToolRegistrar,
  McpServeConfig,
  McpServeStore,
  OAuthClient,
  AuthSession,
  McpTokenRow,
} from './types.js';

export { getPublicBaseUrl } from './public-url.js';
export { hashToken } from './oauth/token.js';
