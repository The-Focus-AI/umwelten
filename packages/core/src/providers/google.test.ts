import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createGoogleModel, getGoogleModels, getGoogleModelUrl, getGoogleAI } from './google.ts'
import { generateText } from 'ai'
import type { ModelDetails } from '../models/models'

describe('Google Provider', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key'
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('Model Listing', () => {
    it('should list available models with required fields', async () => {
      const models = await getGoogleModels()
      expect(models).toBeInstanceOf(Array)
      expect(models.length).toBeGreaterThan(0)
      
      // Log first model for debugging
      console.log('First model:', models[0])
      
      models.forEach((model: ModelDetails) => {
        expect(model.id).toBeDefined()
        expect(model.name).toBeDefined()
        expect(model.provider).toBe('google')
        expect(model.contextLength).toBeTypeOf('number')
        
        // Check costs
        expect(model.costs).toBeDefined()
        expect(model.costs?.promptTokens).toBeTypeOf('number')
        expect(model.costs?.completionTokens).toBeTypeOf('number')
        
        // Check dates
        expect(model.addedDate).toBeInstanceOf(Date)
        expect(model.lastUpdated).toBeInstanceOf(Date)
        
        // Check details
        if (model.details) {
          expect(model.details.family).toBe('gemini')
          expect(model.details.version).toBeDefined()
          expect(model.details.inputTokenLimit).toBeTypeOf('number')
          expect(model.details.outputTokenLimit).toBeTypeOf('number')
          expect(Array.isArray(model.details.supportedGenerationMethods)).toBe(true)
        }
      })
    })

    it('should throw error when API key is missing', async () => {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
      await expect(getGoogleModels()).rejects.toThrow('GOOGLE_GENERATIVE_AI_API_KEY environment variable is required')
    })
  })

  describe('Model Creation', () => {
    it('should create model instance', () => {
      const model = createGoogleModel('gemini-pro')
      expect(model).toBeDefined()
    })
  })

  // Check if Google API key is available and is not the test key
  const GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  const hasValidApiKey = GOOGLE_GENERATIVE_AI_API_KEY && GOOGLE_GENERATIVE_AI_API_KEY !== 'test-key'
  
  if (!hasValidApiKey) {
    console.warn('⚠️ Valid GOOGLE_GENERATIVE_AI_API_KEY not found in environment, some tests will be skipped')
  }

  // Helper function to skip tests if no valid API key
  const itWithAuth = hasValidApiKey ? it : it.skip

  // Use Gemini Pro for tests
  const MODEL_ID = 'gemini-1.5-flash-8b-latest' //gemini-1.5-pro-latest'

  describe('SDK Instance', () => {
    it('should return undefined when API key is missing', () => {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
      expect(getGoogleAI()).toBeUndefined()
    })

    it('should return SDK instance when API key is present', () => {
      expect(getGoogleAI()).toBeDefined()
    })
  })

  describe('Model Creation', () => {
    it('should throw error when API key is missing', () => {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
      expect(() => createGoogleModel('gemini-1.5-pro')).toThrow('GOOGLE_GENERATIVE_AI_API_KEY environment variable is required')
    })

    it('should create model instance when API key is present', () => {
      const model = createGoogleModel('gemini-1.5-pro')
      expect(model).toBeDefined()
    })

    it('should accept empty model name but fail on execution', async () => {
      const model = createGoogleModel('')
      expect(model).toBeDefined()
      
      await expect(generateText({
        model,
        prompt: 'test'
      })).rejects.toThrow()
    })
  })

  describe('Model URLs', () => {
    it('should return correct documentation URL', () => {
      const url = getGoogleModelUrl('gemini-1.5-pro')
      expect(url).toBe('https://ai.google.dev/models/gemini-1.5-pro')
    })
  })

  describe('Text Generation', () => {
    itWithAuth('should generate text with Gemini Pro', async () => {
      const model = createGoogleModel(MODEL_ID)
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
/*
    itWithAuth('should handle longer conversations', async () => {
      const model = createGoogleModel(MODEL_ID)
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
      const model = createGoogleModel(MODEL_ID)
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
      */
  })

  describe('Error Handling', () => {
    it('should handle invalid model names', async () => {
      const model = createGoogleModel('invalid-model-name')
      const prompt = 'This should fail'
      
      await expect(generateText({
        model,
        prompt
      })).rejects.toThrow()
    })

    itWithAuth('should handle empty prompts', async () => {
      const model = createGoogleModel(MODEL_ID)
      
      await expect(generateText({
        model,
        prompt: ''
      })).rejects.toThrow()
    })

    itWithAuth('should handle very long prompts', async () => {
      const model = createGoogleModel(MODEL_ID)
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