import { z } from 'zod';
import { ModelDetails } from '../cognition/types.js';
export interface CostBreakdown {
    promptCost: number;
    completionCost: number;
    totalCost: number;
    usage: TokenUsage;
}
export declare const TokenUsageSchema: any;
export declare const CostBreakdownSchema: any;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
/**
 * Estimates the cost for a given number of tokens based on model pricing
 */
export declare function estimateCost(model: ModelDetails, estimatedPromptTokens: number, estimatedCompletionTokens: number): CostBreakdown | null;
/**
 * Calculates the actual cost based on token usage from the model response
 */
export declare function calculateCost(model: ModelDetails, usage: TokenUsage): CostBreakdown | null;
/**
 * Helper function to format cost breakdown into a human readable string
 */
export declare function formatCostBreakdown(breakdown: CostBreakdown): string;
