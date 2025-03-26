import { describe, it, expect } from 'vitest'
import { getAllModels, searchModels, type ModelDetails } from './models.ts'
import { getOllamaModels } from '../providers/ollama.ts'
import { getOpenRouterModels } from '../providers/openrouter.ts'

describe('Model Information', () => {
  it('should list available Ollama models', async () => {
    const models = await getOllamaModels()
    expect(models).toBeInstanceOf(Array)
    
    if (models.length > 0) {
      const model = models[0]
      expect(model).toHaveProperty('id')
      expect(model).toHaveProperty('name')
      expect(model).toHaveProperty('contextLength')
      expect(model.provider).toBe('ollama')
      expect(model).toHaveProperty('details')
      
      console.log('Example Ollama model:', model)
    }
  })

  it('should list available OpenRouter models', async () => {
    const models = await getOpenRouterModels()
    expect(models).toBeInstanceOf(Array)
    
    if (models.length > 0) {
      const model = models[0]
      expect(model).toHaveProperty('id')
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
      
      // Log all free models
      const freeModels = models.filter((m: ModelDetails) => 
        m.costs && m.costs.promptTokens === 0 && m.costs.completionTokens === 0
      )
      console.log('\nAvailable free models:')
      freeModels.forEach((m: ModelDetails) => {
        console.log(`\nModel: ${m.name}`)
        console.log(`ID: ${m.id}`)
        console.log(`Context Length: ${m.contextLength}`)
        console.log('Details:', m.details)
      })
    }
  })

  it('should get all available models', async () => {
    const models = await getAllModels()
    expect(models).toBeInstanceOf(Array)
    
    // Group models by provider
    const ollamaModels = models.filter(m => m.provider === 'ollama')
    const openRouterModels = models.filter(m => m.provider === 'openrouter')
    
    console.log('Model counts:', {
      total: models.length,
      ollama: ollamaModels.length,
      openRouter: openRouterModels.length
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
  it('should search models by name', async () => {
    const results = await searchModels({ query: 'gemini' })
    expect(results).toBeInstanceOf(Array)
    results.forEach(model => {
      const searchText = `${model.id} ${model.name} ${model.details?.family || ''} ${model.details?.format || ''}`.toLowerCase()
      expect(searchText).toContain('gemini')
    })
  })

  it('should filter by provider', async () => {
    const results = await searchModels({ query: '', provider: 'openrouter' })
    expect(results).toBeInstanceOf(Array)
    results.forEach(model => {
      expect(model.provider).toBe('openrouter')
    })
  })

  it('should sort by date', async () => {
    const results = await searchModels({ 
      query: '',
      sortBy: 'addedDate',
      sortOrder: 'desc'
    })
    expect(results).toBeInstanceOf(Array)
    if (results.length > 1) {
      // Verify dates are valid
      const modelsWithDates = results.filter(model => model.addedDate !== undefined)
      expect(modelsWithDates.length).toBeGreaterThan(0)
      
      modelsWithDates.forEach(model => {
        expect(model.addedDate).toBeInstanceOf(Date)
        if (model.lastUpdated) {
          expect(model.lastUpdated).toBeInstanceOf(Date)
          expect(model.lastUpdated.getTime()).toBeLessThanOrEqual(Date.now())
        }
        expect(model.addedDate.getTime()).toBeLessThanOrEqual(Date.now())
      })

      // Verify sorting
      for (let i = 1; i < modelsWithDates.length; i++) {
        expect(modelsWithDates[i-1].addedDate.getTime()).toBeGreaterThanOrEqual(modelsWithDates[i].addedDate.getTime())
      }
    }
  })

  it('should filter free models', async () => {
    const results = await searchModels({ query: '', onlyFree: true })
    expect(results).toBeInstanceOf(Array)
    results.forEach(model => {
      if (model.costs) {
        expect(model.costs.promptTokens).toBe(0)
        expect(model.costs.completionTokens).toBe(0)
      }
    })
  })
}) 