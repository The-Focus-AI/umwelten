/**
 * Tool-calling eval — multi-step arithmetic with calculator + statistics
 * tools, against a single model.
 *
 * This is the minimum viable tool-calling benchmark — if a model can't
 * chain calculator calls reliably, it won't handle MCP or file tools.
 *
 * Wraps the previous `tool-math.ts` logic into the EvalSuite shape so
 * it composes with language and coding. Verification needs both the
 * final answer (extracted from response text) AND the count of tool
 * calls actually made — that's why VerifyTask.verify accepts the full
 * ModelResponse as a second arg.
 */

import { EvalSuite, type EvalTask } from '../suite.js';
import type { ModelDetails, ModelResponse } from '@umwelten/core/cognition/types.js';
import {
  calculatorTool,
  statisticsTool,
} from '@umwelten/core/stimulus/tools/examples/math.js';

const SECTION_TOOL_MATH = 'tool-math';

interface MathTask {
  id: string;
  name: string;
  prompt: string;
  /** Expected final answer (within tolerance) */
  expected: number;
  tolerance: number;
  /** Minimum number of tool calls expected (heuristic) */
  minToolCalls: number;
}

const TASKS: MathTask[] = [
  {
    id: 'compound-interest',
    name: 'Compound interest',
    prompt:
      'If I invest $1000 at 7% annual compound interest for 5 years, what is the final amount? Use the calculator tool for every step. Show the final answer as a single number with two decimal places.',
    expected: 1402.55,
    tolerance: 1.0,
    minToolCalls: 4,
  },
  {
    id: 'grocery-total',
    name: 'Multi-item grocery total',
    // 3*1.25=3.75, 2*3.50=7, 4*0.75=3, +12.99 = 26.74, *1.08 = 28.8792
    prompt:
      'Compute the total cost of: 3 apples at $1.25 each, 2 loaves of bread at $3.50 each, 4 bottles of water at $0.75 each, and 1 cake at $12.99. Add 8% sales tax. Use the calculator tool. Give the final total as a single number.',
    expected: 28.88,
    tolerance: 0.05,
    minToolCalls: 3,
  },
  {
    id: 'statistics-mixed',
    name: 'Stats + arithmetic',
    prompt:
      'Given the numbers [4, 8, 15, 16, 23, 42], compute the mean and the standard deviation using the statistics tool. Then compute (mean + standard deviation) using the calculator. Return only the final number, rounded to 2 decimal places.',
    expected: 30.32,
    tolerance: 0.5,
    minToolCalls: 2,
  },
  {
    id: 'distance-rate-time',
    name: 'Distance/rate/time',
    prompt:
      'A car travels at 65 mph for 2.5 hours, then at 55 mph for 1.75 hours. Using the calculator tool for each step, find the total distance traveled. Return only the final number.',
    expected: 258.75,
    tolerance: 0.5,
    minToolCalls: 3,
  },
  {
    id: 'percent-discount',
    name: 'Chained percent discount',
    prompt:
      'A laptop originally costs $1200. Apply a 20% holiday discount, then apply a 15% loyalty-program discount on the already-discounted price, then add 6% sales tax. Use the calculator tool for every step. Return only the final price.',
    expected: 864.96,
    tolerance: 0.5,
    minToolCalls: 4,
  },
];

function extractFinalNumber(response: string): number | null {
  const matches = response.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  return parseFloat(matches[matches.length - 1]);
}

function countToolCalls(fullResponse: ModelResponse | undefined): number {
  // ModelResponse.metadata.toolCalls is populated by the runner's
  // step-assembler from AI SDK steps. It's set on streamText and
  // generateText alike, so this works for both code paths.
  const meta = fullResponse?.metadata as any;
  if (!meta) return 0;
  if (Array.isArray(meta.toolCalls)) return meta.toolCalls.length;
  return 0;
}

function scoreMath(
  task: MathTask,
  response: string,
  fullResponse?: ModelResponse,
): { score: number; details: string } {
  const final = extractFinalNumber(response);
  const calls = countToolCalls(fullResponse);

  // Correctness (0–3): exact-ish, close, miss.
  const correctnessPoints = (() => {
    if (final === null) return 0;
    const diff = Math.abs(final - task.expected);
    if (diff <= task.tolerance) return 3;
    if (diff <= task.tolerance * 5) return 1;
    return 0;
  })();

  // Tool-use (0–2): met the minimum, made any call, none.
  const toolUsePoints = (() => {
    if (calls >= task.minToolCalls) return 2;
    if (calls >= 1) return 1;
    return 0;
  })();

  return {
    score: correctnessPoints + toolUsePoints,
    details: `answer=${final ?? 'n/a'} (expected ${task.expected}), calls=${calls} (min ${task.minToolCalls})`,
  };
}

export interface ToolCallingSuiteOptions {
  name?: string;
  /** Override per-task timeout (ms). Defaults to EvalSuite default (5 min). */
  perTaskTimeoutMs?: number;
}

export function makeToolCallingSuite(
  model: ModelDetails,
  opts: ToolCallingSuiteOptions = {},
): EvalSuite {
  const tasks: EvalTask[] = TASKS.map((task) => ({
    id: `toolmath-${task.id}`,
    name: task.name,
    prompt: task.prompt,
    maxScore: 5,
    section: SECTION_TOOL_MATH,
    verify: (response, fullResponse) => scoreMath(task, response, fullResponse),
  }));

  return new EvalSuite({
    name: opts.name ?? 'llm-eval-tool-calling',
    stimulus: {
      role: 'careful mathematician',
      objective: 'compute the answer using the provided tools',
      instructions: [
        'You MUST use the provided tools for arithmetic — do not compute in your head.',
        'Call tools step by step until you have the answer.',
        'Return the final answer as a single number.',
      ],
      temperature: 0.0,
      // No maxTokens cap: thinking-on models need room to chain calls.
      // See CLAUDE.md "Token limits" rule.
      maxToolSteps: 12,
      tools: {
        calculator: calculatorTool,
        statistics: statisticsTool,
      },
    },
    tasks,
    models: [model],
    allModels: [model],
    concurrency: 1,
    perTaskTimeoutMs: opts.perTaskTimeoutMs,
  });
}
