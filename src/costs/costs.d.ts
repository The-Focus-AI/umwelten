import { z } from 'zod';
import { ModelDetails } from '../cognition/types.js';
export interface CostBreakdown {
    promptCost: number;
    completionCost: number;
    totalCost: number;
    usage: TokenUsage;
}
export declare const TokenUsageSchema: z.ZodObject<{
    promptTokens: z.ZodNumber;
    completionTokens: z.ZodNumber;
    total: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const CostBreakdownSchema: z.ZodObject<{
    promptCost: z.ZodNumber;
    completionCost: z.ZodNumber;
    totalCost: z.ZodNumber;
    usage: z.ZodObject<{
        promptTokens: z.ZodNumber;
        completionTokens: z.ZodNumber;
        total: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
}, z.core.$strip>;
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
