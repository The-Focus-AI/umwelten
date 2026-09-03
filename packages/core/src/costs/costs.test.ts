import { describe, it, expect } from 'vitest'
import { estimateCost, calculateCost, formatCostBreakdown, type TokenUsage } from './costs.js'
import { type ModelDetails } from '../cognition/types.js'

describe('Cost Utilities', () => {
  const mockModel: ModelDetails = {
    name: 'Test Model',
    provider: 'test-provider',
    contextLength: 4096,
    costs: {
      promptTokens: 10,    // $10 per 1M prompt tokens (previously $0.01/1k)
      completionTokens: 30  // $30 per 1M completion tokens (previously $0.03/1k)
    }
  }

  const mockFreeModel: ModelDetails = {
    name: 'Free Model',
    provider: 'ollama',
    contextLength: 4096,
  }

  describe('estimateCost', () => {
    it('should estimate costs correctly for paid models (per million tokens)', () => {
      const breakdown = estimateCost(mockModel, 1000, 500); // 1k prompt, 500 completion
      expect(breakdown).not.toBeNull();
      
      if (breakdown) {
        // Expected prompt cost: (10 * 1000) / 1,000,000 = 0.01
        expect(breakdown.promptCost).toBeCloseTo(0.01);
        // Expected completion cost: (30 * 500) / 1,000,000 = 0.015
        expect(breakdown.completionCost).toBeCloseTo(0.015);
        // Expected total cost: 0.01 + 0.015 = 0.025
        expect(breakdown.totalCost).toBeCloseTo(0.025);
        expect(breakdown.usage).toEqual({
          promptTokens: 1000,
          completionTokens: 500,
          total: 1500
        });
      }
    });

    it('should return null for models without cost defined', () => {
      const breakdown = estimateCost(mockFreeModel, 1000, 500);
      expect(breakdown).toBeNull();
    });
  })

  describe('calculateCost', () => {
    it('should calculate actual costs correctly for paid models (per million tokens)', () => {
      const usage: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        total: 3000
      };

      const breakdown = calculateCost(mockModel, usage);
      expect(breakdown).not.toBeNull();
      
      if (breakdown) {
        // Expected prompt cost: (10 * 2000) / 1,000,000 = 0.02
        expect(breakdown.promptCost).toBeCloseTo(0.02);
        // Expected completion cost: (30 * 1000) / 1,000,000 = 0.03
        expect(breakdown.completionCost).toBeCloseTo(0.03);
        // Expected total cost: 0.02 + 0.03 = 0.05
        expect(breakdown.totalCost).toBeCloseTo(0.05);
        expect(breakdown.usage).toEqual(usage);
      }
    });

    it('should return null for models without cost defined', () => {
      const usage: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        total: 3000
      };

      const breakdown = calculateCost(mockFreeModel, usage);
      expect(breakdown).toBeNull();
    });

    describe('prompt cache', () => {
      const cachedModel: ModelDetails = {
        name: 'Cached Model',
        provider: 'test-provider',
        costs: {
          promptTokens: 10,
          completionTokens: 30,
          cacheReadTokens: 1,   // 10× cheaper than plain input
          cacheWriteTokens: 12.5,
        },
      };

      it('prices cache-read tokens at the cache rate and the rest at the input rate', () => {
        const breakdown = calculateCost(cachedModel, {
          promptTokens: 1000,
          completionTokens: 0,
          cacheReadTokens: 800,
        });
        expect(breakdown).not.toBeNull();
        // 200 uncached × $10/M = 0.002; 800 cached × $1/M = 0.0008
        expect(breakdown!.cacheReadCost).toBeCloseTo(0.0008, 10);
        expect(breakdown!.promptCost).toBeCloseTo(0.0028, 10);
        expect(breakdown!.cacheWriteCost).toBeUndefined();
        // Cheaper than pricing the whole prompt as plain input.
        expect(breakdown!.promptCost).toBeLessThan(0.01);
      });

      it('prices cache-write tokens at the write rate', () => {
        const breakdown = calculateCost(cachedModel, {
          promptTokens: 1000,
          completionTokens: 0,
          cacheWriteTokens: 1000,
        });
        // 0 uncached; 1000 × $12.5/M = 0.0125
        expect(breakdown!.cacheWriteCost).toBeCloseTo(0.0125, 10);
        expect(breakdown!.promptCost).toBeCloseTo(0.0125, 10);
      });

      it('falls back to the input rate when the model has no cache rates', () => {
        const breakdown = calculateCost(mockModel, {
          promptTokens: 1000,
          completionTokens: 0,
          cacheReadTokens: 800,
        });
        // Same as 1000 × $10/M — never undercounts vs. the old formula.
        expect(breakdown!.promptCost).toBeCloseTo(0.01, 10);
        expect(breakdown!.cacheReadCost).toBeCloseTo(0.008, 10);
      });

      it('clamps cache tokens that exceed promptTokens', () => {
        const breakdown = calculateCost(cachedModel, {
          promptTokens: 100,
          completionTokens: 0,
          cacheReadTokens: 500,
        });
        expect(breakdown!.promptCost).toBeCloseTo(0.0001, 10); // 100 × $1/M
      });
    });
  })

  describe('formatCostBreakdown', () => {
    it('should format cost breakdown correctly', () => {
      const breakdown = {
        promptCost: 0.02,
        completionCost: 0.03,
        totalCost: 0.05,
        usage: {
          promptTokens: 2000,
          completionTokens: 1000,
          total: 3000
        }
      }

      const formatted = formatCostBreakdown(breakdown)
      expect(formatted).toContain('Prompt (2000 tokens)')
      expect(formatted).toContain('$0.020000')
      expect(formatted).toContain('Completion (1000 tokens)')
      expect(formatted).toContain('$0.030000')
      expect(formatted).toContain('Total: $0.050000')
    })
  })
}) 