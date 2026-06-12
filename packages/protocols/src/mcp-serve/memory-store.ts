/**
 * In-memory implementation of McpServeStore.
 *
 * For tests and dev/demo mounts: all OAuth state (registered clients,
 * pending auth sessions, issued tokens, upstream tokens) is lost when the
 * process exits, so every client must re-authenticate after a restart.
 * Use NeonStore for anything that needs to survive a deploy.
 */

import type {
  McpServeStore,
  OAuthClient,
  AuthSession,
  McpTokenRow,
  UpstreamTokens,
} from './types.js';

export class MemoryStore implements McpServeStore {
  private clients = new Map<string, OAuthClient>();
  private sessions = new Map<string, AuthSession>();
  private tokens = new Map<string, McpTokenRow>();
  private upstreamTokens = new Map<string, UpstreamTokens>();

  // ── OAuth Clients (DCR) ─────────────────────────────────────────

  async createClient(clientId: string, clientName: string | null, redirectUris: string[]): Promise<void> {
    this.clients.set(clientId, {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: [...redirectUris],
      created_at: new Date(),
    });
  }

  async getClient(clientId: string): Promise<OAuthClient | null> {
    return this.clients.get(clientId) ?? null;
  }

  // ── Auth Sessions ───────────────────────────────────────────────

  async createSession(session: AuthSession): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async getSession(id: string): Promise<AuthSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async getSessionByUpstreamState(state: string): Promise<AuthSession | null> {
    for (const session of this.sessions.values()) {
      if (session.upstream_state === state) return session;
    }
    return null;
  }

  async getSessionByMcpCode(code: string): Promise<AuthSession | null> {
    for (const session of this.sessions.values()) {
      if (session.mcp_auth_code === code) return session;
    }
    return null;
  }

  async updateSession(id: string, updates: Partial<AuthSession>): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    Object.assign(session, updates);
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  // ── MCP Tokens ──────────────────────────────────────────────────

  async createToken(tokenHash: string, userId: string, clientId: string, tokenType: string, expiresAt: Date): Promise<void> {
    this.tokens.set(tokenHash, {
      token_hash: tokenHash,
      user_id: userId,
      client_id: clientId,
      token_type: tokenType as McpTokenRow['token_type'],
      expires_at: expiresAt,
      created_at: new Date(),
    });
  }

  async getUserByTokenHash(tokenHash: string): Promise<string | null> {
    const row = this.tokens.get(tokenHash);
    if (!row) return null;
    if (row.expires_at <= new Date()) return null;
    return row.user_id;
  }

  async getTokenByHash(tokenHash: string): Promise<McpTokenRow | null> {
    return this.tokens.get(tokenHash) ?? null;
  }

  async deleteToken(tokenHash: string): Promise<void> {
    this.tokens.delete(tokenHash);
  }

  // ── Upstream Tokens ─────────────────────────────────────────────

  async upsertUpstreamTokens(userId: string, tokens: UpstreamTokens): Promise<void> {
    this.upstreamTokens.set(userId, { ...tokens });
  }

  async getUpstreamTokens(userId: string): Promise<UpstreamTokens | null> {
    return this.upstreamTokens.get(userId) ?? null;
  }
}
