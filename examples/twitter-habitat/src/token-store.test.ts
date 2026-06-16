import { describe, it, expect } from 'vitest';
import {
  XTokenStore,
  habitatSecretStore,
  X_CLIENT_ID_SECRET,
  X_CLIENT_SECRET_SECRET,
  X_REFRESH_TOKEN_SECRET,
  type SecretStore,
} from './token-store.js';
import { XAuthError } from './x-oauth.js';

// ── Test doubles ─────────────────────────────────────────────────────

/** In-memory secret store that records writes. */
function fakeSecrets(initial: Record<string, string> = {}): SecretStore & {
  data: Record<string, string>;
  setCalls: Array<{ name: string; value: string }>;
} {
  const data = { ...initial };
  const setCalls: Array<{ name: string; value: string }> = [];
  return {
    data,
    setCalls,
    get: (name) => data[name],
    set: async (name, value) => {
      setCalls.push({ name, value });
      data[name] = value;
    },
  };
}

interface FetchCall {
  url: string;
  body: string;
  authorization?: string;
}

/**
 * Build a fake fetch that returns queued responses and records the refresh-token
 * presented in each request body. Each queue entry is either a token payload
 * (200) or `{ status, body }` for an error.
 */
function fakeFetch(
  responses: Array<Record<string, unknown> | { status: number; body: unknown }>,
) {
  const calls: FetchCall[] = [];
  let i = 0;
  const fn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const body = String(init?.body ?? '');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(input), body, authorization: headers.Authorization });
    const next = responses[i++];
    if (!next) throw new Error('fakeFetch: no queued response');
    if ('status' in next && typeof next.status === 'number') {
      return new Response(
        typeof next.body === 'string' ? next.body : JSON.stringify(next.body),
        { status: next.status },
      );
    }
    return new Response(JSON.stringify(next), { status: 200 });
  };
  return { fn, calls };
}

const seededSecrets = () =>
  fakeSecrets({
    [X_CLIENT_ID_SECRET]: 'cid',
    [X_CLIENT_SECRET_SECRET]: 'csecret',
    [X_REFRESH_TOKEN_SECRET]: 'refresh-0',
  });

function tokenPayload(access: string, refresh: string, expiresIn = 7200) {
  return { access_token: access, refresh_token: refresh, expires_in: expiresIn };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('XTokenStore', () => {
  it('returns the cached access token without a network call when still valid', async () => {
    const secrets = seededSecrets();
    const { fn, calls } = fakeFetch([tokenPayload('access-1', 'refresh-1')]);
    let clock = 1_000_000;
    const store = new XTokenStore({ secrets, fetchFn: fn, now: () => clock });

    const first = await store.getValidToken(); // cold → 1 refresh
    expect(first).toBe('access-1');

    clock += 60_000; // 1 min later, well inside the 2h window
    const second = await store.getValidToken();
    expect(second).toBe('access-1');

    expect(calls).toHaveLength(1); // no second network call
  });

  it('refreshes via the refresh_token grant when the access token has expired', async () => {
    const secrets = seededSecrets();
    const { fn, calls } = fakeFetch([
      tokenPayload('access-1', 'refresh-1'),
      tokenPayload('access-2', 'refresh-2'),
    ]);
    let clock = 1_000_000;
    const store = new XTokenStore({ secrets, fetchFn: fn, now: () => clock });

    expect(await store.getValidToken()).toBe('access-1');

    clock += 7200 * 1000; // jump past expiry
    expect(await store.getValidToken()).toBe('access-2');

    expect(calls).toHaveLength(2);
    expect(calls[1].body).toContain('grant_type=refresh_token');
  });

  it('persists the rotated refresh token back to the secret store and uses it next time', async () => {
    const secrets = seededSecrets();
    const { fn, calls } = fakeFetch([
      tokenPayload('access-1', 'refresh-1'),
      tokenPayload('access-2', 'refresh-2'),
    ]);
    let clock = 1_000_000;
    const store = new XTokenStore({ secrets, fetchFn: fn, now: () => clock });

    await store.getValidToken();
    // The single-use refresh token is rotated and persisted.
    expect(secrets.data[X_REFRESH_TOKEN_SECRET]).toBe('refresh-1');
    expect(secrets.setCalls.some((c) => c.name === X_REFRESH_TOKEN_SECRET && c.value === 'refresh-1')).toBe(true);

    clock += 7200 * 1000;
    await store.getValidToken();
    // The second refresh must present the persisted refresh-1, not the original refresh-0.
    expect(calls[1].body).toContain('refresh_token=refresh-1');
    expect(secrets.data[X_REFRESH_TOKEN_SECRET]).toBe('refresh-2');
  });

  it('throws an actionable needs_reauth error when no refresh token is present', async () => {
    const secrets = fakeSecrets({
      [X_CLIENT_ID_SECRET]: 'cid',
      [X_CLIENT_SECRET_SECRET]: 'csecret',
      // no refresh token
    });
    const { fn, calls } = fakeFetch([]);
    const store = new XTokenStore({ secrets, fetchFn: fn });

    await expect(store.getValidToken()).rejects.toMatchObject({
      name: 'XAuthError',
      kind: 'needs_reauth',
    });
    await expect(store.getValidToken()).rejects.toThrow(/bootstrap/i);
    expect(calls).toHaveLength(0); // never hits the network
  });

  it('forceRefresh bypasses a still-valid cached token (reactive 401 path)', async () => {
    const secrets = seededSecrets();
    const { fn, calls } = fakeFetch([
      tokenPayload('access-1', 'refresh-1'),
      tokenPayload('access-2', 'refresh-2'),
    ]);
    const store = new XTokenStore({ secrets, fetchFn: fn, now: () => 1_000_000 });

    expect(await store.getValidToken()).toBe('access-1');
    // Token still valid by the clock, but an X API call returned 401 → force a refresh.
    expect(await store.getValidToken({ forceRefresh: true })).toBe('access-2');
    expect(calls).toHaveLength(2);
  });

  it('coalesces concurrent refreshes into a single grant (single-flight)', async () => {
    const secrets = seededSecrets();
    const { fn, calls } = fakeFetch([tokenPayload('access-1', 'refresh-1')]);
    const store = new XTokenStore({ secrets, fetchFn: fn, now: () => 1_000_000 });

    const [a, b, c] = await Promise.all([
      store.getValidToken(),
      store.getValidToken(),
      store.getValidToken(),
    ]);

    expect([a, b, c]).toEqual(['access-1', 'access-1', 'access-1']);
    expect(calls).toHaveLength(1); // the single-use refresh token is presented exactly once
  });

  it('surfaces a needs_reauth error when the refresh token is rejected (invalid_grant)', async () => {
    const secrets = seededSecrets();
    const { fn } = fakeFetch([{ status: 400, body: { error: 'invalid_grant' } }]);
    const store = new XTokenStore({ secrets, fetchFn: fn });

    await expect(store.getValidToken()).rejects.toMatchObject({ kind: 'needs_reauth' });
    // A dead refresh token must NOT be overwritten in the store.
    expect(secrets.data[X_REFRESH_TOKEN_SECRET]).toBe('refresh-0');
  });

  it('classifies a 5xx token-endpoint error as transient (refresh token not dead)', async () => {
    const secrets = seededSecrets();
    const { fn } = fakeFetch([{ status: 503, body: '<html>upstream error</html>' }]);
    const store = new XTokenStore({ secrets, fetchFn: fn });

    const err = await store.getValidToken().catch((e) => e);
    expect(err).toBeInstanceOf(XAuthError);
    expect(err.kind).toBe('transient');
    expect(secrets.data[X_REFRESH_TOKEN_SECRET]).toBe('refresh-0'); // unchanged
  });

  it('errors clearly when client credentials are missing', async () => {
    const secrets = fakeSecrets({ [X_REFRESH_TOKEN_SECRET]: 'refresh-0' });
    const { fn } = fakeFetch([]);
    const store = new XTokenStore({ secrets, fetchFn: fn });

    await expect(store.getValidToken()).rejects.toMatchObject({ kind: 'config' });
  });
});

describe('habitatSecretStore', () => {
  it('adapts a Habitat-like object into a SecretStore', async () => {
    const data: Record<string, string> = { FOO: 'bar' };
    const store = habitatSecretStore({
      getSecret: (n) => data[n],
      setSecret: async (n, v) => {
        data[n] = v;
      },
    });
    expect(store.get('FOO')).toBe('bar');
    await store.set('FOO', 'baz');
    expect(data.FOO).toBe('baz');
  });
});
