/**
 * Caddy label emission (#170) — DockerManager.startContainer stamps
 * `caddy=<host>` + `caddy.reverse_proxy={{upstreams 8080}}` labels so
 * caddy-docker-proxy publishes each habitat at its own public URL. Labels are
 * emitted only when a hostname is resolvable (explicit entry.hostname, or
 * <id>.$GAIA_BASE_DOMAIN); local dev with neither stays label-free. Exec layer
 * mocked; host sessions dir creation is real (tmp data dir).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type CallbackFn = (
  error: Error | null,
  result: { stdout: string; stderr: string },
) => void;

interface RecordedCall {
  cmd: string;
  args: string[];
}

let recordedCalls: RecordedCall[] = [];

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    execFile: vi
      .fn()
      .mockImplementation(
        (
          cmd: string,
          args?: string[] | CallbackFn,
          options?: Record<string, unknown> | CallbackFn,
          cb?: CallbackFn,
        ) => {
          let callback: CallbackFn | undefined;
          if (typeof args === 'function') callback = args;
          else if (typeof options === 'function') callback = options;
          else callback = cb;
          recordedCalls.push({ cmd, args: Array.isArray(args) ? args : [] });
          if (callback) callback(null, { stdout: '', stderr: '' });
          return {} as never;
        },
      ),
  };
});

import { DockerManager, resolveHabitatHostname } from './docker.js';
import type { GaiaHabitatEntry } from './types.js';

function makeEntry(over: Partial<GaiaHabitatEntry> = {}): GaiaHabitatEntry {
  return {
    id: 'twitter',
    name: 'Twitter',
    config: { name: 'Twitter', agents: [] },
    secretBindings: [],
    apiKey: 'gaia_testkey',
    createdAt: '2026-06-18T00:00:00.000Z',
    ...over,
  };
}

function runArgs(): string[] {
  return (
    recordedCalls.find((c) => c.cmd === 'docker' && c.args[0] === 'run')?.args ??
    []
  );
}

/** Values that follow each `--label` flag in the recorded docker run args. */
function labels(args: string[]): string[] {
  return args.filter((_, i) => args[i - 1] === '--label');
}

describe('Gaia Caddy label emission (#170)', () => {
  let dataDir: string;
  let docker: DockerManager;
  const prevBaseDomain = process.env.GAIA_BASE_DOMAIN;
  const prevIngress = process.env.GAIA_INGRESS_NETWORK;
  const prevJwks = process.env.GAIA_JWKS_URL;

  beforeEach(async () => {
    recordedCalls = [];
    delete process.env.GAIA_BASE_DOMAIN;
    delete process.env.GAIA_INGRESS_NETWORK;
    delete process.env.GAIA_JWKS_URL;
    dataDir = await mkdtemp(join(tmpdir(), 'umwl-gaia-caddy-'));
    docker = new DockerManager(dataDir, '/tmp/project');
  });

  afterEach(async () => {
    if (prevBaseDomain === undefined) delete process.env.GAIA_BASE_DOMAIN;
    else process.env.GAIA_BASE_DOMAIN = prevBaseDomain;
    if (prevIngress === undefined) delete process.env.GAIA_INGRESS_NETWORK;
    else process.env.GAIA_INGRESS_NETWORK = prevIngress;
    if (prevJwks === undefined) delete process.env.GAIA_JWKS_URL;
    else process.env.GAIA_JWKS_URL = prevJwks;
    await rm(dataDir, { recursive: true, force: true });
  });

  /** Values that follow each `--env` flag in the recorded docker run args. */
  function envs(args: string[]): string[] {
    return args.filter((_, i) => args[i - 1] === '--env');
  }

  it('injects HABITAT_AUTH_* (JWT-verify) when GAIA_JWKS_URL + hostname are set', async () => {
    process.env.GAIA_BASE_DOMAIN = 'habitats.example.com';
    process.env.GAIA_JWKS_URL = 'https://habitats.example.com/.well-known/jwks.json';
    await docker.startContainer(makeEntry(), '', []);
    const e = envs(runArgs());
    expect(e).toContain('HABITAT_AUTH_AUDIENCE=https://twitter.habitats.example.com');
    expect(e).toContain('HABITAT_AUTH_JWKS_URL=https://habitats.example.com/.well-known/jwks.json');
    // shared bearer stays → dual-auth
    expect(e).toContain('HABITAT_API_KEY=gaia_testkey');
  });

  it('omits HABITAT_AUTH_* when GAIA_JWKS_URL is unset (bearer-only)', async () => {
    process.env.GAIA_BASE_DOMAIN = 'habitats.example.com';
    await docker.startContainer(makeEntry(), '', []);
    const e = envs(runArgs());
    expect(e.some((v) => v.startsWith('HABITAT_AUTH_'))).toBe(false);
    expect(e).toContain('HABITAT_API_KEY=gaia_testkey');
  });

  it('omits HABITAT_AUTH_* when there is no hostname even if GAIA_JWKS_URL is set', async () => {
    process.env.GAIA_JWKS_URL = 'https://habitats.example.com/.well-known/jwks.json';
    await docker.startContainer(makeEntry(), '', []);
    expect(envs(runArgs()).some((v) => v.startsWith('HABITAT_AUTH_'))).toBe(false);
  });

  it('emits no caddy labels when no hostname is resolvable (local dev)', async () => {
    await docker.startContainer(makeEntry(), '', []);
    const args = runArgs();
    expect(labels(args)).toEqual([]);
    // Image still last, core wiring intact.
    expect(args[args.length - 1]).toBe('habitat');
  });

  it('derives <id>.$GAIA_BASE_DOMAIN and stamps both labels', async () => {
    process.env.GAIA_BASE_DOMAIN = 'habitats.example.com';
    await docker.startContainer(makeEntry(), '', []);
    const args = runArgs();
    expect(labels(args)).toEqual([
      'caddy=twitter.habitats.example.com',
      'caddy.reverse_proxy={{upstreams 8080}}',
    ]);
    // Labels precede the image (which must remain the final arg).
    expect(args[args.length - 1]).toBe('habitat');
  });

  it('prefers an explicit entry.hostname over the base domain', async () => {
    process.env.GAIA_BASE_DOMAIN = 'habitats.example.com';
    await docker.startContainer(
      makeEntry({ hostname: 'bird.custom.dev' }),
      '',
      [],
    );
    expect(labels(runArgs())).toEqual([
      'caddy=bird.custom.dev',
      'caddy.reverse_proxy={{upstreams 8080}}',
    ]);
  });

  it('does not disturb image/port/network/api-key wiring', async () => {
    process.env.GAIA_BASE_DOMAIN = 'habitats.example.com';
    await docker.startContainer(makeEntry(), '', []);
    const args = runArgs();
    expect(args[args.length - 1]).toBe('habitat');
    expect(args).toContain('HABITAT_API_KEY=gaia_testkey');
    expect(args.join(' ')).toMatch(/-p 127\.0\.0\.1:\d+:8080/);
    expect(args).toContain('gaia-net');
  });

  it('defaults the ingress network to gaia-net', async () => {
    await docker.startContainer(makeEntry(), '', []);
    const args = runArgs();
    expect(args[args.indexOf('--network') + 1]).toBe('gaia-net');
  });

  it('honors GAIA_INGRESS_NETWORK to reuse an existing caddy network (#170)', async () => {
    process.env.GAIA_INGRESS_NETWORK = 'caddy';
    await docker.startContainer(makeEntry(), '', []);
    const args = runArgs();
    expect(args[args.indexOf('--network') + 1]).toBe('caddy');
  });

  describe('resolveHabitatHostname', () => {
    it('returns undefined with no hostname and no base domain', () => {
      delete process.env.GAIA_BASE_DOMAIN;
      expect(resolveHabitatHostname({ id: 'x' })).toBeUndefined();
    });
    it('derives from the base domain', () => {
      process.env.GAIA_BASE_DOMAIN = 'h.example.com';
      expect(resolveHabitatHostname({ id: 'x' })).toBe('x.h.example.com');
    });
    it('explicit hostname wins', () => {
      process.env.GAIA_BASE_DOMAIN = 'h.example.com';
      expect(resolveHabitatHostname({ id: 'x', hostname: 'y.dev' })).toBe(
        'y.dev',
      );
    });
  });
});
