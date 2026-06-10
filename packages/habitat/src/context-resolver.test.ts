import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveContextSession } from './context-resolver.js';

function userLine(content: string): string {
  return (
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content },
      timestamp: '2026-06-10T12:00:00.000Z',
      uuid: `u-${content}`,
    }) + '\n'
  );
}

function assistantLine(content: string): string {
  return (
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content },
      timestamp: '2026-06-10T12:00:01.000Z',
      uuid: `a-${content}`,
    }) + '\n'
  );
}

async function writeSession(
  sessionsDir: string,
  contextId: string,
  opts: {
    meta?: Record<string, unknown> | null;
    transcript?: string;
  } = {},
): Promise<string> {
  const dir = join(sessionsDir, contextId);
  await mkdir(dir, { recursive: true });
  const meta =
    opts.meta === undefined
      ? {
          sessionId: contextId,
          created: '2026-06-10T11:00:00.000Z',
          lastUsed: '2026-06-10T12:00:00.000Z',
          type: 'a2a',
        }
      : opts.meta;
  if (meta !== null) {
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  }
  if (opts.transcript !== undefined) {
    await writeFile(join(dir, 'transcript.jsonl'), opts.transcript, 'utf-8');
  }
  return dir;
}

describe('resolveContextSession', () => {
  let sessionsDir: string;

  beforeEach(async () => {
    sessionsDir = await mkdtemp(join(tmpdir(), 'umwl-ctx-'));
  });

  afterEach(async () => {
    await rm(sessionsDir, { recursive: true, force: true });
  });

  it('resolves an existing a2a session by contextId', async () => {
    const dir = await writeSession(sessionsDir, 'ctx-abc', {
      transcript: userLine('hello') + assistantLine('hi there'),
    });

    const resolved = await resolveContextSession(sessionsDir, 'ctx-abc');
    expect(resolved).not.toBeNull();
    expect(resolved?.contextId).toBe('ctx-abc');
    expect(resolved?.sessionDir).toBe(dir);
    expect(resolved?.metadata?.sessionId).toBe('ctx-abc');
    expect(resolved?.metadata?.type).toBe('a2a');
    expect(resolved?.transcriptReadPaths).toEqual([join(dir, 'transcript.jsonl')]);
    expect(resolved?.nativeSessionRef).toBeUndefined();
  });

  it('orders frozen segments before the live transcript', async () => {
    const dir = await writeSession(sessionsDir, 'ctx-seg', {
      transcript: userLine('live'),
    });
    await writeFile(
      join(dir, 'transcript.2026-06-01T00-00-00.000Z.jsonl'),
      userLine('old'),
      'utf-8',
    );

    const resolved = await resolveContextSession(sessionsDir, 'ctx-seg');
    expect(resolved?.transcriptReadPaths.map((p) => p.split('/').pop())).toEqual([
      'transcript.2026-06-01T00-00-00.000Z.jsonl',
      'transcript.jsonl',
    ]);
  });

  it('returns null for an unknown contextId', async () => {
    expect(await resolveContextSession(sessionsDir, 'nope')).toBeNull();
  });

  it('returns null for an empty directory (no meta, no transcript)', async () => {
    await mkdir(join(sessionsDir, 'ctx-empty'), { recursive: true });
    expect(await resolveContextSession(sessionsDir, 'ctx-empty')).toBeNull();
  });

  it('rejects path-traversal contextIds without touching the filesystem', async () => {
    await writeSession(sessionsDir, 'ctx-real', { transcript: userLine('x') });
    for (const evil of ['..', '.', '../ctx-real', 'a/b', 'a\\b', '', 'ctx\0id']) {
      expect(await resolveContextSession(sessionsDir, evil)).toBeNull();
    }
  });

  it('still resolves when meta.json is missing but a transcript exists', async () => {
    await writeSession(sessionsDir, 'ctx-nometa', {
      meta: null,
      transcript: userLine('hello'),
    });
    const resolved = await resolveContextSession(sessionsDir, 'ctx-nometa');
    expect(resolved).not.toBeNull();
    expect(resolved?.metadata).toBeNull();
    expect(resolved?.transcriptReadPaths.length).toBe(1);
  });

  it('surfaces a top-level nativeSessionRef from meta.json', async () => {
    const ref = {
      runtime: 'claude-sdk',
      nativeSessionId: 'sdk-123',
      nativeSessionPath: '/data/claude/projects/x/sdk-123.jsonl',
    };
    await writeSession(sessionsDir, 'ctx-native', {
      meta: {
        sessionId: 'ctx-native',
        created: '2026-06-10T11:00:00.000Z',
        lastUsed: '2026-06-10T12:00:00.000Z',
        type: 'a2a',
        nativeSessionRef: ref,
      },
      transcript: userLine('hello'),
    });
    const resolved = await resolveContextSession(sessionsDir, 'ctx-native');
    expect(resolved?.nativeSessionRef).toEqual(ref);
  });

  it('surfaces a nativeSessionRef nested under the metadata record', async () => {
    const ref = {
      runtime: 'pi',
      nativeSessionId: 'pi-9',
      nativeSessionPath: '/data/pi/sessions/pi-9',
    };
    await writeSession(sessionsDir, 'ctx-nested', {
      meta: {
        sessionId: 'ctx-nested',
        created: '2026-06-10T11:00:00.000Z',
        lastUsed: '2026-06-10T12:00:00.000Z',
        type: 'a2a',
        metadata: { nativeSessionRef: ref },
      },
      transcript: userLine('hello'),
    });
    const resolved = await resolveContextSession(sessionsDir, 'ctx-nested');
    expect(resolved?.nativeSessionRef).toEqual(ref);
  });

  it('ignores a malformed nativeSessionRef', async () => {
    await writeSession(sessionsDir, 'ctx-bad', {
      meta: {
        sessionId: 'ctx-bad',
        created: '2026-06-10T11:00:00.000Z',
        lastUsed: '2026-06-10T12:00:00.000Z',
        type: 'a2a',
        nativeSessionRef: 'not-an-object',
      },
      transcript: userLine('hello'),
    });
    const resolved = await resolveContextSession(sessionsDir, 'ctx-bad');
    expect(resolved).not.toBeNull();
    expect(resolved?.nativeSessionRef).toBeUndefined();
  });

  it('treats unparseable meta.json as missing metadata, not an error', async () => {
    const dir = join(sessionsDir, 'ctx-garbage');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'meta.json'), '{ not json', 'utf-8');
    await writeFile(join(dir, 'transcript.jsonl'), userLine('hello'), 'utf-8');
    const resolved = await resolveContextSession(sessionsDir, 'ctx-garbage');
    expect(resolved).not.toBeNull();
    expect(resolved?.metadata).toBeNull();
  });
});
