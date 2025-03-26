import { describe, it, expect } from 'vitest'
import { estimateCost, calculateCost, formatCostBreakdown, type TokenUsage } from './costs.ts'
import { type ModelDetails } from '../models/models.ts'

describe('Cost Utilities', () => {
  const mockModel: ModelDetails = {
    id: 'test-model',
    name: 'Test Model',
    contextLength: 4096,
    provider: 'openrouter',
    costs: {
      promptTokens: 0.01,    // $0.01 per 1K prompt tokens
      completionTokens: 0.03  // $0.03 per 1K completion tokens
    }
  }

  const mockFreeModel: ModelDetails = {
    id: 'free-model',
    name: 'Free Model',
    contextLength: 4096,
    provider: 'ollama'
  }

  describe('estimateCost', () => {
    it('should estimate costs correctly for paid models', () => {
      const breakdown = estimateCost(mockModel, 1000, 500)
      expect(breakdown).not.toBeNull()
      
      if (breakdown) {
        expect(breakdown.promptCost).toBe(0.01) // 1000 tokens * $0.01/1K
        expect(breakdown.completionCost).toBe(0.015) // 500 tokens * $0.03/1K
        expect(breakdown.totalCost).toBe(0.025)
        expect(breakdown.usage).toEqual({
          promptTokens: 1000,
          completionTokens: 500,
          total: 1500
        })
      }
    })

    it('should return null for free models', () => {
      const breakdown = estimateCost(mockFreeModel, 1000, 500)
      expect(breakdown).toBeNull()
    })
  })

  describe('calculateCost', () => {
    it('should calculate actual costs correctly for paid models', () => {
      const usage: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        total: 3000
      }

      const breakdown = calculateCost(mockModel, usage)
      expect(breakdown).not.toBeNull()
      
      if (breakdown) {
        expect(breakdown.promptCost).toBe(0.02) // 2000 tokens * $0.01/1K
        expect(breakdown.completionCost).toBe(0.03) // 1000 tokens * $0.03/1K
        expect(breakdown.totalCost).toBe(0.05)
        expect(breakdown.usage).toEqual(usage)
      }
    })

    it('should return null for free models', () => {
      const usage: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        total: 3000
      }

      const breakdown = calculateCost(mockFreeModel, usage)
      expect(breakdown).toBeNull()
    })
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