/**
 * GitHub boot-time env injection (ADR 0004 decision 3) —
 * DockerManager.startContainer injects GITHUB_TOKEN / GITHUB_WRITE_TOKEN
 * only when the caller minted them, and GAIA_URL (Gaia's in-network
 * address) always. Exec layer mocked; host sessions dir creation is real
 * (tmp data dir).
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

import { DockerManager, resolveGaiaInternalUrl } from './docker.js';
import type { GaiaHabitatEntry } from './types.js';

function makeEntry(over: Partial<GaiaHabitatEntry> = {}): GaiaHabitatEntry {
  return {
    id: 'twitter',
    name: 'Twitter',
    config: { name: 'Twitter', agents: [] },
    secretBindings: [],
    apiKey: 'gaia_testkey',
    createdAt: '2026-07-06T00:00:00.000Z',
    ...over,
  };
}

function runArgs(): string[] {
  return (
    recordedCalls.find((c) => c.cmd === 'docker' && c.args[0] === 'run')?.args ??
    []
  );
}

/** Values that follow each `--env` flag in the recorded docker run args. */
function envs(args: string[]): string[] {
  return args.filter((_, i) => args[i - 1] === '--env');
}

describe('GitHub boot env injection (ADR 0004)', () => {
  let dataDir: string;
  let docker: DockerManager;
  const prevInternalUrl = process.env.GAIA_INTERNAL_URL;
  const prevGaiaPort = process.env.GAIA_PORT;

  beforeEach(async () => {
    recordedCalls = [];
    delete process.env.GAIA_INTERNAL_URL;
    delete process.env.GAIA_PORT;
    dataDir = await mkdtemp(join(tmpdir(), 'umwl-gaia-github-env-'));
    docker = new DockerManager(dataDir, '/tmp/project');
  });

  afterEach(async () => {
    if (prevInternalUrl === undefined) delete process.env.GAIA_INTERNAL_URL;
    else process.env.GAIA_INTERNAL_URL = prevInternalUrl;
    if (prevGaiaPort === undefined) delete process.env.GAIA_PORT;
    else process.env.GAIA_PORT = prevGaiaPort;
    await rm(dataDir, { recursive: true, force: true });
  });

  it('injects GITHUB_TOKEN and GITHUB_WRITE_TOKEN when minted', async () => {
    await docker.startContainer(makeEntry(), '', [], {
      githubTokens: { read: 'ghs_1_read.jwt', write: 'ghs_1_write.jwt' },
    });
    const e = envs(runArgs());
    expect(e).toContain('GITHUB_TOKEN=ghs_1_read.jwt');
    expect(e).toContain('GITHUB_WRITE_TOKEN=ghs_1_write.jwt');
  });

  it('injects only the minted kind (read without write)', async () => {
    await docker.startContainer(makeEntry(), '', [], {
      githubTokens: { read: 'ghs_1_read.jwt' },
    });
    const e = envs(runArgs());
    expect(e).toContain('GITHUB_TOKEN=ghs_1_read.jwt');
    expect(e.some((v) => v.startsWith('GITHUB_WRITE_TOKEN='))).toBe(false);
  });

  it('omits both token envs when no tokens were minted', async () => {
    await docker.startContainer(makeEntry(), '', []);
    const e = envs(runArgs());
    expect(e.some((v) => v.startsWith('GITHUB_TOKEN='))).toBe(false);
    expect(e.some((v) => v.startsWith('GITHUB_WRITE_TOKEN='))).toBe(false);
  });

  it('always injects GAIA_URL (default: compose container name + GAIA_PORT default)', async () => {
    await docker.startContainer(makeEntry(), '', []);
    expect(envs(runArgs())).toContain('GAIA_URL=http://gaia:7420');
  });

  it('GAIA_URL honors GAIA_PORT and the GAIA_INTERNAL_URL override', async () => {
    process.env.GAIA_PORT = '7421';
    expect(resolveGaiaInternalUrl()).toBe('http://gaia:7421');
    process.env.GAIA_INTERNAL_URL = 'http://gaia-custom:9999';
    expect(resolveGaiaInternalUrl()).toBe('http://gaia-custom:9999');

    await docker.startContainer(makeEntry(), '', []);
    expect(envs(runArgs())).toContain('GAIA_URL=http://gaia-custom:9999');
  });

  it('keeps the image as the final arg and core wiring intact', async () => {
    await docker.startContainer(makeEntry(), '', [], {
      githubTokens: { read: 'r', write: 'w' },
    });
    const args = runArgs();
    expect(args[args.length - 1]).toBe('habitat');
    expect(envs(args)).toContain('HABITAT_API_KEY=gaia_testkey');
  });
});
