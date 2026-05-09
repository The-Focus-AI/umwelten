/**
 * Registry for compaction strategies. Built-in strategies are registered lazily to avoid circular dependency with Interaction.
 */

import type { CompactionStrategy } from "./types.js";

const strategies = new Map<string, CompactionStrategy>();

const BUILTIN_IDS = ["through-line-and-facts", "truncate"] as const;
let builtinsRegistered = false;

async function ensureBuiltins(): Promise<void> {
  if (builtinsRegistered) return;
  const [{ throughLineAndFactsStrategy }, { truncateStrategy }] = await Promise.all([
    import("./strategies/through-line-and-facts.js"),
    import("./strategies/truncate.js"),
  ]);
  registerCompactionStrategy(throughLineAndFactsStrategy);
  registerCompactionStrategy(truncateStrategy);
  builtinsRegistered = true;
}

export function registerCompactionStrategy(s: CompactionStrategy): void {
  strategies.set(s.id, s);
}

export async function getCompactionStrategy(id: string): Promise<CompactionStrategy | undefined> {
  if ((BUILTIN_IDS as readonly string[]).includes(id)) {
    await ensureBuiltins();
  }
  return strategies.get(id);
}

export async function listCompactionStrategies(): Promise<CompactionStrategy[]> {
  await ensureBuiltins();
  return Array.from(strategies.values());
}

export function registerBuiltins(): void {
  ensureBuiltins();
}
