/**
 * Session browser data: merge session list (adapters) with analysis index, support search.
 * Can run index from browser to update analysis as you browse.
 */

import type { NormalizedSessionEntry, NormalizedMessage } from '../../../sessions/normalized-types.js';
import type { SessionAnalysisEntry } from '../../../sessions/analysis-types.js';
import type { SessionIndexEntry } from '../../../sessions/types.js';
import { getAdapterRegistry } from '../../../sessions/adapters/index.js';
import { hasAnalysisIndex, readAnalysisIndex } from '../../../sessions/session-store.js';
import { searchSessions } from '../../../sessions/session-search.js';
import { indexProject } from '../../../sessions/session-indexer.js';

export interface BrowserSession {
  /** Normalized session (always present) */
  session: NormalizedSessionEntry;
  /** Analysis when index exists and matches */
  analysis?: SessionAnalysisEntry;
}

export interface BrowserDataResult {
  sessions: BrowserSession[];
  hasIndex: boolean;
}

/**
 * Load session list from adapters and merge with analysis index when present.
 */
export async function loadBrowserData(projectPath: string): Promise<BrowserDataResult> {
  const registry = getAdapterRegistry();
  const adapters = await registry.detectAdapters(projectPath);
  const sessionEntries: NormalizedSessionEntry[] = [];

  for (const adapter of adapters) {
    try {
      const result = await adapter.discoverSessions({
        projectPath,
        sortBy: 'modified',
        sortOrder: 'desc',
      });
      sessionEntries.push(...result.sessions);
    } catch {
      // skip
    }
  }

  const hasIndex = await hasAnalysisIndex(projectPath);
  let analysisByKey: Map<string, SessionAnalysisEntry> = new Map();

  if (hasIndex) {
    const index = await readAnalysisIndex(projectPath);
    for (const entry of index.entries) {
      analysisByKey.set(entry.sessionId, entry);
    }
  }

  const sessions: BrowserSession[] = sessionEntries.map(session => {
    const analysis =
      analysisByKey.get(session.id) ?? analysisByKey.get(session.sourceId);
    return { session, analysis };
  });

  return { sessions, hasIndex };
}

/**
 * Load messages for a session (for chat detail view). Uses the adapter for the session's source.
 */
export async function loadSessionMessages(
  projectPath: string,
  sessionEntry: NormalizedSessionEntry
): Promise<NormalizedMessage[]> {
  const registry = getAdapterRegistry();
  const adapter = registry.get(sessionEntry.source);
  if (!adapter) return [];
  try {
    const messages = await adapter.getMessages(sessionEntry.id);
    if (messages.length > 0) return messages;
    if (sessionEntry.sourceId !== sessionEntry.id) {
      return adapter.getMessages(sessionEntry.sourceId);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Search/filter browser sessions. When analysis index exists uses searchSessions; else filters by firstPrompt.
 */
export async function searchBrowserSessions(
  projectPath: string,
  query: string | undefined,
  options: { limit?: number } = {}
): Promise<BrowserSession[]> {
  const { sessions, hasIndex } = await loadBrowserData(projectPath);
  const limit = options.limit ?? 50;

  if (!hasIndex || !query?.trim()) {
    if (!query?.trim()) {
      return sessions.slice(0, limit);
    }
    const q = query.toLowerCase().trim();
    return sessions
      .filter(bs => bs.session.firstPrompt?.toLowerCase().includes(q))
      .slice(0, limit);
  }

  const scored = await searchSessions(query, {
    projectPath,
    limit,
  });

  const sessionById = new Map(sessions.map(bs => [bs.session.id, bs]));
  const sessionBySourceId = new Map(sessions.map(bs => [bs.session.sourceId, bs]));

  const result: BrowserSession[] = [];
  for (const { entry } of scored) {
    const bs =
      sessionById.get(entry.sessionId) ??
      sessionBySourceId.get(entry.sessionId) ??
      sessions.find(s => s.analysis?.sessionId === entry.sessionId);
    if (bs) {
      result.push(bs.analysis ? bs : { ...bs, analysis: entry });
    }
  }
  return result;
}

/**
 * Build SessionIndexEntry[] from adapter-discovered sessions (same as CLI index command).
 */
function buildSessionsOverride(projectPath: string, allNormalized: NormalizedSessionEntry[]): SessionIndexEntry[] {
  return allNormalized.map(s => {
    const hasFullPath =
      s.source === 'claude-code' &&
      s.sourceData != null &&
      typeof (s.sourceData as Record<string, unknown>).fullPath === 'string' &&
      typeof (s.sourceData as Record<string, unknown>).fileMtime === 'number';

    const fileMtime = hasFullPath
      ? (s.sourceData as Record<string, unknown>).fileMtime as number
      : new Date(s.modified).getTime();
    const sessionId = hasFullPath ? s.sourceId : s.id;

    return {
      sessionId,
      ...(hasFullPath && {
        fullPath: (s.sourceData as Record<string, unknown>).fullPath as string,
      }),
      fileMtime,
      firstPrompt: s.firstPrompt ?? '',
      messageCount: s.messageCount ?? 0,
      created: s.created ?? '',
      modified: s.modified ?? '',
      gitBranch: s.gitBranch ?? 'main',
      projectPath: s.projectPath ?? projectPath,
      isSidechain: s.isSidechain ?? false,
      ...(!hasFullPath && { source: s.source }),
    };
  });
}

export interface RunBrowserIndexResult {
  indexed: number;
  skipped: number;
  failed: number;
}

/**
 * Run index from browser (same as "sessions index"). Updates analysis index; call loadBrowserData after to refresh.
 */
export async function runBrowserIndex(
  projectPath: string,
  options: { model?: string; force?: boolean } = {}
): Promise<RunBrowserIndexResult> {
  const registry = getAdapterRegistry();
  const adapters = await registry.detectAdapters(projectPath);
  const allNormalized: NormalizedSessionEntry[] = [];

  for (const adapter of adapters) {
    try {
      const result = await adapter.discoverSessions({
        projectPath,
        sortBy: 'modified',
        sortOrder: 'desc',
      });
      allNormalized.push(...result.sessions);
    } catch {
      // skip
    }
  }

  const sessionsOverride = buildSessionsOverride(projectPath, allNormalized);
  const result = await indexProject({
    projectPath,
    model: options.model ?? 'google:gemini-3-flash-preview',
    force: options.force ?? false,
    batchSize: 3,
    verbose: false,
    sessionsOverride,
  });

  return { indexed: result.indexed, skipped: result.skipped, failed: result.failed };
}
