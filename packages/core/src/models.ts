import { LanguageModelV1 } from 'ai'

export interface ModelCosts {
  promptTokens: number  // Cost per 1K prompt tokens in USD
  completionTokens: number  // Cost per 1K completion tokens in USD
}

export interface ModelDetails {
  id: string
  name: string
  contextLength: number
  costs?: ModelCosts  // Optional since Ollama models are free
  provider: 'openrouter' | 'ollama'
  details?: {
    format?: string
    family?: string
    parameterSize?: string
    quantizationLevel?: string
  }
}

export interface ModelProvider {
  listModels(): Promise<ModelDetails[]>
  createModel(modelId: string): LanguageModelV1
}

// Function to get available models from OpenRouter
export async function getOpenRouterModels(): Promise<ModelDetails[]> {
  const response = await fetch('https://openrouter.ai/api/v1/models')
  const data = await response.json()
  
  return data.data.map((model: any) => ({
    id: model.id,
    name: model.name,
    contextLength: model.context_length,
    costs: {
      promptTokens: parseFloat(model.pricing.prompt) * 1000, // Convert to cost per 1K tokens
      completionTokens: parseFloat(model.pricing.completion) * 1000
    },
    provider: 'openrouter' as const,
    details: model.architecture
  }))
}

// Function to get available models from Ollama
export async function getOllamaModels(): Promise<ModelDetails[]> {
  const response = await fetch('http://localhost:11434/api/tags')
  const data = await response.json()
  
  return data.models.map((model: any) => ({
    id: model.name,
    name: model.name,
    contextLength: 4096, // Default context length, could be adjusted based on model
    provider: 'ollama' as const,
    details: {
      format: model.details?.format,
      family: model.details?.family,
      parameterSize: model.details?.parameter_size,
      quantizationLevel: model.details?.quantization_level
    }
  }))
}

// Function to get all available models from all providers
export async function getAllModels(): Promise<ModelDetails[]> {
  try {
    const [openRouterModels, ollamaModels] = await Promise.allSettled([
      getOpenRouterModels(),
      getOllamaModels()
    ])
    
    const models: ModelDetails[] = []
    
    if (openRouterModels.status === 'fulfilled') {
      models.push(...openRouterModels.value)
    }
    
    if (ollamaModels.status === 'fulfilled') {
      models.push(...ollamaModels.value)
    }
    
    return models
  } catch (error) {
    console.error('Error fetching models:', error)
    return []
  }
} 