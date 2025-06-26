import { describe, it, expect } from 'vitest'
import { createOpenRouterProvider } from './openrouter.js'
import { generateText } from 'ai'
import type { ModelRoute } from '../cognition/types.js'
import { vi } from 'vitest'


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
    name: 'mistral-small-3.1-24b-instruct',
    provider: 'mistralai',
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
    it('should list available models', async () => {
      if (!OPENROUTER_API_KEY) {
        console.warn('⚠️ OPENROUTER_API_KEY not found, skipping test')
        return
      }

      const provider = createOpenRouterProvider(OPENROUTER_API_KEY)
      const models = await provider.listModels()
      expect(models).toBeInstanceOf(Array)
      
      if (models.length > 0) {
        const model = models[0]
        expect(model).toHaveProperty('name')
        expect(model).toHaveProperty('contextLength')
        expect(model).toHaveProperty('costs')
        expect(model.provider).toBe('openrouter')
        
        // Check cost structure
        if (model.costs) {
          expect(model.costs).toHaveProperty('promptTokens')
          expect(model.costs).toHaveProperty('completionTokens')
          expect(typeof model.costs.promptTokens).toBe('number')
          expect(typeof model.costs.completionTokens).toBe('number')
        }
      }
    })

    it('should get language model for valid model ID', async () => {
      if (!OPENROUTER_API_KEY) {
        console.warn('⚠️ OPENROUTER_API_KEY not found, skipping test')
        return
      }

      const provider = createOpenRouterProvider(OPENROUTER_API_KEY)
      const modelRoute: ModelRoute = {
        name: 'gpt-3.5-turbo',
        provider: 'openai',
      }
      const model = provider.getLanguageModel(modelRoute)
      expect(model).toBeDefined()
      expect(typeof model.doGenerate).toBe('function')
      expect(typeof model.doStream).toBe('function')
    })

    it('should filter free models', async () => {
      if (!OPENROUTER_API_KEY) {
        console.warn('⚠️ OPENROUTER_API_KEY not found, skipping test')
        return
      }

      const provider = createOpenRouterProvider(OPENROUTER_API_KEY)
      const models = await provider.listModels()
      const freeModels = models.filter(model => 
        model.costs && model.costs.promptTokens === 0 && model.costs.completionTokens === 0
      )
      
      freeModels.forEach(model => {
        if (model.costs) {
          expect(model.costs.promptTokens).toBe(0)
          expect(model.costs.completionTokens).toBe(0)
        }
      })

      // // Log free models for visibility
      // if (freeModels.length > 0) {
      //   console.log('\nAvailable free models:')
      //   freeModels.forEach(m => {
      //     console.log(`\nModel: ${m.name}`)
      //     console.log(`ID: ${m.modelId}`)
      //     console.log(`Context Length: ${m.contextLength}`)
      //     console.log('Details:', m.details)
      //   }
        // }
    })

    it('should validate model details structure', async () => {
      if (!OPENROUTER_API_KEY) {
        console.warn('⚠️ OPENROUTER_API_KEY not found, skipping test')
        return
      }

      const provider = createOpenRouterProvider(OPENROUTER_API_KEY)
      const models = await provider.listModels()
      
      models.forEach(model => {
        // Required fields
        expect(model).toHaveProperty('name')
        expect(model).toHaveProperty('contextLength')
        expect(model).toHaveProperty('provider')
        expect(model.provider).toBe('openrouter')
        
        // Optional but structured fields
        if (model.costs) {
          expect(model.costs).toHaveProperty('promptTokens')
          expect(model.costs).toHaveProperty('completionTokens')
          expect(typeof model.costs.promptTokens).toBe('number')
          expect(typeof model.costs.completionTokens).toBe('number')
        }
        
        if (model.details) {
          if (model.details.family) expect(typeof model.details.family).toBe('string')
          if (model.details.format) expect(typeof model.details.format).toBe('string')
        }
        
        if (model.addedDate) expect(model.addedDate).toBeInstanceOf(Date)
        if (model.lastUpdated) expect(model.lastUpdated).toBeInstanceOf(Date)
      })
    })
  })

  describe('Text Generation', () => {
    it.skip('should generate text with free Mistral model', async () => {
      // TODO: Enable when a valid model ID and API key are available
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

    it.skip('should handle longer conversations', async () => {
      // TODO: Enable when a valid model ID and API key are available
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

    it.skip('should respect temperature setting', async () => {
      // TODO: Enable when a valid model ID and API key are available
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