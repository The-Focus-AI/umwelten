#!/usr/bin/env node
/**
 * Local-Providers Tool-Math
 *
 * Multi-step arithmetic tasks that require calling the calculator + statistics
 * tools. Deterministic scoring based on (a) correct final answer and
 * (b) evidence of tool use (did the model actually call tools?).
 *
 * This is the minimum viable tool-calling benchmark — if a model can't
 * chain calculator calls reliably, it won't handle MCP or file tools.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/tool-math.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/tool-math.ts --frontier --new
 */

import '../../model-showdown/shared/env.js';
import fs from 'fs';
import path from 'path';
import type { CoreMessage } from 'ai';
import { Interaction } from '../../../src/interaction/core/interaction.js';
import { Stimulus } from '../../../src/stimulus/stimulus.js';
import { clearAllRateLimitStates } from '../../../src/rate-limit/rate-limit.js';
import { calculatorTool, statisticsTool } from '../../../src/stimulus/tools/examples/math.js';
import type { ModelDetails } from '../../../src/cognition/types.js';
import { LOCAL_MODELS, ALL_MODELS, includeFrontier, modelLabel, modelKey } from '../shared/models.js';

// ── Tasks ────────────────────────────────────────────────────────────────────
//
// Each task has a deterministic numeric answer. The model MUST use tools —
// we check both correctness and tool-call count.

interface MathTask {
  id: string;
  name: string;
  prompt: string;
  /** Expected final answer (absolute or within tolerance) */
  expected: number;
  tolerance: number;
  /** Minimum number of tool calls expected (heuristic) */
  minToolCalls: number;
}

const TASKS: MathTask[] = [
  {
    id: 'compound-interest',
    name: 'Compound interest',
    prompt: 'If I invest $1000 at 7% annual compound interest for 5 years, what is the final amount? Use the calculator tool for every step. Show the final answer as a single number with two decimal places.',
    expected: 1402.55, // 1000 * 1.07^5
    tolerance: 1.0,
    minToolCalls: 4,
  },
  {
    id: 'grocery-total',
    name: 'Multi-item grocery total',
    prompt: `Compute the total cost of: 3 apples at $1.25 each, 2 loaves of bread at $3.50 each, 4 bottles of water at $0.75 each, and 1 cake at $12.99. Add 8% sales tax. Use the calculator tool. Give the final total as a single number.`,
    expected: 27.56, // (3.75 + 7 + 3 + 12.99) * 1.08 = 26.74 * 1.08 = 28.87... wait let me recompute
    tolerance: 0.05,
    minToolCalls: 3,
  },
  {
    id: 'statistics-mixed',
    name: 'Stats + arithmetic',
    prompt: 'Given the numbers [4, 8, 15, 16, 23, 42], compute the mean and the standard deviation using the statistics tool. Then compute (mean + standard deviation) using the calculator. Return only the final number, rounded to 2 decimal places.',
    expected: 30.32, // mean=18, sd≈12.32 → 30.32
    tolerance: 0.5,
    minToolCalls: 2,
  },
  {
    id: 'distance-rate-time',
    name: 'Distance/rate/time',
    prompt: 'A car travels at 65 mph for 2.5 hours, then at 55 mph for 1.75 hours. Using the calculator tool for each step, find the total distance traveled. Return only the final number.',
    expected: 258.75, // 162.5 + 96.25
    tolerance: 0.5,
    minToolCalls: 3,
  },
  {
    id: 'percent-discount',
    name: 'Chained percent discount',
    prompt: 'A laptop originally costs $1200. Apply a 20% holiday discount, then apply a 15% loyalty-program discount on the already-discounted price, then add 6% sales tax. Use the calculator tool for every step. Return only the final price.',
    expected: 864.96, // 1200*0.8=960; 960*0.85=816; 816*1.06=864.96
    tolerance: 0.5,
    minToolCalls: 4,
  },
];

// Pre-compute correct answer for grocery-total to fix my tolerance
// 3*1.25=3.75, 2*3.50=7, 4*0.75=3, +12.99 = 26.74, *1.08 = 28.8792
TASKS[1].expected = 28.88;

// ── Scoring ──────────────────────────────────────────────────────────────────

interface ToolCall { name: string; args: Record<string, any> }

function extractToolCalls(messages: CoreMessage[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant' || typeof msg.content === 'string') continue;
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as any[]) {
      if (part.type === 'tool-call') {
        calls.push({ name: part.toolName, args: (part.args ?? part.input) as any });
      }
    }
  }
  return calls;
}

function extractFinalNumber(response: string): number | null {
  // Prefer the last number in the response
  const matches = response.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  return parseFloat(matches[matches.length - 1]);
}

function scoreTask(task: MathTask, response: string, toolCalls: ToolCall[]): { score: number; details: string } {
  const final = extractFinalNumber(response);
  const calls = toolCalls.length;

  const correctnessPoints = (() => {
    if (final === null) return 0;
    const diff = Math.abs(final - task.expected);
    if (diff <= task.tolerance) return 3; // exact
    if (diff <= task.tolerance * 5) return 1; // close
    return 0;
  })();

  const toolUsePoints = (() => {
    if (calls >= task.minToolCalls) return 2;
    if (calls >= 1) return 1;
    return 0;
  })();

  const total = correctnessPoints + toolUsePoints;
  return {
    score: total,
    details: `answer=${final ?? 'n/a'} (expected ${task.expected}), calls=${calls} (min ${task.minToolCalls})`,
  };
}

// ── Run ──────────────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'evaluations', 'local-providers-tool-math');
const forceNew = process.argv.includes('--new');

function resultPath(runId: string, taskId: string, model: ModelDetails): string {
  return path.join(OUTPUT_DIR, 'runs', runId, taskId, `${modelKey(model)}.json`);
}

function nextRunId(): string {
  const baseDir = path.join(OUTPUT_DIR, 'runs');
  fs.mkdirSync(baseDir, { recursive: true });
  const existing = fs.readdirSync(baseDir).filter(d => /^\d+$/.test(d)).map(Number).sort((a, b) => a - b);
  const latest = existing.length > 0 ? existing[existing.length - 1] : 1;
  const n = forceNew ? latest + 1 : latest;
  return String(n).padStart(3, '0');
}

async function runOne(model: ModelDetails, task: MathTask) {
  const stimulus = new Stimulus({
    role: 'careful mathematician',
    objective: 'compute the answer using the provided tools',
    instructions: [
      'You MUST use the provided tools for arithmetic — do not compute in your head.',
      'Call tools step by step until you have the answer.',
      'Return the final answer as a single number.',
    ],
    temperature: 0.0,
    maxTokens: 2000,
    maxToolSteps: 12,
    runnerType: 'base',
  });
  stimulus.setTools({
    calculator: calculatorTool,
    statistics: statisticsTool,
  });

  const interaction = new Interaction(model, stimulus);
  interaction.addMessage({ role: 'user', content: task.prompt });

  const start = Date.now();
  const response = await interaction.generateText();
  const durationMs = Date.now() - start;
  const text = response?.content ?? '';
  const toolCalls = extractToolCalls(interaction.getMessages());
  return { text, toolCalls, durationMs };
}

async function main() {
  const models = includeFrontier() ? ALL_MODELS : LOCAL_MODELS;
  const runId = nextRunId();

  console.log('🔧 Local-Providers Tool-Math');
  console.log('═'.repeat(70));
  console.log(`Tasks:   ${TASKS.length}`);
  console.log(`Models:  ${models.length}`);
  console.log(`Max:     ${TASKS.length * 5} per model (3 correctness + 2 tool-use per task)`);
  console.log(`Run:     #${runId}`);
  console.log('═'.repeat(70));
  console.log();

  const allResults: any[] = [];

  for (const task of TASKS) {
    console.log(`\n🧮 ${task.name}`);
    for (const model of models) {
      const fp = resultPath(runId, task.id, model);
      if (!forceNew && fs.existsSync(fp)) {
        const cached = JSON.parse(fs.readFileSync(fp, 'utf8'));
        allResults.push(cached);
        console.log(`   ✓ ${modelLabel(model)} → ${cached.score}/5 (cached)`);
        continue;
      }
      try {
        process.stdout.write(`   🔄 ${modelLabel(model)}...`);
        const { text, toolCalls, durationMs } = await runOne(model, task);
        const scored = scoreTask(task, text, toolCalls);
        const r = {
          taskId: task.id,
          model: model.name,
          provider: model.provider,
          score: scored.score,
          maxScore: 5,
          details: scored.details,
          toolCalls: toolCalls.length,
          toolNames: toolCalls.map(c => c.name),
          durationMs,
          response: text.slice(0, 500),
        };
        allResults.push(r);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, JSON.stringify(r, null, 2));
        const icon = r.score >= 4 ? '✅' : r.score >= 2 ? '⚠️' : '❌';
        console.log(` ${icon} ${r.score}/5  ${r.details}`);
      } catch (err: any) {
        const r = {
          taskId: task.id, model: model.name, provider: model.provider,
          score: 0, maxScore: 5, details: `error: ${err.message}`, toolCalls: 0, toolNames: [],
          durationMs: 0, response: '', error: err.message,
        };
        allResults.push(r);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, JSON.stringify(r, null, 2));
        console.log(` ❌ ${err.message.slice(0, 80)}`);
      }
      clearAllRateLimitStates();
    }
  }

  // ── Aggregate ─────────────────────────────────────────────────────────────

  const byModel = new Map<string, { total: number; max: number; calls: number; time: number }>();
  for (const r of allResults) {
    const key = `${r.provider}:${r.model}`;
    const e = byModel.get(key) ?? { total: 0, max: 0, calls: 0, time: 0 };
    e.total += r.score;
    e.max += r.maxScore;
    e.calls += r.toolCalls;
    e.time += r.durationMs;
    byModel.set(key, e);
  }

  const ranked = [...byModel.entries()].sort((a, b) => b[1].total - a[1].total);
  console.log('\n\n🏁 TOOL-MATH RANKINGS');
  console.log('─'.repeat(80));
  console.log(`${'Model'.padEnd(50)} ${'Score'.padEnd(10)} ${'Calls'.padEnd(8)} ${'Time'.padEnd(8)}`);
  console.log('─'.repeat(80));
  for (const [label, e] of ranked) {
    const pct = Math.round((e.total / e.max) * 100);
    console.log(`${label.padEnd(50)} ${`${e.total}/${e.max} (${pct}%)`.padEnd(10)} ${String(e.calls).padEnd(8)} ${Math.round(e.time / 1000)}s`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
