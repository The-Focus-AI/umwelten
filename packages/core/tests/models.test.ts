import { describe, it, expect } from 'vitest'
import { getOllamaModels, getOpenRouterModels, getAllModels, type ModelDetails } from '../src/models.js'

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