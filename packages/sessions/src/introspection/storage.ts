import { join, dirname } from 'node:path';
import { readFile, writeFile, mkdir, readdir, appendFile } from 'node:fs/promises';
import type { IntrospectionRun, DecisionLogEntry } from './types.js';

/** Directory under the project where runs and the decision log live. */
export function getIntrospectDir(projectPath: string): string {
  return join(projectPath, '.umwelten', 'introspect');
}

export function getDecisionLogPath(projectPath: string): string {
  return join(projectPath, '.umwelten', 'introspect-log.jsonl');
}

export async function saveRun(projectPath: string, run: IntrospectionRun): Promise<string> {
  const dir = getIntrospectDir(projectPath);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${run.runId}.json`);
  await writeFile(filePath, JSON.stringify(run, null, 2), 'utf-8');
  return filePath;
}

export async function loadRun(projectPath: string, runId: string): Promise<IntrospectionRun | null> {
  const filePath = join(getIntrospectDir(projectPath), `${runId}.json`);
  try {
    const text = await readFile(filePath, 'utf-8');
    return JSON.parse(text) as IntrospectionRun;
  } catch {
    return null;
  }
}

export async function listRuns(projectPath: string): Promise<string[]> {
  const dir = getIntrospectDir(projectPath);
  try {
    const names = await readdir(dir);
    return names
      .filter((n) => n.endsWith('.json'))
      .map((n) => n.slice(0, -5))
      .sort((a, b) => (a < b ? 1 : -1)); // newest first (ISO sorts lexically)
  } catch {
    return [];
  }
}

export async function loadLatestRun(projectPath: string): Promise<IntrospectionRun | null> {
  const ids = await listRuns(projectPath);
  if (ids.length === 0) return null;
  return loadRun(projectPath, ids[0]);
}

export function makeRunId(): string {
  // ISO without colons — safe as filename.
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// ---- Decision log ----

export async function appendDecision(
  projectPath: string,
  entry: DecisionLogEntry
): Promise<void> {
  const p = getDecisionLogPath(projectPath);
  await mkdir(dirname(p), { recursive: true });
  await appendFile(p, JSON.stringify(entry) + '\n', 'utf-8');
}

export async function readDecisions(projectPath: string): Promise<DecisionLogEntry[]> {
  try {
    const text = await readFile(getDecisionLogPath(projectPath), 'utf-8');
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    return lines.map((l) => JSON.parse(l) as DecisionLogEntry);
  } catch {
    return [];
  }
}

/** Normalize a proposal's primary text for dedup lookup against prior decisions. */
export function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface RunTally {
  total: number;
  accepted: number;
  skipped: number;
  pending: number;
}

/** Count per-run proposal status by cross-referencing the decision log. */
export function tallyRun(
  run: import('./types.js').IntrospectionRun,
  decisions: import('./types.js').DecisionLogEntry[]
): RunTally {
  const keys: Array<{ kind: string; key: string }> = [];
  for (const r of run.result.workflowRules)
    keys.push({ kind: 'workflowRule', key: normalizeKey(r.rule) });
  for (const f of run.result.architectureFacts)
    keys.push({ kind: 'architectureFact', key: normalizeKey(f.fact) });
  for (const g of run.result.gotchas)
    keys.push({ kind: 'gotcha', key: normalizeKey(g.issue) });
  const byKey = new Map<string, 'accepted' | 'skipped'>();
  for (const d of decisions) byKey.set(`${d.kind}:${d.key}`, d.verdict);
  let accepted = 0;
  let skipped = 0;
  for (const k of keys) {
    const v = byKey.get(`${k.kind}:${k.key}`);
    if (v === 'accepted') accepted++;
    else if (v === 'skipped') skipped++;
  }
  return {
    total: keys.length,
    accepted,
    skipped,
    pending: keys.length - accepted - skipped,
  };
}
