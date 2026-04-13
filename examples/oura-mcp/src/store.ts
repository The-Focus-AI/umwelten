import { neon } from '@neondatabase/serverless';

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
  oura_state: string | null;
  mcp_auth_code: string | null;
  user_id: string | null;
  created_at: Date;
  expires_at: Date;
}

export interface OuraTokens {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: Date | null;
  scopes: string | null;
  updated_at: Date;
}

export class Store {
  private sql;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  // --- OAuth Clients (DCR) ---

  async createClient(clientId: string, clientName: string | null, redirectUris: string[]): Promise<void> {
    await this.sql`
      INSERT INTO oauth_clients (client_id, client_name, redirect_uris)
      VALUES (${clientId}, ${clientName}, ${JSON.stringify(redirectUris)}::jsonb)
    `;
  }

  async getClient(clientId: string): Promise<OAuthClient | null> {
    const rows = await this.sql`
      SELECT * FROM oauth_clients WHERE client_id = ${clientId}
    `;
    return (rows[0] as OAuthClient) ?? null;
  }

  // --- Auth Sessions ---

  async createSession(session: AuthSession): Promise<void> {
    await this.sql`
      INSERT INTO auth_sessions (id, client_id, redirect_uri, code_challenge, code_challenge_method, state, resource, oura_state, mcp_auth_code, user_id, created_at, expires_at)
      VALUES (
        ${session.id},
        ${session.client_id},
        ${session.redirect_uri},
        ${session.code_challenge},
        ${session.code_challenge_method},
        ${session.state},
        ${session.resource},
        ${session.oura_state},
        ${session.mcp_auth_code},
        ${session.user_id},
        ${session.created_at.toISOString()},
        ${session.expires_at.toISOString()}
      )
    `;
  }

  async getSession(id: string): Promise<AuthSession | null> {
    const rows = await this.sql`
      SELECT * FROM auth_sessions WHERE id = ${id}
    `;
    return (rows[0] as AuthSession) ?? null;
  }

  async getSessionByOuraState(ouraState: string): Promise<AuthSession | null> {
    const rows = await this.sql`
      SELECT * FROM auth_sessions WHERE oura_state = ${ouraState}
    `;
    return (rows[0] as AuthSession) ?? null;
  }

  async getSessionByMcpCode(code: string): Promise<AuthSession | null> {
    const rows = await this.sql`
      SELECT * FROM auth_sessions WHERE mcp_auth_code = ${code}
    `;
    return (rows[0] as AuthSession) ?? null;
  }

  async updateSession(id: string, updates: Partial<AuthSession>): Promise<void> {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.oura_state !== undefined) {
      await this.sql`UPDATE auth_sessions SET oura_state = ${updates.oura_state} WHERE id = ${id}`;
    }
    if (updates.mcp_auth_code !== undefined) {
      await this.sql`UPDATE auth_sessions SET mcp_auth_code = ${updates.mcp_auth_code} WHERE id = ${id}`;
    }
    if (updates.user_id !== undefined) {
      await this.sql`UPDATE auth_sessions SET user_id = ${updates.user_id} WHERE id = ${id}`;
    }
    if (updates.state !== undefined) {
      await this.sql`UPDATE auth_sessions SET state = ${updates.state} WHERE id = ${id}`;
    }
    if (updates.resource !== undefined) {
      await this.sql`UPDATE auth_sessions SET resource = ${updates.resource} WHERE id = ${id}`;
    }
  }

  async deleteSession(id: string): Promise<void> {
    await this.sql`DELETE FROM auth_sessions WHERE id = ${id}`;
  }

  async cleanupExpiredSessions(): Promise<number> {
    const rows = await this.sql`
      DELETE FROM auth_sessions WHERE expires_at < now() RETURNING id
    `;
    return rows.length;
  }

  // --- MCP Tokens ---

  async createToken(tokenHash: string, userId: string, clientId: string, tokenType: string, expiresAt: Date): Promise<void> {
    await this.sql`
      INSERT INTO mcp_tokens (token_hash, user_id, client_id, token_type, expires_at)
      VALUES (${tokenHash}, ${userId}, ${clientId}, ${tokenType}, ${expiresAt.toISOString()})
    `;
  }

  async getUserByTokenHash(tokenHash: string): Promise<string | null> {
    const rows = await this.sql`
      SELECT user_id FROM mcp_tokens WHERE token_hash = ${tokenHash} AND expires_at > now()
    `;
    return (rows[0]?.user_id as string) ?? null;
  }

  async getTokenByHash(tokenHash: string): Promise<{ token_hash: string; user_id: string; client_id: string; token_type: string; expires_at: Date } | null> {
    const rows = await this.sql`
      SELECT * FROM mcp_tokens WHERE token_hash = ${tokenHash}
    `;
    return (rows[0] as { token_hash: string; user_id: string; client_id: string; token_type: string; expires_at: Date }) ?? null;
  }

  async deleteToken(tokenHash: string): Promise<void> {
    await this.sql`DELETE FROM mcp_tokens WHERE token_hash = ${tokenHash}`;
  }

  async deleteTokensByUser(userId: string, tokenType?: string): Promise<void> {
    if (tokenType) {
      await this.sql`
        DELETE FROM mcp_tokens WHERE user_id = ${userId} AND token_type = ${tokenType}
      `;
    } else {
      await this.sql`
        DELETE FROM mcp_tokens WHERE user_id = ${userId}
      `;
    }
  }

  async cleanupExpiredTokens(): Promise<number> {
    const rows = await this.sql`
      DELETE FROM mcp_tokens WHERE expires_at < now() RETURNING token_hash
    `;
    return rows.length;
  }

  // --- Oura Tokens ---

  async upsertOuraTokens(userId: string, accessToken: string, refreshToken: string, expiresAt: Date | null, scopes?: string): Promise<void> {
    await this.sql`
      INSERT INTO oura_tokens (user_id, access_token, refresh_token, expires_at, scopes, updated_at)
      VALUES (${userId}, ${accessToken}, ${refreshToken}, ${expiresAt?.toISOString() ?? null}, ${scopes ?? null}, now())
      ON CONFLICT (user_id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        scopes = EXCLUDED.scopes,
        updated_at = now()
    `;
  }

  async getOuraTokens(userId: string): Promise<OuraTokens | null> {
    const rows = await this.sql`
      SELECT * FROM oura_tokens WHERE user_id = ${userId}
    `;
    return (rows[0] as OuraTokens) ?? null;
  }
}
