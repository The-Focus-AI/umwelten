import { z } from 'zod';
export type RateLimitErrorType = 'soft' | 'hard';
export interface RateLimitState {
    requestCount: number;
    lastRequestTime: Date;
    backoffUntil?: Date;
    consecutiveFailures: number;
}
export interface RateLimitConfig {
    maxRequestsPerMinute: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitterFactor: number;
}
export declare const RateLimitHeadersSchema: z.ZodObject<{
    'x-ratelimit-limit': z.ZodOptional<z.ZodOptional<z.ZodString>>;
    'x-ratelimit-remaining': z.ZodOptional<z.ZodOptional<z.ZodString>>;
    'x-ratelimit-reset': z.ZodOptional<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export declare function isRetriableError(error: any): boolean;
/**
 * Check if we should allow a request based on rate limit state
 */
export declare function shouldAllowRequest(modelId: string, config?: RateLimitConfig): boolean;
/**
 * Update rate limit state after a request
 */
export declare function updateRateLimitState(modelId: string, success: boolean, error?: any, headers?: Record<string, string>, config?: RateLimitConfig): void;
/**
 * Get current rate limit state for a model
 */
export declare function getRateLimitState(modelId: string): RateLimitState | undefined;
/**
 * Clear rate limit state for a model
 */
export declare function clearRateLimitState(modelId: string): void;
