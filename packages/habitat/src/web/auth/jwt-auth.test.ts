import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, SignJWT, exportSPKI } from 'jose';
import type { IncomingMessage } from 'node:http';
import { jwtAuth } from './jwt-auth.js';

const AUD = 'habitat-twitter';
const ISS = 'https://habitats.example';

let priv: CryptoKey;
let pub: CryptoKey;
let otherPriv: CryptoKey; // a different signer, for tamper tests
let spkiPem: string;

beforeAll(async () => {
  const a = await generateKeyPair('ES256', { extractable: true });
  priv = a.privateKey;
  pub = a.publicKey;
  spkiPem = await exportSPKI(pub);
  const b = await generateKeyPair('ES256', { extractable: true });
  otherPriv = b.privateKey;
});

/** Mint an ES256 token with sensible defaults, overridable per test. */
function mint(opts: {
  sub?: string | null;
  aud?: string;
  iss?: string;
  expiresIn?: string; // jose duration, e.g. '5m' or '-1m'
  name?: string;
  signer?: CryptoKey;
  alg?: string;
} = {}): Promise<string> {
  const claims: Record<string, unknown> = {};
  if (opts.name) claims.name = opts.name;
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: opts.alg ?? 'ES256' })
    .setIssuedAt()
    .setIssuer(opts.iss ?? ISS)
    .setAudience(opts.aud ?? AUD)
    .setExpirationTime(opts.expiresIn ?? '5m');
  if (opts.sub !== null) jwt = jwt.setSubject(opts.sub ?? 'user-123');
  return jwt.sign(opts.signer ?? priv);
}

function reqWith(authorization?: string): IncomingMessage {
  return { headers: authorization ? { authorization } : {} } as unknown as IncomingMessage;
}

function bearer(token: string): IncomingMessage {
  return reqWith(`Bearer ${token}`);
}

describe('jwtAuth — config', () => {
  it('throws when no key source is given', () => {
    expect(() => jwtAuth({ audience: AUD })).toThrow(/jwksUrl or publicKeyPem/);
  });
  it('throws when both key sources are given', () => {
    expect(() => jwtAuth({ audience: AUD, jwksUrl: 'https://x/jwks', publicKeyPem: spkiPem })).toThrow(
      /only one/,
    );
  });
});

describe('jwtAuth — valid tokens (pinned public key)', () => {
  it('verifies a good token and returns the subject as userId', async () => {
    const provider = jwtAuth({ audience: AUD, issuer: ISS, publicKeyPem: spkiPem });
    const user = await provider.authenticate(bearer(await mint({ sub: 'user-abc', name: 'Will' })));
    expect(user).toEqual({
      userId: 'user-abc',
      displayName: 'Will',
      email: undefined,
      provider: 'oauth',
    });
  });

  it('works without an issuer constraint', async () => {
    const provider = jwtAuth({ audience: AUD, publicKeyPem: spkiPem });
    const user = await provider.authenticate(bearer(await mint({ sub: 'u2' })));
    expect(user?.userId).toBe('u2');
  });
});

describe('jwtAuth — rejects bad requests', () => {
  const provider = () => jwtAuth({ audience: AUD, issuer: ISS, publicKeyPem: spkiPem });

  it('returns null with no Authorization header', async () => {
    expect(await provider().authenticate(reqWith())).toBeNull();
  });

  it('returns null for a non-bearer scheme', async () => {
    expect(await provider().authenticate(reqWith('Basic abc'))).toBeNull();
  });

  it('returns null for garbage token', async () => {
    expect(await provider().authenticate(bearer('not-a-jwt'))).toBeNull();
  });

  it('rejects a token for the wrong audience', async () => {
    const t = await mint({ aud: 'some-other-habitat' });
    expect(await provider().authenticate(bearer(t))).toBeNull();
  });

  it('rejects a token from the wrong issuer', async () => {
    const t = await mint({ iss: 'https://evil.example' });
    expect(await provider().authenticate(bearer(t))).toBeNull();
  });

  it('rejects an expired token', async () => {
    const t = await mint({ expiresIn: '-1m' });
    expect(await provider().authenticate(bearer(t))).toBeNull();
  });

  it('rejects a token signed by a different (wrong) key', async () => {
    const t = await mint({ signer: otherPriv });
    expect(await provider().authenticate(bearer(t))).toBeNull();
  });

  it('rejects a token with no subject', async () => {
    const t = await mint({ sub: null });
    expect(await provider().authenticate(bearer(t))).toBeNull();
  });
});

describe('jwtAuth — security: non-asymmetric algs are rejected', () => {
  const provider = () => jwtAuth({ audience: AUD, issuer: ISS, publicKeyPem: spkiPem });

  it('rejects an HS256 (symmetric) token', async () => {
    const secret = new TextEncoder().encode('shared-secret-attacker-controls');
    const t = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(ISS)
      .setAudience(AUD)
      .setSubject('user-123')
      .setExpirationTime('5m')
      .sign(secret);
    expect(await provider().authenticate(bearer(t))).toBeNull();
  });

  it('rejects an unsigned alg:none token', async () => {
    // Hand-craft header.payload. with an empty signature — the classic alg:none attack.
    const b64u = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const header = b64u({ alg: 'none', typ: 'JWT' });
    const payload = b64u({
      sub: 'user-123',
      aud: AUD,
      iss: ISS,
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const t = `${header}.${payload}.`;
    expect(await provider().authenticate(bearer(t))).toBeNull();
  });
});
