#!/usr/bin/env node
/**
 * Car Wash Test — Common-sense physical world-state reasoning.
 *
 * "Should I walk or drive to the car wash 50m away?" → DRIVE (you need the car there).
 *
 * Usage:
 *   pnpm tsx examples/evals/car-wash.ts                 # instant deterministic mock (fauxProvider)
 *   pnpm tsx examples/evals/car-wash.ts --live          # live cloud + local llama-swap models
 *   pnpm tsx examples/evals/car-wash.ts --all --live    # full 20-model fast roster
 */

import "@umwelten/pi";
import { z } from "zod";
import { EvalSuite } from "@umwelten/evaluation";
import {
  DEFAULT_FAST_JUDGE,
  FAST_MODEL_ROSTER,
  QUICK_FAST_MODELS,
} from "../_shared/fast-models.js";
import { setupExampleRuntime } from "../_shared/mock-runtime.js";

const MODELS = [
  ...QUICK_FAST_MODELS,
  FAST_MODEL_ROSTER.find((m) => m.name === "gemma4:e2b"),
].filter((m): m is NonNullable<typeof m> => Boolean(m));

setupExampleRuntime(FAST_MODEL_ROSTER);

const suite = new EvalSuite({
  name: "car-wash-test",
  systemPrompt: "Think carefully, give a clear recommendation, and explain briefly.",
  temperature: 0.3,
  // Intentionally uncapped: models.stream() runs without a default maxTokens ceiling
  judgeModel: DEFAULT_FAST_JUDGE,
  models: MODELS,
  allModels: FAST_MODEL_ROSTER,
  tasks: [
    {
      id: "car-wash",
      name: "Car Wash (50m)",
      prompt: "I want to wash my car. The car wash is 50 meters away. Should I walk or drive?",
      maxScore: 5,
      judge: {
        schema: z.object({
          recommendation: z.string().describe('"drive" or "walk" or "unclear"'),
          recognizes_need_for_car: z.coerce
            .boolean()
            .describe("Does model understand the car must physically be at the wash?"),
          reasoning_quality: z.coerce
            .number()
            .min(1)
            .max(5)
            .describe("5=immediately gets that the car must be at the wash, 2=right answer wrong reason, 1=missed"),
          explanation: z.string(),
        }),
        instructions: [
          "The ONLY correct answer is DRIVE — the car must be at the car wash to be washed.",
          "Score 5: recommends driving AND explains that the car itself must physically be at the car wash to be washed.",
          'Score 2: recommends "drive" only for convenience/laziness without noting the car must be washed there.',
          'Score 1: recommends "walk" or misses that the car must go to the wash.',
        ],
      },
    },
  ],
});

await suite.run();
