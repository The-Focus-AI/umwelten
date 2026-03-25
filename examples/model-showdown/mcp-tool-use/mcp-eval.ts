#!/usr/bin/env node
/**
 * MCP Tool-Use Eval — Battery Health & Charging Analysis
 *
 * Tests models' ability to orchestrate multiple TezLab MCP tools to
 * analyze battery health, charging patterns, and find charger alternatives.
 *
 * Scoring: deterministic tool-use (0-6) + LLM judge quality (1-10) = total /16
 *
 * Usage:
 *   cd examples/model-showdown
 *   pnpm tsx mcp-tool-use/mcp-eval.ts              # quick (3 models)
 *   pnpm tsx mcp-tool-use/mcp-eval.ts --all         # full showdown
 *   pnpm tsx mcp-tool-use/mcp-eval.ts --all --new   # fresh run
 */

import '../shared/env.js';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { CoreMessage } from 'ai';
import { Interaction } from '../../../src/interaction/core/interaction.js';
import { clearAllRateLimitStates } from '../../../src/rate-limit/rate-limit.js';
import type { ModelDetails } from '../../../src/cognition/types.js';
import { SHOWDOWN_MODELS, LOCAL_TEST_MODELS, modelLabel, modelKey } from '../shared/models.js';
import { resolveRun, isFullRun, delay } from '../shared/runner-utils.js';
import { JUDGE_MODEL, judgeResponse } from '../shared/judge.js';
import { createMCPChatRuntime } from '../../mcp-chat/habitat.js';

// ── Prompt ───────────────────────────────────────────────────────────────────

const PROMPT =
  `Analyze my vehicle's battery health and charging patterns. ` +
  `First identify my vehicle, then get the battery health data. ` +
  `Look at my recent charging history and efficiency stats. ` +
  `Are there any patterns in how my charging behavior might affect battery health? ` +
  `Also check what chargers I typically use and whether there are better public charger alternatives nearby. ` +
  `Give me a concise analysis with specific numbers from the data.`;

// ── Tool call scoring ────────────────────────────────────────────────────────

interface ToolCall {
  name: string;
  args: Record<string, any>;
}

interface ToolUsage {
  calls: ToolCall[];
  called_list_vehicles: boolean;
  called_get_battery_health: boolean;
  called_get_charges_or_report: boolean;
  called_get_efficiency: boolean;
  called_get_my_chargers: boolean;
  called_search_or_find_chargers: boolean;
  tool_score: number;
  tool_score_breakdown: string;
}

function extractToolCalls(messages: CoreMessage[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    for (const part of msg.content as any[]) {
      if (part.type === 'tool-call') {
        calls.push({ name: part.toolName, args: part.input ?? part.args ?? {} });
      }
    }
  }
  return calls;
}

function scoreToolUsage(calls: ToolCall[]): ToolUsage {
  const names = calls.map(c => c.name);
  const called_list_vehicles = names.includes('list_vehicles');
  const called_get_battery_health = names.includes('get_battery_health');
  const called_get_charges_or_report = names.includes('get_charges') || names.includes('get_charges_brief') || names.includes('get_charge_report');
  const called_get_efficiency = names.includes('get_efficiency');
  const called_get_my_chargers = names.includes('get_my_chargers');
  const called_search_or_find_chargers = names.includes('search_public_chargers') || names.includes('find_nearby_chargers');

  const checks = [
    [called_list_vehicles, 'list_vehicles'],
    [called_get_battery_health, 'get_battery_health'],
    [called_get_charges_or_report, 'get_charges/report'],
    [called_get_efficiency, 'get_efficiency'],
    [called_get_my_chargers, 'get_my_chargers'],
    [called_search_or_find_chargers, 'search/find chargers'],
  ] as [boolean, string][];

  const passed = checks.filter(([ok]) => ok);
  const failed = checks.filter(([ok]) => !ok);
  const tool_score = passed.length;
  const tool_score_breakdown =
    (passed.length ? `✅ ${passed.map(([, l]) => l).join(', ')}` : '') +
    (failed.length ? `  ❌ ${failed.map(([, l]) => l).join(', ')}` : '');

  return {
    calls,
    called_list_vehicles,
    called_get_battery_health,
    called_get_charges_or_report,
    called_get_efficiency,
    called_get_my_chargers,
    called_search_or_find_chargers,
    tool_score,
    tool_score_breakdown,
  };
}

// ── Judge schema ─────────────────────────────────────────────────────────────

const JudgeSchema = z.object({
  data_synthesis: z.number().min(1).max(5).describe(
    '1=no cross-referencing, 5=excellent synthesis of battery health + charging data'
  ),
  actionable_insights: z.number().min(1).max(5).describe(
    '1=no recommendations, 5=specific, data-backed recommendations'
  ),
  factual_grounding: z.number().min(1).max(5).describe(
    '1=vague/no numbers, 5=cites specific percentages, kWh, dates from tool results'
  ),
  overall_score: z.number().min(1).max(10),
  explanation: z.string(),
});

type JudgeResult = z.infer<typeof JudgeSchema>;

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const models = isFullRun() ? SHOWDOWN_MODELS : LOCAL_TEST_MODELS;
  const { runId, runDir, runNumber, isResume } = resolveRun('model-showdown-mcp');

  console.log('🔧 MCP Tool-Use Eval — Battery Health Analysis');
  console.log('═'.repeat(70));
  console.log(`Prompt:  "${PROMPT.slice(0, 70)}..."`);
  console.log(`Models:  ${models.length}`);
  console.log(`Run:     #${runId}${isResume ? ' (resuming)' : ''}`);
  console.log('═'.repeat(70));
  console.log();

  // ── Connect to MCP ────────────────────────────────────────────────────────

  console.log('🔌 Connecting to TezLab MCP server...');
  const { habitat, tezlab } = await createMCPChatRuntime();
  console.log(`   ✅ Connected — ${tezlab.getToolNames().length} tools available\n`);

  const stimulus = await habitat.getStimulus();
  stimulus.options.maxToolSteps = 20;

  const responsesDir = path.join(runDir, 'responses');
  fs.mkdirSync(responsesDir, { recursive: true });
  const forceNew = process.argv.includes('--new');

  // ── Step 1: Run each model ────────────────────────────────────────────────

  console.log('📡 Running evaluation (sequential — shared MCP connection)...\n');
  const modelResults: ModelResult[] = [];

  for (const modelDetails of models) {
    const label = modelLabel(modelDetails);
    const mk = modelKey(modelDetails);
    const responsePath = path.join(responsesDir, `${mk}.json`);

    if (fs.existsSync(responsePath) && !forceNew) {
      const cached = JSON.parse(fs.readFileSync(responsePath, 'utf8')) as ModelResult;
      if (!cached.error) {
        console.log(`  📁 ${label} (cached) tools: ${cached.toolUsage.tool_score}/6`);
        modelResults.push(cached);
        continue;
      }
      console.log(`  🔁 ${label} (retrying — previously errored)`);
      fs.unlinkSync(responsePath);
    }

    process.stdout.write(`  🔄 ${label}...`);
    const startTime = Date.now();

    try {
      const interaction = new Interaction(modelDetails, stimulus);
      interaction.addMessage({ role: 'user', content: PROMPT });

      const response = await interaction.generateText();
      const durationMs = Date.now() - startTime;

      const responseText = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      const allMessages = interaction.getMessages();
      const toolCalls = extractToolCalls(allMessages);
      const toolUsage = scoreToolUsage(toolCalls);

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

      console.log(
        ` ✅ ${(durationMs / 1000).toFixed(1)}s | tools: ${toolUsage.tool_score}/6` +
        ` | calls: ${toolCalls.map(c => c.name).join('→')}`
      );
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(` ❌ ${errorMsg.slice(0, 80)}`);
      const result: ModelResult = {
        model: modelDetails.name,
        provider: modelDetails.provider,
        responseText: '',
        durationMs,
        cost: 0,
        tokens: null,
        toolUsage: scoreToolUsage([]),
        error: errorMsg,
      };
      modelResults.push(result);
      fs.writeFileSync(responsePath, JSON.stringify(result, null, 2));
    }
  }

  console.log(`\n✅ Got ${modelResults.filter(r => !r.error).length}/${modelResults.length} responses\n`);

  // ── Step 2: LLM judge ─────────────────────────────────────────────────────

  clearAllRateLimitStates();
  console.log(`⚖️  Judging with ${modelLabel(JUDGE_MODEL)}...\n`);

  const judgeInstructions = [
    'You are assessing an AI response that analyzed vehicle battery health and charging patterns using real data from MCP tools.',
    `The user asked: "${PROMPT}"`,
    'A GOOD response: uses specific numbers from tools, cross-references battery health with charging behavior, recommends alternatives.',
    'A BAD response: vague, no numbers, doesn\'t synthesize across data sources.',
  ];

  const scored: ScoredResult[] = [];
  const resultsDir = path.join(runDir, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });

  for (const result of modelResults) {
    const mk = `${result.model.replace(/[\/:]/g, '-')}-${result.provider}`;
    const resultPath = path.join(resultsDir, `${mk}.json`);

    if (fs.existsSync(resultPath) && !forceNew) {
      const cached = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as ScoredResult;
      if (cached.judge !== null) {
        scored.push(cached);
        continue;
      }
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
        `Tool score: ${tu.tool_score}/6  (${tu.tool_score_breakdown})`;

      const content =
        `=== TOOL USAGE ===\n${toolSummary}\n\n` +
        `=== MODEL RESPONSE ===\n${result.responseText}`;

      const judgeResult = await judgeResponse(JUDGE_MODEL, judgeInstructions, content, JudgeSchema);
      const s: ScoredResult = { ...result, judge: judgeResult };
      scored.push(s);
      fs.writeFileSync(resultPath, JSON.stringify(s, null, 2));

      const total = tu.tool_score + judgeResult.overall_score;
      console.log(
        `  ${total >= 12 ? '★★★' : total >= 8 ? '★★☆' : '★☆☆'} ${result.provider}:${result.model}` +
        ` → total: ${total}/16 | tools: ${tu.tool_score}/6 | quality: ${judgeResult.overall_score}/10`
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

  // ── Step 3: Print rankings ────────────────────────────────────────────────

  const ok = scored.filter(s => s.judge !== null) as (ScoredResult & { judge: JudgeResult })[];
  const byTotal = [...ok].sort((a, b) =>
    (b.toolUsage.tool_score + b.judge.overall_score) - (a.toolUsage.tool_score + a.judge.overall_score) ||
    a.durationMs - b.durationMs
  );

  const mw = Math.max(50, ...byTotal.map(s => `${s.provider}:${s.model}`.length + 2));

  console.log('\n\n🏁 MCP TOOL-USE EVAL — FINAL RANKINGS');
  console.log('═'.repeat(140));
  console.log(
    `${'Model'.padEnd(mw)} ${'Total'.padEnd(8)} ${'Tools'.padEnd(8)} ${'Quality'.padEnd(9)} ${'Synth'.padEnd(7)} ${'Insights'.padEnd(10)} ${'Facts'.padEnd(7)} ${'Cost'.padEnd(10)} ${'Time'.padEnd(8)} Explanation`
  );
  console.log('─'.repeat(140));

  for (const s of byTotal) {
    const label = `${s.provider}:${s.model}`;
    const total = s.toolUsage.tool_score + s.judge.overall_score;
    console.log(
      `${label.padEnd(mw)} ${`${total}/16`.padEnd(8)} ${`${s.toolUsage.tool_score}/6`.padEnd(8)} ${`${s.judge.overall_score}/10`.padEnd(9)} ${`${s.judge.data_synthesis}/5`.padEnd(7)} ${`${s.judge.actionable_insights}/5`.padEnd(10)} ${`${s.judge.factual_grounding}/5`.padEnd(7)} ${`$${s.cost.toFixed(4)}`.padEnd(10)} ${`${(s.durationMs / 1000).toFixed(1)}s`.padEnd(8)} ${s.judge.explanation.slice(0, 40)}`
    );
  }

  const errors = scored.filter(s => s.judge === null);
  if (errors.length) {
    console.log('─'.repeat(140));
    for (const s of errors) {
      console.log(`❌ ${s.provider}:${s.model} — ${(s.judgeError || s.error || '?').slice(0, 80)}`);
    }
  }

  const totalCost = scored.reduce((s, r) => s + r.cost, 0);
  console.log(`\n💰 Total cost: $${totalCost.toFixed(4)}`);
  console.log(`📁 Results: ${runDir}`);
  console.log('\n🎉 MCP tool-use eval complete!');

  await tezlab.disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
