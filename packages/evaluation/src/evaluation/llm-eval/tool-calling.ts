import { z } from "zod";
import { tool, type ModelSpec, type PiTurnResult } from "@umwelten/pi";
import { EvalSuite, type EvalTask } from "../suite.js";

const SECTION_TOOL_MATH = "tool-math";

export const calculatorTool = tool({
  description: "Perform arithmetic operations (add, subtract, multiply, divide, power)",
  inputSchema: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide", "power"]),
    a: z.number(),
    b: z.number(),
  }),
  execute: async ({ operation, a, b }) => {
    switch (operation) {
      case "add":
        return { result: a + b };
      case "subtract":
        return { result: a - b };
      case "multiply":
        return { result: a * b };
      case "divide":
        return { result: b === 0 ? NaN : a / b };
      case "power":
        return { result: a ** b };
    }
  },
});

export const statisticsTool = tool({
  description: "Compute mean and population standard deviation of a numeric array",
  inputSchema: z.object({
    numbers: z.array(z.number()).min(1),
  }),
  execute: async ({ numbers }) => {
    const mean = numbers.reduce((s, n) => s + n, 0) / numbers.length;
    const variance =
      numbers.reduce((s, n) => s + (n - mean) ** 2, 0) / numbers.length;
    return { mean, stdDev: Math.sqrt(variance) };
  },
});

interface MathTask {
  id: string;
  name: string;
  prompt: string;
  expected: number;
  tolerance: number;
  minToolCalls: number;
}

const TASKS: MathTask[] = [
  {
    id: "compound-interest",
    name: "Compound interest",
    prompt:
      "If I invest $1000 at 7% annual compound interest for 5 years, what is the final amount? Use the calculator tool for every step. Show the final answer as a single number with two decimal places.",
    expected: 1402.55,
    tolerance: 1.0,
    minToolCalls: 2,
  },
  {
    id: "grocery-total",
    name: "Multi-item grocery total",
    prompt:
      "Compute the total cost of: 3 apples at $1.25 each, 2 loaves of bread at $3.50 each, 4 bottles of water at $0.75 each, and 1 cake at $12.99. Add 8% sales tax. Use the calculator tool. Give the final total as a single number.",
    expected: 28.88,
    tolerance: 0.05,
    minToolCalls: 3,
  },
  {
    id: "statistics-mixed",
    name: "Stats + arithmetic",
    prompt:
      "Given the numbers [4, 8, 15, 16, 23, 42], compute the mean and standard deviation using the statistics tool, then compute (mean + stdDev) using the calculator. Return only the final number rounded to 2 decimal places.",
    expected: 30.32,
    tolerance: 1.5,
    minToolCalls: 2,
  },
];

function extractFinalNumber(response: string): number | null {
  const matches = response.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  return parseFloat(matches[matches.length - 1]);
}

export interface ToolCallingSuiteOptions {
  name?: string;
  perTaskTimeoutMs?: number;
}

export function makeToolCallingSuite(
  model: ModelSpec,
  opts: ToolCallingSuiteOptions = {},
): EvalSuite {
  const tasks: EvalTask[] = TASKS.map((task) => ({
    id: `toolmath-${task.id}`,
    name: task.name,
    prompt: task.prompt,
    maxScore: 5,
    section: SECTION_TOOL_MATH,
    verify: (response: string, turn?: PiTurnResult) => {
      const final = extractFinalNumber(response);
      const calls = turn?.toolCalls.length ?? 0;
      const diff = final === null ? Infinity : Math.abs(final - task.expected);
      const correctness =
        diff <= task.tolerance ? 3 : diff <= task.tolerance * 5 ? 1 : 0;
      const toolPts = calls >= task.minToolCalls ? 2 : calls >= 1 ? 1 : 0;
      return {
        score: correctness + toolPts,
        details: `answer=${final ?? "n/a"} (expected ${task.expected}), calls=${calls}`,
      };
    },
  }));

  return new EvalSuite({
    name: opts.name ?? "llm-eval-tool-calling",
    systemPrompt: [
      "You are a careful mathematician.",
      "You MUST use the provided tools for arithmetic — do not compute in your head.",
      "Return the final answer as a single number.",
    ].join("\n"),
    temperature: 0.0,
    // Intentionally uncapped: thinking-on models need room to chain tool calls
    maxToolSteps: 12,
    tools: {
      calculator: calculatorTool,
      statistics: statisticsTool,
    },
    tasks,
    models: [model],
    allModels: [model],
    concurrency: 1,
    perTaskTimeoutMs: opts.perTaskTimeoutMs,
  });
}
