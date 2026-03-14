/**
 * Show full response text for each model in a rivian-10day eval run.
 * Usage: pnpm tsx scripts/show-rivian-results.ts [run-number]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '..');

const runArg  = process.argv[2] ?? '001';
const runId   = runArg.padStart(3, '0');
const baseDir = path.join(repoRoot, 'examples', 'mcp-chat', 'output', 'evaluations', 'rivian-10day', 'runs', runId);

if (!existsSync(baseDir)) {
  console.error(`Run directory not found: ${baseDir}`);
  process.exit(1);
}

const responsesDir = path.join(baseDir, 'responses');
const resultsDir   = path.join(baseDir, 'results');

const responseFiles = readdirSync(responsesDir)
  .filter(f => f.endsWith('.json') && !f.includes('.transcript'));

for (const file of responseFiles.sort()) {
  const response = JSON.parse(readFileSync(path.join(responsesDir, file), 'utf8'));
  const resultPath = path.join(resultsDir, file);
  const result = existsSync(resultPath)
    ? JSON.parse(readFileSync(resultPath, 'utf8'))
    : null;

  const tu = response.toolUsage;
  const label = `${response.provider}:${response.model}`;

  console.log('\n' + '═'.repeat(80));
  console.log(`MODEL: ${label}`);
  console.log('─'.repeat(80));

  if (response.error) {
    console.log(`ERROR: ${response.error}`);
    continue;
  }

  // Tool usage
  if (tu) {
    console.log(`TOOLS (${tu.tool_score}/5): ${tu.calls.map((c: any) => c.name).join(' → ') || 'none'}`);
    console.log(`  get_drives  start: ${tu.drives_start_date ?? 'NONE'}  end: ${tu.drives_end_date ?? 'NONE'}`);
    console.log(`  get_charges start: ${tu.charges_start_date ?? 'NONE'}  end: ${tu.charges_end_date ?? 'NONE'}`);
    console.log(`  ${tu.tool_score_breakdown}`);
  }

  // Judge scores
  if (result?.judge) {
    const j = result.judge;
    console.log(`JUDGE: overall ${j.overall_score}/10 | story ${j.narrative_quality}/5 | facts ${j.factual_grounding}/5 | feb? ${j.covers_full_date_range}`);
    console.log(`  "${j.explanation}"`);
  }

  // Full response text
  const time = (response.durationMs / 1000).toFixed(1);
  const toks = response.tokens ? `${response.tokens.promptTokens}p + ${response.tokens.completionTokens}c tokens` : '';
  console.log(`TIME: ${time}s  ${toks}`);
  console.log('\nRESPONSE:');
  console.log(response.responseText);
}

console.log('\n' + '═'.repeat(80));
