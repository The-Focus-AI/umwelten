#!/usr/bin/env node
/**
 * Rivian 10-Day Activity Eval — Multi-Provider Tool Use + Story Quality Test
 *
 * Scores each model on three axes:
 *   1. Tool use correctness  (deterministic) — did it call the right tools with
 *      the right date params?  get_drives/get_charges must have start_date ≤ Feb 27.
 *   2. Factual grounding     (LLM judge)     — did it use real data in the response?
 *   3. Storytelling quality  (LLM judge)     — is the narrative engaging?
 *
 * Usage:
 *   pnpm tsx eval-rivian.ts               # local test (3 models), latest run
 *   pnpm tsx eval-rivian.ts --all         # full suite, latest run (cached)
 *   pnpm tsx eval-rivian.ts --all --new   # fresh run (new run number)
 *   pnpm tsx eval-rivian.ts --run 3       # re-use specific run
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// Load root .env regardless of cwd
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import type { CoreMessage } from 'ai';
import { clearAllRateLimitStates } from '../../src/rate-limit/rate-limit.js';
import { Interaction } from '../../src/interaction/core/interaction.js';
import { Stimulus } from '../../src/stimulus/stimulus.js';
import type { ModelDetails } from '../../src/cognition/types.js';
import { createMCPChatRuntime } from './habitat.js';

// ── Models to evaluate ──────────────────────────────────────────────────────

const LOCAL_TEST_MODELS: ModelDetails[] = [
  // ── Confirmed working ─────────────────────────────────────────────────────
  { name: 'glm-4.7-flash:latest', provider: 'ollama' },
  { name: 'qwen3:30b-a3b', provider: 'ollama' },
  { name: 'qwen3:32b', provider: 'ollama' },
  { name: 'gpt-oss:latest', provider: 'ollama' },
  { name: 'mistral-small:latest', provider: 'ollama' },
  // ── Untested ──────────────────────────────────────────────────────────────
  { name: 'minimax-m2.1:cloud', provider: 'ollama' },
  { name: 'deepseek-r1:latest', provider: 'ollama' },
  { name: 'deepseek-r1:32b', provider: 'ollama' },
  // llama4:latest — 67GB, consistently times out >10min

  // ── Confirmed Bad Request (no tool calling) ───────────────────────────────
  { name: 'phi4:latest', provider: 'ollama' },
  { name: 'gemma3n:e4b', provider: 'ollama' },
  { name: 'deepseek-r1:14b', provider: 'ollama' },
  // devstral:latest — timed out >10min, excluded
];

const ALL_MODELS: ModelDetails[] = [
  // ── Google — all via OpenRouter (exact IDs from models list) ─────────────
  { name: 'google/gemini-3.1-pro-preview', provider: 'openrouter' },           // Feb 19 2026  $2.00/$12.00
  { name: 'google/gemini-3.1-flash-lite-preview', provider: 'openrouter' },    // Mar 3 2026   $0.25/$1.50
  { name: 'google/gemini-3-flash-preview', provider: 'openrouter' },           // Dec 17 2025  $0.50/$3.00

  // ── Anthropic — Claude 4.6 (Feb 2026) ────────────────────────────────────
  { name: 'anthropic/claude-opus-4.6', provider: 'openrouter' },    // Feb 5 2026   $5/$25
  { name: 'anthropic/claude-sonnet-4.6', provider: 'openrouter' },  // Feb 17 2026  $3/$15
  { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' },   // Oct 2025     $1/$5

  // ── OpenAI — GPT-5.4 (Mar 5 2026) + 5.3 (Feb–Mar 2026) ─────────────────
  { name: 'openai/gpt-5.4', provider: 'openrouter' },               // Mar 5 2026   $2.50/$15
  // gpt-5.4-pro excluded — $30/$180, requires higher credit tier
  { name: 'openai/gpt-5.3-codex', provider: 'openrouter' },         // Feb 5 2026   $1.75/$14
  { name: 'openai/gpt-5.3-chat', provider: 'openrouter' },          // Mar 3 2026   $1.75/$14
  { name: 'openai/gpt-oss-120b', provider: 'openrouter' },          // Aug 2025     $0.04/$0.19
  { name: 'openai/gpt-oss-20b', provider: 'openrouter' },           // Aug 2025     $0.03/$0.14

  // ── xAI — grok-4.20 not on OpenRouter; newest available: ─────────────────
  { name: 'x-ai/grok-4.1-fast', provider: 'openrouter' },           // Nov 2025     $0.20/$0.50
  { name: 'x-ai/grok-4', provider: 'openrouter' },                  // Jul 2025     $3/$15

  // ── DeepSeek — V4 not on OpenRouter; newest available: ───────────────────
  { name: 'deepseek/deepseek-v3.2', provider: 'openrouter' },       // Dec 1 2025   $0.25/$0.40
  { name: 'deepseek/deepseek-v3.2-speciale', provider: 'openrouter' }, // Dec 1 2025 $0.40/$1.20

  // ── Qwen 3.5 (Feb 2026) ──────────────────────────────────────────────────
  { name: 'qwen/qwen3.5-397b-a17b', provider: 'openrouter' },       // Feb 16 2026  $0.39/$2.34
  { name: 'qwen/qwen3.5-122b-a10b', provider: 'openrouter' },       // Feb 25 2026  $0.26/$2.08
  { name: 'qwen/qwen3.5-35b-a3b', provider: 'openrouter' },         // Feb 25 2026  $0.16/$1.30
  { name: 'qwen/qwen3.5-flash-02-23', provider: 'openrouter' },     // Feb 23 2026  $0.10/$0.40

  // ── GLM-5 (Feb 11 2026) — $0.80/$2.56 ───────────────────────────────────
  { name: 'z-ai/glm-5', provider: 'openrouter' },

  // ── MiniMax M2.5 (Feb 12 2026) — $0.30/$1.20 ────────────────────────────
  { name: 'minimax/minimax-m2.5', provider: 'openrouter' },

  // ── Inception Mercury-2 (Mar 4 2026) — $0.25/$0.75 ───────────────────────
  { name: 'inception/mercury-2', provider: 'openrouter' },

  // ── Kimi K2.5 (Jan 27 2026) — $0.45/$2.20 ───────────────────────────────
  { name: 'moonshotai/kimi-k2.5', provider: 'openrouter' },

  // ── Mistral Large 2512 (Dec 1 2025) — $0.50/$1.50 ────────────────────────
  { name: 'mistralai/mistral-large-2512', provider: 'openrouter' },

  // ── Meta Llama 4 (Apr 2025) — open-weight baseline ───────────────────────
  { name: 'meta-llama/llama-4-maverick', provider: 'openrouter' },  // $0.15/$0.60
  { name: 'meta-llama/llama-4-scout', provider: 'openrouter' },     // $0.08/$0.30

  // ── Ollama (local — confirmed working from run 3) ─────────────────────────
  { name: 'glm-4.7-flash:latest', provider: 'ollama' },
  { name: 'qwen3:30b-a3b', provider: 'ollama' },
  { name: 'qwen3:32b', provider: 'ollama' },
  { name: 'gpt-oss:latest', provider: 'ollama' },
  { name: 'minimax-m2.1:cloud', provider: 'ollama' },
  { name: 'mistral-small:latest', provider: 'ollama' },
];

const MODELS = process.argv.includes('--all') ? ALL_MODELS : LOCAL_TEST_MODELS;

// ── CLI flags ────────────────────────────────────────────────────────────────

function parseRunFlag(): number | null {
  const idx = process.argv.indexOf('--run');
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  const n = parseInt(process.argv[idx + 1], 10);
  return Number.isNaN(n) ? null : n;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const RIVIAN_PROMPT =
  `look through my real data and summarize the 10 days of the rivians activity between february 27 and march 8 2026. ` +
  `if there were any notable trips, create a narrative of the time frame. ` +
  `today is mar 8 2026 and make sure that you include full 10 days, so if you don't ` +
  `have any drives and chargers in february its obviously false.`;

  const EXPECTED_START = '2026-02-27';
  const EXPECTED_END   = '2026-03-08';

// ── Tool call extraction & deterministic scoring ──────────────────────────────

interface ToolCall {
  name: string;
  args: Record<string, any>;
}

interface ToolUsage {
  calls: ToolCall[];                  // every tool call made, in order
  called_list_vehicles: boolean;
  called_get_drives: boolean;
  called_get_charges: boolean;
  drives_start_date: string | null;   // first start_date passed to get_drives
  drives_end_date: string | null;
  charges_start_date: string | null;  // first start_date passed to get_charges
  charges_end_date: string | null;
  drives_has_date_range: boolean;     // get_drives was called with a start_date
  charges_has_date_range: boolean;    // get_charges was called with a start_date
  dates_cover_feb27: boolean;         // start_date ≤ 2026-02-27
  tool_score: number;                 // 0–5 deterministic score
  tool_score_breakdown: string;       // human-readable explanation
}

function extractToolCalls(messages: CoreMessage[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    for (const part of msg.content as any[]) {
      if (part.type === 'tool-call') {
        // Vercel AI SDK uses `input`; some adapters use `args`
        calls.push({ name: part.toolName, args: part.input ?? part.args ?? {} });
      }
    }
  }
  return calls;
}

function scoreToolUsage(calls: ToolCall[]): ToolUsage {
  const called_list_vehicles = calls.some(c => c.name === 'list_vehicles');
  const called_get_drives    = calls.some(c => c.name === 'get_drives');
  const called_get_charges   = calls.some(c => c.name === 'get_charges');

  const driveCall  = calls.find(c => c.name === 'get_drives');
  const chargeCall = calls.find(c => c.name === 'get_charges');

  const drives_start_date  = driveCall?.args?.start_date  ?? null;
  const drives_end_date    = driveCall?.args?.end_date    ?? null;
  const charges_start_date = chargeCall?.args?.start_date ?? null;
  const charges_end_date   = chargeCall?.args?.end_date   ?? null;

  const drives_has_date_range  = drives_start_date !== null;
  const charges_has_date_range = charges_start_date !== null;

  // start_date must be on or before Feb 27 to cover the full range
  const dates_cover_feb27 =
    (drives_start_date  !== null && drives_start_date  <= EXPECTED_START) ||
    (charges_start_date !== null && charges_start_date <= EXPECTED_START);

  // 0–5 scoring
  const checks = [
    [called_get_drives,    'called get_drives'],
    [called_get_charges,   'called get_charges'],
    [drives_has_date_range,  'get_drives has start_date'],
    [charges_has_date_range, 'get_charges has start_date'],
    [dates_cover_feb27,    `start_date ≤ ${EXPECTED_START}`],
  ] as [boolean, string][];

  const passed  = checks.filter(([ok]) => ok);
  const failed  = checks.filter(([ok]) => !ok);
  const tool_score = passed.length;
  const tool_score_breakdown =
    (passed.length  ? `✅ ${passed.map(([, l]) => l).join(', ')}` : '') +
    (failed.length  ? `  ❌ ${failed.map(([, l]) => l).join(', ')}` : '');

  return {
    calls,
    called_list_vehicles,
    called_get_drives,
    called_get_charges,
    drives_start_date,
    drives_end_date,
    charges_start_date,
    charges_end_date,
    drives_has_date_range,
    charges_has_date_range,
    dates_cover_feb27,
    tool_score,
    tool_score_breakdown,
  };
}

// ── Judge schema ──────────────────────────────────────────────────────────────

const JudgeSchema = z.object({
  covers_full_date_range: z.boolean().describe(
    'Does the final response text include data from late February (Feb 27+)?'
  ),
  has_trip_narrative: z.boolean().describe(
    'Is there at least one narrative paragraph about a notable trip (not just bullet points)?'
  ),
  narrative_quality: z.number().min(1).max(5).describe(
    '1=no narrative/dry list  2=minimal story  3=basic story with some detail  ' +
    '4=engaging story with context  5=vivid narrative with rich specifics (dates, distances, places)'
  ),
  factual_grounding: z.number().min(1).max(5).describe(
    '1=vague/hallucinated  2=sparse data  3=some specifics  ' +
    '4=good use of real data  5=rich specifics from tool results (exact dates, distances, charge %)'
  ),
  overall_score: z.number().min(1).max(10).describe(
    'Overall quality: factual accuracy + storytelling quality combined'
  ),
  explanation: z.string().describe(
    'One sentence: what the model did well and what it got wrong'
  ),
});

type JudgeResult = z.infer<typeof JudgeSchema>;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModelResult {
  model: string;
  provider: string;
  responseText: string;
  durationMs: number;
  cost: number;
  tokens: { promptTokens: number; completionTokens: number } | null;
  toolUsage: ToolUsage;
  error?: string;
}

interface ScoredResult extends ModelResult {
  judge: JudgeResult | null;
  judgeError?: string;
}

type JudgedScoredResult = ScoredResult & { judge: JudgeResult };

function totalPoints(s: JudgedScoredResult): number {
  return s.judge.overall_score + s.toolUsage.tool_score;
}

function durationSeconds(s: ModelResult): number {
  return s.durationMs / 1000;
}

function hasMeteredCost(s: ModelResult): boolean {
  return s.cost > 0;
}

function formatCost(s: ModelResult): string {
  if (hasMeteredCost(s)) return `$${s.cost.toFixed(4)}`;
  return s.provider === 'ollama' ? 'local' : '$0.0000';
}

function pointsPerDollar(s: JudgedScoredResult): number | null {
  return hasMeteredCost(s) ? totalPoints(s) / s.cost : null;
}

function pointsPerSecond(s: JudgedScoredResult): number {
  return totalPoints(s) / Math.max(durationSeconds(s), 0.001);
}

function formatMaybe(n: number | null, digits = 1): string {
  return n === null || !Number.isFinite(n) ? '—' : n.toFixed(digits);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚗 Rivian 10-Day Activity Eval');
  console.log('═'.repeat(70));
  console.log('Prompt: "Summarize the last 10 days of the Rivian\'s activity."');
  console.log(`Date:   Today is Mar 8, 2026 → full range ${EXPECTED_START} – ${EXPECTED_END}`);
  console.log(`Models: ${MODELS.length}`);
  console.log('═'.repeat(70));
  console.log();

  // ── Determine run number ────────────────────────────────────────────────────

  const baseDir = path.join(process.cwd(), 'output', 'evaluations', 'rivian-10day', 'runs');
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

  console.log(`📂 Run #${runId}${isResume ? ' (resuming existing run)' : ''}\n`);

  // ── Initialize MCP runtime ──────────────────────────────────────────────────

  console.log('🔌 Connecting to TezLab MCP server...');
  const { habitat, tezlab } = await createMCPChatRuntime();
  console.log(`   ✅ Connected — ${tezlab.getToolNames().length} tools available`);
  console.log(`   Tools: ${tezlab.getToolNames().slice(0, 5).join(', ')}${tezlab.getToolNames().length > 5 ? '…' : ''}\n`);

  const stimulus = await habitat.getStimulus();
  stimulus.options.maxToolSteps = 20;

  const responsesDir = path.join(runDir, 'responses');
  fs.mkdirSync(responsesDir, { recursive: true });

  // ── Step 1: Run each model ──────────────────────────────────────────────────

  console.log('📡 Running evaluation (sequential — shared MCP connection)...\n');

  const modelResults: ModelResult[] = [];

  for (const modelDetails of MODELS) {
    const modelLabel = `${modelDetails.provider}:${modelDetails.name}`;
    const modelKey   = `${modelDetails.name.replace(/[\/:]/g, '-')}-${modelDetails.provider}`;
    const responsePath = path.join(responsesDir, `${modelKey}.json`);

    if (fs.existsSync(responsePath) && !forceNew) {
      const cached = JSON.parse(fs.readFileSync(responsePath, 'utf8')) as ModelResult;

      // Re-run models that previously errored (don't cache failures)
      if (cached.error) {
        console.log(`  🔁 ${modelLabel} (retrying — previously errored: ${cached.error.slice(0, 60)})`);
        fs.unlinkSync(responsePath);
        // fall through to run the model
      } else {

      // Backfill toolUsage if missing (old cached result predates this field)
      if (!cached.toolUsage) {
        const transcriptPath = responsePath.replace('.json', '.transcript.jsonl');
        if (fs.existsSync(transcriptPath)) {
          const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
          const messages = lines.map(l => JSON.parse(l) as CoreMessage);
          cached.toolUsage = scoreToolUsage(extractToolCalls(messages));
        } else {
          cached.toolUsage = scoreToolUsage([]);
        }
        fs.writeFileSync(responsePath, JSON.stringify(cached, null, 2));
      }

      const tu = cached.toolUsage;
      console.log(
        `  📁 ${modelLabel} (cached)` +
        `  tools: ${tu.calls.map(c => c.name).join('→') || 'none'}  score: ${tu.tool_score}/5` +
        `  drives start: ${tu.drives_start_date ?? 'NONE'}`
      );
      modelResults.push(cached);
      continue;
      } // end else (not errored)
    }

    process.stdout.write(`  🔄 ${modelLabel}...`);
    const startTime = Date.now();

    try {
      const interaction = new Interaction(modelDetails, stimulus);
      interaction.addMessage({ role: 'user', content: RIVIAN_PROMPT });

      const response = await interaction.generateText();
      const durationMs = Date.now() - startTime;

      const responseText = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      const allMessages = interaction.getMessages();
      const toolCalls   = extractToolCalls(allMessages);
      const toolUsage   = scoreToolUsage(toolCalls);

      const result: ModelResult = {
        model: modelDetails.name,
        provider: modelDetails.provider,
        responseText,
        durationMs,
        cost: response.metadata.cost?.totalCost || 0,
        tokens: response.metadata.tokenUsage || null,
        toolUsage,
      };

      modelResults.push(result);
      fs.writeFileSync(responsePath, JSON.stringify(result, null, 2));

      // Full conversation transcript (system + user + all tool turns + final response)
      const transcriptPath = responsePath.replace('.json', '.transcript.jsonl');
      fs.writeFileSync(transcriptPath, allMessages.map(m => JSON.stringify(m)).join('\n') + '\n');

      console.log(
        ` ✅ ${(durationMs / 1000).toFixed(1)}s` +
        ` | tool score: ${toolUsage.tool_score}/5` +
        ` | calls: ${toolCalls.map(c => c.name).join('→')}` +
        `\n       drives start: ${toolUsage.drives_start_date ?? 'NONE'}` +
        `  charges start: ${toolUsage.charges_start_date ?? 'NONE'}`
      );

    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg   = err instanceof Error ? err.message : String(err);
      console.log(` ❌ ${errorMsg.slice(0, 80)}`);

      modelResults.push({
        model: modelDetails.name,
        provider: modelDetails.provider,
        responseText: '',
        durationMs,
        cost: 0,
        tokens: null,
        toolUsage: scoreToolUsage([]),
        error: errorMsg,
      });
      fs.writeFileSync(responsePath, JSON.stringify(modelResults[modelResults.length - 1], null, 2));
    }
  }

  // If the model list changed mid-run, preserve previously cached responses in
  // this run directory so older successful models still appear in judging and
  // final rankings.
  const seenModelLabels = new Set(modelResults.map(r => `${r.provider}:${r.model}`));
  const cachedResponseFiles = fs.readdirSync(responsesDir)
    .filter(name => name.endsWith('.json') && !name.endsWith('.transcript.jsonl'));

  for (const file of cachedResponseFiles) {
    const responsePath = path.join(responsesDir, file);
    const cached = JSON.parse(fs.readFileSync(responsePath, 'utf8')) as ModelResult;
    const label = `${cached.provider}:${cached.model}`;
    if (seenModelLabels.has(label)) continue;

    if (!cached.toolUsage) {
      const transcriptPath = responsePath.replace('.json', '.transcript.jsonl');
      if (fs.existsSync(transcriptPath)) {
        const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
        const messages = lines.map(l => JSON.parse(l) as CoreMessage);
        cached.toolUsage = scoreToolUsage(extractToolCalls(messages));
      } else {
        cached.toolUsage = scoreToolUsage([]);
      }
      fs.writeFileSync(responsePath, JSON.stringify(cached, null, 2));
    }

    modelResults.push(cached);
    seenModelLabels.add(label);
    console.log(`  ♻️  Recovered cached run result: ${label}`);
  }

  console.log(`\n✅ Got ${modelResults.filter(r => !r.error).length}/${modelResults.length} responses\n`);

  // ── Step 2: LLM judge ──────────────────────────────────────────────────────

  const judgeModel: ModelDetails = process.env.OPENROUTER_API_KEY
    ? { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' }
    : { name: 'gpt-oss:latest', provider: 'ollama' };

  clearAllRateLimitStates();
  console.log(`⚖️  Judging responses with ${judgeModel.provider}:${judgeModel.name}...\n`);

  const judgeStimulus = new Stimulus({
    role: 'evaluation judge',
    objective: 'assess the quality of an AI response to a personal vehicle activity summary request',
    instructions: [
      'The user asked an AI assistant (connected to a TezLab MCP server with real Rivian data):',
      `"Summarize the last 10 days of the Rivian's activity. Today is Mar 8, 2026 — full range ${EXPECTED_START} – ${EXPECTED_END}."`,
      'You will receive the model\'s final text response AND a summary of which tools it called and with what arguments.',
      'A GOOD response: covers the full Feb 27–Mar 8 range with real data and tells an engaging story.',
      'A BAD response: only covers March, lacks specifics, or is just a dry bullet list.',
      'NOTE: If the tool summary shows get_drives or get_charges were called WITHOUT a start_date, the model almost certainly got incomplete data — factor this into factual_grounding.',
      'Reply with ONLY a JSON object, no markdown fences, matching exactly:',
      '{"covers_full_date_range":true|false,"has_trip_narrative":true|false,"narrative_quality":1-5,"factual_grounding":1-5,"overall_score":1-10,"explanation":"..."}',
    ],
    temperature: 0.0,
    maxTokens: 400,
    runnerType: 'base',
  });

  const scored: ScoredResult[] = [];
  const resultsDir = path.join(runDir, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  for (const result of modelResults) {
    const modelKey  = `${result.model.replace(/[\/:]/g, '-')}-${result.provider}`;
    const resultPath = path.join(resultsDir, `${modelKey}.json`);

    // Cache hit — skip only if judge succeeded previously
    if (fs.existsSync(resultPath) && !forceNew) {
      const cached = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as ScoredResult;
      if (cached.judge !== null) {
        // Backfill toolUsage from the response cache if missing (old cached result)
        if (!cached.toolUsage) cached.toolUsage = result.toolUsage ?? scoreToolUsage([]);
        console.log(`  📁 ${result.provider}:${result.model} (cached)`);
        scored.push(cached);
        continue;
      }
      console.log(`  🔄 ${result.provider}:${result.model} (re-judging — previous attempt failed)`);
    }

    if (result.error || !result.responseText) {
      const s: ScoredResult = { ...result, judge: null, judgeError: result.error || 'no response' };
      scored.push(s);
      fs.writeFileSync(resultPath, JSON.stringify(s, null, 2));
      continue;
    }

    try {
      const tu = result.toolUsage;
      const toolSummary =
        `Tools called: ${tu.calls.map(c => c.name).join(', ') || 'none'}\n` +
        `get_drives  start_date: ${tu.drives_start_date  ?? 'NOT PROVIDED'}  end_date: ${tu.drives_end_date  ?? 'NOT PROVIDED'}\n` +
        `get_charges start_date: ${tu.charges_start_date ?? 'NOT PROVIDED'}  end_date: ${tu.charges_end_date ?? 'NOT PROVIDED'}\n` +
        `Tool score: ${tu.tool_score}/5  (${tu.tool_score_breakdown})`;

      const judgeInteraction = new Interaction(judgeModel, judgeStimulus);
      judgeInteraction.addMessage({
        role: 'user',
        content:
          `=== TOOL USAGE ===\n${toolSummary}\n\n` +
          `=== MODEL RESPONSE ===\n${result.responseText}\n\n` +
          `Score this response. Reply with ONLY a JSON object.`,
      });
      const judgeResponse = await judgeInteraction.generateText();

      let jsonStr = (judgeResponse.content as string).trim();
      const m = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/) || jsonStr.match(/(\{[\s\S]*\})/);
      if (m) jsonStr = m[1].trim();

      const judgeResult = JudgeSchema.parse(JSON.parse(jsonStr));
      const s: ScoredResult = { ...result, judge: judgeResult };
      scored.push(s);
      fs.writeFileSync(resultPath, JSON.stringify(s, null, 2));

      const stars = '★'.repeat(Math.round(judgeResult.overall_score / 2)) +
                    '☆'.repeat(5 - Math.round(judgeResult.overall_score / 2));
      console.log(
        `  ${stars} ${result.provider}:${result.model}` +
        ` → overall: ${judgeResult.overall_score}/10` +
        ` | story: ${judgeResult.narrative_quality}/5` +
        ` | facts: ${judgeResult.factual_grounding}/5` +
        ` | tools: ${tu.tool_score}/5`
      );
    } catch (err) {
      const judgeError = err instanceof Error ? err.message : String(err);
      console.log(`  ⚠️  ${result.provider}:${result.model} → judge error: ${judgeError.slice(0, 60)}`);
      const s: ScoredResult = { ...result, judge: null, judgeError };
      scored.push(s);
      fs.writeFileSync(resultPath, JSON.stringify(s, null, 2));
    }

    await delay(500);
  }

  // ── Step 3: Print final rankings ───────────────────────────────────────────

  const ok = scored.filter(s => s.judge !== null) as JudgedScoredResult[];

  const byQuality = [...ok].sort((a, b) =>
    totalPoints(b) - totalPoints(a) ||
    b.toolUsage.tool_score - a.toolUsage.tool_score ||
    a.durationMs - b.durationMs ||
    a.cost - b.cost
  );

  const byCloudValue = [...ok]
    .filter(hasMeteredCost)
    .sort((a, b) =>
      (pointsPerDollar(b) ?? -Infinity) - (pointsPerDollar(a) ?? -Infinity) ||
      totalPoints(b) - totalPoints(a) ||
      a.durationMs - b.durationMs ||
      a.cost - b.cost
    );

  const byFastHighQuality = [...ok]
    .filter(s => s.toolUsage.tool_score === 5 && s.judge.overall_score >= 9)
    .sort((a, b) =>
      a.durationMs - b.durationMs ||
      totalPoints(b) - totalPoints(a) ||
      a.cost - b.cost
    );

  const perfect = byQuality.filter(s => totalPoints(s) === 15);
  const mw = Math.max(48, ...byQuality.map(s => `${s.provider}:${s.model}`.length + 2));

  console.log(`\n📁 Results written to ${resultsDir}/`);
  console.log('\n🏁 FINAL RANKINGS  (sorted by quality, then speed, then cost)');
  console.log('═'.repeat(165));
  console.log(
    `${'Model'.padEnd(mw)} ${'Total'.padEnd(7)} ${'LLM'.padEnd(6)} ${'Tools'.padEnd(7)} ${'Cost'.padEnd(9)} ${'Time'.padEnd(8)} ${'pts/$'.padEnd(8)} ${'pts/s'.padEnd(8)} ${'Story'.padEnd(7)} ${'Facts'.padEnd(7)} ${'Feb?'.padEnd(6)} ${'Drives start'.padEnd(14)} Explanation`
  );
  console.log('─'.repeat(165));

  for (const s of byQuality) {
    const label    = `${s.provider}:${s.model}`;
    const total    = `${totalPoints(s)}/15`;
    const llm      = `${s.judge.overall_score}/10`;
    const tools    = `${s.toolUsage.tool_score}/5`;
    const cost     = formatCost(s);
    const ppd      = formatMaybe(pointsPerDollar(s));
    const pps      = pointsPerSecond(s).toFixed(2);
    const story    = `${s.judge.narrative_quality}/5`;
    const facts    = `${s.judge.factual_grounding}/5`;
    const feb      = s.judge.covers_full_date_range ? '✅' : '❌';
    const dStart   = s.toolUsage.drives_start_date ?? '—';
    const timeStr  = s.durationMs > 0 ? `${(s.durationMs / 1000).toFixed(1)}s` : '-';
    const explain  = s.judge.explanation.slice(0, 45);

    console.log(
      `${label.padEnd(mw)} ${total.padEnd(7)} ${llm.padEnd(6)} ${tools.padEnd(7)} ${cost.padEnd(9)} ${timeStr.padEnd(8)} ${ppd.padEnd(8)} ${pps.padEnd(8)} ${story.padEnd(7)} ${facts.padEnd(7)} ${feb.padEnd(6)} ${dStart.padEnd(14)} ${explain}`
    );
  }

  const errors = scored.filter(s => s.judge === null);
  if (errors.length) {
    console.log('─'.repeat(165));
    for (const s of errors) {
      console.log(`❌ ${s.provider}:${s.model} — ${(s.judgeError || s.error || '?').slice(0, 80)}`);
    }
  }

  if (byCloudValue.length) {
    console.log('\n💸 BEST CLOUD VALUE  (highest points per dollar)');
    console.log('─'.repeat(120));
    for (const s of byCloudValue.slice(0, 8)) {
      console.log(
        `${`${s.provider}:${s.model}`.padEnd(mw)} ` +
        `${`${totalPoints(s)}/15`.padEnd(7)} ` +
        `${formatCost(s).padEnd(9)} ` +
        `${`${durationSeconds(s).toFixed(1)}s`.padEnd(8)} ` +
        `${formatMaybe(pointsPerDollar(s)).padEnd(8)} pts/$ ` +
        `${s.judge.explanation.slice(0, 45)}`
      );
    }
  }

  if (byFastHighQuality.length) {
    console.log('\n⚡ FASTEST HIGH-QUALITY  (tool score 5/5 and LLM ≥ 9/10)');
    console.log('─'.repeat(120));
    for (const s of byFastHighQuality.slice(0, 8)) {
      console.log(
        `${`${s.provider}:${s.model}`.padEnd(mw)} ` +
        `${`${totalPoints(s)}/15`.padEnd(7)} ` +
        `${`${durationSeconds(s).toFixed(1)}s`.padEnd(8)} ` +
        `${formatCost(s).padEnd(9)} ` +
        `${formatMaybe(pointsPerDollar(s)).padEnd(8)} pts/$ ` +
        `${s.judge.explanation.slice(0, 45)}`
      );
    }
  }

  // Summary
  const totalCost       = scored.reduce((sum, s) => sum + s.cost, 0);
  const correctDates    = ok.filter(s => s.toolUsage.dates_cover_feb27).length;
  const passedDriveDate = ok.filter(s => s.toolUsage.drives_has_date_range).length;
  const withNarrative   = ok.filter(s => s.judge.has_trip_narrative).length;
  const avgTool         = ok.length ? (ok.reduce((s, r) => s + r.toolUsage.tool_score, 0) / ok.length).toFixed(1) : 'N/A';
  const avgStory        = ok.length ? (ok.reduce((s, r) => s + r.judge.narrative_quality, 0) / ok.length).toFixed(1) : 'N/A';

  console.log('─'.repeat(165));
  console.log(`\n📊 Summary: ${ok.length}/${scored.length} evaluated`);
  console.log(`   🔧 Passed start_date to get_drives:   ${passedDriveDate}/${ok.length}`);
  console.log(`   📅 start_date covered Feb 27:          ${correctDates}/${ok.length}`);
  console.log(`   📖 Had a trip narrative:               ${withNarrative}/${ok.length}`);
  console.log(`   🔢 Avg tool score:                     ${avgTool}/5`);
  console.log(`   ✍️  Avg narrative quality:              ${avgStory}/5`);
  console.log(`   💰 Total cost:                         $${totalCost.toFixed(5)}`);

  if (ok.length > 0) {
    const bestTotal = byQuality[0];
    const bestTool  = [...ok].sort((a, b) => b.toolUsage.tool_score - a.toolUsage.tool_score || a.durationMs - b.durationMs)[0];
    const bestStory = [...ok].sort((a, b) => b.judge.narrative_quality - a.judge.narrative_quality || a.durationMs - b.durationMs)[0];
    const fastestPerfect = [...perfect].sort((a, b) => a.durationMs - b.durationMs || a.cost - b.cost)[0];
    const cheapestPerfect = perfect.filter(hasMeteredCost).sort((a, b) => a.cost - b.cost || a.durationMs - b.durationMs)[0];
    const bestValue = byCloudValue[0];
    console.log(`\n🥇 Best overall:   ${bestTotal.provider}:${bestTotal.model}  (${totalPoints(bestTotal)}/15, ${durationSeconds(bestTotal).toFixed(1)}s, ${formatCost(bestTotal)})`);
    console.log(`🔧 Best tool use:  ${bestTool.provider}:${bestTool.model}  (${bestTool.toolUsage.tool_score}/5)  — drives start: ${bestTool.toolUsage.drives_start_date ?? 'none'}`);
    console.log(`🏆 Best narrative: ${bestStory.provider}:${bestStory.model}  (${bestStory.judge.narrative_quality}/5)`);
    if (fastestPerfect) {
      console.log(`⚡ Fastest perfect: ${fastestPerfect.provider}:${fastestPerfect.model}  (${durationSeconds(fastestPerfect).toFixed(1)}s, ${formatCost(fastestPerfect)})`);
    }
    if (cheapestPerfect) {
      console.log(`💵 Cheapest perfect cloud: ${cheapestPerfect.provider}:${cheapestPerfect.model}  (${formatCost(cheapestPerfect)}, ${durationSeconds(cheapestPerfect).toFixed(1)}s)`);
    }
    if (bestValue) {
      console.log(`📈 Best cloud value: ${bestValue.provider}:${bestValue.model}  (${formatMaybe(pointsPerDollar(bestValue))} pts/$, ${formatCost(bestValue)}, ${durationSeconds(bestValue).toFixed(1)}s)`);
    }
  }

  console.log(`\n📄 Self-contained report: pnpm run report-rivian -- --run ${runNumber}`);

  console.log('\n🎉 Rivian eval complete!');
  await tezlab.disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
