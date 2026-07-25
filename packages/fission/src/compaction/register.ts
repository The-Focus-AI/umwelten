/**
 * Register the fission compaction strategies into core's registry.
 *
 * They go into the *shared* registry rather than a private one, so anything
 * that already calls `interaction.compactContext(id)` — the habitat REPL, the
 * session tools, the digester — can use them too. The experiment's strategies
 * and the product's strategies are the same objects.
 */

import {
  registerCompactionStrategy,
  listCompactionStrategies,
} from "@umwelten/core/context/registry.js";
import type { CompactionStrategy } from "@umwelten/core/context/types.js";
import { rollingSummaryStrategy } from "./rolling-summary.js";
import { topicCarryoverStrategy } from "./topic-carryover.js";
import { recentWindowStrategy } from "./recent-window.js";

export const FISSION_STRATEGIES: CompactionStrategy[] = [
  rollingSummaryStrategy,
  topicCarryoverStrategy,
  recentWindowStrategy,
];

let registered = false;

/** Idempotent. Call before any compaction runs. */
export function registerFissionStrategies(): void {
  if (registered) return;
  registered = true;
  for (const strategy of FISSION_STRATEGIES) {
    registerCompactionStrategy(strategy);
  }
}

/** Every strategy available to the playground: core's plus this package's. */
export async function listAllStrategies(): Promise<CompactionStrategy[]> {
  registerFissionStrategies();
  return listCompactionStrategies();
}
