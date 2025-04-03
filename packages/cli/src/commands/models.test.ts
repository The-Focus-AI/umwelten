import { describe, it, expect, vi } from 'vitest'
import { modelsCommand } from './models'
import type { ModelDetails } from '@model-eval/core/src/models/models.js'

describe('Models Command', () => {
  // Mock model data
  const mockModels: ModelDetails[] = [
    {
      modelId: 'gemini-1.5-pro',
      provider: 'google',
      route: 'direct',
      name: 'Gemini Pro',
      contextLength: 32768,
      costs: {
        promptTokens: 0.0005,
        completionTokens: 0.0005
      }
    },
    {
      modelId: 'gpt-4-turbo-preview',
      provider: 'openai',
      route: 'openrouter',
      name: 'GPT-4 Turbo',
      contextLength: 128000,
      costs: {
        promptTokens: 0.01,
        completionTokens: 0.03
      }
    }
  ]

  // Mock the getAllModels function
  vi.mock('@model-eval/core/src/models/models.js', () => ({
    getAllModels: vi.fn().mockResolvedValue(mockModels),
    searchModels: vi.fn().mockImplementation((query: string, models: ModelDetails[]) => {
      return models.filter((m: ModelDetails) => 
        m.name?.toLowerCase().includes(query.toLowerCase()) ||
        m.modelId.toLowerCase().includes(query.toLowerCase())
      )
    })
  }))

  describe('List Models', () => {
    it('should list all available models in table format', async () => {
      const mockConsoleLog = vi.spyOn(console, 'log')
      await modelsCommand.parseAsync(['node', 'test'])
      
      expect(mockConsoleLog).toHaveBeenCalled()
      const output = mockConsoleLog.mock.calls.join('\n')
      expect(output).toContain('gemini-1.5-pro')
      expect(output).toContain('gpt-4-turbo-preview')
      expect(output).toContain('google')
      expect(output).toContain('openai')
      
      mockConsoleLog.mockRestore()
    })

    it('should list models in JSON format', async () => {
      const mockConsoleLog = vi.spyOn(console, 'log')
      await modelsCommand.parseAsync(['node', 'test', '--json'])
      
      expect(mockConsoleLog).toHaveBeenCalled()
      const output = mockConsoleLog.mock.calls[0][0]
      const parsed = JSON.parse(output)
      expect(parsed).toHaveLength(2)
      expect(parsed[0].modelId).toBe('gemini-1.5-pro')
      expect(parsed[1].modelId).toBe('gpt-4-turbo-preview')
      
      mockConsoleLog.mockRestore()
    })

    it('should filter models by provider', async () => {
      const mockConsoleLog = vi.spyOn(console, 'log')
      await modelsCommand.parseAsync(['node', 'test', '--provider', 'google', '--json'])
      
      expect(mockConsoleLog).toHaveBeenCalled()
      const output = mockConsoleLog.mock.calls[0][0]
      const parsed = JSON.parse(output)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].modelId).toBe('gemini-1.5-pro')
      expect(parsed[0].provider).toBe('google')
      
      mockConsoleLog.mockRestore()
    })
  })

  describe('Model Info', () => {
    it('should display detailed model information', async () => {
      const mockConsoleLog = vi.spyOn(console, 'log')
      await modelsCommand.parseAsync(['node', 'test', '--id', 'gemini-1.5-pro'])
      
      expect(mockConsoleLog).toHaveBeenCalled()
      const output = mockConsoleLog.mock.calls.join('\n')
      expect(output).toContain('gemini-1.5-pro')
      expect(output).toContain('google')
      expect(output).toContain('32768')
      expect(output).toContain('$0.0005')
      
      mockConsoleLog.mockRestore()
    })
  })

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      vi.mock('@model-eval/core/src/models/models.js', () => ({
        getAllModels: vi.fn().mockRejectedValue(new Error('API Error'))
      }))

      const mockConsoleError = vi.spyOn(console, 'error')
      await modelsCommand.parseAsync(['node', 'test'])
      
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Error fetching models')
      )
      
      mockConsoleError.mockRestore()
    })
  })
}) 