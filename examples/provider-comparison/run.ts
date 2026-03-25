#!/usr/bin/env node
/**
 * Provider Comparison — Same Weights, Different Infrastructure
 *
 * Runs the same Nemotron models through every available provider to measure
 * how inference infrastructure affects model behavior.
 *
 * Tests:
 *   1. MCP tool use (via TezLab MCP server) — most sensitive to provider differences
 *   2. Instruction following (deterministic scoring, 6 tasks)
 *   3. A reasoning question (counterfeit coin)
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/provider-comparison/run.ts
 *   dotenvx run -- pnpm tsx examples/provider-comparison/run.ts --new    # force fresh
 */

import '../../examples/model-showdown/shared/env.js';
import fs from 'fs';
import path from 'path';
import type { CoreMessage } from 'ai';
import { Interaction } from '../../src/interaction/core/interaction.js';
import { Stimulus } from '../../src/stimulus/stimulus.js';
import { clearAllRateLimitStates } from '../../src/rate-limit/rate-limit.js';
import type { ModelDetails } from '../../src/cognition/types.js';
import { createMCPChatRuntime } from '../mcp-chat/habitat.js';

// ── Models to compare ────────────────────────────────────────────────────────

interface ProviderModel {
  label: string;
  model: ModelDetails;
}

const MODELS: ProviderModel[] = [
  // Nemotron Nano 30B — 3+ providers
  { label: 'Nano-30B / OpenRouter', model: { name: 'nvidia/nemotron-3-nano-30b-a3b:free', provider: 'openrouter' } },
  { label: 'Nano-30B / DeepInfra',  model: { name: 'nvidia/Nemotron-3-Nano-30B-A3B', provider: 'deepinfra' } },
  { label: 'Nano-30B / Ollama',     model: { name: 'nemotron-3-nano:latest', provider: 'ollama' } },
  { label: 'Nano-30B / NVIDIA NIM', model: { name: 'nvidia/nemotron-3-nano-30b-a3b', provider: 'nvidia' } },

  // Nemotron Super 120B — 3 providers
  { label: 'Super-120B / OpenRouter', model: { name: 'nvidia/nemotron-3-super-120b-a12b:free', provider: 'openrouter' } },
  { label: 'Super-120B / DeepInfra',  model: { name: 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B', provider: 'deepinfra' } },
  { label: 'Super-120B / NVIDIA NIM', model: { name: 'nvidia/nemotron-3-super-120b-a12b', provider: 'nvidia' } },

  // Nemotron Nano 9B — 3 providers
  { label: 'Nano-9B / OpenRouter', model: { name: 'nvidia/nemotron-nano-9b-v2:free', provider: 'openrouter' } },
  { label: 'Nano-9B / DeepInfra',  model: { name: 'nvidia/NVIDIA-Nemotron-Nano-9B-v2', provider: 'deepinfra' } },
  { label: 'Nano-9B / NVIDIA NIM', model: { name: 'nvidia/nvidia-nemotron-nano-9b-v2', provider: 'nvidia' } },
];

// ── Test prompts ─────────────────────────────────────────────────────────────

const TESTS = {
  mcp: {
    name: 'MCP Tool Use',
    prompt: `Analyze my vehicle's battery health and charging patterns. First identify my vehicle, then get the battery health data. Look at my recent charging history and efficiency stats. Are there any patterns in how my charging behavior might affect battery health? Also check what chargers I typically use and whether there are better public charger alternatives nearby. Give me a concise analysis with specific numbers from the data.`,
    requiresMCP: true,
  },
  instruction: {
    name: 'Instruction Following',
    tasks: [
      {
        id: 'word-count',
        prompt: 'Write a 12-word sentence about the ocean. Nothing else.',
        score: (response: string) => {
          const words = response.trim().split(/\s+/).filter(w => w.length > 0);
          return words.length === 12 ? 5 : 0;
        },
        maxScore: 5,
      },
      {
        id: 'json-output',
        prompt: 'Output a JSON object with keys "name" (string), "age" (number between 25-35), and "skills" (array of 3 strings). No markdown fences. No explanation. Just the raw JSON.',
        score: (response: string) => {
          let s = 0;
          const cleaned = response.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
          try {
            const obj = JSON.parse(cleaned);
            if (typeof obj.name === 'string') s++;
            if (typeof obj.age === 'number' && obj.age >= 25 && obj.age <= 35) s++;
            if (Array.isArray(obj.skills) && obj.skills.length === 3) s++;
            if (!response.includes('```')) s += 2; // No fences bonus
          } catch {}
          return s;
        },
        maxScore: 5,
      },
      {
        id: 'constrained-list',
        prompt: 'List 5 animals, numbered 1-5, max 8 characters each, in alphabetical order. No extra text.',
        score: (response: string) => {
          let s = 0;
          const lines = response.trim().split('\n').map(l => l.trim()).filter(l => l);
          if (lines.length === 5) s++;
          const animals = lines.map(l => l.replace(/^\d+[\.\)]\s*/, '').trim());
          if (animals.every(a => a.length <= 8)) s++;
          const sorted = [...animals].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
          if (JSON.stringify(animals.map(a => a.toLowerCase())) === JSON.stringify(sorted.map(a => a.toLowerCase()))) s++;
          // Numbered check
          if (lines.every((l, i) => l.startsWith(`${i + 1}`))) s++;
          // No extra text
          if (lines.length <= 6) s++;
          return s;
        },
        maxScore: 5,
      },
    ],
    requiresMCP: false,
  },
  reasoning: {
    name: 'Reasoning (Counterfeit Coin)',
    prompt: `You have 12 coins. One is counterfeit and may be heavier or lighter than the others. You have a balance scale and can use it exactly 3 times. Describe a strategy that guarantees finding the counterfeit coin AND determining whether it is heavier or lighter in all cases. Be precise about which coins go on each side for each weighing, and cover all possible outcomes.`,
    requiresMCP: false,
  },
};

// ── Output directory ─────────────────────────────────────────────────────────

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'provider-comparison');
const forceNew = process.argv.includes('--new');

function resultPath(label: string, test: string): string {
  const key = label.replace(/[\/\s]+/g, '-').toLowerCase();
  return path.join(OUTPUT_DIR, test, `${key}.json`);
}

// ── MCP Tool scoring ─────────────────────────────────────────────────────────

interface ToolCall { name: string; args: Record<string, any> }

function extractToolCalls(messages: CoreMessage[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant' || typeof msg.content === 'string') continue;
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === 'tool-call') {
        calls.push({ name: part.toolName, args: part.args as Record<string, any> });
      }
    }
  }
  return calls;
}

function scoreMCPToolUse(calls: ToolCall[]) {
  const names = new Set(calls.map(c => c.name));
  const checks = {
    list_vehicles: names.has('list_vehicles'),
    get_battery_health: names.has('get_battery_health'),
    get_charges_or_report: names.has('get_charges') || names.has('get_charges_brief') || names.has('get_charge_report'),
    get_efficiency: names.has('get_efficiency'),
    get_my_chargers: names.has('get_my_chargers'),
    search_or_find_chargers: names.has('search_public_chargers') || names.has('find_nearby_chargers'),
  };
  const score = Object.values(checks).filter(Boolean).length;
  return { checks, score, maxScore: 6, calls };
}

// ── Run a single test ────────────────────────────────────────────────────────

async function runTest(
  pm: ProviderModel,
  testName: string,
  prompt: string,
  stimulus: Stimulus,
  useMCP: boolean,
): Promise<any> {
  const fp = resultPath(pm.label, testName);
  if (fs.existsSync(fp) && !forceNew) {
    const cached = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!cached.error) return cached;
  }

  const start = Date.now();
  try {
    const interaction = new Interaction(pm.model, stimulus);
    interaction.addMessage({ role: 'user', content: prompt });

    const response = await interaction.generateText();

    const text = response?.content ?? '';
    const toolCalls = useMCP ? extractToolCalls(interaction.getMessages()) : [];
    const mcpScore = useMCP ? scoreMCPToolUse(toolCalls) : null;
    const durationMs = Date.now() - start;

    const result = {
      label: pm.label,
      model: pm.model.name,
      provider: pm.model.provider,
      response: text,
      durationMs,
      cost: response?.cost ?? 0,
      tokens: response?.usage ?? null,
      ...(mcpScore ? { toolUsage: mcpScore } : {}),
    };

    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(result, null, 2));
    return result;
  } catch (err: any) {
    const result = {
      label: pm.label,
      model: pm.model.name,
      provider: pm.model.provider,
      error: err.message || String(err),
      durationMs: Date.now() - start,
    };
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(result, null, 2));
    return result;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔬 Provider Comparison — Same Weights, Different Infrastructure');
  console.log('═'.repeat(70));
  console.log(`Models:  ${MODELS.length}`);
  console.log(`Output:  ${OUTPUT_DIR}`);
  console.log('═'.repeat(70));
  console.log();

  // Filter out models whose providers don't have API keys
  const available: ProviderModel[] = [];
  for (const pm of MODELS) {
    const envMap: Record<string, string> = {
      openrouter: 'OPENROUTER_API_KEY',
      deepinfra: 'DEEPINFRA_API_KEY',
      nvidia: 'NVIDIA_API_KEY',
      ollama: '', // always available
    };
    const envKey = envMap[pm.model.provider];
    if (envKey === undefined) { continue; }
    if (envKey && !process.env[envKey]) {
      console.log(`  ⏭️  ${pm.label} — skipped (no ${envKey})`);
      continue;
    }
    available.push(pm);
  }
  console.log(`\nAvailable: ${available.length} model/provider combos\n`);

  // ── MCP Test ─────────────────────────────────────────────────────────────

  console.log('━━━ Test 1: MCP Tool Use ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Connecting to TezLab MCP server...');

  let mcpStimulus: Stimulus | null = null;
  try {
    const { habitat, tezlab } = await createMCPChatRuntime();
    mcpStimulus = await habitat.getStimulus();
    mcpStimulus.options.maxToolSteps = 20;
    console.log(`Connected — ${tezlab.getToolNames().length} tools available\n`);
  } catch (err: any) {
    console.log(`⚠️  MCP not available: ${err.message}\n`);
  }

  if (mcpStimulus) {
    for (const pm of available) {
      process.stdout.write(`  🔄 ${pm.label}...`);
      const result = await runTest(pm, 'mcp', TESTS.mcp.prompt, mcpStimulus, true);
      if (result.error) {
        console.log(` ❌ ${result.error.slice(0, 60)}`);
      } else {
        console.log(` ✅ tools=${result.toolUsage.score}/6, ${result.toolUsage.calls.length} calls, ${Math.round(result.durationMs / 1000)}s`);
      }
      clearAllRateLimitStates();
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ── Instruction Following ────────────────────────────────────────────────

  console.log('\n━━━ Test 2: Instruction Following ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const plainStimulus = new Stimulus({
    role: 'You are a helpful assistant. Follow instructions precisely.',
  });

  for (const pm of available) {
    let totalScore = 0;
    let totalMax = 0;
    const taskResults: any[] = [];

    for (const task of TESTS.instruction.tasks) {
      process.stdout.write(`  🔄 ${pm.label} / ${task.id}...`);
      const result = await runTest(pm, `instruction-${task.id}`, task.prompt, plainStimulus, false);
      if (result.error) {
        console.log(` ❌ ${result.error.slice(0, 60)}`);
        taskResults.push({ id: task.id, score: 0, max: task.maxScore, error: result.error });
      } else {
        const score = task.score(result.response);
        totalScore += score;
        totalMax += task.maxScore;
        console.log(` ${score}/${task.maxScore}`);
        taskResults.push({ id: task.id, score, max: task.maxScore, response: result.response.slice(0, 200) });
      }
      clearAllRateLimitStates();
      await new Promise(r => setTimeout(r, 1000));
    }

    // Save combined instruction result
    const fp = resultPath(pm.label, 'instruction-combined');
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify({
      label: pm.label,
      model: pm.model.name,
      provider: pm.model.provider,
      totalScore,
      totalMax,
      tasks: taskResults,
    }, null, 2));

    console.log(`  📊 ${pm.label}: ${totalScore}/${totalMax}\n`);
  }

  // ── Reasoning ────────────────────────────────────────────────────────────

  console.log('━━━ Test 3: Reasoning (Counterfeit Coin) ━━━━━━━━━━━━━━━━━━━━━━');

  for (const pm of available) {
    process.stdout.write(`  🔄 ${pm.label}...`);
    const result = await runTest(pm, 'reasoning', TESTS.reasoning.prompt, plainStimulus, false);
    if (result.error) {
      console.log(` ❌ ${result.error.slice(0, 60)}`);
    } else {
      console.log(` ✅ ${result.response.length} chars, ${Math.round(result.durationMs / 1000)}s`);
    }
    clearAllRateLimitStates();
    await new Promise(r => setTimeout(r, 2000));
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n\n═══════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Group by model weight
  const groups = new Map<string, ProviderModel[]>();
  for (const pm of available) {
    const weight = pm.label.split(' / ')[0];
    if (!groups.has(weight)) groups.set(weight, []);
    groups.get(weight)!.push(pm);
  }

  for (const [weight, pms] of groups) {
    console.log(`\n  ${weight}:`);
    console.log(`  ${'Provider'.padEnd(15)} ${'MCP'.padEnd(10)} ${'Instr'.padEnd(10)} ${'Time'.padEnd(8)}`);
    console.log(`  ${'─'.repeat(15)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(8)}`);

    for (const pm of pms) {
      const provider = pm.label.split(' / ')[1];

      // MCP
      const mcpFp = resultPath(pm.label, 'mcp');
      let mcpStr = '—';
      if (fs.existsSync(mcpFp)) {
        const mcp = JSON.parse(fs.readFileSync(mcpFp, 'utf8'));
        mcpStr = mcp.error ? 'ERR' : `${mcp.toolUsage.score}/6 (${mcp.toolUsage.calls.length} calls)`;
      }

      // Instruction
      const instrFp = resultPath(pm.label, 'instruction-combined');
      let instrStr = '—';
      if (fs.existsSync(instrFp)) {
        const instr = JSON.parse(fs.readFileSync(instrFp, 'utf8'));
        instrStr = `${instr.totalScore}/${instr.totalMax}`;
      }

      // Reasoning time
      const reasonFp = resultPath(pm.label, 'reasoning');
      let timeStr = '—';
      if (fs.existsSync(reasonFp)) {
        const r = JSON.parse(fs.readFileSync(reasonFp, 'utf8'));
        timeStr = r.error ? 'ERR' : `${Math.round(r.durationMs / 1000)}s`;
      }

      console.log(`  ${provider.padEnd(15)} ${mcpStr.padEnd(10)} ${instrStr.padEnd(10)} ${timeStr.padEnd(8)}`);
    }
  }

  console.log('\n\nResults saved to:', OUTPUT_DIR);
}

main().catch(console.error);
