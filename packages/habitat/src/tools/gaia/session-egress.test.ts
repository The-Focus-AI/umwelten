/**
 * Session egress tests (#119) — Gaia bind-mounts each container's sessions
 * directory to a host path under the data dir so host-side introspection
 * (umwelten browse, the digester) sees in-container sessions. Exec layer
 * mocked; the host directory creation is real (tmp data dir).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, stat, writeFile, mkdir } from 'node:fs/promises';
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
          if (typeof args === 'function') {
            callback = args;
          } else if (typeof options === 'function') {
            callback = options;
          } else {
            callback = cb;
          }
          recordedCalls.push({ cmd, args: Array.isArray(args) ? args : [] });
          if (callback) callback(null, { stdout: '', stderr: '' });
          return {} as never;
        },
      ),
  };
});

import { DockerManager } from './docker.js';
import type { GaiaHabitatEntry } from './types.js';

function makeEntry(id = 'egress-hab'): GaiaHabitatEntry {
  return {
    id,
    name: 'Egress Hab',
    config: { name: 'Egress Hab', agents: [] },
    secretBindings: [],
    apiKey: 'gaia_testkey',
    createdAt: '2026-06-11T00:00:00.000Z',
  };
}

function runArgs(): string[] {
  const run = recordedCalls.find(
    (c) => c.cmd === 'docker' && c.args[0] === 'run',
  );
  return run?.args ?? [];
}

describe('Gaia session egress (#119)', () => {
  let dataDir: string;
  let docker: DockerManager;

  beforeEach(async () => {
    recordedCalls = [];
    dataDir = await mkdtemp(join(tmpdir(), 'umwl-gaia-egress-'));
    docker = new DockerManager(dataDir, '/tmp/project');
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('exposes the per-entry host sessions path', () => {
    expect(docker.hostSessionsDir('egress-hab')).toBe(
      join(dataDir, 'sessions', 'egress-hab'),
    );
  });

  it('bind-mounts the sessions dir over the named volume in docker run', async () => {
    await docker.startContainer(makeEntry(), '', []);
    const args = runArgs();
    const volumes = args.filter((_, i) => args[i - 1] === '-v');
    // Named volume first, then the more specific sessions bind that shadows it.
    expect(volumes).toEqual([
      'gaia-egress-hab-data:/data',
      `${join(dataDir, 'sessions', 'egress-hab')}:/data/sessions`,
    ]);
  });

  it('creates the host sessions directory before docker run', async () => {
    await docker.startContainer(makeEntry(), '', []);
    const st = await stat(join(dataDir, 'sessions', 'egress-hab'));
    expect(st.isDirectory()).toBe(true);
  });

  it('keeps existing host session files across restarts (no clearing)', async () => {
    const hostDir = join(dataDir, 'sessions', 'egress-hab');
    await mkdir(join(hostDir, 'ctx-1'), { recursive: true });
    await writeFile(join(hostDir, 'ctx-1', 'transcript.jsonl'), '{}\n');

    await docker.startContainer(makeEntry(), '', []);

    const st = await stat(join(hostDir, 'ctx-1', 'transcript.jsonl'));
    expect(st.isFile()).toBe(true);
  });

  it('keeps image, port, network, and api-key wiring unchanged', async () => {
    await docker.startContainer(makeEntry(), '', []);
    const args = runArgs();
    expect(args[args.length - 1]).toBe('habitat');
    expect(args).toContain('HABITAT_API_KEY=gaia_testkey');
    expect(args.join(' ')).toMatch(/-p 127\.0\.0\.1:\d+:8080/);
    expect(args).toContain('gaia-net');
  });
});
