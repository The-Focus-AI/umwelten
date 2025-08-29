import { describe, it, expect } from 'vitest'
import { createGitHubModelsProvider } from './github-models.js'
import { generateText } from 'ai'
import type { ModelRoute } from '../cognition/types.js'

describe('GitHub Models Provider', () => {
  // Check if GitHub token is available
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN
  
  if (!GITHUB_TOKEN) {
    console.warn('⚠️ GITHUB_TOKEN not found in environment, some tests will be skipped')
  }

  // Helper function to skip tests if no API key
  const itWithAuth = GITHUB_TOKEN ? it : it.skip

  // Test route using a commonly available model
  const TEST_ROUTE: ModelRoute = {
    name: 'openai/gpt-4o-mini',
    provider: 'openai',
    variant: undefined
  }

  describe('Provider Instance', () => {
    it('should create a provider instance', () => {
      if (!GITHUB_TOKEN) {
        // Skip this test if no token available
        return
      }
      const provider = createGitHubModelsProvider(GITHUB_TOKEN!)
      expect(provider).toBeDefined()
      expect(typeof provider).toBe('object')
      expect(provider).not.toBeNull()
    })

    it('should fail without API key', () => {
      expect(() => createGitHubModelsProvider('')).toThrow()
    })

    it('should fail with undefined API key', () => {
      expect(() => createGitHubModelsProvider(undefined)).toThrow()
    })
  })

  describe('Model Listing', () => {
    itWithAuth('should list available models with required fields', async () => {
      const provider = createGitHubModelsProvider(GITHUB_TOKEN)
      const models = await provider.listModels()
      
      expect(models).toBeInstanceOf(Array)
      
      if (models.length > 0) {
        const firstModel = models[0]
        expect(firstModel).toHaveProperty('provider', 'github-models')
        expect(firstModel).toHaveProperty('name')
        expect(firstModel).toHaveProperty('contextLength')
        expect(firstModel).toHaveProperty('costs')
        expect(firstModel.costs).toHaveProperty('promptTokens')
        expect(firstModel.costs).toHaveProperty('completionTokens')
        expect(firstModel).toHaveProperty('details')
        
        // GitHub Models should be free during preview
        expect(firstModel.costs.promptTokens).toBe(0)
        expect(firstModel.costs.completionTokens).toBe(0)
        
        console.log(`📋 Found ${models.length} GitHub Models`)
        console.log(`📄 Sample model: ${firstModel.name}`)
        console.log(`💰 Costs: $${firstModel.costs.promptTokens}/1M prompt tokens, $${firstModel.costs.completionTokens}/1M completion tokens`)
      } else {
        console.log('⚠️ No models returned from GitHub Models API')
      }
    }, 30000) // 30 second timeout for API call
  })

  describe('Text Generation', () => {
    itWithAuth('should generate text using GitHub Models', async () => {
      const provider = createGitHubModelsProvider(GITHUB_TOKEN)
      const model = provider.getLanguageModel(TEST_ROUTE)
      
      expect(model).toBeDefined()
      
      const result = await generateText({
        model,
        prompt: 'Say "Hello, GitHub Models!" and nothing else.',
        maxTokens: 50,
        temperature: 0
      })
      
      expect(result).toBeDefined()
      expect(result.text).toBeDefined()
      expect(typeof result.text).toBe('string')
      expect(result.text.length).toBeGreaterThan(0)
      expect(result.usage).toBeDefined()
      expect(result.usage?.promptTokens).toBeGreaterThan(0)
      expect(result.usage?.completionTokens).toBeGreaterThan(0)
      
      console.log(`🤖 Generated response: "${result.text}"`)
      console.log(`📊 Token usage: ${result.usage?.promptTokens} prompt + ${result.usage?.completionTokens} completion = ${result.usage?.totalTokens} total`)
      
      // Verify the response contains expected content
      expect(result.text.toLowerCase()).toContain('hello')
    }, 30000) // 30 second timeout for generation
  })

  describe('Error Handling', () => {
    itWithAuth('should handle invalid model IDs', async () => {
      const provider = createGitHubModelsProvider(GITHUB_TOKEN)
      
      const invalidRoute: ModelRoute = {
        name: 'invalid/nonexistent-model',
        provider: 'invalid',
        variant: undefined
      }
      
      const model = provider.getLanguageModel(invalidRoute)
      
      // The model creation should work, but text generation should fail
      expect(model).toBeDefined()
      
      try {
        await generateText({
          model,
          prompt: 'This should fail',
          maxTokens: 10
        })
        // If we get here, the test should fail
        expect.fail('Expected an error for invalid model ID')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        console.log(`✅ Expected error for invalid model: ${error}`)
      }
    }, 30000)

    it('should handle missing API key gracefully', () => {
      expect(() => {
        createGitHubModelsProvider('')
      }).toThrow('GitHubModelsProvider requires an API key')
    })

    itWithAuth('should handle API errors gracefully', async () => {
      // Create provider with invalid base URL to simulate API error
      const provider = createGitHubModelsProvider(GITHUB_TOKEN, 'https://invalid-github-models-url.com')
      
      try {
        await provider.listModels()
        expect.fail('Expected an error for invalid API URL')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toContain('Failed to fetch GitHub Models')
        console.log(`✅ Expected error for invalid API URL: ${error.message}`)
      }
    }, 30000)
  })
})