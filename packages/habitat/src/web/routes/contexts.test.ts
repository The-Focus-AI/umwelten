import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contextShowRoute, contextTranscriptRoute } from './contexts.js';
import { defaultRoutes } from './index.js';
import type { RouteContext } from '../types.js';

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

interface FakeRes {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function fakeCtx(sessionsDir: string): { ctx: RouteContext; res: FakeRes } {
  const res: FakeRes = { status: 0, headers: {}, body: '' };
  const ctx = {
    habitat: { getSessionsDir: () => sessionsDir },
    bridge: {},
    user: { userId: 'test-user' },
    req: {},
    res: {
      writeHead(status: number, headers?: Record<string, string>) {
        res.status = status;
        if (headers) res.headers = { ...res.headers, ...headers };
        return this;
      },
      end(chunk?: string) {
        if (chunk) res.body += chunk;
      },
    },
    path: '',
    query: {},
  } as unknown as RouteContext;
  return { ctx, res };
}

describe('context routes', () => {
  let sessionsDir: string;

  beforeEach(async () => {
    sessionsDir = await mkdtemp(join(tmpdir(), 'umwl-ctxroute-'));
  });

  afterEach(async () => {
    await rm(sessionsDir, { recursive: true, force: true });
  });

  async function seedSession(
    contextId: string,
    extraMeta: Record<string, unknown> = {},
  ): Promise<string> {
    const dir = join(sessionsDir, contextId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({
        sessionId: contextId,
        created: '2026-06-10T11:00:00.000Z',
        lastUsed: '2026-06-10T12:00:00.000Z',
        type: 'a2a',
        ...extraMeta,
      }),
      'utf-8',
    );
    await writeFile(
      join(dir, 'transcript.jsonl'),
      userLine('hello') + assistantLine('hi there'),
      'utf-8',
    );
    return dir;
  }

  describe('GET /api/contexts/:contextId', () => {
    it('returns metadata and normalized messages', async () => {
      await seedSession('ctx-1');
      const { ctx, res } = fakeCtx(sessionsDir);

      await contextShowRoute.handle(ctx, { contextId: 'ctx-1' });

      expect(res.status).toBe(200);
      expect(res.headers['Content-Type']).toContain('application/json');
      const body = JSON.parse(res.body);
      expect(body.contextId).toBe('ctx-1');
      expect(body.sessionId).toBe('ctx-1');
      expect(body.type).toBe('a2a');
      expect(body.created).toBe('2026-06-10T11:00:00.000Z');
      expect(body.lastUsed).toBe('2026-06-10T12:00:00.000Z');
      expect(body.messageCount).toBe(2);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0]).toMatchObject({ role: 'user', content: 'hello' });
      expect(body.messages[1]).toMatchObject({
        role: 'assistant',
        content: 'hi there',
      });
      expect(body.nativeSessionRef).toBeUndefined();
    });

    it('includes nativeSessionRef when the session has one', async () => {
      const ref = {
        runtime: 'claude-sdk',
        nativeSessionId: 'sdk-42',
        nativeSessionPath: '/data/claude/projects/p/sdk-42.jsonl',
      };
      await seedSession('ctx-native', { nativeSessionRef: ref });
      const { ctx, res } = fakeCtx(sessionsDir);

      await contextShowRoute.handle(ctx, { contextId: 'ctx-native' });

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).nativeSessionRef).toEqual(ref);
    });

    it('404s on an unknown contextId', async () => {
      const { ctx, res } = fakeCtx(sessionsDir);
      await contextShowRoute.handle(ctx, { contextId: 'missing' });
      expect(res.status).toBe(404);
      expect(JSON.parse(res.body).error).toBeTruthy();
    });

    it('404s on a traversal contextId', async () => {
      await seedSession('ctx-1');
      const { ctx, res } = fakeCtx(sessionsDir);
      await contextShowRoute.handle(ctx, { contextId: '../ctx-1' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/contexts/:contextId/transcript', () => {
    it('returns the raw transcript JSONL', async () => {
      await seedSession('ctx-1');
      const { ctx, res } = fakeCtx(sessionsDir);

      await contextTranscriptRoute.handle(ctx, { contextId: 'ctx-1' });

      expect(res.status).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/x-ndjson');
      const lines = res.body.split('\n').filter((l) => l.trim());
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).message.content).toBe('hello');
      expect(JSON.parse(lines[1]).message.content).toBe('hi there');
    });

    it('concatenates frozen segments before the live transcript', async () => {
      const dir = await seedSession('ctx-seg');
      await writeFile(
        join(dir, 'transcript.2026-06-01T00-00-00.000Z.jsonl'),
        userLine('frozen-first'),
        'utf-8',
      );
      const { ctx, res } = fakeCtx(sessionsDir);

      await contextTranscriptRoute.handle(ctx, { contextId: 'ctx-seg' });

      const lines = res.body.split('\n').filter((l) => l.trim());
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).message.content).toBe('frozen-first');
      expect(JSON.parse(lines[2]).message.content).toBe('hi there');
    });

    it('404s on an unknown contextId', async () => {
      const { ctx, res } = fakeCtx(sessionsDir);
      await contextTranscriptRoute.handle(ctx, { contextId: 'missing' });
      expect(res.status).toBe(404);
    });
  });

  describe('registration and auth gating', () => {
    it('both routes are GET and bearer-gated (no skipAuth)', () => {
      for (const route of [contextShowRoute, contextTranscriptRoute]) {
        expect(route.method).toBe('GET');
        expect(route.skipAuth).toBeFalsy();
      }
    });

    it('defaultRoutes registers transcript before show so :contextId does not swallow it', () => {
      const paths = defaultRoutes().map((r) => r.path);
      const transcriptIdx = paths.indexOf('/api/contexts/:contextId/transcript');
      const showIdx = paths.indexOf('/api/contexts/:contextId');
      expect(transcriptIdx).toBeGreaterThanOrEqual(0);
      expect(showIdx).toBeGreaterThanOrEqual(0);
      expect(transcriptIdx).toBeLessThan(showIdx);
    });
  });
});
