import { describe, it, expect } from 'vitest'
import { estimateCost, calculateCost, formatCostBreakdown, type TokenUsage } from './costs.js'
import { type ModelDetails } from '../models/types.js'

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