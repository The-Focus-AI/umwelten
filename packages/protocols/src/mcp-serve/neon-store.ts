/**
 * Neon Postgres implementation of McpServeStore.
 * Uses @neondatabase/serverless for HTTP-based queries (no WebSocket needed).
 */

import { neon } from '@neondatabase/serverless';
import type {
  McpServeStore,
  OAuthClient,
  AuthSession,
  McpTokenRow,
  UpstreamTokens,
} from './types.js';

export class NeonStore implements McpServeStore {
  private sql;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  // ── Schema Setup ────────────────────────────────────────────────

  async setupTables(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_name TEXT,
        redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL DEFAULT 'S256',
        state TEXT,
        resource TEXT,
        upstream_state TEXT,
        mcp_auth_code TEXT,
        user_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes'
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS mcp_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        token_type TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS upstream_tokens (
        user_id TEXT PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMPTZ,
        scopes TEXT,
        extra JSONB,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
  }

  // ── OAuth Clients (DCR) ─────────────────────────────────────────

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

  // ── Auth Sessions ───────────────────────────────────────────────

  async createSession(session: AuthSession): Promise<void> {
    await this.sql`
      INSERT INTO auth_sessions (
        id, client_id, redirect_uri, code_challenge, code_challenge_method,
        state, resource, upstream_state, mcp_auth_code, user_id, created_at, expires_at
      )
      VALUES (
        ${session.id}, ${session.client_id}, ${session.redirect_uri},
        ${session.code_challenge}, ${session.code_challenge_method},
        ${session.state}, ${session.resource}, ${session.upstream_state},
        ${session.mcp_auth_code}, ${session.user_id},
        ${session.created_at.toISOString()}, ${session.expires_at.toISOString()}
      )
    `;
  }

  async getSession(id: string): Promise<AuthSession | null> {
    const rows = await this.sql`SELECT * FROM auth_sessions WHERE id = ${id}`;
    return (rows[0] as AuthSession) ?? null;
  }

  async getSessionByUpstreamState(state: string): Promise<AuthSession | null> {
    const rows = await this.sql`
      SELECT * FROM auth_sessions WHERE upstream_state = ${state}
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
    if (updates.upstream_state !== undefined) {
      await this.sql`UPDATE auth_sessions SET upstream_state = ${updates.upstream_state} WHERE id = ${id}`;
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

  // ── MCP Tokens ──────────────────────────────────────────────────

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

  async getTokenByHash(tokenHash: string): Promise<McpTokenRow | null> {
    const rows = await this.sql`SELECT * FROM mcp_tokens WHERE token_hash = ${tokenHash}`;
    return (rows[0] as McpTokenRow) ?? null;
  }

  async deleteToken(tokenHash: string): Promise<void> {
    await this.sql`DELETE FROM mcp_tokens WHERE token_hash = ${tokenHash}`;
  }

  // ── Upstream Tokens ─────────────────────────────────────────────

  async upsertUpstreamTokens(userId: string, tokens: UpstreamTokens): Promise<void> {
    await this.sql`
      INSERT INTO upstream_tokens (user_id, access_token, refresh_token, expires_at, scopes, extra, updated_at)
      VALUES (
        ${userId}, ${tokens.access_token}, ${tokens.refresh_token},
        ${tokens.expires_at?.toISOString() ?? null}, ${tokens.scopes ?? null},
        ${tokens.extra ? JSON.stringify(tokens.extra) : null}::jsonb, now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        scopes = EXCLUDED.scopes,
        extra = EXCLUDED.extra,
        updated_at = now()
    `;
  }

  async getUpstreamTokens(userId: string): Promise<UpstreamTokens | null> {
    const rows = await this.sql`SELECT * FROM upstream_tokens WHERE user_id = ${userId}`;
    if (!rows[0]) return null;
    const row = rows[0] as Record<string, unknown>;
    return {
      access_token: row.access_token as string,
      refresh_token: row.refresh_token as string,
      expires_at: row.expires_at ? new Date(row.expires_at as string) : null,
      scopes: row.scopes as string | undefined,
      extra: row.extra as Record<string, unknown> | undefined,
    };
  }
}
