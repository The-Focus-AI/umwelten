/**
 * DockerManager image-selection tests (#115) — exec layer mocked, no real
 * Docker. Mock pattern follows fnox.test.ts: callback-based execFile mock
 * compatible with util.promisify.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

type CallbackFn = (
  error: Error | null,
  result: { stdout: string; stderr: string },
) => void;

interface RecordedCall {
  cmd: string;
  args: string[];
}

let recordedCalls: RecordedCall[] = [];
/** Image names that `docker image inspect` should report as present. */
let existingImages: Set<string> = new Set();

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
          const argv = Array.isArray(args) ? args : [];
          recordedCalls.push({ cmd, args: argv });
          if (callback) {
            if (argv[0] === 'image' && argv[1] === 'inspect') {
              if (existingImages.has(argv[2])) {
                callback(null, { stdout: '[]', stderr: '' });
              } else {
                callback(new Error(`No such image: ${argv[2]}`), {
                  stdout: '',
                  stderr: `Error: No such image: ${argv[2]}`,
                });
              }
            } else {
              callback(null, { stdout: '', stderr: '' });
            }
          }
          return {} as never;
        },
      ),
  };
});

import { DockerManager, DEFAULT_IMAGE_NAME } from './docker.js';
import type { GaiaHabitatEntry } from './types.js';

function makeEntry(overrides: Partial<GaiaHabitatEntry> = {}): GaiaHabitatEntry {
  return {
    id: 'test-hab',
    name: 'Test Hab',
    config: { name: 'Test Hab', agents: [] },
    secretBindings: [],
    apiKey: 'gaia_testkey',
    createdAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

function runCalls(): RecordedCall[] {
  return recordedCalls.filter((c) => c.cmd === 'docker' && c.args[0] === 'run');
}

describe('DockerManager — per-entry image', () => {
  let docker: DockerManager;

  beforeEach(() => {
    recordedCalls = [];
    existingImages = new Set([DEFAULT_IMAGE_NAME]);
    docker = new DockerManager('/tmp/gaia-data', '/tmp/project');
  });

  it('runs the default image when the entry has no image field', async () => {
    const port = await docker.startContainer(makeEntry(), '', []);
    expect(port).toBeGreaterThan(0);
    const run = runCalls();
    expect(run).toHaveLength(1);
    expect(run[0].args[run[0].args.length - 1]).toBe(DEFAULT_IMAGE_NAME);
  });

  it('runs the entry image when set and present', async () => {
    existingImages.add('habitat-coding');
    await docker.startContainer(makeEntry({ image: 'habitat-coding' }), '', []);
    const run = runCalls();
    expect(run).toHaveLength(1);
    expect(run[0].args[run[0].args.length - 1]).toBe('habitat-coding');
  });

  it('throws a clear error for a missing custom image — no silent fallback, no docker run', async () => {
    await expect(
      docker.startContainer(makeEntry({ image: 'ghost-image' }), '', []),
    ).rejects.toThrow(/ghost-image.*test-hab|test-hab.*ghost-image/);
    expect(runCalls()).toHaveLength(0);
  });

  it('preserves volume, network, port, and api-key wiring for custom images', async () => {
    existingImages.add('habitat-coding');
    await docker.startContainer(makeEntry({ image: 'habitat-coding' }), '', []);
    const args = runCalls()[0].args;
    expect(args).toContain('gaia-test-hab-data:/data');
    expect(args).toContain('HABITAT_API_KEY=gaia_testkey');
    expect(args.join(' ')).toContain('--network');
  });

  it('imageExists checks the given image, defaulting to the standard image', async () => {
    existingImages = new Set(['habitat-coding']);
    expect(await docker.imageExists('habitat-coding')).toBe(true);
    expect(await docker.imageExists()).toBe(false); // default image absent
    const inspected = recordedCalls
      .filter((c) => c.args[0] === 'image' && c.args[1] === 'inspect')
      .map((c) => c.args[2]);
    expect(inspected).toEqual(['habitat-coding', DEFAULT_IMAGE_NAME]);
  });
});
