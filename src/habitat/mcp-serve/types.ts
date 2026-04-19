/**
 * Types for the generic MCP server library.
 *
 * The core abstraction: an `UpstreamOAuthProvider` defines how to chain
 * MCP OAuth → upstream service OAuth (e.g., Twitter, Oura, Gmail).
 * A `McpToolRegistrar` defines how to register tools on the McpServer
 * for a given authenticated user.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ── Upstream OAuth Provider ─────────────────────────────────────────

/**
 * Tokens returned by the upstream service after OAuth exchange.
 */
export interface UpstreamTokens {
  access_token: string;
  refresh_token: string;
  expires_at: Date | null;
  scopes?: string;
  /** Any extra data the provider wants to persist (e.g., user profile). */
  extra?: Record<string, unknown>;
}

/**
 * Defines how to authenticate with an upstream service (Twitter, Oura, etc.).
 * Implementations handle the service-specific OAuth dance.
 */
export interface UpstreamOAuthProvider {
  /** Human-readable name, e.g. "oura", "twitter". Used as DB key prefix. */
  name: string;

  /**
   * Build the upstream authorization URL that the user's browser is redirected to.
   * @param callbackUrl - The URL the upstream service should redirect back to (our /oauth/upstream-callback)
   * @param state - An opaque state string to round-trip through the upstream flow
   */
  buildAuthorizeUrl(callbackUrl: string, state: string): string;

  /**
   * Exchange the upstream authorization code for tokens.
   * Called after the upstream service redirects back to us.
   * @param upstreamState - The state string from buildAuthorizeUrl, round-tripped through the upstream flow.
   *                       Providers that need to correlate per-flow data (e.g., PKCE verifier) can use it as a lookup key.
   * @returns The upstream tokens + a stable user identity string.
   */
  exchangeCode(code: string, callbackUrl: string, upstreamState?: string): Promise<{
    tokens: UpstreamTokens;
    userId: string;
  }>;

  /**
   * Refresh an expired upstream access token.
   * @returns Updated tokens (new access_token, possibly new refresh_token).
   */
  refreshToken(refreshToken: string): Promise<UpstreamTokens>;

  /**
   * Optional: upstream OAuth scopes to request.
   */
  scopes?: string;
}

// ── Tool Registration ───────────────────────────────────────────────

/**
 * A function that registers MCP tools for a given authenticated user.
 * Called on each request with the user's identity and a way to get their upstream token.
 */
export type McpToolRegistrar = (
  server: McpServer,
  userId: string,
  getUpstreamToken: () => Promise<string>,
) => Promise<void>;

// ── Store Interfaces ────────────────────────────────────────────────

export interface OAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  created_at: Date;
}

export interface AuthSession {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string | null;
  resource: string | null;
  upstream_state: string | null;
  mcp_auth_code: string | null;
  user_id: string | null;
  created_at: Date;
  expires_at: Date;
}

export interface McpTokenRow {
  token_hash: string;
  user_id: string;
  client_id: string;
  token_type: 'access' | 'refresh';
  expires_at: Date;
  created_at: Date;
}

/**
 * Abstract store interface for MCP server state.
 * Implementations can use Neon Postgres, SQLite, or even files.
 */
export interface McpServeStore {
  // OAuth Clients (DCR)
  createClient(clientId: string, clientName: string | null, redirectUris: string[]): Promise<void>;
  getClient(clientId: string): Promise<OAuthClient | null>;

  // Auth Sessions (short-lived, pending flows)
  createSession(session: AuthSession): Promise<void>;
  getSession(id: string): Promise<AuthSession | null>;
  getSessionByUpstreamState(state: string): Promise<AuthSession | null>;
  getSessionByMcpCode(code: string): Promise<AuthSession | null>;
  updateSession(id: string, updates: Partial<AuthSession>): Promise<void>;
  deleteSession(id: string): Promise<void>;

  // MCP Tokens (our issued tokens → user mapping)
  createToken(tokenHash: string, userId: string, clientId: string, tokenType: string, expiresAt: Date): Promise<void>;
  getUserByTokenHash(tokenHash: string): Promise<string | null>;
  getTokenByHash(tokenHash: string): Promise<McpTokenRow | null>;
  deleteToken(tokenHash: string): Promise<void>;

  // Upstream Tokens (per-user tokens for the upstream service)
  upsertUpstreamTokens(userId: string, tokens: UpstreamTokens): Promise<void>;
  getUpstreamTokens(userId: string): Promise<UpstreamTokens | null>;
}

// ── Server Config ───────────────────────────────────────────────────

/**
 * Configuration for creating an MCP server with upstream OAuth.
 */
export interface McpServeConfig {
  /** Server name shown in MCP metadata. */
  name: string;
  /** Server version. */
  version?: string;
  /** The upstream OAuth provider (Twitter, Oura, etc.). */
  upstream: UpstreamOAuthProvider;
  /** Function that registers MCP tools for a user. */
  registerTools: McpToolRegistrar;
  /** The backing store for OAuth state. */
  store: McpServeStore;
  /** Port to listen on. Defaults to 8080. */
  port?: number;
  /**
   * Optional path to a directory whose `index.html` is served at `GET /`.
   * Relative paths resolve against the current working directory.
   * Also serves `<staticRoot>/index.html` for `GET /index.html`.
   */
  staticRoot?: string;
}
