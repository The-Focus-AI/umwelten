import { ModelCosts, ModelDetails } from './models'

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

export interface CostBreakdown {
  promptCost: number
  completionCost: number
  totalCost: number
  usage: TokenUsage
}

/**
 * Estimates the cost for a given number of tokens based on model pricing
 */
export function estimateCost(model: ModelDetails, estimatedPromptTokens: number, estimatedCompletionTokens: number): CostBreakdown | null {
  if (!model.costs) {
    return null // Free model or costs not available
  }

  const usage = {
    promptTokens: estimatedPromptTokens,
    completionTokens: estimatedCompletionTokens
  }

  const promptCost = (model.costs.promptTokens * estimatedPromptTokens) / 1000
  const completionCost = (model.costs.completionTokens * estimatedCompletionTokens) / 1000

  return {
    promptCost,
    completionCost,
    totalCost: promptCost + completionCost,
    usage
  }
}

/**
 * Calculates the actual cost based on token usage from the model response
 */
export function calculateCost(model: ModelDetails, usage: TokenUsage): CostBreakdown | null {
  if (!model.costs) {
    return null // Free model or costs not available
  }

  const promptCost = (model.costs.promptTokens * usage.promptTokens) / 1000
  const completionCost = (model.costs.completionTokens * usage.completionTokens) / 1000

  return {
    promptCost,
    completionCost,
    totalCost: promptCost + completionCost,
    usage
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