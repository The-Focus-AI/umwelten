/**
 * Digest store — persistence for session digests and accumulated knowledge.
 *
 * Layout:
 *   ~/.umwelten/digests/index.json           — master index
 *   ~/.umwelten/digests/sessions/{id}.json   — per-session digest
 *   ~/.umwelten/knowledge/{kind}.jsonl       — accumulated learnings
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import type {
  SessionDigest,
  DigestIndex,
  DigestIndexEntry,
  AnalysisModelDetails,
} from './analysis-types.js';

// ─── Paths ──────────────────────────────────────────────────────────────────

const UMWELTEN_DIR = join(homedir(), '.umwelten');
const DIGESTS_DIR = join(UMWELTEN_DIR, 'digests');
const SESSIONS_DIR = join(DIGESTS_DIR, 'sessions');
const INDEX_PATH = join(DIGESTS_DIR, 'index.json');
const KNOWLEDGE_DIR = join(UMWELTEN_DIR, 'knowledge');

export function getDigestsDir(): string {
  return DIGESTS_DIR;
}

export function getKnowledgeDir(): string {
  return KNOWLEDGE_DIR;
}

// ─── Directory setup ────────────────────────────────────────────────────────

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function ensureDigestDirs(): Promise<void> {
  await ensureDir(SESSIONS_DIR);
  await ensureDir(KNOWLEDGE_DIR);
}

// ─── Per-session digest I/O ─────────────────────────────────────────────────

function digestPath(sessionId: string): string {
  // Sanitize sessionId for filesystem (UUIDs are safe, but just in case)
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(SESSIONS_DIR, `${safe}.json`);
}

export async function saveDigest(digest: SessionDigest): Promise<void> {
  await ensureDigestDirs();
  await writeFile(digestPath(digest.sessionId), JSON.stringify(digest, null, 2));
}

export async function loadDigest(sessionId: string): Promise<SessionDigest | null> {
  try {
    const raw = await readFile(digestPath(sessionId), 'utf-8');
    return JSON.parse(raw) as SessionDigest;
  } catch {
    return null;
  }
}

export async function isDigested(sessionId: string): Promise<boolean> {
  try {
    await stat(digestPath(sessionId));
    return true;
  } catch {
    return false;
  }
}

// ─── Master index I/O ───────────────────────────────────────────────────────

export async function loadDigestIndex(): Promise<DigestIndex | null> {
  try {
    const raw = await readFile(INDEX_PATH, 'utf-8');
    return JSON.parse(raw) as DigestIndex;
  } catch {
    return null;
  }
}

export async function saveDigestIndex(index: DigestIndex): Promise<void> {
  await ensureDigestDirs();
  await writeFile(INDEX_PATH, JSON.stringify(index, null, 2));
}

/**
 * Build a DigestIndexEntry from a full SessionDigest (lightweight projection).
 */
export function digestToIndexEntry(digest: SessionDigest): DigestIndexEntry {
  return {
    sessionId: digest.sessionId,
    projectPath: digest.projectPath,
    projectName: digest.projectName,
    source: digest.source,
    created: digest.created,
    digestedAt: digest.digestedAt,
    overallSummary: digest.overallSummary,
    allFacts: digest.allFacts,
    topics: digest.analysis.topics,
    tags: digest.analysis.tags,
    keyLearnings: digest.analysis.keyLearnings,
    solutionType: digest.analysis.solutionType,
    successIndicators: digest.analysis.successIndicators,
    messageCount: digest.metrics.messageCount,
    estimatedCost: digest.metrics.estimatedCost,
  };
}

/**
 * Add or update a digest in the master index.
 */
export async function upsertDigestIndex(
  digest: SessionDigest,
  modelUsed: AnalysisModelDetails,
): Promise<void> {
  let index = await loadDigestIndex();
  const entry = digestToIndexEntry(digest);

  if (!index) {
    index = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      modelUsed,
      projects: [],
      totalSessions: 0,
      digestedSessions: 0,
      entries: [],
    };
  }

  // Upsert entry
  const existingIdx = index.entries.findIndex(e => e.sessionId === entry.sessionId);
  if (existingIdx >= 0) {
    index.entries[existingIdx] = entry;
  } else {
    index.entries.push(entry);
  }

  // Rebuild project summaries
  const projectMap = new Map<string, { path: string; name: string; count: number }>();
  for (const e of index.entries) {
    const existing = projectMap.get(e.projectPath);
    if (existing) {
      existing.count++;
    } else {
      projectMap.set(e.projectPath, { path: e.projectPath, name: e.projectName, count: 1 });
    }
  }
  index.projects = Array.from(projectMap.values()).map(p => ({
    path: p.path,
    name: p.name,
    sessionCount: p.count,
  }));

  index.digestedSessions = index.entries.length;
  index.totalSessions = index.entries.length;
  index.lastUpdated = new Date().toISOString();
  index.modelUsed = modelUsed;

  await saveDigestIndex(index);
}

// ─── Knowledge (accumulated learnings) ──────────────────────────────────────

export type KnowledgeKind = 'facts' | 'playbooks' | 'preferences' | 'open_loops' | 'mistakes';
const KNOWLEDGE_KINDS: KnowledgeKind[] = ['facts', 'playbooks', 'preferences', 'open_loops', 'mistakes'];

export interface KnowledgeRecord {
  id: string;
  kind: KnowledgeKind;
  createdAt: string;
  text: string;
  sessionId: string;
  projectName: string;
}

function knowledgePath(kind: KnowledgeKind): string {
  return join(KNOWLEDGE_DIR, `${kind}.jsonl`);
}

export async function appendKnowledge(records: KnowledgeRecord[]): Promise<void> {
  await ensureDir(KNOWLEDGE_DIR);
  // Group by kind
  const byKind = new Map<KnowledgeKind, KnowledgeRecord[]>();
  for (const r of records) {
    const list = byKind.get(r.kind) || [];
    list.push(r);
    byKind.set(r.kind, list);
  }

  for (const [kind, recs] of byKind) {
    const lines = recs.map(r => JSON.stringify(r)).join('\n') + '\n';
    await writeFile(knowledgePath(kind), lines, { flag: 'a' });
  }
}

export async function readKnowledge(kind?: KnowledgeKind): Promise<KnowledgeRecord[]> {
  const kinds = kind ? [kind] : KNOWLEDGE_KINDS;
  const results: KnowledgeRecord[] = [];

  for (const k of kinds) {
    try {
      const raw = await readFile(knowledgePath(k), 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          results.push(JSON.parse(line) as KnowledgeRecord);
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // file doesn't exist yet
    }
  }

  return results;
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export interface DigestStats {
  totalDigests: number;
  projectCount: number;
  projects: { name: string; count: number }[];
  knowledgeCounts: Record<KnowledgeKind, number>;
  dateRange: { oldest: string; newest: string } | null;
}

export async function getDigestStats(): Promise<DigestStats> {
  const index = await loadDigestIndex();

  const knowledgeCounts: Record<KnowledgeKind, number> = {
    facts: 0,
    playbooks: 0,
    preferences: 0,
    open_loops: 0,
    mistakes: 0,
  };

  for (const kind of KNOWLEDGE_KINDS) {
    try {
      const raw = await readFile(knowledgePath(kind), 'utf-8');
      knowledgeCounts[kind] = raw.split('\n').filter(l => l.trim()).length;
    } catch {
      // file doesn't exist
    }
  }

  if (!index || index.entries.length === 0) {
    return {
      totalDigests: 0,
      projectCount: 0,
      projects: [],
      knowledgeCounts,
      dateRange: null,
    };
  }

  const sorted = [...index.entries].sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
  );

  return {
    totalDigests: index.entries.length,
    projectCount: index.projects.length,
    projects: index.projects
      .map(p => ({ name: p.name, count: p.sessionCount }))
      .sort((a, b) => b.count - a.count),
    knowledgeCounts,
    dateRange: {
      oldest: sorted[0].created,
      newest: sorted[sorted.length - 1].created,
    },
  };
}
