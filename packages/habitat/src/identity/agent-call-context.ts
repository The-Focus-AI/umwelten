/**
 * Agent call-chain context — tracks the chain of agents currently mid-`agent_ask`
 * so nested calls can be guarded against unbounded recursion and cycles.
 *
 * Implemented with AsyncLocalStorage so the chain follows the async call tree
 * without having to thread it through every tool execute() signature.
 *
 * Default depth limit: 3. Override per-call via withAgentCall().
 */

import { AsyncLocalStorage } from "node:async_hooks";

export const DEFAULT_AGENT_CALL_DEPTH = 3;

export interface AgentCallContext {
  /** Ordered list of agent ids currently mid-`agent_ask`, root → leaf. */
  chain: string[];
  /** Maximum allowed chain length. */
  maxDepth: number;
}

const storage = new AsyncLocalStorage<AgentCallContext>();

/** Get the current call context, or undefined if not in any agent_ask chain. */
export function getAgentCallContext(): AgentCallContext | undefined {
  return storage.getStore();
}

export interface RecursionCheck {
  ok: boolean;
  reason?: "MAX_DEPTH" | "CYCLE";
  message?: string;
  chain: string[];
}

/**
 * Check whether `targetAgentId` can be invoked from inside the current
 * call context. Used by `agent_ask` before delegating.
 */
export function checkAgentCall(targetAgentId: string): RecursionCheck {
  const ctx = storage.getStore();
  if (!ctx) {
    return { ok: true, chain: [] };
  }
  if (ctx.chain.length >= ctx.maxDepth) {
    return {
      ok: false,
      reason: "MAX_DEPTH",
      message: `agent_ask call chain reached max depth ${ctx.maxDepth}: ${ctx.chain.join(" → ")} → ${targetAgentId}`,
      chain: ctx.chain,
    };
  }
  if (ctx.chain.includes(targetAgentId)) {
    return {
      ok: false,
      reason: "CYCLE",
      message: `agent_ask cycle detected: ${ctx.chain.join(" → ")} → ${targetAgentId} (already in chain)`,
      chain: ctx.chain,
    };
  }
  return { ok: true, chain: ctx.chain };
}

/**
 * Run `fn` inside an extended agent-call context with `agentId` pushed onto
 * the chain. Resets to the previous context when `fn` resolves.
 */
export async function withAgentCall<T>(
  agentId: string,
  fn: () => Promise<T>,
  options?: { maxDepth?: number },
): Promise<T> {
  const existing = storage.getStore();
  const next: AgentCallContext = existing
    ? { chain: [...existing.chain, agentId], maxDepth: existing.maxDepth }
    : { chain: [agentId], maxDepth: options?.maxDepth ?? DEFAULT_AGENT_CALL_DEPTH };
  return storage.run(next, fn);
}

/**
 * Reset the call context — used by tests and by isolated entry points
 * (top-level Habitat.createInteraction calls happen outside any chain).
 */
export async function withFreshAgentCallContext<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ chain: [], maxDepth: DEFAULT_AGENT_CALL_DEPTH }, fn);
}
