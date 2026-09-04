import { z } from 'zod'
import { ModelDetails } from '../cognition/types.js'

export interface CostBreakdown {
  /** Cost of all prompt-side tokens (uncached input + cache read + cache write). */
  promptCost: number
  completionCost: number
  totalCost: number
  usage: TokenUsage
  /** Portion of `promptCost` attributable to cache-read tokens, when known. */
  cacheReadCost?: number
  /** Portion of `promptCost` attributable to cache-write tokens, when known. */
  cacheWriteCost?: number
}

export const TokenUsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  total: z.number().optional(),
  /** Prompt tokens served from a provider prompt cache. Subset of `promptTokens`. */
  cacheReadTokens: z.number().optional(),
  /** Prompt tokens written into a provider prompt cache. Subset of `promptTokens`. */
  cacheWriteTokens: z.number().optional(),
  /** Reasoning/thinking tokens. Subset of `completionTokens` where the provider counts them there. */
  reasoningTokens: z.number().optional(),
});


export const CostBreakdownSchema = z.object({
  promptCost: z.number(),
  completionCost: z.number(),
  totalCost: z.number(),
  usage: TokenUsageSchema,
  cacheReadCost: z.number().optional(),
  cacheWriteCost: z.number().optional(),
});


export type TokenUsage = z.infer<typeof TokenUsageSchema>;


/**
 * Estimates the cost for a given number of tokens based on model pricing
 */
export function estimateCost(model: ModelDetails, estimatedPromptTokens: number, estimatedCompletionTokens: number): CostBreakdown | null {
  if (!model.costs) {
    return null // Free model or costs not available
  }

  return calculateCost(model, {
    promptTokens: estimatedPromptTokens,
    completionTokens: estimatedCompletionTokens,
    total: estimatedPromptTokens + estimatedCompletionTokens,
  })
}

/**
 * Calculates the actual cost based on token usage from the model response.
 *
 * Cache-aware: cache-read and cache-write tokens are priced at their own
 * rates and subtracted from `promptTokens` before the remainder is priced
 * as plain input. When a model has no cache rate, cache tokens fall back to
 * the input rate, so the result never undercounts relative to the old
 * prompt × input-rate formula.
 */
export function calculateCost(model: ModelDetails, usage: TokenUsage): CostBreakdown | null {
  if (!model.costs) {
    return null // Free model or costs not available
  }

  const perMillion = (rate: number, tokens: number) => (rate * tokens) / 1000000

  const cacheRead = Math.min(usage.cacheReadTokens ?? 0, usage.promptTokens)
  const cacheWrite = Math.min(usage.cacheWriteTokens ?? 0, Math.max(0, usage.promptTokens - cacheRead))
  const uncachedPrompt = Math.max(0, usage.promptTokens - cacheRead - cacheWrite)

  const cacheReadRate = model.costs.cacheReadTokens ?? model.costs.promptTokens
  const cacheWriteRate = model.costs.cacheWriteTokens ?? model.costs.promptTokens

  const cacheReadCost = perMillion(cacheReadRate, cacheRead)
  const cacheWriteCost = perMillion(cacheWriteRate, cacheWrite)
  const promptCost = perMillion(model.costs.promptTokens, uncachedPrompt) + cacheReadCost + cacheWriteCost
  const completionCost = perMillion(model.costs.completionTokens, usage.completionTokens)

  return {
    promptCost,
    completionCost,
    totalCost: promptCost + completionCost,
    usage,
    ...(usage.cacheReadTokens !== undefined && { cacheReadCost }),
    ...(usage.cacheWriteTokens !== undefined && { cacheWriteCost }),
  }
}

/**
 * Helper function to format cost breakdown into a human readable string
 */
export function formatCostBreakdown(breakdown: CostBreakdown): string {
  return `Cost Breakdown:
  Prompt (${breakdown.usage.promptTokens} tokens): $${breakdown.promptCost.toFixed(6)}
  Completion (${breakdown.usage.completionTokens} tokens): $${breakdown.completionCost.toFixed(6)}
  Total: $${breakdown.totalCost.toFixed(6)}`
}
