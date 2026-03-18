/**
 * Car Wash Test — Common-Sense Reasoning Evaluation
 *
 * Asks many models: "I want to wash my car. The car wash is 50 meters
 * away. Should I walk or drive?"
 *
 * Correct answer: DRIVE — you need the car at the car wash.
 *
 * Each run gets its own directory under output/evaluations/car-wash-test/runs/NNN/
 * with both responses/ and results/ so you can compare across runs.
 *
 * Usage:
 *   pnpm tsx scripts/examples/car-wash-test.ts          # local test (3 models), defaults to latest run
 *   pnpm tsx scripts/examples/car-wash-test.ts --all    # full suite, defaults to latest run (cached)
 *   pnpm tsx scripts/examples/car-wash-test.ts --all --new    # fresh run (new run number)
 *   pnpm tsx scripts/examples/car-wash-test.ts --all --run 4  # re-use specific run
 */

import '../../src/env/load.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { SimpleEvaluation } from '../../src/evaluation/strategies/simple-evaluation.js';
import { EvaluationCache } from '../../src/evaluation/caching/cache-service.js';
import { Stimulus } from '../../src/stimulus/stimulus.js';
import { clearAllRateLimitStates } from '../../src/rate-limit/rate-limit.js';
import { Interaction } from '../../src/interaction/core/interaction.js';
import { ModelDetails } from '../../src/cognition/types.js';

// ── Models to evaluate ──────────────────────────────────────────────────────
// Matching https://opper.ai/blog/car-wash-test as closely as possible.
// Discover available models with: pnpm run cli -- models --search <query>

// Full model list — uncomment ALL_MODELS and set MODELS = ALL_MODELS to run the full suite.
// For a quick local test, use the small MODELS array below.

// One model per provider for testing
const LOCAL_TEST_MODELS: ModelDetails[] = [
  { name: 'qwen3:30b-a3b', provider: 'ollama' },                       // Ollama (local)
  { name: 'gemini-3-flash-preview', provider: 'google' },              // Google (direct)
  { name: 'anthropic/claude-3.5-haiku', provider: 'openrouter' },      // OpenRouter
];

const ALL_MODELS: ModelDetails[] = [
  // ── Google (direct) ───────────────────────────────────────────────────────
  // { name: 'gemini-3.1-pro-preview', provider: 'google' },  // 503 high demand — disabled
  { name: 'gemini-3-flash-preview', provider: 'google' },
  { name: 'gemini-3-pro-preview', provider: 'google' },
  { name: 'gemini-2.5-pro', provider: 'google' },
  { name: 'gemini-2.5-flash', provider: 'google' },
  { name: 'gemini-2.5-flash-lite', provider: 'google' },
  { name: 'gemini-2.0-flash', provider: 'google' },
  { name: 'gemini-2.0-flash-lite', provider: 'google' },

  // ── OpenRouter — Anthropic ────────────────────────────────────────────────
  { name: 'anthropic/claude-opus-4.6', provider: 'openrouter' },
  { name: 'anthropic/claude-sonnet-4.6', provider: 'openrouter' },
  { name: 'anthropic/claude-opus-4.5', provider: 'openrouter' },
  { name: 'anthropic/claude-sonnet-4.5', provider: 'openrouter' },
  { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' },
  { name: 'anthropic/claude-opus-4.1', provider: 'openrouter' },
  { name: 'anthropic/claude-opus-4', provider: 'openrouter' },
  { name: 'anthropic/claude-sonnet-4', provider: 'openrouter' },
  { name: 'anthropic/claude-3.7-sonnet', provider: 'openrouter' },
  { name: 'anthropic/claude-3.5-sonnet', provider: 'openrouter' },
  { name: 'anthropic/claude-3.5-haiku', provider: 'openrouter' },

  // ── OpenRouter — OpenAI ───────────────────────────────────────────────────
  { name: 'openai/gpt-5.3-codex', provider: 'openrouter' },
  { name: 'openai/gpt-5.2-pro', provider: 'openrouter' },
  { name: 'openai/gpt-5.2', provider: 'openrouter' },
  { name: 'openai/gpt-5.1', provider: 'openrouter' },
  { name: 'openai/gpt-5-pro', provider: 'openrouter' },
  { name: 'openai/gpt-5', provider: 'openrouter' },
  { name: 'openai/gpt-5-mini', provider: 'openrouter' },
  { name: 'openai/gpt-5-nano', provider: 'openrouter' },
  { name: 'openai/o3-pro', provider: 'openrouter' },
  { name: 'openai/o3', provider: 'openrouter' },
  { name: 'openai/o3-mini', provider: 'openrouter' },
  { name: 'openai/o3-mini-high', provider: 'openrouter' },
  { name: 'openai/o1', provider: 'openrouter' },
  { name: 'openai/o1-pro', provider: 'openrouter' },
  { name: 'openai/o4-mini-high', provider: 'openrouter' },
  { name: 'openai/o4-mini', provider: 'openrouter' },
  { name: 'openai/gpt-4.1', provider: 'openrouter' },
  { name: 'openai/gpt-4.1-mini', provider: 'openrouter' },
  { name: 'openai/gpt-4.1-nano', provider: 'openrouter' },
  { name: 'openai/gpt-4o', provider: 'openrouter' },
  { name: 'openai/gpt-4o-mini', provider: 'openrouter' },
  { name: 'openai/gpt-oss-20b', provider: 'openrouter' },
  { name: 'openai/gpt-oss-120b', provider: 'openrouter' },

  // ── OpenRouter — xAI (Grok) ──────────────────────────────────────────────
  { name: 'x-ai/grok-4', provider: 'openrouter' },
  { name: 'x-ai/grok-4.1-fast', provider: 'openrouter' },
  { name: 'x-ai/grok-4-fast', provider: 'openrouter' },
  { name: 'x-ai/grok-3', provider: 'openrouter' },
  { name: 'x-ai/grok-3-mini', provider: 'openrouter' },
  { name: 'x-ai/grok-3-beta', provider: 'openrouter' },

  // ── OpenRouter — Meta Llama ───────────────────────────────────────────────
  { name: 'meta-llama/llama-4-maverick', provider: 'openrouter' },
  { name: 'meta-llama/llama-4-scout', provider: 'openrouter' },
  { name: 'meta-llama/llama-3.3-70b-instruct', provider: 'openrouter' },
  { name: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', provider: 'openrouter' },

  // ── OpenRouter — Mistral ──────────────────────────────────────────────────
  { name: 'mistralai/mistral-large-2512', provider: 'openrouter' },
  { name: 'mistralai/mistral-large-2411', provider: 'openrouter' },
  { name: 'mistralai/mistral-medium-3', provider: 'openrouter' },
  { name: 'mistralai/mistral-medium-3.1', provider: 'openrouter' },
  { name: 'mistralai/mistral-small-3.1-24b-instruct', provider: 'openrouter' },
  { name: 'mistralai/mistral-small-3.2-24b-instruct', provider: 'openrouter' },
  { name: 'mistralai/devstral-medium', provider: 'openrouter' },
  { name: 'mistralai/devstral-small', provider: 'openrouter' },

  // ── OpenRouter — DeepSeek ─────────────────────────────────────────────────
  { name: 'deepseek/deepseek-v3.2', provider: 'openrouter' },
  { name: 'deepseek/deepseek-v3.1-terminus', provider: 'openrouter' },
  { name: 'deepseek/deepseek-chat-v3.1', provider: 'openrouter' },
  { name: 'deepseek/deepseek-chat-v3-0324', provider: 'openrouter' },
  { name: 'deepseek/deepseek-r1', provider: 'openrouter' },
  { name: 'deepseek/deepseek-r1-0528', provider: 'openrouter' },

  // ── OpenRouter — Qwen ─────────────────────────────────────────────────────
  { name: 'qwen/qwen3.5-plus-02-15', provider: 'openrouter' },
  { name: 'qwen/qwen3.5-397b-a17b', provider: 'openrouter' },
  { name: 'qwen/qwen3.5-122b-a10b', provider: 'openrouter' },
  { name: 'qwen/qwen3.5-35b-a3b', provider: 'openrouter' },
  { name: 'qwen/qwen3.5-27b', provider: 'openrouter' },
  { name: 'qwen/qwen3-max', provider: 'openrouter' },
  { name: 'qwen/qwen3-max-thinking', provider: 'openrouter' },
  { name: 'qwen/qwen3-coder', provider: 'openrouter' },
  { name: 'qwen/qwen3-coder-next', provider: 'openrouter' },
  { name: 'qwen/qwen3-235b-a22b', provider: 'openrouter' },
  { name: 'qwen/qwq-32b', provider: 'openrouter' },
  { name: 'qwen/qwen-2.5-72b-instruct', provider: 'openrouter' },

  // ── OpenRouter — Cohere ───────────────────────────────────────────────────
  { name: 'cohere/command-a', provider: 'openrouter' },

  // ── OpenRouter — Amazon ───────────────────────────────────────────────────
  { name: 'amazon/nova-premier-v1', provider: 'openrouter' },
  { name: 'amazon/nova-pro-v1', provider: 'openrouter' },
  { name: 'amazon/nova-lite-v1', provider: 'openrouter' },
  { name: 'amazon/nova-micro-v1', provider: 'openrouter' },

  // ── OpenRouter — Microsoft ────────────────────────────────────────────────
  { name: 'microsoft/phi-4', provider: 'openrouter' },

  // ── OpenRouter — Perplexity (Sonar) ───────────────────────────────────────
  { name: 'perplexity/sonar', provider: 'openrouter' },
  { name: 'perplexity/sonar-pro', provider: 'openrouter' },
  { name: 'perplexity/sonar-reasoning-pro', provider: 'openrouter' },

  // ── OpenRouter — Kimi (Moonshot) ──────────────────────────────────────────
  { name: 'moonshotai/kimi-k2.5', provider: 'openrouter' },
  { name: 'moonshotai/kimi-k2-0905', provider: 'openrouter' },
  { name: 'moonshotai/kimi-k2-thinking', provider: 'openrouter' },

  // ── OpenRouter — GLM (Zhipu) ──────────────────────────────────────────────
  { name: 'z-ai/glm-5', provider: 'openrouter' },
  { name: 'z-ai/glm-4.7', provider: 'openrouter' },
  { name: 'z-ai/glm-4.7-flash', provider: 'openrouter' },
  { name: 'z-ai/glm-4.6', provider: 'openrouter' },
  { name: 'z-ai/glm-4.5', provider: 'openrouter' },

  // ── OpenRouter — MiniMax ──────────────────────────────────────────────────
  { name: 'minimax/minimax-m2.5', provider: 'openrouter' },
  { name: 'minimax/minimax-m2.1', provider: 'openrouter' },

  // ── OpenRouter — Nvidia ───────────────────────────────────────────────────
  { name: 'nvidia/nemotron-3-super-120b-a12b:free', provider: 'openrouter' },
  { name: 'nvidia/nemotron-3-nano-30b-a3b:free', provider: 'openrouter' },
  { name: 'nvidia/nemotron-3-nano-30b-a3b', provider: 'openrouter' },
  { name: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', provider: 'openrouter' },
  { name: 'nvidia/nemotron-nano-9b-v2:free', provider: 'openrouter' },

  // ── DeepInfra — Nvidia Nemotron ─────────────────────────────────────────
  { name: 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B', provider: 'deepinfra' },
  { name: 'nvidia/Nemotron-3-Nano-30B-A3B', provider: 'deepinfra' },
  { name: 'nvidia/Llama-3.3-Nemotron-Super-49B-v1.5', provider: 'deepinfra' },
  { name: 'nvidia/NVIDIA-Nemotron-Nano-9B-v2', provider: 'deepinfra' },

  // ── OpenRouter — Google (Gemma) ───────────────────────────────────────────
  { name: 'google/gemma-3-27b-it', provider: 'openrouter' },
  { name: 'google/gemma-3n-e4b-it', provider: 'openrouter' },

  // ── OpenRouter — Baidu (ERNIE) ────────────────────────────────────────────
  { name: 'baidu/ernie-4.5-300b-a47b', provider: 'openrouter' },
  { name: 'baidu/ernie-4.5-21b-a3b', provider: 'openrouter' },

  // ── OpenRouter — ByteDance (Seed) ─────────────────────────────────────────
  { name: 'bytedance-seed/seed-1.6', provider: 'openrouter' },
  { name: 'bytedance-seed/seed-1.6-flash', provider: 'openrouter' },

  // ── OpenRouter — StepFun ──────────────────────────────────────────────────
  { name: 'stepfun/step-3.5-flash', provider: 'openrouter' },

  // ── OpenRouter — Inception ────────────────────────────────────────────────
  { name: 'inception/mercury', provider: 'openrouter' },

  // ── OpenRouter — Writer ───────────────────────────────────────────────────
  { name: 'writer/palmyra-x5', provider: 'openrouter' },

  // ── OpenRouter — Inflection ───────────────────────────────────────────────
  { name: 'inflection/inflection-3-productivity', provider: 'openrouter' },

  // ── OpenRouter — AllenAI (OLMo) ───────────────────────────────────────────
  { name: 'allenai/olmo-3.1-32b-instruct', provider: 'openrouter' },
  { name: 'allenai/olmo-3.1-32b-think', provider: 'openrouter' },

  // ── OpenRouter — Thinking/Reasoning models ───────────────────────────────
  { name: 'anthropic/claude-3.7-sonnet:thinking', provider: 'openrouter' },
  { name: 'qwen/qwen-plus-2025-07-28:thinking', provider: 'openrouter' },
  { name: 'qwen/qwen3-235b-a22b-thinking-2507', provider: 'openrouter' },
  { name: 'qwen/qwen3-30b-a3b-thinking-2507', provider: 'openrouter' },
  { name: 'qwen/qwen3-next-80b-a3b-thinking', provider: 'openrouter' },
  { name: 'qwen/qwen3-vl-235b-a22b-thinking', provider: 'openrouter' },
  { name: 'qwen/qwen3-vl-30b-a3b-thinking', provider: 'openrouter' },
  { name: 'baidu/ernie-4.5-21b-a3b-thinking', provider: 'openrouter' },
  { name: 'liquid/lfm-2.5-1.2b-thinking:free', provider: 'openrouter' },
  { name: 'arcee-ai/maestro-reasoning', provider: 'openrouter' },
  { name: 'qwen/qwen3-vl-8b-thinking', provider: 'openrouter' },

  // ── Ollama (local) ────────────────────────────────────────────────────────
  { name: 'deepseek-r1:latest', provider: 'ollama' },
  { name: 'deepseek-r1:14b', provider: 'ollama' },
  { name: 'deepseek-r1:32b', provider: 'ollama' },
  { name: 'qwen3:32b', provider: 'ollama' },
  { name: 'qwen3:30b-a3b', provider: 'ollama' },
  { name: 'gpt-oss:latest', provider: 'ollama' },
  { name: 'minimax-m2.1:cloud', provider: 'ollama' },
  { name: 'phi4:latest', provider: 'ollama' },
  { name: 'gemma3n:e4b', provider: 'ollama' },
  { name: 'mistral-small:latest', provider: 'ollama' },
  // { name: 'llama4:latest', provider: 'ollama' },  // 67GB — too large for this machine
  // { name: 'qwen3.5:35b', provider: 'ollama' },  // requires newer Ollama version
  { name: 'devstral:latest', provider: 'ollama' },
];

// Toggle: LOCAL_TEST_MODELS for quick local test, ALL_MODELS for full run
const MODELS = process.argv.includes('--all') ? ALL_MODELS : LOCAL_TEST_MODELS;

// Parse --run N flag to re-use a specific run (resume partial / re-judge cached responses)
function parseRunFlag(): number | null {
  const idx = process.argv.indexOf('--run');
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  const n = parseInt(process.argv[idx + 1], 10);
  return Number.isNaN(n) ? null : n;
}

// ── Judge schema ────────────────────────────────────────────────────────────

const JudgeSchema = z.object({
  recommendation: z.enum(['drive', 'walk', 'both', 'unclear']).describe(
    'What does the model ultimately recommend? drive = take the car, walk = go on foot, both = suggests either is fine, unclear = no clear recommendation'
  ),
  recognizes_need_for_car: z.boolean().describe(
    'Does the model explicitly state or clearly imply that the car must be physically present at the car wash to be washed?'
  ),
  correct_reason: z.boolean().describe(
    'Did the model recommend driving BECAUSE the car needs to be at the car wash? A model that says drive for other reasons (convenience, weather, laziness) gets false here.'
  ),
  stated_reason: z.string().describe(
    'What reason did the model give for its recommendation? Summarize in one sentence.'
  ),
  reasoning_quality: z.number().min(1).max(5).describe(
    '1=missed the point entirely, 2=right answer wrong reason, 3=partially recognized it, 4=good reasoning, 5=immediately identified that the car must be at the car wash'
  ),
  explanation: z.string().describe(
    'Brief explanation of the judge verdict'
  ),
});

type JudgeResult = z.infer<typeof JudgeSchema>;

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚗 Car Wash Reasoning Test');
  console.log('═'.repeat(60));
  console.log('Question: "I want to wash my car. The car wash is 50 meters');
  console.log('           away. Should I walk or drive?"');
  console.log('Correct:  DRIVE (you need the car at the car wash)');
  console.log(`Models:   ${MODELS.length}`);
  console.log('═'.repeat(60));
  console.log();

  // ── Determine run number ────────────────────────────────────────────────

  const baseDir = path.join(process.cwd(), 'output', 'evaluations', 'car-wash-test', 'runs');
  fs.mkdirSync(baseDir, { recursive: true });
  const existingRuns = fs.readdirSync(baseDir)
    .filter(d => /^\d+$/.test(d))
    .map(d => parseInt(d, 10))
    .sort((a, b) => a - b);
  const requestedRun = parseRunFlag();
  // Default to latest existing run (reuse cache), use --new for a fresh run
  const forceNew = process.argv.includes('--new');
  const latestRun = existingRuns.length > 0 ? existingRuns[existingRuns.length - 1] : 1;
  const runNumber = forceNew
    ? (latestRun + 1)
    : (requestedRun ?? latestRun);
  const runId = String(runNumber).padStart(3, '0');
  const runDir = path.join(baseDir, runId);
  const isResume = existingRuns.includes(runNumber);

  console.log(`📂 Run #${runId}${isResume ? ' (resuming existing run)' : ''}\n`);

  // ── Step 1: Evaluate all models ─────────────────────────────────────────

  const stimulus = new Stimulus({
    role: 'helpful assistant',
    objective: 'answer the user\'s question clearly and concisely',
    instructions: [
      'Think through the question carefully',
      'Give a clear recommendation',
      'Explain your reasoning briefly',
    ],
    temperature: 0.3,
    maxTokens: 500,
    runnerType: 'base',
  });

  const cache = new EvaluationCache(`car-wash-test/runs/${runId}`, { verbose: false });

  const evaluation = new SimpleEvaluation(
    stimulus,
    MODELS,
    'I want to wash my car. The car wash is 50 meters away. Should I walk or drive?',
    cache,
    {
      evaluationId: `car-wash-test-${runId}`,
      useCache: true,  // Write responses to this run's directory
      concurrent: true,
      maxConcurrency: 5,
      showProgress: true,
    },
    (progress) => {
      if (progress.status === 'completed') {
        console.log(`  ✅ ${progress.modelName}`);
      } else if (progress.status === 'error') {
        console.log(`  ❌ ${progress.modelName}: ${progress.error}`);
      }
    }
  );

  console.log('📡 Running evaluation across all models...\n');
  const results = await evaluation.run();
  console.log(`\n✅ Got ${results.length} responses\n`);

  // ── Step 2: Judge each response via chat ────────────────────────────────

  const judgeModel: ModelDetails = { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' };
  // Clear all rate limit state from the evaluation phase
  clearAllRateLimitStates();
  console.log(`⚖️  Judging responses with ${judgeModel.name}...\n`);

  const judgeStimulus = new Stimulus({
    role: 'evaluation judge',
    objective: 'assess whether AI model responses correctly answer a common-sense reasoning question, paying close attention to WHY the model gave its answer',
    instructions: [
      'The question was: "I want to wash my car. The car wash is 50 meters away. Should I walk or drive?"',
      'The ONLY correct answer is DRIVE — because the car must be physically present at the car wash to be washed. You cannot walk to a car wash without your car and wash it.',
      'IMPORTANT: A model that says "drive" for the WRONG reason (convenience, weather, laziness, "might as well") has NOT truly passed the test. It got lucky.',
      'A model that says "walk" has completely failed to recognize this basic requirement.',
      'Score reasoning_quality: 5=immediately identifies car must be at wash, 4=good reasoning mentioning car presence, 3=partially gets it, 2=right answer but wrong reason, 1=missed the point.',
      'Reply with ONLY a JSON object (no markdown fences, no extra text):',
      '{"recommendation":"drive"|"walk"|"both"|"unclear", "recognizes_need_for_car":true|false, "correct_reason":true|false, "stated_reason":"...", "reasoning_quality":1-5, "explanation":"..."}',
    ],
    temperature: 0.0,
    maxTokens: 400,
    runnerType: 'base',
  });

  interface ScoredResult {
    model: string;
    provider: string;
    judge: JudgeResult;
    correct: boolean;
    responsePreview: string;
    durationMs: number;
    cost: number;
    tokens: { promptTokens: number; completionTokens: number; total?: number } | null;
  }

  const scored: ScoredResult[] = [];
  const resultsDir = path.join(runDir, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  let judgeCallCount = 0;
  for (const result of results) {
    // Clear rate limit state every 50 calls to prevent hitting the 60/min limit
    if (judgeCallCount > 0 && judgeCallCount % 50 === 0) {
      clearAllRateLimitStates();
    }
    const modelLabel = `${result.model.provider}:${result.model.name}`;
    const modelKey = `${result.model.name.replace(/\//g, '-')}-${result.model.provider}`;
    const resultPath = path.join(resultsDir, `${modelKey}.json`);

    const responseText = typeof result.response.content === 'string'
      ? result.response.content
      : JSON.stringify(result.response.content);

    // Timing from the actual model response metadata
    const startTime = result.response.metadata.startTime;
    const endTime = result.response.metadata.endTime;
    const durationMs = typeof startTime === 'string' && typeof endTime === 'string'
      ? new Date(endTime).getTime() - new Date(startTime).getTime()
      : startTime instanceof Date && endTime instanceof Date
        ? endTime.getTime() - startTime.getTime()
        : 0;

    const cost = result.response.metadata.cost?.totalCost || 0;
    const tokens = result.response.metadata.tokenUsage || null;

    if (!responseText || result.metadata.error) {
      const errorResult: ScoredResult = {
        model: result.model.name,
        provider: result.model.provider,
        judge: {
          recommendation: 'unclear',
          recognizes_need_for_car: false,
          correct_reason: false,
          stated_reason: 'N/A',
          reasoning_quality: 1,
          explanation: `Error: ${result.metadata.error || 'empty response'}`,
        },
        correct: false,
        responsePreview: result.metadata.error || 'empty',
        durationMs,
        cost,
        tokens,
      };
      scored.push(errorResult);
      fs.writeFileSync(resultPath, JSON.stringify(errorResult, null, 2));
      continue;
    }

    try {
      const judgeInteraction = new Interaction(judgeModel, judgeStimulus);
      judgeInteraction.addMessage({
        role: 'user',
        content: `Here is the model response to judge:\n\n---\n${responseText}\n---\n\nScore this response. Reply with ONLY a JSON object.`,
      });
      const judgeResponse = await judgeInteraction.generateText();

      // Extract JSON from the response (handle possible markdown fences)
      let jsonStr = judgeResponse.content.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/) || jsonStr.match(/(\{[\s\S]*\})/);
      if (jsonMatch) jsonStr = jsonMatch[1].trim();

      const judgeResult = JudgeSchema.parse(JSON.parse(jsonStr));

      const scoredResult: ScoredResult = {
        model: result.model.name,
        provider: result.model.provider,
        judge: judgeResult,
        correct: judgeResult.recommendation === 'drive' && judgeResult.correct_reason,
        responsePreview: responseText.replace(/\n/g, ' ').slice(0, 120),
        durationMs,
        cost,
        tokens,
      };
      scored.push(scoredResult);
      fs.writeFileSync(resultPath, JSON.stringify(scoredResult, null, 2));

      const icon = judgeResult.recommendation === 'drive' ? '✅' : '❌';
      console.log(`  ${icon} ${modelLabel} → ${judgeResult.recommendation} (reasoning: ${judgeResult.reasoning_quality}/5)`);
    } catch (err) {
      console.log(`  ⚠️  ${modelLabel} → judge error: ${err instanceof Error ? err.message : err}`);
      const errorResult: ScoredResult = {
        model: result.model.name,
        provider: result.model.provider,
        judge: {
          recommendation: 'unclear',
          recognizes_need_for_car: false,
          correct_reason: false,
          stated_reason: 'N/A',
          reasoning_quality: 1,
          explanation: `Judge error: ${err instanceof Error ? err.message : String(err)}`,
        },
        correct: false,
        responsePreview: responseText.replace(/\n/g, ' ').slice(0, 120),
        durationMs,
        cost,
        tokens,
      };
      scored.push(errorResult);
      fs.writeFileSync(resultPath, JSON.stringify(errorResult, null, 2));
    }

    judgeCallCount++;
    // Delay to stay under 60 requests/minute rate limit
    await delay(1000);
  }

  // ── Step 3: Print results ─────────────────────────────────────────────

  const totalCost = scored.reduce((sum, s) => sum + s.cost, 0);
  const passed = scored.filter(s => s.correct).length;
  const luckyDrive = scored.filter(s => s.judge.recommendation === 'drive' && !s.judge.correct_reason).length;
  const failed = scored.filter(s => s.judge.recommendation === 'walk').length;
  const other = scored.length - passed - luckyDrive - failed;

  scored.sort((a, b) => {
    if (a.correct !== b.correct) return a.correct ? -1 : 1;
    return b.judge.reasoning_quality - a.judge.reasoning_quality;
  });

  const modelWidth = Math.max(45, ...scored.map(s => `${s.provider}:${s.model}`.length + 2));

  console.log(`\n📁 Results written to ${resultsDir}/`);
  console.log('\n🏁 RESULTS');
  console.log('═'.repeat(120));
  console.log(
    `${'Model'.padEnd(modelWidth)} ${'Answer'.padEnd(10)} ${'Why?'.padEnd(6)} ${'Q'.padEnd(4)} ${'Cost'.padEnd(12)} ${'Time'.padEnd(8)} Reason`
  );
  console.log('─'.repeat(120));

  for (const s of scored) {
    const label = `${s.provider}:${s.model}`;
    const icon = s.correct ? '✅' : s.judge.recommendation === 'walk' ? '❌' : '⚠️';
    const reasonIcon = s.judge.correct_reason ? '✓' : '✗';
    const quality = `${s.judge.reasoning_quality}`;
    const costStr = `$${s.cost.toFixed(6)}`;
    const timeStr = s.durationMs > 0 ? `${(s.durationMs / 1000).toFixed(1)}s` : '-';
    const reason = s.judge.stated_reason.slice(0, 50);

    console.log(
      `${icon} ${label.padEnd(modelWidth - 2)} ${s.judge.recommendation.padEnd(10)} ${reasonIcon.padEnd(6)} ${quality.padEnd(4)} ${costStr.padEnd(12)} ${timeStr.padEnd(8)} ${reason}`
    );
  }

  console.log('─'.repeat(120));
  console.log(`\n📊 Summary: ${passed}/${scored.length} truly correct (DRIVE for the right reason)`);
  console.log(`   ✅ Correct (drive + right reason): ${passed}`);
  console.log(`   ⚠️  Lucky (drive + wrong reason):   ${luckyDrive}`);
  console.log(`   ❌ Failed (walk):                   ${failed}`);
  if (other > 0) console.log(`   ❓ Other (both/unclear/error):      ${other}`);
  console.log(`   💰 Total Cost: $${totalCost.toFixed(6)}`);

  console.log('\n🎉 Car wash test complete!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
