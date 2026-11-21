#!/usr/bin/env node
/**
 * Multi-step tool-calling & Elo pairwise ranking over `@earendil-works/pi-ai`.
 *
 * Usage:
 *   pnpm tsx examples/evals/tool-math.ts          # instant deterministic mock
 *   pnpm tsx examples/evals/tool-math.ts --live   # live cloud + local models
 */

import "@umwelten/pi";
import {
  calculatorTool,
  EvalSuite,
  PairwiseRanker,
  statisticsTool,
} from "@umwelten/evaluation";
import {
  DEFAULT_FAST_JUDGE,
  FAST_MODEL_ROSTER,
  QUICK_FAST_MODELS,
} from "../_shared/fast-models.js";
import { setupExampleRuntime } from "../_shared/mock-runtime.js";

setupExampleRuntime(FAST_MODEL_ROSTER);

const suite = new EvalSuite({
  name: "tool-math-smoke",
  systemPrompt:
    "You are a careful mathematician. Use the calculator and statistics tools for every arithmetic step and end with the exact final number.",
  temperature: 0,
  tools: {
    calculator: calculatorTool,
    statistics: statisticsTool,
  },
  models: QUICK_FAST_MODELS,
  allModels: FAST_MODEL_ROSTER,
  tasks: [
    {
      id: "grocery-total",
      name: "Grocery Total",
      prompt:
        "Compute the total cost of: 3 apples at $1.25 each, 2 loaves of bread at $3.50 each, 4 bottles of water at $0.75 each, and 1 cake at $12.99. Add 8% sales tax. Use the calculator tool.",
      maxScore: 5,
      verify: (response, turn) => {
        const hasExact = /28\.88/.test(response);
        const calls = turn?.toolCalls.length ?? 0;
        return {
          score: (hasExact ? 3 : 0) + (calls >= 3 ? 2 : calls >= 1 ? 1 : 0),
          details: `exact28.88=${hasExact}, toolCalls=${calls}`,
        };
      },
    },
  ],
});

const records = await suite.run();
const okRecords = records.filter((r) => !r.error);
if (okRecords.length >= 2) {
  const ranker = new PairwiseRanker(
    okRecords.map((r) => ({
      key: `${r.provider}:${r.model}`,
      provider: r.provider,
      model: r.model,
      responseText: r.responseText,
    })),
    {
      judgeModel: DEFAULT_FAST_JUDGE,
      judgeInstructions: ["Prefer exact 28.88 with clear subtotal + tax breakdown."],
      pairingMode: "all",
    },
  );
  const ranked = await ranker.rank();
  console.log(
    "\nPairwise Elo standings:",
    ranked.rankings.map((e) => `${e.provider}:${e.model} → Elo ${Math.round(e.elo)}`),
  );
}
