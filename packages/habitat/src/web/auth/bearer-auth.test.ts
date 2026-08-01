import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { bearerAuth, parseApiKeys } from './bearer-auth.js';

const req = (authorization?: string) =>
  ({ headers: authorization ? { authorization } : {} }) as IncomingMessage;

describe('parseApiKeys', () => {
  it('parses one key, several keys, and trims whitespace', () => {
    expect(parseApiKeys('solo')).toEqual(['solo']);
    expect(parseApiKeys('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(parseApiKeys(' a , b ')).toEqual(['a', 'b']);
  });

  /**
   * A blank entry must never become a key — an empty variable or a trailing
   * comma would otherwise produce a key that matches the empty string.
   */
  it('drops blanks rather than turning them into keys', () => {
    expect(parseApiKeys('a,,b,')).toEqual(['a', 'b']);
    expect(parseApiKeys('')).toEqual([]);
    expect(parseApiKeys('   ')).toEqual([]);
    expect(parseApiKeys(',,')).toEqual([]);
    expect(parseApiKeys(undefined)).toEqual([]);
  });
});

describe('bearerAuth', () => {
  it('accepts a single key, as before', async () => {
    const auth = bearerAuth('only-key');
    expect((await auth.authenticate(req('Bearer only-key')))?.userId).toBe(
      'bearer-user',
    );
    expect(await auth.authenticate(req('Bearer other'))).toBeNull();
  });

  it('accepts any key in the list', async () => {
    const auth = bearerAuth(['gaia-dashboard', 'will-cli', 'agent']);

    for (const key of ['gaia-dashboard', 'will-cli', 'agent']) {
      expect((await auth.authenticate(req(`Bearer ${key}`)))?.userId).toBe(
        'bearer-user',
      );
    }
  });

  /** Same rights, same identity — a list of accepted values, not roles. */
  it('resolves every key to the same identity', async () => {
    const auth = bearerAuth(['one', 'two']);
    expect(await auth.authenticate(req('Bearer one'))).toEqual(
      await auth.authenticate(req('Bearer two')),
    );
  });

  /** Revoking one key must leave the others working. */
  it('rejects a key that is no longer in the list', async () => {
    const auth = bearerAuth(['kept']);
    expect(await auth.authenticate(req('Bearer revoked'))).toBeNull();
    expect(await auth.authenticate(req('Bearer kept'))).not.toBeNull();
  });

  it('rejects a missing header, a non-bearer scheme, and an empty token', async () => {
    const auth = bearerAuth(['k']);
    expect(await auth.authenticate(req())).toBeNull();
    expect(await auth.authenticate(req('Basic k'))).toBeNull();
    expect(await auth.authenticate(req('Bearer'))).toBeNull();
    expect(await auth.authenticate(req('Bearer '))).toBeNull();
  });

  /** An empty list authenticates nobody — it must not fall open. */
  it('accepts nothing when configured with no usable keys', async () => {
    for (const keys of [[], [''], ['', '']]) {
      const auth = bearerAuth(keys);
      expect(await auth.authenticate(req('Bearer anything'))).toBeNull();
      expect(await auth.authenticate(req('Bearer '))).toBeNull();
    }
  });
});
