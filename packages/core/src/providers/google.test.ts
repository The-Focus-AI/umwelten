import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createGoogleProvider } from './google.js'
import { generateText } from 'ai'
import type { ModelDetails } from '../models/models.js'
import type { ModelRoute } from '../models/types.js'

describe('Google Provider', () => {
  const originalEnv = process.env
  const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY

  beforeEach(() => {
    if (!GOOGLE_API_KEY) {
      throw new Error('GOOGLE_GENERATIVE_AI_API_KEY environment variable is required')
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  // Helper function to skip tests if no API key
  const itWithAuth = GOOGLE_API_KEY ? it : it.skip

  // Test route using Gemini Pro
  const TEST_ROUTE: ModelRoute = {
    modelId: 'gemini-pro',
    provider: 'google',
    route: 'direct'
  }

  describe('Provider Instance', () => {
    it('should create a provider instance', () => {
      const provider = createGoogleProvider(GOOGLE_API_KEY!)
      expect(provider).toBeDefined()
      expect(typeof provider).toBe('object')
      expect(provider).not.toBeNull()
    })

    it('should fail without API key', () => {
      expect(() => createGoogleProvider('')).toThrow()
    })
  })

  describe('Model Listing', () => {
    it('should list available models with required fields', async () => {
      const provider = createGoogleProvider(GOOGLE_API_KEY!)
      const models = await provider.listModels()
      expect(models).toBeInstanceOf(Array)
      expect(models.length).toBeGreaterThan(0)
      
      // Log first model for debugging
      console.log('First model:', models[models.length - 1])
      
      models.forEach((model: ModelDetails) => {
        expect(model.modelId).toBeDefined()
        expect(model.name).toBeDefined()
        expect(model.provider).toBe('google')
        expect(model.route).toBe('direct')
        expect(model.contextLength).toBeTypeOf('number')
        
        // Check costs
        expect(model.costs).toBeDefined()
        expect(model.costs?.promptTokens).toBeTypeOf('number')
        expect(model.costs?.completionTokens).toBeTypeOf('number')
      })
    })
  })

  describe('Text Generation', () => {
    itWithAuth('should generate text with Gemini Pro', async () => {
      const provider = createGoogleProvider(GOOGLE_API_KEY!)
      const model = provider.getLanguageModel(TEST_ROUTE)
      const prompt = 'Write a haiku about coding'
      
      const response = await generateText({
        model,
        prompt
      })

      console.log('Generated text:', response.text)
      
      expect(response.text).toBeTruthy()
      expect(typeof response.text).toBe('string')
      expect(response.text.length).toBeGreaterThan(0)
      
      // Check usage statistics
      expect(response).toHaveProperty('usage')
      if (response.usage) {
        console.log('Usage stats:', response.usage)
        expect(response.usage).toHaveProperty('promptTokens')
        expect(response.usage).toHaveProperty('completionTokens')
        expect(response.usage).toHaveProperty('totalTokens')
        expect(response.usage.totalTokens).toBe(
          response.usage.promptTokens + response.usage.completionTokens
        )
      }
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid model IDs', async () => {
      const provider = createGoogleProvider(GOOGLE_API_KEY!)
      const invalidRoute: ModelRoute = {
        ...TEST_ROUTE,
        modelId: 'invalid-model-name'
      }
      const model = provider.getLanguageModel(invalidRoute)
      const prompt = 'This should fail'
      
      await expect(generateText({
        model,
        prompt
      })).rejects.toThrow()
    })

    itWithAuth('should handle empty prompts', async () => {
      const provider = createGoogleProvider(GOOGLE_API_KEY!)
      const model = provider.getLanguageModel(TEST_ROUTE)
      
      await expect(generateText({
        model,
        prompt: ''
      })).rejects.toThrow()
    })
  })
}) 