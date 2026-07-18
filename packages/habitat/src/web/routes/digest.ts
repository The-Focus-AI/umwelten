/**
 * Digest / knowledge / ask routes — the HTTP surface for the session
 * introspection layer (session-digester + digest-persistence +
 * digest-search), so the container web UI (and anything else) can browse
 * what a habitat has learned and ask questions about its sessions.
 *
 * Digests persist on the habitat volume at
 * <workDir>/.umwelten/digests/sessions/<id>.json (digest-persistence's
 * canonical convention with projectPath = workDir), so they survive
 * container rebuilds. Running a digest or asking a question spends LLM
 * tokens on the habitat's default model — both are explicit POSTs, never
 * triggered implicitly.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RouteHandler } from '../types.js';
import type { AgentHost } from '../../types.js';
import {
  digestSession,
  askAboutSession,
} from '@umwelten/core/interaction/analysis/session-digester.js';
import {
  loadDigest,
  saveDigest,
} from '@umwelten/core/interaction/analysis/digest-persistence.js';
import {
  readAllKnowledge,
  searchKnowledge,
} from '@umwelten/core/interaction/analysis/digest-search.js';
import type { SessionDigest } from '@umwelten/core/interaction/analysis/analysis-types.js';

function json(res: any, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req: any): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function resolveSession(
  habitat: AgentHost,
  idOrPrefix: string,
): Promise<{ sessionId: string; sessionDir: string } | null> {
  const sessions = await habitat.listSessions();
  const match = sessions.find(
    (s) => s.sessionId === idOrPrefix || s.sessionId.startsWith(idOrPrefix),
  );
  if (!match) return null;
  const sessionDir = await habitat.getSessionDir(match.sessionId);
  if (!sessionDir) return null;
  return { sessionId: match.sessionId, sessionDir };
}

/** Trimmed digest for list/detail payloads (segments/beats are large). */
function digestSummary(digest: SessionDigest) {
  return {
    sessionId: digest.sessionId,
    digestedAt: digest.digestedAt,
    summary: digest.overallSummary,
    topics: digest.analysis?.topics ?? [],
    tags: digest.analysis?.tags ?? [],
    keyLearnings: digest.analysis?.keyLearnings ?? '',
    solutionType: digest.analysis?.solutionType,
    facts: (digest.extractedFacts ?? []).map((f) => ({
      type: f.type,
      text: f.text,
    })),
    phases: (digest.phases ?? []).map((p) => ({
      name: p.name,
      description: p.description,
    })),
    metrics: digest.metrics,
  };
}

// ── GET /api/sessions/:id/digest ─────────────────────────────────────

export const digestShowRoute: RouteHandler = {
  method: 'GET',
  path: '/api/sessions/:id/digest',
  async handle(ctx, params) {
    const resolved = await resolveSession(ctx.habitat, params.id);
    if (!resolved) return json(ctx.res, { error: 'Session not found' }, 404);
    const digest = await loadDigest(
      ctx.habitat.getWorkDir(),
      resolved.sessionId,
    );
    if (!digest) {
      return json(ctx.res, {
        sessionId: resolved.sessionId,
        digested: false,
      });
    }
    json(ctx.res, {
      digested: true,
      ...digestSummary(digest),
      full: ctx.query.full === '1' ? digest : undefined,
    });
  },
};

// ── POST /api/sessions/:id/digest — run the digester ─────────────────

export const digestRunRoute: RouteHandler = {
  method: 'POST',
  path: '/api/sessions/:id/digest',
  async handle(ctx, params) {
    const resolved = await resolveSession(ctx.habitat, params.id);
    if (!resolved) return json(ctx.res, { error: 'Session not found' }, 404);

    const model = ctx.habitat.getDefaultModelDetails();
    if (!model) {
      return json(
        ctx.res,
        { error: 'No default model configured for this habitat' },
        400,
      );
    }

    const sessions = await ctx.habitat.listSessions();
    const meta = sessions.find((s) => s.sessionId === resolved.sessionId);
    const workDir = ctx.habitat.getWorkDir();
    const transcriptPath = join(resolved.sessionDir, 'transcript.jsonl');

    // SessionIndexEntry-ish shape — same adaptation the digest-live TUI
    // uses to feed a habitat transcript into the claude-code-shaped
    // digester (the transcript IS claude-style JSONL).
    const entry = {
      sessionId: resolved.sessionId,
      fullPath: transcriptPath,
      fileMtime: Date.now(),
      // firstPrompt/messageCount aren't in HabitatSessionMetadata — the
      // digester derives both from the transcript itself.
      firstPrompt: '',
      messageCount: 0,
      created: meta?.created ?? new Date().toISOString(),
      modified: meta?.lastUsed ?? new Date().toISOString(),
      gitBranch: '',
      projectPath: workDir,
      isSidechain: false,
    };
    const projectName = ctx.habitat.getConfig().name ?? 'habitat';

    try {
      const digest = await digestSession(entry, workDir, projectName, model);
      if (!digest) {
        return json(
          ctx.res,
          { error: 'Session too small or empty to digest' },
          422,
        );
      }
      await saveDigest(workDir, digest);
      // The digester degrades gracefully when every LLM call fails (missing
      // provider key, quota): metrics survive but analysis comes back empty.
      // Surface that instead of letting a stub digest read as success.
      const stub = !digest.overallSummary && !digest.segments?.length;
      json(ctx.res, {
        digested: true,
        ...(stub
          ? {
              warning:
                'LLM analysis unavailable (provider key/quota?) — metrics-only digest saved. Fix the provider and re-run.',
            }
          : {}),
        ...digestSummary(digest),
      });
    } catch (err) {
      json(
        ctx.res,
        { error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  },
};

// ── GET /api/knowledge ───────────────────────────────────────────────

/**
 * Aggregated knowledge across everything this habitat has digested:
 * - `records`: classified learnings from the learnings store
 *   (facts / skill_candidates / preferences / open_loops / mistakes),
 *   optionally filtered by ?kind= and searched by ?q=.
 * - `digests`: one summary row per persisted digest (the browsable index).
 */
export const knowledgeRoute: RouteHandler = {
  method: 'GET',
  path: '/api/knowledge',
  async handle(ctx) {
    const kind = ctx.query.kind as
      | 'facts'
      | 'skill_candidates'
      | 'preferences'
      | 'open_loops'
      | 'mistakes'
      | undefined;
    const limit = Math.min(parseInt(ctx.query.limit || '100', 10) || 100, 500);

    let records: Array<{ kind: string; text: string; project?: string }> = [];
    try {
      if (ctx.query.q) {
        const results = await searchKnowledge(ctx.query.q, { limit, kind });
        records = results.map(({ record, projectName }) => ({
          kind: record.kind,
          text:
            (record.payload as { text?: string })?.text ??
            JSON.stringify(record.payload),
          project: projectName,
        }));
      } else {
        const all = await readAllKnowledge(kind);
        records = all.slice(0, limit).map((record) => ({
          kind: record.kind,
          text:
            (record.payload as { text?: string })?.text ??
            JSON.stringify(record.payload),
          project: record.provenance?.claudeProjectPath,
        }));
      }
    } catch {
      /* no learnings store yet — records stays empty */
    }

    // Digest index: scan the volume's digest dir directly.
    const digests: ReturnType<typeof digestSummary>[] = [];
    const digestsDir = join(
      ctx.habitat.getWorkDir(),
      '.umwelten',
      'digests',
      'sessions',
    );
    try {
      const files = await readdir(digestsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const digest = JSON.parse(
            await readFile(join(digestsDir, file), 'utf-8'),
          ) as SessionDigest;
          digests.push(digestSummary(digest));
        } catch {
          /* skip malformed digest */
        }
      }
    } catch {
      /* no digests yet */
    }
    digests.sort((a, b) => (b.digestedAt ?? '').localeCompare(a.digestedAt ?? ''));

    json(ctx.res, { records, digests });
  },
};

// ── POST /api/sessions/:id/ask ───────────────────────────────────────

export const askRoute: RouteHandler = {
  method: 'POST',
  path: '/api/sessions/:id/ask',
  async handle(ctx, params) {
    const resolved = await resolveSession(ctx.habitat, params.id);
    if (!resolved) return json(ctx.res, { error: 'Session not found' }, 404);

    const body = await readBody(ctx.req);
    const question =
      typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) {
      return json(ctx.res, { error: 'Missing "question" in body' }, 400);
    }

    const model = ctx.habitat.getDefaultModelDetails();
    if (!model) {
      return json(
        ctx.res,
        { error: 'No default model configured for this habitat' },
        400,
      );
    }

    try {
      const answer = await askAboutSession({
        sessionFile: join(resolved.sessionDir, 'transcript.jsonl'),
        projectPath: ctx.habitat.getWorkDir(),
        sessionId: resolved.sessionId,
        question,
        model,
      });
      json(ctx.res, { sessionId: resolved.sessionId, question, answer });
    } catch (err) {
      json(
        ctx.res,
        { error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  },
};
