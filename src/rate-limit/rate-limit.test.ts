import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldAllowRequest,
  updateRateLimitState,
  getRateLimitState,
  clearRateLimitState,
  type RateLimitConfig
} from './rate-limit.ts';

describe('Rate Limit Handling', () => {
  const testModelId = 'test-model';
  const testConfig: RateLimitConfig = {
    maxRequestsPerMinute: 2,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    jitterFactor: 0.1
  };

  beforeEach(() => {
    // Clear rate limit state before each test
    clearRateLimitState(testModelId);
  });

  describe('Request Allowance', () => {
    it('should allow requests within rate limit', () => {
      expect(shouldAllowRequest(testModelId, testConfig)).toBe(true);
      updateRateLimitState(testModelId, true, undefined, testConfig);
      expect(shouldAllowRequest(testModelId, testConfig)).toBe(true);
    });

    it('should block requests over rate limit', () => {
      // Make maximum allowed requests
      expect(shouldAllowRequest(testModelId, testConfig)).toBe(true);
      updateRateLimitState(testModelId, true, undefined, testConfig);
      expect(shouldAllowRequest(testModelId, testConfig)).toBe(true);
      updateRateLimitState(testModelId, true, undefined, testConfig);

      // Next request should be blocked
      expect(shouldAllowRequest(testModelId, testConfig)).toBe(false);
    });
  });

  describe('Backoff Handling', () => {
    it('should implement exponential backoff on failures', async () => {
      // First request fails
      updateRateLimitState(testModelId, false, undefined, testConfig);
      const state1 = getRateLimitState(testModelId);
      expect(state1?.consecutiveFailures).toBe(1);
      expect(state1?.backoffUntil).toBeDefined();
      const firstBackoff = state1?.backoffUntil?.getTime();

      // Wait a small amount to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 1));

      // Second failure should increase backoff
      updateRateLimitState(testModelId, false, undefined, testConfig);
      const state2 = getRateLimitState(testModelId);
      expect(state2?.consecutiveFailures).toBe(2);
      expect(state2?.backoffUntil).toBeDefined();
      const secondBackoff = state2?.backoffUntil?.getTime();
      
      // Verify second backoff is longer than first
      if (firstBackoff && secondBackoff) {
        expect(secondBackoff).toBeGreaterThan(firstBackoff);
      } else {
        throw new Error('Backoff times not properly set');
      }
    });

    it('should reset backoff after success', () => {
      // First request fails
      updateRateLimitState(testModelId, false, undefined, testConfig);
      const failedState = getRateLimitState(testModelId);
      expect(failedState?.consecutiveFailures).toBe(1);
      expect(failedState?.backoffUntil).toBeDefined();

      // Successful request resets backoff
      updateRateLimitState(testModelId, true, undefined, testConfig);
      const successState = getRateLimitState(testModelId);
      expect(successState?.consecutiveFailures).toBe(0);
      expect(successState?.backoffUntil).toBeUndefined();
    });
  });

  describe('Rate Limit Headers', () => {
    it('should handle rate limit headers', () => {
      const headers = {
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '59',
        'x-ratelimit-reset': '1500000000'
      };

      updateRateLimitState(testModelId, true, headers, testConfig);
      const state = getRateLimitState(testModelId);
      expect(state).toBeDefined();
      expect(state?.requestCount).toBe(1);
    });
  });

  describe('State Management', () => {
    it('should clear rate limit state', () => {
      // Set some state
      updateRateLimitState(testModelId, true, undefined, testConfig);
      expect(getRateLimitState(testModelId)).toBeDefined();

      // Clear state
      clearRateLimitState(testModelId);
      expect(getRateLimitState(testModelId)).toBeUndefined();
    });

    it('should track request count correctly', () => {
      // Make a few requests
      updateRateLimitState(testModelId, true, undefined, testConfig);
      updateRateLimitState(testModelId, true, undefined, testConfig);

      const state = getRateLimitState(testModelId);
      expect(state?.requestCount).toBe(2);
    });
  });

  describe('Ollama Provider', () => {
    const ollamaModelId = 'ollama-model';
    const ollamaConfig: RateLimitConfig = {
      maxRequestsPerMinute: Infinity, // No rate limit for ollama
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterFactor: 0
    };

    it('should never rate limit requests to ollama', () => {
      expect(shouldAllowRequest(ollamaModelId, ollamaConfig)).toBe(true);
      updateRateLimitState(ollamaModelId, true, undefined, ollamaConfig);
      expect(shouldAllowRequest(ollamaModelId, ollamaConfig)).toBe(true);
      updateRateLimitState(ollamaModelId, true, undefined, ollamaConfig);
      expect(shouldAllowRequest(ollamaModelId, ollamaConfig)).toBe(true);
    });
  });
}); 