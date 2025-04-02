import { describe, it, expect } from 'vitest'
import { createOpenRouterProvider } from './openrouter.js'
import { generateText } from 'ai'
import type { ModelRoute } from '../models/types.js'

describe('OpenRouter Provider', () => {
  // Check if OpenRouter API key is available
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
  
  if (!OPENROUTER_API_KEY) {
    console.warn('⚠️ OPENROUTER_API_KEY not found in environment, some tests will be skipped')
  }

  // Helper function to skip tests if no API key
  const itWithAuth = OPENROUTER_API_KEY ? it : it.skip

  // Test route using the free Mistral model
  const TEST_ROUTE: ModelRoute = {
    modelId: 'mistral-small-3.1-24b-instruct',
    provider: 'mistralai',
    route: 'openrouter',
    variant: 'free'
  }

  describe('Provider Instance', () => {
    it('should create a provider instance', () => {
      const provider = createOpenRouterProvider(OPENROUTER_API_KEY!)
      expect(provider).toBeDefined()
      expect(typeof provider).toBe('object')
      expect(provider).not.toBeNull()
    })

    it('should fail without API key', () => {
      expect(() => createOpenRouterProvider('')).toThrow()
    })
  })

  describe('Model Listing', () => {
    itWithAuth('should list available models', async () => {
      const provider = createOpenRouterProvider(OPENROUTER_API_KEY!)
      const models = await provider.listModels()
      expect(models).toBeInstanceOf(Array)
      expect(models.length).toBeGreaterThan(0)

      // Log first model for debugging
      console.log('First model:', models[0])

      // Check model structure
      models.forEach(model => {
        expect(model.modelId).toBeDefined()
        expect(model.provider).toBeDefined()
        expect(model.route).toBe('openrouter')
        expect(model.name).toBeDefined()
        expect(model.contextLength).toBeTypeOf('number')
        expect(model.costs).toBeDefined()
        expect(model.costs?.promptTokens).toBeTypeOf('number')
        expect(model.costs?.completionTokens).toBeTypeOf('number')
      })

      // Log free models
      const freeModels = models.filter(m => 
        m.costs && m.costs.promptTokens === 0 && m.costs.completionTokens === 0
      )
      console.log('\nAvailable free models:', freeModels.map(m => m.modelId))
    })
  })

  describe('Text Generation', () => {
    itWithAuth('should generate text with free Mistral model', async () => {
      const provider = createOpenRouterProvider(OPENROUTER_API_KEY!)
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

    itWithAuth('should handle longer conversations', async () => {
      const provider = createOpenRouterProvider(OPENROUTER_API_KEY!)
      const model = provider.getLanguageModel(TEST_ROUTE)
      const prompt = `
System: You are a helpful assistant. Keep your responses concise.
User: What is the capital of France?
Assistant: Paris.
User: What is its population?
`
      const response = await generateText({
        model,
        prompt
      })

      console.log('Conversation response:', response.text)
      
      expect(response.text).toBeTruthy()
      expect(typeof response.text).toBe('string')
      expect(response.text.length).toBeGreaterThan(0)
    })

    itWithAuth('should respect temperature setting', async () => {
      const provider = createOpenRouterProvider(OPENROUTER_API_KEY!)
      const model = provider.getLanguageModel(TEST_ROUTE)
      const prompt = 'Generate a random number between 1 and 10'
      
      // Generate with temperature 0 (deterministic)
      const response1 = await generateText({
        model,
        prompt,
        temperature: 0
      })

      // Generate again with same temperature
      const response2 = await generateText({
        model,
        prompt,
        temperature: 0
      })

      console.log('Response 1:', response1.text)
      console.log('Response 2:', response2.text)
      
      // With temperature 0, responses should be identical
      expect(response1.text).toBe(response2.text)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid model IDs', async () => {
      const provider = createOpenRouterProvider(OPENROUTER_API_KEY!)
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
      const provider = createOpenRouterProvider(OPENROUTER_API_KEY!)
      const model = provider.getLanguageModel(TEST_ROUTE)
      
      await expect(generateText({
        model,
        prompt: ''
      })).rejects.toThrow()
    })

    itWithAuth('should handle very long prompts', async () => {
      const provider = createOpenRouterProvider(OPENROUTER_API_KEY!)
      const model = provider.getLanguageModel(TEST_ROUTE)
      // Create a prompt that's definitely too long (100K tokens)
      const longPrompt = Array(100000).fill('test').join(' ')
      
      // The API should reject this quickly due to token limit validation
      await expect(generateText({
        model,
        prompt: longPrompt
      })).rejects.toThrow()
    }, 30000) // 30 second timeout just in case
  })
}) 