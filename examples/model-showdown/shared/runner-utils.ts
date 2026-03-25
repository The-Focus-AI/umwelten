import fs from 'fs';
import path from 'path';

/** Parse --run N flag */
export function parseRunFlag(): number | null {
  const idx = process.argv.indexOf('--run');
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  const n = parseInt(process.argv[idx + 1], 10);
  return Number.isNaN(n) ? null : n;
}

/** Determine run number and directory */
export function resolveRun(evalName: string): { runId: string; runDir: string; runNumber: number; isResume: boolean } {
  const baseDir = path.join(process.cwd(), 'output', 'evaluations', evalName, 'runs');
  fs.mkdirSync(baseDir, { recursive: true });

  const existingRuns = fs.readdirSync(baseDir)
    .filter(d => /^\d+$/.test(d))
    .map(d => parseInt(d, 10))
    .sort((a, b) => a - b);

  const requestedRun = parseRunFlag();
  const forceNew = process.argv.includes('--new');
  const latestRun = existingRuns.length > 0 ? existingRuns[existingRuns.length - 1] : 1;
  const runNumber = forceNew ? (latestRun + 1) : (requestedRun ?? latestRun);
  const runId = String(runNumber).padStart(3, '0');
  const runDir = path.join(baseDir, runId);
  const isResume = existingRuns.includes(runNumber);

  return { runId, runDir, runNumber, isResume };
}

/** Check if --all flag is set */
export function isFullRun(): boolean {
  return process.argv.includes('--all');
}

/** Check if --with-reasoning-levels flag is set */
export function withReasoningLevels(): boolean {
  return process.argv.includes('--with-reasoning-levels');
}

/** Delay helper */
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
