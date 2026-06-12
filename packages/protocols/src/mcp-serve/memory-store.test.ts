/**
 * MemoryStore — behavior parity with NeonStore for the McpServeStore
 * contract the OAuth flow depends on (session lookup by state/code,
 * token expiry, upstream token upsert).
 */

import { describe, it, expect } from 'vitest';
import { MemoryStore } from './memory-store.js';
import type { AuthSession } from './types.js';

function session(overrides: Partial<AuthSession> = {}): AuthSession {
  const now = new Date();
  return {
    id: 'sess-1',
    client_id: 'client-1',
    redirect_uri: 'https://client.example/cb',
    code_challenge: 'abc',
    code_challenge_method: 'S256',
    state: 'client-state',
    resource: null,
    upstream_state: 'up-state',
    mcp_auth_code: null,
    user_id: null,
    created_at: now,
    expires_at: new Date(now.getTime() + 10 * 60 * 1000),
    ...overrides,
  };
}

describe('MemoryStore', () => {
  it('round-trips OAuth clients', async () => {
    const store = new MemoryStore();
    await store.createClient('c1', 'My Client', ['https://a/cb']);
    const client = await store.getClient('c1');
    expect(client?.client_name).toBe('My Client');
    expect(client?.redirect_uris).toEqual(['https://a/cb']);
    expect(await store.getClient('missing')).toBeNull();
  });

  it('finds sessions by id, upstream state, and mcp code', async () => {
    const store = new MemoryStore();
    await store.createSession(session());
    expect((await store.getSession('sess-1'))?.client_id).toBe('client-1');
    expect((await store.getSessionByUpstreamState('up-state'))?.id).toBe('sess-1');
    expect(await store.getSessionByMcpCode('nope')).toBeNull();

    await store.updateSession('sess-1', { mcp_auth_code: 'code-9', user_id: 'u1' });
    const found = await store.getSessionByMcpCode('code-9');
    expect(found?.user_id).toBe('u1');

    await store.deleteSession('sess-1');
    expect(await store.getSession('sess-1')).toBeNull();
  });

  it('maps token hashes to users and honors expiry', async () => {
    const store = new MemoryStore();
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);

    await store.createToken('hash-live', 'u1', 'c1', 'access', future);
    await store.createToken('hash-dead', 'u1', 'c1', 'access', past);

    expect(await store.getUserByTokenHash('hash-live')).toBe('u1');
    expect(await store.getUserByTokenHash('hash-dead')).toBeNull();
    expect((await store.getTokenByHash('hash-dead'))?.user_id).toBe('u1');

    await store.deleteToken('hash-live');
    expect(await store.getUserByTokenHash('hash-live')).toBeNull();
  });

  it('upserts upstream tokens', async () => {
    const store = new MemoryStore();
    await store.upsertUpstreamTokens('u1', {
      access_token: 'a1',
      refresh_token: 'r1',
      expires_at: null,
    });
    await store.upsertUpstreamTokens('u1', {
      access_token: 'a2',
      refresh_token: 'r2',
      expires_at: null,
    });
    expect((await store.getUpstreamTokens('u1'))?.access_token).toBe('a2');
    expect(await store.getUpstreamTokens('u2')).toBeNull();
  });
});
