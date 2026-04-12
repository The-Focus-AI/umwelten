/**
 * Cross-project search and aggregation over session analysis indexes.
 *
 * Reads from per-project SessionAnalysisIndex files (System B) and
 * FileLearningsStore for accumulated knowledge. No dependency on digest-store.
 */

import type {
  SessionAnalysisEntry,
  ScoredDigestResult,
} from './analysis-types.js';
import {
  readAnalysisIndex,
  hasAnalysisIndex,
} from '../persistence/session-store.js';
import { FileLearningsStore } from '../../session-record/learnings-store.js';
import type { LearningRecord } from '../../session-record/types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';

// ─── Project discovery ──────────────────────────────────────────────────────

async function discoverAllProjectPaths(): Promise<string[]> {
  const claudeDir = join(homedir(), '.claude', 'projects');
  const projects: string[] = [];
  try {
    const entries = await readdir(claudeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const files = await readdir(join(claudeDir, entry.name));
        if (files.some(f => f.endsWith('.jsonl'))) {
          projects.push(entry.name.replace(/^-/, '/').replace(/-/g, '/'));
        }
      } catch { /* skip */ }
    }
  } catch { /* no ~/.claude/projects */ }
  return projects;
}

function projectDisplayName(projectPath: string): string {
  const parts = projectPath.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

// ─── Cross-project index loading ────────────────────────────────────────────

interface CrossProjectEntry extends SessionAnalysisEntry {
  projectPath: string;
  projectName: string;
}

/**
 * Load all analysis entries across all projects.
 */
async function loadAllEntries(): Promise<CrossProjectEntry[]> {
  const projectPaths = await discoverAllProjectPaths();
  const all: CrossProjectEntry[] = [];

  for (const projectPath of projectPaths) {
    if (!(await hasAnalysisIndex(projectPath))) continue;
    try {
      const index = await readAnalysisIndex(projectPath);
      const projectName = projectDisplayName(projectPath);
      for (const entry of index.entries) {
        all.push({ ...entry, projectPath, projectName });
      }
    } catch { /* skip broken indexes */ }
  }

  return all;
}

// ─── Search ─────────────────────────────────────────────────────────────────

export interface DigestSearchOptions {
  limit?: number;
  project?: string;
  tags?: string[];
  topic?: string;
  solutionType?: string;
  success?: string;
}

function rankEntries(
  query: string,
  entries: CrossProjectEntry[],
): ScoredDigestResult[] {
  const lowerQuery = query.toLowerCase();
  const now = Date.now();

  return entries.map(entry => {
    let score = 0;
    const matchedFields: string[] = [];

    // Summary match: +5
    if (entry.analysis.summary.toLowerCase().includes(lowerQuery)) {
      score += 5;
      matchedFields.push('summary');
    }

    // Key learnings match: +4
    if (entry.analysis.keyLearnings.toLowerCase().includes(lowerQuery)) {
      score += 4;
      matchedFields.push('learnings');
    }

    // Exact tag match: +10
    if (entry.analysis.tags.some(t => t.toLowerCase() === lowerQuery)) {
      score += 10;
      matchedFields.push('tag(exact)');
    }

    // Partial tag match: +7
    if (entry.analysis.tags.some(t => t.toLowerCase().includes(lowerQuery))) {
      score += 7;
      matchedFields.push('tag');
    }

    // Topic match: +5
    if (entry.analysis.topics.some(t => t.toLowerCase().includes(lowerQuery))) {
      score += 5;
      matchedFields.push('topic');
    }

    // Project name match: +3
    if (entry.projectName.toLowerCase().includes(lowerQuery)) {
      score += 3;
      matchedFields.push('project');
    }

    // First prompt match: +1
    if (entry.metadata.firstPrompt.toLowerCase().includes(lowerQuery)) {
      score += 1;
      matchedFields.push('prompt');
    }

    // Recency bonus: +5 decaying over 60 days
    const daysOld = (now - new Date(entry.metadata.created).getTime()) / (1000 * 60 * 60 * 24);
    const recencyBonus = Math.max(0, 5 - (daysOld / 60) * 5);
    score += recencyBonus;
    if (recencyBonus > 1) matchedFields.push('recent');

    // Success bonus: +2
    if (entry.analysis.successIndicators === 'yes') {
      score += 2;
      matchedFields.push('success');
    }

    return {
      entry: {
        sessionId: entry.sessionId,
        projectPath: entry.projectPath,
        projectName: entry.projectName,
        source: 'claude-code',
        created: entry.metadata.created,
        digestedAt: entry.analyzedAt,
        overallSummary: entry.analysis.summary,
        allFacts: [], // facts are in FileLearningsStore
        topics: entry.analysis.topics,
        tags: entry.analysis.tags,
        keyLearnings: entry.analysis.keyLearnings,
        solutionType: entry.analysis.solutionType,
        successIndicators: entry.analysis.successIndicators,
        messageCount: entry.metadata.messageCount,
        estimatedCost: entry.metadata.estimatedCost,
      },
      score,
      matchedFields,
    };
  })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Search across all analyzed sessions.
 */
export async function searchDigests(
  query: string,
  options: DigestSearchOptions = {},
): Promise<ScoredDigestResult[]> {
  let entries = await loadAllEntries();

  if (options.project) {
    const lower = options.project.toLowerCase();
    entries = entries.filter(e => e.projectName.toLowerCase().includes(lower));
  }
  if (options.tags?.length) {
    entries = entries.filter(e =>
      options.tags!.some(tag => e.analysis.tags.some(t => t.toLowerCase() === tag.toLowerCase()))
    );
  }
  if (options.topic) {
    const lower = options.topic.toLowerCase();
    entries = entries.filter(e => e.analysis.topics.some(t => t.toLowerCase().includes(lower)));
  }
  if (options.solutionType) {
    entries = entries.filter(e => e.analysis.solutionType === options.solutionType);
  }
  if (options.success) {
    entries = entries.filter(e => e.analysis.successIndicators === options.success);
  }

  const results = query ? rankEntries(query, entries) : entries.map(e => ({
    entry: {
      sessionId: e.sessionId,
      projectPath: e.projectPath,
      projectName: e.projectName,
      source: 'claude-code',
      created: e.metadata.created,
      digestedAt: e.analyzedAt,
      overallSummary: e.analysis.summary,
      allFacts: [],
      topics: e.analysis.topics,
      tags: e.analysis.tags,
      keyLearnings: e.analysis.keyLearnings,
      solutionType: e.analysis.solutionType,
      successIndicators: e.analysis.successIndicators,
      messageCount: e.metadata.messageCount,
      estimatedCost: e.metadata.estimatedCost,
    },
    score: 0,
    matchedFields: [] as string[],
  }));

  return results.slice(0, options.limit || 10);
}

// ─── Knowledge search (via FileLearningsStore) ──────────────────────────────

export interface KnowledgeSearchResult {
  record: LearningRecord;
  projectName: string;
  score: number;
}

/**
 * Search accumulated knowledge across all projects.
 */
export async function searchKnowledge(
  query: string,
  options: { limit?: number; kind?: string } = {},
): Promise<KnowledgeSearchResult[]> {
  const lowerQuery = query.toLowerCase();
  const results: KnowledgeSearchResult[] = [];

  // Scan all learnings directories under ~/.umwelten/learnings/claude/
  const learningsBase = join(homedir(), '.umwelten', 'learnings', 'claude');
  let dirs: string[];
  try {
    dirs = await readdir(learningsBase);
  } catch {
    return [];
  }

  for (const dir of dirs) {
    try {
      const store = new FileLearningsStore(join(learningsBase, dir));
      const kind = options.kind as any;
      const records = kind ? await store.read(kind) : (await store.readAll()).facts;

      for (const record of records) {
        const text = JSON.stringify(record.payload).toLowerCase();
        if (text.includes(lowerQuery)) {
          results.push({
            record,
            projectName: record.provenance?.claudeProjectPath
              ? projectDisplayName(record.provenance.claudeProjectPath)
              : dir,
            score: 5,
          });
        }
      }
    } catch { /* skip */ }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit || 20);
}

// ─── Aggregation ────────────────────────────────────────────────────────────

export async function getDigestTopics(
  limit: number = 20,
): Promise<{ topic: string; count: number; projects: string[] }[]> {
  const entries = await loadAllEntries();
  const topicMap = new Map<string, { count: number; projects: Set<string> }>();

  for (const entry of entries) {
    for (const topic of entry.analysis.topics) {
      const existing = topicMap.get(topic);
      if (existing) {
        existing.count++;
        existing.projects.add(entry.projectName);
      } else {
        topicMap.set(topic, { count: 1, projects: new Set([entry.projectName]) });
      }
    }
  }

  return Array.from(topicMap.entries())
    .map(([topic, { count, projects }]) => ({ topic, count, projects: Array.from(projects) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function getDigestPatterns(): Promise<{
  totalSessions: number;
  projectCount: number;
  solutionTypes: { type: string; count: number }[];
  successRates: { indicator: string; count: number; percentage: number }[];
  topProjects: { name: string; count: number }[];
}> {
  const entries = await loadAllEntries();
  const total = entries.length;
  if (total === 0) {
    return { totalSessions: 0, projectCount: 0, solutionTypes: [], successRates: [], topProjects: [] };
  }

  const solutionCounts = new Map<string, number>();
  const successCounts = new Map<string, number>();
  const projectCounts = new Map<string, number>();

  for (const entry of entries) {
    solutionCounts.set(entry.analysis.solutionType, (solutionCounts.get(entry.analysis.solutionType) || 0) + 1);
    successCounts.set(entry.analysis.successIndicators, (successCounts.get(entry.analysis.successIndicators) || 0) + 1);
    projectCounts.set(entry.projectName, (projectCounts.get(entry.projectName) || 0) + 1);
  }

  return {
    totalSessions: total,
    projectCount: new Set(entries.map(e => e.projectPath)).size,
    solutionTypes: Array.from(solutionCounts.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    successRates: Array.from(successCounts.entries()).map(([indicator, count]) => ({ indicator, count, percentage: (count / total) * 100 })).sort((a, b) => b.count - a.count),
    topProjects: Array.from(projectCounts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 20),
  };
}

// ─── Overview ───────────────────────────────────────────────────────────────

export interface DigestOverview {
  totalSessions: number;
  projectCount: number;
  totalFacts: number;
  dateRange: { oldest: string; newest: string } | null;
  recentSessions: {
    sessionId: string; projectName: string; created: string;
    summary: string; solutionType: string; success: string; factCount: number;
  }[];
  topTopics: { topic: string; count: number; projects: string[] }[];
  successRates: { indicator: string; count: number; percentage: number }[];
  solutionTypes: { type: string; count: number }[];
  topProjects: { name: string; count: number }[];
  activityByWeek: { week: string; count: number; projects: Set<string> }[];
}

export async function buildOverview(): Promise<DigestOverview> {
  const entries = await loadAllEntries();
  const total = entries.length;

  const empty: DigestOverview = {
    totalSessions: 0, projectCount: 0, totalFacts: 0, dateRange: null,
    recentSessions: [], topTopics: [], successRates: [], solutionTypes: [],
    topProjects: [], activityByWeek: [],
  };

  if (total === 0) return empty;

  const sorted = [...entries].sort((a, b) => new Date(a.metadata.created).getTime() - new Date(b.metadata.created).getTime());
  const dateRange = { oldest: sorted[0].metadata.created, newest: sorted[sorted.length - 1].metadata.created };

  const recent = [...entries]
    .sort((a, b) => new Date(b.metadata.created).getTime() - new Date(a.metadata.created).getTime())
    .slice(0, 10);

  const recentSessions = recent.map(e => ({
    sessionId: e.sessionId,
    projectName: e.projectName,
    created: e.metadata.created,
    summary: e.analysis.summary.slice(0, 150),
    solutionType: e.analysis.solutionType,
    success: e.analysis.successIndicators,
    factCount: 0,
  }));

  const topTopics = (await getDigestTopics(15));

  const successCounts = new Map<string, number>();
  const solutionCounts = new Map<string, number>();
  const projectCounts = new Map<string, number>();
  for (const e of entries) {
    successCounts.set(e.analysis.successIndicators, (successCounts.get(e.analysis.successIndicators) || 0) + 1);
    solutionCounts.set(e.analysis.solutionType, (solutionCounts.get(e.analysis.solutionType) || 0) + 1);
    projectCounts.set(e.projectName, (projectCounts.get(e.projectName) || 0) + 1);
  }

  const weekMap = new Map<string, { count: number; projects: Set<string> }>();
  for (const e of entries) {
    const d = new Date(e.metadata.created);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(d);
    weekStart.setDate(diff);
    const weekKey = weekStart.toISOString().slice(0, 10);
    const existing = weekMap.get(weekKey);
    if (existing) { existing.count++; existing.projects.add(e.projectName); }
    else { weekMap.set(weekKey, { count: 1, projects: new Set([e.projectName]) }); }
  }

  return {
    totalSessions: total,
    projectCount: new Set(entries.map(e => e.projectPath)).size,
    totalFacts: 0, // TODO: count from FileLearningsStore
    dateRange,
    recentSessions,
    topTopics,
    successRates: Array.from(successCounts.entries()).map(([indicator, count]) => ({ indicator, count, percentage: (count / total) * 100 })).sort((a, b) => b.count - a.count),
    solutionTypes: Array.from(solutionCounts.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    topProjects: Array.from(projectCounts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 15),
    activityByWeek: Array.from(weekMap.entries()).map(([week, { count, projects }]) => ({ week, count, projects })).sort((a, b) => b.week.localeCompare(a.week)).slice(0, 12),
  };
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export async function getDigestStats(): Promise<{
  totalSessions: number;
  projectCount: number;
  projects: { name: string; count: number }[];
  dateRange: { oldest: string; newest: string } | null;
}> {
  const entries = await loadAllEntries();
  if (entries.length === 0) {
    return { totalSessions: 0, projectCount: 0, projects: [], dateRange: null };
  }

  const projectCounts = new Map<string, number>();
  for (const e of entries) {
    projectCounts.set(e.projectName, (projectCounts.get(e.projectName) || 0) + 1);
  }

  const sorted = [...entries].sort((a, b) => new Date(a.metadata.created).getTime() - new Date(b.metadata.created).getTime());

  return {
    totalSessions: entries.length,
    projectCount: new Set(entries.map(e => e.projectPath)).size,
    projects: Array.from(projectCounts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    dateRange: { oldest: sorted[0].metadata.created, newest: sorted[sorted.length - 1].metadata.created },
  };
}

/**
 * Read all learnings from FileLearningsStore across all sessions.
 */
export async function readAllKnowledge(
  kind?: string,
): Promise<LearningRecord[]> {
  const learningsBase = join(homedir(), '.umwelten', 'learnings', 'claude');
  const results: LearningRecord[] = [];
  let dirs: string[];
  try {
    dirs = await readdir(learningsBase);
  } catch {
    return [];
  }

  for (const dir of dirs) {
    try {
      const store = new FileLearningsStore(join(learningsBase, dir));
      if (kind) {
        const records = await store.read(kind as any);
        results.push(...records);
      } else {
        const all = await store.readAll();
        for (const records of Object.values(all)) {
          results.push(...records);
        }
      }
    } catch { /* skip */ }
  }

  return results;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function formatDigestResults(results: ScoredDigestResult[]): string {
  if (results.length === 0) return 'No results found.';

  const lines: string[] = [`Found ${results.length} matching sessions:\n`];
  for (let i = 0; i < results.length; i++) {
    const { entry, score, matchedFields } = results[i];
    const date = new Date(entry.created);
    const daysAgo = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    const timeStr = daysAgo === 0 ? 'today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`;

    lines.push(`${i + 1}. [${entry.projectName}] ${timeStr} (${entry.successIndicators})`);
    lines.push(`   Summary: ${entry.overallSummary.slice(0, 200)}`);
    lines.push(`   Topics: ${entry.topics.join(', ')}`);
    lines.push(`   Tags: ${entry.tags.join(', ')}`);
    if (matchedFields.length > 0) {
      lines.push(`   Matched: ${matchedFields.join(', ')} (score: ${score.toFixed(1)})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function formatDigestResultsJSON(results: ScoredDigestResult[]): string {
  return JSON.stringify(results.map(({ entry, score, matchedFields }) => ({
    ...entry, score, matchedFields,
  })), null, 2);
}

export function formatOverview(o: DigestOverview): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('  INTROSPECTION BRAIN');
  lines.push('  ═══════════════════════════════════════════════════════');
  lines.push('');

  if (o.totalSessions === 0) {
    lines.push('  No sessions analyzed yet. Run: sessions index -p <project>');
    return lines.join('\n');
  }

  const oldest = o.dateRange ? new Date(o.dateRange.oldest).toLocaleDateString() : '?';
  const newest = o.dateRange ? new Date(o.dateRange.newest).toLocaleDateString() : '?';
  lines.push(`  ${o.totalSessions} sessions  |  ${o.projectCount} projects  |  ${oldest} — ${newest}`);
  lines.push('');

  if (o.activityByWeek.length > 0) {
    lines.push('  WEEKLY ACTIVITY');
    lines.push('  ───────────────────────────────────────────────────────');
    const maxCount = Math.max(...o.activityByWeek.map(w => w.count));
    for (const w of o.activityByWeek.slice(0, 8)) {
      const barLen = Math.max(1, Math.round((w.count / maxCount) * 30));
      const bar = '█'.repeat(barLen);
      const projs = Array.from(w.projects).slice(0, 3).join(', ');
      const more = w.projects.size > 3 ? ` +${w.projects.size - 3}` : '';
      lines.push(`  ${w.week}  ${bar} ${w.count}  (${projs}${more})`);
    }
    lines.push('');
  }

  lines.push('  HOW IT\'S GOING                     WHAT KIND OF WORK');
  lines.push('  ──────────────────────────────────  ──────────────────────────');
  const icons: Record<string, string> = { yes: '  [OK]', partial: '  [~~]', no: '  [XX]', unclear: '  [??]' };
  const maxRows = Math.max(o.successRates.length, o.solutionTypes.length);
  for (let i = 0; i < maxRows; i++) {
    let left = '                                    ';
    let right = '';
    if (i < o.successRates.length) {
      const s = o.successRates[i];
      left = `${icons[s.indicator] || '  [  ]'} ${s.indicator.padEnd(10)} ${String(s.count).padStart(3)} (${s.percentage.toFixed(0)}%)`.padEnd(36);
    }
    if (i < o.solutionTypes.length) {
      const t = o.solutionTypes[i];
      right = `  ${t.type.padEnd(15)} ${t.count}`;
    }
    lines.push(`${left}${right}`);
  }
  lines.push('');

  lines.push('  TOP TOPICS');
  lines.push('  ───────────────────────────────────────────────────────');
  for (const t of o.topTopics.slice(0, 10)) {
    const projs = t.projects.length <= 2 ? t.projects.join(', ') : `${t.projects.slice(0, 2).join(', ')} +${t.projects.length - 2}`;
    lines.push(`  ${String(t.count).padStart(3)}x  ${t.topic}  (${projs})`);
  }
  lines.push('');

  lines.push('  TOP PROJECTS');
  lines.push('  ───────────────────────────────────────────────────────');
  for (const p of o.topProjects.slice(0, 10)) {
    const barLen = Math.max(1, Math.round((p.count / o.topProjects[0].count) * 20));
    lines.push(`  ${'▓'.repeat(barLen)} ${p.name} (${p.count})`);
  }
  lines.push('');

  lines.push('  RECENT SESSIONS');
  lines.push('  ───────────────────────────────────────────────────────');
  for (const s of o.recentSessions.slice(0, 8)) {
    const daysAgo = Math.floor((Date.now() - new Date(s.created).getTime()) / (1000 * 60 * 60 * 24));
    const timeStr = daysAgo === 0 ? 'today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`;
    const mark = s.success === 'yes' ? '[OK]' : s.success === 'partial' ? '[~~]' : s.success === 'no' ? '[XX]' : '[??]';
    lines.push(`  ${mark} ${timeStr.padEnd(7)} [${s.projectName}]`);
    lines.push(`         ${s.summary}`);
    lines.push('');
  }

  lines.push('  ═══════════════════════════════════════════════════════');
  lines.push('  Search: sessions digest search "<query>"');
  lines.push('');

  return lines.join('\n');
}
