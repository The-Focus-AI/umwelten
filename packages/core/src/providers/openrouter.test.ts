import { describe, it, expect } from 'vitest'
import { createOpenRouterModel } from './openrouter.ts'
import { generateText } from 'ai'

describe('OpenRouter Provider', () => {
  // Check if OpenRouter API key is available
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
  
  if (!OPENROUTER_API_KEY) {
    console.warn('⚠️ OPENROUTER_API_KEY not found in environment, some tests will be skipped')
  }

  // Helper function to skip tests if no API key
  const itWithAuth = OPENROUTER_API_KEY ? it : it.skip

  // Use the free Mistral model for all tests
  const FREE_MODEL_ID = 'mistralai/mistral-small-3.1-24b-instruct:free'

  describe('Model Creation', () => {
    it('should create a model instance', () => {
      const model = createOpenRouterModel(FREE_MODEL_ID)
      expect(model).toBeDefined()
      expect(typeof model).toBe('object')
      expect(model).not.toBeNull()
    })

    it('should accept empty model name but fail on execution', async () => {
      const model = createOpenRouterModel('')
      expect(model).toBeDefined()
      
      await expect(generateText({
        model,
        prompt: 'test'
      })).rejects.toThrow()
    })
  })

  describe('Text Generation', () => {
    itWithAuth('should generate text with free Mistral model', async () => {
      const model = createOpenRouterModel(FREE_MODEL_ID)
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
      const model = createOpenRouterModel(FREE_MODEL_ID)
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
      const model = createOpenRouterModel(FREE_MODEL_ID)
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
    it('should handle invalid model names', async () => {
      const model = createOpenRouterModel('invalid-model-name')
      const prompt = 'This should fail'
      
      await expect(generateText({
        model,
        prompt
      })).rejects.toThrow()
    })

    itWithAuth('should handle empty prompts', async () => {
      const model = createOpenRouterModel(FREE_MODEL_ID)
      
      await expect(generateText({
        model,
        prompt: ''
      })).rejects.toThrow()
    })

    itWithAuth('should handle very long prompts', async () => {
      const model = createOpenRouterModel(FREE_MODEL_ID)
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