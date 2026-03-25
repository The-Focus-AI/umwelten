#!/usr/bin/env node
/**
 * Process cached API responses into results — no API calls needed.
 * Reads cached response files, extracts code, runs locally, verifies, writes result files.
 */
import '../shared/env.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ALL_CHALLENGES, ALL_LANGUAGES, type Language } from './challenges.js';

const RUN_DIR = path.join(process.cwd(), 'output', 'evaluations', 'model-showdown-coding', 'runs', '006');

const LANG_FENCE_NAMES: Record<Language, string[]> = {
  typescript: ['typescript', 'ts'],
  python: ['python', 'py'],
  go: ['go', 'golang'],
};

function extractCode(response: string, lang: Language): string | null {
  for (const fence of LANG_FENCE_NAMES[lang]) {
    const match = response.match(new RegExp(`\`\`\`${fence}\\s*\\n([\\s\\S]*?)\`\`\``));
    if (match) return match[1].trim();
  }
  const generic = response.match(/```\s*\n([\s\S]*?)```/);
  if (generic) return generic[1].trim();
  const markers: Record<Language, string[]> = {
    typescript: ['console.log', 'function '],
    python: ['print(', 'def '],
    go: ['package main', 'func main'],
  };
  if (markers[lang].some(m => response.includes(m))) return response.trim();
  return null;
}

function executeLocal(code: string, lang: Language): { stdout: string; stderr: string; exitCode: number } {
  const tmpDir = path.join(process.cwd(), 'output', '.tmp-code');
  fs.mkdirSync(tmpDir, { recursive: true });
  const ext = { typescript: '.ts', python: '.py', go: '.go' }[lang];
  const tmpFile = path.join(tmpDir, `code-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);

  try {
    fs.writeFileSync(tmpFile, code);
    const cmd = {
      typescript: `npx tsx "${tmpFile}"`,
      python: `python3 "${tmpFile}"`,
      go: `go run "${tmpFile}"`,
    }[lang];

    const stdout = execSync(cmd, { timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout: stdout || '', stderr: '', exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout || '', stderr: err.stderr || err.message || '', exitCode: err.status || 1 };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function main() {
  let processed = 0, skipped = 0;

  for (const challenge of ALL_CHALLENGES) {
    for (const lang of ALL_LANGUAGES) {
      const taskId = `${challenge.id}-${lang}`;
      const taskDir = path.join(RUN_DIR, taskId);
      const resultsDir = path.join(taskDir, 'results');

      // Find all response subdirs
      const responsesBase = path.join(taskDir, 'responses');
      if (!fs.existsSync(responsesBase)) continue;

      // Response files are in responses/{stimulusId}/{modelKey}.json
      const stimDirs = fs.readdirSync(responsesBase).filter(d =>
        fs.statSync(path.join(responsesBase, d)).isDirectory()
      );

      for (const stimDir of stimDirs) {
        const stimPath = path.join(responsesBase, stimDir);
        const responseFiles = fs.readdirSync(stimPath).filter(f => f.endsWith('.json'));

        for (const respFile of responseFiles) {
          // Convert response filename to result filename
          // Response: nvidia-Nemotron-3-Nano-30B-A3B-deepinfra.json
          // Result: nvidia-Nemotron-3-Nano-30B-A3B-deepinfra.json
          const modelKey = respFile.replace('.json', '');
          const resultPath = path.join(resultsDir, respFile);

          // Skip if result already exists
          if (fs.existsSync(resultPath)) {
            skipped++;
            continue;
          }

          // Read cached response
          const respData = JSON.parse(fs.readFileSync(path.join(stimPath, respFile), 'utf8'));
          const responseText = respData.content || '';

          if (!responseText) {
            // Empty response — write error result
            fs.mkdirSync(resultsDir, { recursive: true });
            const r = {
              challengeId: challenge.id, language: lang,
              model: modelKey, provider: '',
              responseText: '', extractedCode: null,
              compiled: false, ran: false, stdout: '', stderr: '',
              verifyScore: 0, verifyDetails: 'empty response',
              totalScore: 0, durationMs: 0, cost: 0,
              error: 'empty response',
            };
            fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));
            console.log(`  ❌ ${taskId} / ${modelKey} → 0/7 (empty response)`);
            processed++;
            continue;
          }

          // Extract code
          const code = extractCode(responseText, lang);
          if (!code) {
            fs.mkdirSync(resultsDir, { recursive: true });
            const r = {
              challengeId: challenge.id, language: lang,
              model: modelKey, provider: '',
              responseText, extractedCode: null,
              compiled: false, ran: false, stdout: '', stderr: '',
              verifyScore: 0, verifyDetails: 'Could not extract code',
              totalScore: 0, durationMs: 0, cost: 0,
            };
            fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));
            console.log(`  ❌ ${taskId} / ${modelKey} → 0/7 (no code found)`);
            processed++;
            continue;
          }

          // Execute locally
          const { stdout, stderr, exitCode } = executeLocal(code, lang);
          const compiled = exitCode === 0 || stdout.length > 0;
          const ran = exitCode === 0;

          // Verify
          const verification = ran
            ? challenge.verify(stdout)
            : { pass: false, score: 0, details: `Exit code ${exitCode}: ${stderr.slice(0, 100)}` };

          const totalScore = (compiled ? 1 : 0) + (ran ? 1 : 0) + verification.score;

          fs.mkdirSync(resultsDir, { recursive: true });
          const r = {
            challengeId: challenge.id, language: lang,
            model: modelKey, provider: '',
            responseText, extractedCode: code,
            compiled, ran,
            stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 500),
            verifyScore: verification.score, verifyDetails: verification.details,
            totalScore, durationMs: 0,
            cost: respData.metadata?.cost?.totalCost || 0,
          };
          fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));

          const icon = totalScore >= 5 ? '✅' : totalScore >= 3 ? '⚠️' : '❌';
          console.log(`  ${icon} ${taskId} / ${modelKey} → ${totalScore}/7 (${verification.details.slice(0, 60)})`);
          processed++;
        }
      }
    }
  }

  console.log(`\nDone: ${processed} processed, ${skipped} skipped (already had results)`);

  // Print final counts
  console.log('\n=== FINAL COUNTS ===');
  for (const challenge of ALL_CHALLENGES) {
    for (const lang of ALL_LANGUAGES) {
      const taskId = `${challenge.id}-${lang}`;
      const resultsDir = path.join(RUN_DIR, taskId, 'results');
      const count = fs.existsSync(resultsDir) ? fs.readdirSync(resultsDir).filter(f => f.endsWith('.json')).length : 0;
      if (count < 22) console.log(`  ${taskId}: ${count}/22`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
