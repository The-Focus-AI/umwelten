import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createGoogleProvider } from './google.js'
import { generateText } from 'ai'
import type { ModelDetails, ModelRoute } from '../cognition/types.js'
import { hasGoogleKey } from '../test-utils/setup.js'

describe('Google Provider', () => {
  const originalEnv = process.env
  const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY

  beforeEach(() => {
    // Skip setup if no API key - tests will be skipped by itWithAuth
    if (!hasGoogleKey()) {
      return
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  // Helper function to skip tests if no API key
  const itWithAuth = hasGoogleKey() ? it : it.skip

  // Test route using Gemini Pro
  const TEST_ROUTE: ModelRoute = {
    name: 'gemini-1.5-pro',
    provider: 'google',
  }

  describe('Provider Instance', () => {
    itWithAuth('should create a provider instance', () => {
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
    itWithAuth('should list available models with required fields', async () => {
      const provider = createGoogleProvider(GOOGLE_API_KEY!)
      const models = await provider.listModels()
      expect(models).toBeInstanceOf(Array)
      expect(models.length).toBeGreaterThan(0)
      
      // Log first model for debugging
      console.log('First model:', models[models.length - 1])
      
      models.forEach((model: ModelDetails) => {
        expect(model.name).toBeDefined()
        expect(model.provider).toBe('google')
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
        expect(response.usage).toHaveProperty('inputTokens')
        expect(response.usage).toHaveProperty('outputTokens')
        expect(response.usage).toHaveProperty('totalTokens')
        expect(response.usage.totalTokens).toBe(
          response.usage.inputTokens! + response.usage.outputTokens!
        )
      }
    })
  })

  describe('Error Handling', () => {
    itWithAuth('should handle invalid model IDs', async () => {
      const provider = createGoogleProvider(GOOGLE_API_KEY!)
      const invalidRoute: ModelRoute = {
        ...TEST_ROUTE,
        name: 'invalid-model-name'
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
      
      const response = await generateText({
        model,
        prompt: ''
      })

      // Should return a message asking for input
      expect(response.text).toBeTruthy()
      expect(response.text.toLowerCase()).toContain('provide')
      // AI SDK v5 behavior changed - model now provides helpful suggestions instead of error message
      expect(response.text.toLowerCase()).toContain('task') // Check for helpful response content

      // Should have usage statistics
      expect(response.usage).toBeDefined()
      if (response.usage?.inputTokens && response.usage?.outputTokens) {
        expect(response.usage.inputTokens).toBeGreaterThan(0)
        expect(response.usage.outputTokens).toBeGreaterThan(0)
        expect(response.usage.totalTokens).toBe(
          response.usage.inputTokens! + response.usage.outputTokens!
        )
      }
    })
  })
}) 