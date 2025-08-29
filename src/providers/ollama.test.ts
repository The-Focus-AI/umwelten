import { describe, it, expect } from 'vitest'
import { createOllamaProvider } from './ollama.js'
import { generateText } from 'ai'
import { ModelRoute } from '../cognition/types.js'
import { checkOllamaConnection } from '../test-utils/setup.js'

describe('Ollama Provider', () => {
  // Check if Ollama is running locally
  const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434'
  
  // Test route using the gemma model
  const TEST_ROUTE: ModelRoute = {
    name: 'gemma3:27b',
    provider: 'ollama',
  }

  describe('Provider Instance', () => {
    it('should create a provider instance', () => {
      const provider = createOllamaProvider()
      expect(provider).toBeDefined()
      expect(typeof provider).toBe('object')
      expect(provider).not.toBeNull()
    })

    it('should accept custom base URL', () => {
      const provider = createOllamaProvider('http://custom:11434')
      expect(provider).toBeDefined()
    })
  })

  describe('Model Listing', () => {
    it('should list available models', async () => {
      // Skip if Ollama is not running
      const ollamaAvailable = await checkOllamaConnection()
      if (!ollamaAvailable) {
        console.warn('⚠️ Ollama not available, skipping test')
        return
      }

      const provider = createOllamaProvider()
      const models = await provider.listModels()
      expect(models).toBeInstanceOf(Array)

      // Log first model for debugging
      if (models.length > 0) {
        console.log('First model:', models[0])
      }

      // Check model structure
      models.forEach(model => {
        expect(model.name).toBeDefined()
        expect(model.provider).toBe('ollama')
        expect(model.name).toBeDefined()
        expect(model.contextLength).toBeTypeOf('number')
        expect(model.costs).toBeDefined()
        expect(model.costs?.promptTokens).toBeTypeOf('number')
        expect(model.costs?.completionTokens).toBeTypeOf('number')
      })
    })
  })

  describe('Text Generation', () => {
    it('should generate text with gemma model', async () => {
      // Skip if Ollama is not running
      const ollamaAvailable = await checkOllamaConnection()
      if (!ollamaAvailable) {
        console.warn('⚠️ Ollama not available, skipping test')
        return
      }

      const provider = createOllamaProvider()
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
          response.usage.inputTokens + response.usage.outputTokens
        )
      }
    })

    it('should handle longer conversations', async () => {
      // Skip if Ollama is not running
      const ollamaAvailable = await checkOllamaConnection()
      if (!ollamaAvailable) {
        console.warn('⚠️ Ollama not available, skipping test')
        return
      }

      const provider = createOllamaProvider()
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
      // TODO: Enable when Ollama is reliably available and responsive
      // Skip if Ollama is not running
      const ollamaAvailable = await checkOllamaConnection()
      if (!ollamaAvailable) {
        console.warn('⚠️ Ollama not available, skipping test')
        return
      }

      const provider = createOllamaProvider()
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

    it('should generate text with gemma3:12b model', async () => {
      // Skip if Ollama is not running
      const ollamaAvailable = await checkOllamaConnection()
      if (!ollamaAvailable) {
        console.warn('⚠️ Ollama not available, skipping test')
        return
      }

      const provider = createOllamaProvider()
      const model = provider.getLanguageModel({ name: 'gemma3:12b', provider: 'ollama' })
      
      const prompt = 'Write a haiku about coding'
      
      const response = await generateText({
        model,
        prompt
      })

      console.log('Generated text for gemma3:12b:', response.text)
      
      expect(response.text).toBeTruthy()
      expect(typeof response.text).toBe('string')
      expect(response.text.length).toBeGreaterThan(0)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid model IDs', async () => {
      const provider = createOllamaProvider()
      const invalidRoute: ModelRoute = {
        ...TEST_ROUTE,
        name: 'invalid-model-name'
      }
      const model = provider.getLanguageModel(invalidRoute)
      const prompt = 'This should fail'
      
      // Skip if Ollama is not running
      const ollamaAvailable = await checkOllamaConnection()
      if (!ollamaAvailable) {
        console.warn('⚠️ Ollama not available, skipping test')
        return
      }

      await expect(generateText({
        model,
        prompt
      })).rejects.toThrow()
    })
  })

  describe('Verify Costs Property', () => {
    it('should have valid costs for each model', async () => {
      // Skip if Ollama is not running
      const ollamaAvailable = await checkOllamaConnection();
      if (!ollamaAvailable) {
        console.warn('⚠️ Ollama not available, skipping test');
        return;
      }

      const provider = createOllamaProvider();
      const models = await provider.listModels();
      expect(models).toBeInstanceOf(Array);

      models.forEach(model => {
        expect(model.costs).toBeDefined();
        expect(typeof model.costs?.promptTokens).toBe('number');
        expect(typeof model.costs?.completionTokens).toBe('number');
        expect(model.costs?.promptTokens).toBeGreaterThanOrEqual(0);
        expect(model.costs?.completionTokens).toBeGreaterThanOrEqual(0);
      });
    });
  });
}) 