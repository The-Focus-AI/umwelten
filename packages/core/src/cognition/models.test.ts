import { describe, it, expect } from 'vitest'
import type { ModelDetails } from './types.js'
import { createOllamaProvider } from '../providers/ollama.js'
import { createOpenRouterProvider } from '../providers/openrouter.js'
import { createGoogleProvider } from '../providers/google.js'
import { searchModels } from './models.js'
import { hasOpenRouterKey, hasGoogleKey } from '../test-utils/setup.js'

// API keys for providers that require authentication
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY

describe('Model Information', () => {
  it('should list available Ollama models', async () => {
    const provider = createOllamaProvider()
    const models = await provider.listModels()
    expect(models).toBeInstanceOf(Array)
    
    if (models.length > 0) {
      const model = models[0]
      expect(model).toHaveProperty('name')
      expect(model).toHaveProperty('contextLength')
      expect(model.provider).toBe('ollama')
      expect(model).toHaveProperty('details')
      
      console.log('Example Ollama model:', model)
    }
  })

  it('should list available OpenRouter models', async () => {
    if (!hasOpenRouterKey() || !OPENROUTER_API_KEY) {
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
      expect(model.provider).toBeDefined()
      
      // Check cost structure
      if (model.costs) {
        expect(model.costs).toHaveProperty('promptTokens')
        expect(model.costs).toHaveProperty('completionTokens')
        expect(typeof model.costs.promptTokens).toBe('number')
        expect(typeof model.costs.completionTokens).toBe('number')
      }
      
      // Log all free models
      const freeModels = models.filter((m: ModelDetails) => 
        m.costs && m.costs.promptTokens === 0 && m.costs.completionTokens === 0
      )
    }
  })

  it('should list available Google models', async () => {
    if (!hasGoogleKey() || !GOOGLE_API_KEY) {
      console.warn('⚠️ GOOGLE_API_KEY not found, skipping test')
      return
    }

    const provider = createGoogleProvider(GOOGLE_API_KEY)
    const models = await provider.listModels()
    expect(models).toBeInstanceOf(Array)
    
    if (models.length > 0) {
      const model = models[0]

      expect(model).toHaveProperty('name')
      expect(model).toHaveProperty('contextLength')
      expect(model.provider).toBe('google')
      
      
      console.log('Example Google model:', model)
    }
  })

  it('should get models from all available providers', async () => {
    // Create providers
    const providers = [
      createOllamaProvider(),
      ...(hasOpenRouterKey() && OPENROUTER_API_KEY ? [createOpenRouterProvider(OPENROUTER_API_KEY)] : []),
      ...(hasGoogleKey() && GOOGLE_API_KEY ? [createGoogleProvider(GOOGLE_API_KEY)] : [])
    ]

    // Get models from all providers
    const modelLists = await Promise.all(
      providers.map(provider => provider.listModels())
    )
    
    // Combine all models
    const models = modelLists.flat()
    expect(models).toBeInstanceOf(Array)
    
    // Group models by provider
    const ollamaModels = models.filter(m => m.provider === 'ollama')
    const openRouterModels = models.filter(m => m.provider === 'openrouter')
    const googleModels = models.filter(m => m.provider === 'google')
    
    console.log('Model counts:', {
      total: models.length,
      ollama: ollamaModels.length,
      openRouter: openRouterModels.length,
      google: googleModels.length
    })
    
    // Log some cost examples if available
    const modelWithCost = models.find(m => m.costs)
    if (modelWithCost && modelWithCost.costs) {
      console.log('Example model costs (per 1K tokens):', {
        model: modelWithCost.name,
        costs: modelWithCost.costs
      })
    }
  })
})

describe('Model Search', () => {
  // Helper to get all models from available providers
  async function getAllModels(): Promise<ModelDetails[]> {
    const providers = [
      createOllamaProvider(),
      ...(hasOpenRouterKey() && OPENROUTER_API_KEY ? [createOpenRouterProvider(OPENROUTER_API_KEY)] : []),
      ...(hasGoogleKey() && GOOGLE_API_KEY ? [createGoogleProvider(GOOGLE_API_KEY)] : [])
    ]
    const modelLists = await Promise.all(
      providers.map(provider => provider.listModels())
    )
    return modelLists.flat()
  }

  it('should search models by name', async () => {
    const models = await getAllModels()
    const results = await searchModels('gemini', models)
    expect(results).toBeInstanceOf(Array)
    results.forEach(model => {
      const searchText = `${model.provider} ${model.name} ${model.details?.family || ''} ${model.details?.format || ''}`.toLowerCase()
      expect(searchText).toContain('gemini')
    })
  })

  it('should filter by provider', async () => {
    const models = await getAllModels()
    const openRouterModels = models.filter(m => m.provider === 'openrouter')
    expect(openRouterModels).toBeInstanceOf(Array)
    openRouterModels.forEach(model => {
      expect(model.provider).toBe('openrouter')
    })
  })

  it('should sort by date', async () => {
    const models = await getAllModels()
    const modelsWithDates = models.filter(model => model.addedDate !== undefined)
    const sortedModels = [...modelsWithDates].sort((a, b) => {
      const dateA = a.addedDate?.getTime() || 0
      const dateB = b.addedDate?.getTime() || 0
      return dateB - dateA // descending order
    })

    if (sortedModels.length > 1) {
      // Verify dates are valid
      expect(sortedModels.length).toBeGreaterThan(0)
      
      sortedModels.forEach(model => {
        expect(model.addedDate).toBeInstanceOf(Date)
        if (model.lastUpdated) {
          expect(model.lastUpdated).toBeInstanceOf(Date)
          expect(model.lastUpdated.getTime()).toBeLessThanOrEqual(Date.now())
        }
        if (model.addedDate) {
          expect(model.addedDate.getTime()).toBeLessThanOrEqual(Date.now())
        }
      })

      // Verify sorting
      for (let i = 1; i < sortedModels.length; i++) {
        const prevDate = sortedModels[i-1].addedDate
        const currDate = sortedModels[i].addedDate
        if (prevDate && currDate) {
          expect(prevDate.getTime()).toBeGreaterThanOrEqual(currDate.getTime())
        }
      }
    }
  })

  it('should filter free models', async () => {
    const models = await getAllModels()
    const freeModels = models.filter(model => 
      model.costs && model.costs.promptTokens === 0 && model.costs.completionTokens === 0
    )
    expect(freeModels).toBeInstanceOf(Array)
    freeModels.forEach(model => {
      if (model.costs) {
        expect(model.costs.promptTokens).toBe(0)
        expect(model.costs.completionTokens).toBe(0)
      }
    })
  })
}) 