#!/usr/bin/env node
/**
 * Reasoning Eval — 4 logic puzzles culminating in the 12-coin balance problem.
 *
 * Usage:
 *   pnpm tsx examples/evals/reasoning.ts                # instant deterministic mock
 *   pnpm tsx examples/evals/reasoning.ts --live         # live cloud + local models
 *   pnpm tsx examples/evals/reasoning.ts --all --live   # full 20-model fast roster
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

setupExampleRuntime(FAST_MODEL_ROSTER);

const judgeSchema = z.object({
  reasoning_quality: z.coerce.number().min(1).max(5).describe("1=missed, 3=partial, 5=perfect"),
  explanation: z.string().describe("Brief explanation"),
});

const suite = new EvalSuite({
  name: "reasoning-eval",
  systemPrompt: "Think carefully, give a clear answer, and explain your procedure concisely.",
  temperature: 0.3,
  judgeModel: DEFAULT_FAST_JUDGE,
  models: QUICK_FAST_MODELS,
  allModels: FAST_MODEL_ROSTER,
  tasks: [
    {
      id: "surgeon",
      name: "Surgeon Riddle",
      prompt:
        'A father and his son are in a car accident. The father dies. The son is rushed to the hospital. The surgeon says: "I can\'t operate on this boy, he\'s my son." How is this possible?',
      maxScore: 5,
      judge: {
        schema: judgeSchema,
        instructions: [
          "Correct answer: the surgeon is the boy's mother (or second father).",
          "5=directly answers, 3=hedges across many guesses, 1=missed.",
        ],
      },
    },
    {
      id: "bat-ball",
      name: "Bat & Ball",
      prompt:
        "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?",
      maxScore: 5,
      judge: {
        schema: judgeSchema,
        instructions: [
          "Correct answer: $0.05 (five cents). Trap answer: $0.10.",
          "5=immediately gets $0.05, 2=says $0.10.",
        ],
      },
    },
    {
      id: "lily-pad",
      name: "Lily Pad",
      prompt:
        "A patch of lily pads doubles in size every day. If it takes 48 days to cover the entire lake, how many days to cover half?",
      maxScore: 5,
      judge: {
        schema: judgeSchema,
        instructions: ["Correct answer: 47 days. Trap answer: 24.", "5=immediately says 47, 2=says 24."],
      },
    },
    {
      id: "counterfeit-coin",
      name: "12-Coin Balance",
      prompt:
        "You have 12 coins. One is counterfeit (heavier or lighter). Using a balance scale at most 3 times, explain a complete procedure that finds the counterfeit coin and determines heavier/lighter.",
      maxScore: 5,
      judge: {
        schema: judgeSchema,
        instructions: [
          "5=complete 3-weighing decision tree covering balanced and tilted branches with coin rotation.",
          "3=starts with 4v4 but hand-waves Step 2, 1=claims impossible.",
        ],
      },
    },
  ],
});

await suite.run();
