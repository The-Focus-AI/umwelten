/**
 * Unit tests for the digest/knowledge/ask routes: session resolution,
 * digest read from the volume convention, the knowledge aggregation
 * payload, and input validation. The LLM-invoking paths (POST digest run,
 * ask) are validated up to the model-required guard — actually running
 * them needs a live model and belongs to integration tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  digestShowRoute,
  digestRunRoute,
  knowledgeRoute,
  askRoute,
} from './digest.js';
import { saveDigest } from '@umwelten/core/interaction/analysis/digest-persistence.js';
import type { SessionDigest } from '@umwelten/core/interaction/analysis/analysis-types.js';
import type { RouteContext } from '../types.js';

interface FakeRes {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function fakeCtx(opts: {
  workDir: string;
  sessions: Array<{ sessionId: string; dir: string }>;
  query?: Record<string, string>;
  body?: unknown;
  model?: { name: string; provider: string } | undefined;
}): { ctx: RouteContext; res: FakeRes } {
  const res: FakeRes = { status: 0, headers: {}, body: '' };
  const req = opts.body
    ? Readable.from([Buffer.from(JSON.stringify(opts.body))])
    : Readable.from([]);
  const ctx = {
    habitat: {
      getWorkDir: () => opts.workDir,
      getConfig: () => ({ name: 'Test Habitat', agents: [] }),
      getDefaultModelDetails: () => opts.model,
      listSessions: async () =>
        opts.sessions.map((s) => ({
          sessionId: s.sessionId,
          created: '2026-07-01T00:00:00Z',
          lastUsed: '2026-07-01T01:00:00Z',
          type: 'web',
        })),
      getSessionDir: async (id: string) =>
        opts.sessions.find((s) => s.sessionId === id)?.dir ?? null,
    },
    bridge: {},
    user: { userId: 'test-user' },
    req,
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
    query: opts.query ?? {},
  } as unknown as RouteContext;
  return { ctx, res };
}

function minimalDigest(sessionId: string): SessionDigest {
  return {
    sessionId,
    projectPath: '/data',
    projectName: 'Test Habitat',
    source: 'habitat',
    created: '2026-07-01T00:00:00Z',
    modified: '2026-07-01T01:00:00Z',
    digestedAt: '2026-07-02T00:00:00Z',
    segments: [],
    overallSummary: 'Built the thing.',
    allFacts: [],
    analysis: {
      topics: ['deploys', 'sessions'],
      tags: ['ci'],
      keyLearnings: 'Always check the card.',
      summary: 'Built the thing.',
      solutionType: 'feature',
      codeLanguages: ['ts'],
      toolsUsed: ['docker'],
      successIndicators: 'yes',
      relatedFiles: [],
    },
    extractedFacts: [{ type: 'decision', text: 'hybrid is the default' }],
    phases: [
      { name: 'Explore', beatRange: [0, 1], description: 'looked around' },
    ],
    metrics: {
      messageCount: 10,
      segmentCount: 1,
      toolCallCount: 3,
      estimatedCost: 0.01,
      duration: 60000,
    },
  };
}

describe('digest routes', () => {
  let workDir: string;
  let sessionDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'umwl-digestroute-'));
    sessionDir = join(workDir, 'sessions', 'sess-1');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'transcript.jsonl'), '');
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const sessions = () => [{ sessionId: 'sess-1', dir: sessionDir }];

  it('GET digest → digested:false when none persisted', async () => {
    const { ctx, res } = fakeCtx({ workDir, sessions: sessions() });
    await digestShowRoute.handle(ctx, { id: 'sess-1' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      sessionId: 'sess-1',
      digested: false,
    });
  });

  it('GET digest → summary payload from the volume convention', async () => {
    await saveDigest(workDir, minimalDigest('sess-1'));
    const { ctx, res } = fakeCtx({ workDir, sessions: sessions() });
    await digestShowRoute.handle(ctx, { id: 'sess-1' });
    const body = JSON.parse(res.body);
    expect(body.digested).toBe(true);
    expect(body.summary).toBe('Built the thing.');
    expect(body.topics).toEqual(['deploys', 'sessions']);
    expect(body.facts).toEqual([
      { type: 'decision', text: 'hybrid is the default' },
    ]);
    expect(body.phases[0].name).toBe('Explore');
    expect(body.full).toBeUndefined();
  });

  it('GET digest ?full=1 includes the raw digest', async () => {
    await saveDigest(workDir, minimalDigest('sess-1'));
    const { ctx, res } = fakeCtx({
      workDir,
      sessions: sessions(),
      query: { full: '1' },
    });
    await digestShowRoute.handle(ctx, { id: 'sess-1' });
    expect(JSON.parse(res.body).full.segments).toEqual([]);
  });

  it('resolves session id prefixes', async () => {
    await saveDigest(workDir, minimalDigest('sess-1'));
    const { ctx, res } = fakeCtx({ workDir, sessions: sessions() });
    await digestShowRoute.handle(ctx, { id: 'sess' });
    expect(JSON.parse(res.body).sessionId).toBe('sess-1');
  });

  it('404s on unknown session', async () => {
    const { ctx, res } = fakeCtx({ workDir, sessions: sessions() });
    await digestShowRoute.handle(ctx, { id: 'nope' });
    expect(res.status).toBe(404);
  });

  it('POST digest → 400 without a default model', async () => {
    const { ctx, res } = fakeCtx({
      workDir,
      sessions: sessions(),
      model: undefined,
    });
    await digestRunRoute.handle(ctx, { id: 'sess-1' });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/model/i);
  });

  it('POST ask → 400 on missing question', async () => {
    const { ctx, res } = fakeCtx({
      workDir,
      sessions: sessions(),
      model: { name: 'm', provider: 'google' },
      body: {},
    });
    await askRoute.handle(ctx, { id: 'sess-1' });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/question/i);
  });

  it('POST ask → 400 without a default model', async () => {
    const { ctx, res } = fakeCtx({
      workDir,
      sessions: sessions(),
      model: undefined,
      body: { question: 'what happened?' },
    });
    await askRoute.handle(ctx, { id: 'sess-1' });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/model/i);
  });

  it('GET knowledge → digest index from the volume, empty records ok', async () => {
    await saveDigest(workDir, minimalDigest('sess-1'));
    const { ctx, res } = fakeCtx({ workDir, sessions: sessions() });
    await knowledgeRoute.handle(ctx, {});
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.records)).toBe(true);
    expect(body.digests).toHaveLength(1);
    expect(body.digests[0].sessionId).toBe('sess-1');
    expect(body.digests[0].keyLearnings).toBe('Always check the card.');
  });

  it('GET knowledge → empty payload when nothing digested', async () => {
    const { ctx, res } = fakeCtx({ workDir, sessions: [] });
    await knowledgeRoute.handle(ctx, {});
    const body = JSON.parse(res.body);
    expect(body.digests).toEqual([]);
  });
});
