import { z } from 'zod';

// Rate limit tracking for a specific model
export interface RateLimitState {
  requestCount: number;
  lastRequestTime: Date;
  backoffUntil?: Date;
  consecutiveFailures: number;
}

// Rate limit configuration
export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

// Schema for rate limit response headers
export const RateLimitHeadersSchema = z.object({
  'x-ratelimit-limit': z.string().optional(),
  'x-ratelimit-remaining': z.string().optional(),
  'x-ratelimit-reset': z.string().optional(),
}).partial();

// Default configuration
const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequestsPerMinute: 60,
  baseDelayMs: 1000,
  maxDelayMs: 64000, // Max delay of ~1 minute
  jitterFactor: 0.1,
};

// In-memory storage for rate limit state
const rateLimitStates = new Map<string, RateLimitState>();

/**
 * Calculate exponential backoff with jitter
 */
function calculateBackoff(consecutiveFailures: number, config: RateLimitConfig): number {
  const baseDelay = config.baseDelayMs;
  const maxDelay = config.maxDelayMs;
  
  // Calculate exponential delay: baseDelay * 2^failures
  let delay = baseDelay * Math.pow(2, consecutiveFailures);
  
  // Apply maximum delay cap
  delay = Math.min(delay, maxDelay);
  
  // Add jitter to prevent thundering herd
  const jitter = delay * config.jitterFactor * (Math.random() * 2 - 1);
  return delay + jitter;
}

/**
 * Check if we should allow a request based on rate limit state
 */
export function shouldAllowRequest(modelId: string, config: RateLimitConfig = DEFAULT_CONFIG): boolean {
  const now = new Date();
  const state = rateLimitStates.get(modelId) || {
    requestCount: 0,
    lastRequestTime: new Date(0),
    consecutiveFailures: 0,
  };

  // If we're in backoff, check if we can exit
  if (state.backoffUntil && state.backoffUntil > now) {
    return false;
  }

  // Reset request count if it's been more than a minute
  if (now.getTime() - state.lastRequestTime.getTime() > 60000) {
    state.requestCount = 0;
  }

  // Check if we're within rate limits
  return state.requestCount < config.maxRequestsPerMinute;
}

/**
 * Update rate limit state after a request
 */
export function updateRateLimitState(
  modelId: string,
  success: boolean,
  headers?: Record<string, string>,
  config: RateLimitConfig = DEFAULT_CONFIG
): void {
  const now = new Date();
  const state = rateLimitStates.get(modelId) || {
    requestCount: 0,
    lastRequestTime: new Date(0),
    consecutiveFailures: 0,
  };

  // Parse rate limit headers if available
  if (headers) {
    const parsedHeaders = RateLimitHeadersSchema.safeParse(headers);
    if (parsedHeaders.success) {
      // Update state based on headers
      // This is provider-specific and can be enhanced based on actual headers
    }
  }

  if (success) {
    // Reset failure count on success
    state.consecutiveFailures = 0;
    state.backoffUntil = undefined;
  } else {
    // Increment failure count and calculate backoff
    state.consecutiveFailures++;
    const backoffMs = calculateBackoff(state.consecutiveFailures, config);
    state.backoffUntil = new Date(now.getTime() + backoffMs);
  }

  // Update request count and time
  if (now.getTime() - state.lastRequestTime.getTime() > 60000) {
    state.requestCount = 1;
  } else {
    state.requestCount++;
  }
  state.lastRequestTime = now;

  // Update state in storage
  rateLimitStates.set(modelId, state);
}

/**
 * Get current rate limit state for a model
 */
export function getRateLimitState(modelId: string): RateLimitState | undefined {
  return rateLimitStates.get(modelId);
}

/**
 * Clear rate limit state for a model
 */
export function clearRateLimitState(modelId: string): void {
  rateLimitStates.delete(modelId);
} 