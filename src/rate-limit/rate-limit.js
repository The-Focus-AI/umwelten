import { z } from 'zod';
// Schema for rate limit response headers
export const RateLimitHeadersSchema = z.object({
    'x-ratelimit-limit': z.string().optional(),
    'x-ratelimit-remaining': z.string().optional(),
    'x-ratelimit-reset': z.string().optional(),
}).partial();
// Default configuration
const DEFAULT_CONFIG = {
    maxRequestsPerMinute: 60,
    baseDelayMs: 1000,
    maxDelayMs: 64000, // Max delay of ~1 minute
    jitterFactor: 0.1,
};
// In-memory storage for rate limit state
const rateLimitStates = new Map();
/**
 * Calculate exponential backoff with jitter
 */
function calculateBackoff(consecutiveFailures, config) {
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
// Function to determine if an error is retriable
export function isRetriableError(error) {
    if (!error)
        return false;
    // Handle OpenAI-like error responses
    if (error.status) {
        // 429 is the classic rate limit error
        if (error.status === 429)
            return true;
        // 5xx errors are server-side issues, often transient
        if (error.status >= 500 && error.status <= 599)
            return true;
    }
    // Add other checks for transient network errors if needed
    // e.g., ECONNRESET, ETIMEDOUT
    if (error.code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(error.code)) {
        return true;
    }
    return false;
}
/**
 * Check if we should allow a request based on rate limit state
 */
export function shouldAllowRequest(modelId, config = DEFAULT_CONFIG) {
    const now = new Date();
    let state = rateLimitStates.get(modelId);
    if (!state) {
        return true;
    }
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
export function updateRateLimitState(modelId, success, error, headers, config = DEFAULT_CONFIG) {
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
    const errorType = isRetriableError(error) ? 'soft' : 'hard';
    if (success) {
        // Reset failure count on success
        state.consecutiveFailures = 0;
        state.backoffUntil = undefined;
    }
    else {
        // For soft errors, increment failure count and calculate backoff
        if (errorType === 'soft') {
            state.consecutiveFailures++;
            const backoffMs = calculateBackoff(state.consecutiveFailures, config);
            state.backoffUntil = new Date(now.getTime() + backoffMs);
        }
        else {
            // For hard errors, do not backoff, just log the failure internally
            // and reset consecutive failures to not penalize future requests.
            state.consecutiveFailures = 0;
            state.backoffUntil = undefined;
        }
    }
    // Update request count and time
    if (now.getTime() - state.lastRequestTime.getTime() > 60000) {
        state.requestCount = 1;
    }
    else {
        state.requestCount++;
    }
    state.lastRequestTime = now;
    // Update state in storage
    rateLimitStates.set(modelId, state);
}
/**
 * Get current rate limit state for a model
 */
export function getRateLimitState(modelId) {
    return rateLimitStates.get(modelId);
}
/**
 * Clear rate limit state for a model
 */
export function clearRateLimitState(modelId) {
    rateLimitStates.delete(modelId);
}
//# sourceMappingURL=rate-limit.js.map