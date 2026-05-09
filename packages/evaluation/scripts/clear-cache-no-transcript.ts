#!/usr/bin/env node
/**
 * One-off: walk the evaluation cache, delete every cached ModelResponse
 * that was written before transcript capture (no `messages` field).
 * Next time the suite runs, those cells re-call the model and get a
 * full transcript. Other cells (already with transcripts, or judge
 * scores) are untouched.
 *
 * Scoped via --eval to avoid blowing away unrelated runs.
 *
 * Usage:
 *   pnpm tsx scripts/clear-cache-no-transcript.ts --eval llm-eval-coding
 *   pnpm tsx scripts/clear-cache-no-transcript.ts --eval llm-eval-coding --filter nemotron
 *   pnpm tsx scripts/clear-cache-no-transcript.ts --eval llm-eval-coding --gen-only
 *   pnpm tsx scripts/clear-cache-no-transcript.ts --eval llm-eval-coding --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
function readArg(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1 || i + 1 >= argv.length) return undefined;
  return argv[i + 1];
}

const evalName = readArg('--eval');
if (!evalName) {
  console.error('Required: --eval <name>');
  process.exit(1);
}
const filter = readArg('--filter');
const genOnly = argv.includes('--gen-only');
const dryRun = argv.includes('--dry-run');

const base = path.join(process.cwd(), 'output', 'evaluations', evalName, 'runs');
if (!fs.existsSync(base)) {
  console.error(`No runs dir at ${base}`);
  process.exit(1);
}

let scanned = 0;
let deleted = 0;
let kept = 0;

function walk(dir: string) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (!full.endsWith('.json')) continue;
    if (full.includes('.transcript.json')) continue;
    // Only target the responses/ subdirs (where model-response cache lives)
    if (!full.includes(`${path.sep}responses${path.sep}`)) continue;
    if (filter && !full.includes(filter)) continue;

    // Filter to gen tasks only if requested
    if (genOnly) {
      // Path looks like .../runs/NNN/<taskId>/responses/.../<model>.json
      const parts = full.split(path.sep);
      const runsIdx = parts.findIndex((p) => p === 'runs');
      const taskId = parts[runsIdx + 2];
      if (!taskId?.startsWith('gen-')) continue;
    }

    scanned++;
    try {
      const data = JSON.parse(fs.readFileSync(full, 'utf8'));
      const hasMessages =
        Array.isArray(data.messages) && data.messages.length > 0;
      if (hasMessages) {
        kept++;
        continue;
      }
      if (dryRun) {
        console.log(`would delete: ${path.relative(process.cwd(), full)}`);
      } else {
        fs.unlinkSync(full);
      }
      deleted++;
    } catch {
      // skip malformed
    }
  }
}

walk(base);

console.log();
console.log(`Scanned: ${scanned}`);
console.log(`Kept:    ${kept} (have messages)`);
console.log(`Deleted: ${deleted}${dryRun ? ' (DRY RUN — nothing changed)' : ''}`);
