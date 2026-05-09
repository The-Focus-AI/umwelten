#!/usr/bin/env node
/**
 * Git Summarizer Test — practical coding task
 *
 * Asks the model to write a script that traverses a directory, runs
 * `git log --since="7 days ago"` in each subfolder that has a .git
 * directory, and produces a readable summary of changes.
 *
 * Scoring: script runs(1) + detects repos(2) + correct date filtering(2) +
 * readable summary(2) = /7
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/test-git-summarize.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/test-git-summarize.ts --model ollama:qwen3.6:27b
 *   dotenvx run -- pnpm tsx examples/local-providers/test-git-summarize.ts --model llamaswap-nothink:gemma-4-26b-a4b
 */

import '../model-showdown/shared/env.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { Stimulus } from '@umwelten/core/stimulus/stimulus.js';
import { Interaction } from '@umwelten/core/interaction/core/interaction.js';
import type { ModelDetails } from '@umwelten/core/cognition/types.js';
import { getModel } from '@umwelten/core/providers/index.js';

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseModel(): ModelDetails {
  const idx = process.argv.indexOf('--model');
  if (idx !== -1 && idx + 1 < process.argv.length) {
    const [provider, ...nameParts] = process.argv[idx + 1].split(':');
    const name = nameParts.join(':');
    return { name, provider };
  }
  // default: a fast local model
  return { name: 'gemma-4-26b-a4b', provider: 'llamaswap-nothink' };
}

// ── Setup test repos ─────────────────────────────────────────────────────────

interface RepoSpec {
  name: string;
  /** Relative day offsets from today (negative = past). */
  commits: Array<{ daysAgo: number; message: string; file: string; content: string }>;
}

const TEST_REPOS: RepoSpec[] = [
  {
    name: 'frontend-app',
    commits: [
      { daysAgo: 2, message: 'fix: navbar overflow on mobile', file: 'src/Navbar.tsx', content: 'export const Navbar = () => <nav>fixed</nav>;' },
      { daysAgo: 5, message: 'feat: add dark mode toggle', file: 'src/ThemeToggle.tsx', content: 'export const ThemeToggle = () => <button>🌙</button>;' },
    ],
  },
  {
    name: 'api-server',
    commits: [
      { daysAgo: 1, message: 'perf: cache user sessions in redis', file: 'src/session.ts', content: 'export const getSession = (id) => redis.get(id);' },
      { daysAgo: 3, message: 'fix: handle null user edge case', file: 'src/auth.ts', content: 'export const auth = (req) => req.user ?? null;' },
      { daysAgo: 6, message: 'chore: upgrade dependencies', file: 'package.json', content: '{"dependencies": {"express": "^5.0.0"}}' },
    ],
  },
  {
    name: 'docs-site',
    commits: [
      { daysAgo: 4, message: 'docs: add deployment guide', file: 'docs/deploy.md', content: '# Deployment\n\nRun `npm run deploy`.' },
    ],
  },
];

function createTestRepo(root: string, spec: RepoSpec) {
  const dir = path.join(root, spec.name);
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.test"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });

  for (const c of spec.commits) {
    const date = new Date();
    date.setDate(date.getDate() - c.daysAgo);
    const dateStr = date.toISOString().replace('T', ' ').slice(0, 19);

    const filePath = path.join(dir, c.file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, c.content);
    execSync('git add -A', { cwd: dir, stdio: 'pipe' });
    execSync(`GIT_COMMITTER_DATE="${dateStr}" git commit -m "${c.message}" --date="${dateStr}"`, {
      cwd: dir, stdio: 'pipe', env: { ...process.env },
    });
  }
}

// ── Add a "noise" repo with no recent commits ────────────────────────────────
function createNoiseRepo(root: string) {
  const dir = path.join(root, 'stale-project');
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.test"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });

  // One commit from 30 days ago
  const oldDate = new Date();
  oldDate.setDate(oldDate.getDate() - 30);
  const dateStr = oldDate.toISOString().replace('T', ' ').slice(0, 19);
  fs.writeFileSync(path.join(dir, 'old.txt'), 'old');
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  execSync(`GIT_COMMITTER_DATE="${dateStr}" git commit -m "old commit" --date="${dateStr}"`, {
    cwd: dir, stdio: 'pipe', env: { ...process.env },
  });
}

// ── Verification ─────────────────────────────────────────────────────────────

interface Verdict {
  score: number;
  maxScore: number;
  details: string[];
}

function verify(scriptPath: string, repoRoot: string): Verdict {
  const details: string[] = [];
  let score = 0;
  const maxScore = 7;

  // 1. Script runs (1)
  try {
    const result = execSync(`node "${scriptPath}" "${repoRoot}"`, {
      cwd: repoRoot,
      timeout: 15_000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = result.toString();
    score += 1;
    details.push('✅ script executed successfully');
  } catch (err: any) {
    const output = (err.stdout ?? '').toString() + (err.stderr ?? '').toString();
    details.push(`❌ script execution failed: ${err.message?.slice(0, 120)}`);
    return { score: 0, maxScore, details };
  }

  // Cap output for analysis
  const out = output.slice(0, 5000);

  // 2. Detects repos (2) — should find frontend-app, api-server, docs-site
  const foundRepos: string[] = [];
  for (const repo of ['frontend-app', 'api-server', 'docs-site']) {
    if (out.includes(repo)) foundRepos.push(repo);
  }
  if (foundRepos.length >= 3) { score += 2; details.push('✅ found all 3 test repos'); }
  else if (foundRepos.length >= 2) { score += 1; details.push(`⚠️ found ${foundRepos.length}/3 repos: ${foundRepos.join(', ')}`); }
  else { details.push(`❌ only found ${foundRepos.length}/3 repos`); }

  // 3. Correct date filtering (2) — should NOT include stale-project (30 days ago)
  if (!out.includes('stale-project')) { score += 2; details.push('✅ correctly filtered out old repo'); }
  else { details.push('❌ included stale-project (30 days old) in output'); }

  // 4. Readable summary (2) — should mention commit messages, not just raw git output
  const hasMessages = TEST_REPOS.some(r =>
    r.commits.some(c => out.includes(c.message.split(':')[0])),
  );
  const hasStructure = out.includes('commit') || out.includes('change') || out.includes('repo') || out.includes('summary');
  if (hasMessages && hasStructure) { score += 2; details.push('✅ readable summary with commit details'); }
  else if (hasMessages || hasStructure) { score += 1; details.push('⚠️ partial summary'); }
  else { details.push('❌ no readable summary structure'); }

  return { score, maxScore, details };
}

// ── Main ─────────────────────────────────────────────────────────────────────

const PROMPT = `Write a Node.js script that:

1. Takes a directory path as a command-line argument
2. Scans that directory for subdirectories that contain a .git folder
3. For each git repo found, runs \`git log --since="7 days ago" --oneline\`
4. Collects the results and prints a summary showing:
   - The repo name
   - Number of commits in the last 7 days
   - A brief summary of what changed (based on commit messages)
5. Skips repos with no activity in the last 7 days
6. Handles errors gracefully (non-git directories, missing repos)

Output ONLY the complete Node.js script inside a \`\`\`javascript code block. No explanation.`;

async function main() {
  const model = parseModel();
  console.log(`🧪 Git Summarizer Test`);
  console.log(`Model: ${model.provider}:${model.name}`);

  // Create test repos
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-summarize-test-'));
  console.log(`Test repos: ${tmpDir}`);
  for (const spec of TEST_REPOS) createTestRepo(tmpDir, spec);
  createNoiseRepo(tmpDir);

  // Get model response
  const lm = await getModel(model);
  if (!lm) { console.error('Model not found'); process.exit(1); }

  const stimulus = new Stimulus({
    role: 'expert Node.js developer',
    objective: 'write a complete, working Node.js script that summarizes git changes',
    instructions: [
      'Write a complete, self-contained Node.js script',
      'Use only the standard library (no npm install required)',
      'Handle errors gracefully',
      'Output ONLY the script inside a ```javascript code block',
    ],
    temperature: 0.2,
    maxTokens: 2000,
    runnerType: 'base',
  });

  const interaction = new Interaction(model, stimulus, { model: lm });
  const t0 = Date.now();
  const response = await interaction.generateText();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const text = response.content;
  console.log(`\nResponse (${elapsed}s):`);
  console.log('─'.repeat(60));
  console.log(text.slice(0, 800));
  if (text.length > 800) console.log(`\n... (${text.length - 800} more chars)`);
  console.log('─'.repeat(60));

  // Extract code
  const codeMatch = text.match(/```(?:javascript|js)\s*\n([\s\S]*?)```/);
  if (!codeMatch) {
    console.log('\n❌ No JavaScript code block found in response');
    console.log('Score: 0/7');
    process.exit(0);
  }
  const code = codeMatch[1].trim();

  // Write and run
  const scriptPath = path.join(tmpDir, 'summarize.js');
  fs.writeFileSync(scriptPath, code);
  console.log(`\nScript written to: ${scriptPath}`);

  console.log('\nVerification:');
  const verdict = verify(scriptPath, tmpDir);
  for (const d of verdict.details) console.log(`  ${d}`);
  console.log(`\nScore: ${verdict.score}/${verdict.maxScore}`);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(err => { console.error(err); process.exit(1); });
