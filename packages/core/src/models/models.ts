import { LanguageModelV1 } from 'ai'
import { z } from 'zod'
import { TokenUsage, TokenUsageSchema } from '../costs/costs.ts'
import { getOpenRouterModels } from '../providers/openrouter.ts'
import { getOllamaModels } from '../providers/ollama.ts'

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
  addedDate: Date     // When the model was first seen
  lastUpdated: Date   // When the model was last updated
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


export const ModelCapabilitiesSchema = z.object({
  maxTokens: z.number(),
  streaming: z.boolean(),
  functionCalling: z.boolean(),
});

export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelOptionsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  stop: z.array(z.string()).optional(),
});

export type ModelOptions = z.infer<typeof ModelOptionsSchema>;

export const ModelResponseSchema = z.object({
  content: z.string(),
  metadata: z.object({
    startTime: z.date(),
    endTime: z.date(),
    tokenUsage: TokenUsageSchema,
    provider: z.string(),
    model: z.string(),
    cost: z.number(),
  }),
});

export type ModelResponse = z.infer<typeof ModelResponseSchema>;

export interface ModelProvider {
  id: string;
  capabilities: ModelCapabilities;
  execute(prompt: string, options?: ModelOptions): Promise<ModelResponse>;
  calculateCost(usage: TokenUsage): number;
}

export interface ModelRunner {
  execute(params: {
    prompt: string;
    model: ModelProvider;
    options?: ModelOptions;
  }): Promise<ModelResponse>;
}

export interface ModelSearchOptions {
  query: string              // Search term
  provider?: 'openrouter' | 'ollama' | 'all'  // Filter by provider
  sortBy?: 'name' | 'addedDate' | 'contextLength' | 'cost'  // Sort results
  sortOrder?: 'asc' | 'desc'  // Sort direction
  onlyFree?: boolean        // Only show free models
}

/**
 * Search through available models using various criteria
 */
export async function searchModels(options: ModelSearchOptions): Promise<ModelDetails[]> {
  const allModels = await getAllModels()
  let results = allModels

  // Filter by provider if specified
  if (options.provider && options.provider !== 'all') {
    results = results.filter(model => model.provider === options.provider)
  }

  // Filter by search query
  if (options.query) {
    const searchTerms = options.query.toLowerCase().split(/\s+/)
    results = results.filter(model => {
      const searchText = `${model.id} ${model.name} ${model.details?.family || ''} ${model.details?.format || ''}`.toLowerCase()
      return searchTerms.every(term => searchText.includes(term))
    })
  }

  // Filter free models if requested
  if (options.onlyFree) {
    results = results.filter(model => 
      !model.costs || (model.costs.promptTokens === 0 && model.costs.completionTokens === 0)
    )
  }

  // Sort results
  if (options.sortBy) {
    results.sort((a, b) => {
      let comparison = 0
      switch (options.sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'addedDate':
          if (!a.addedDate && !b.addedDate) return 0
          if (!a.addedDate) return 1
          if (!b.addedDate) return -1
          comparison = a.addedDate.getTime() - b.addedDate.getTime()
          break
        case 'contextLength':
          comparison = a.contextLength - b.contextLength
          break
        case 'cost':
          const aCost = a.costs ? (a.costs.promptTokens + a.costs.completionTokens) : 0
          const bCost = b.costs ? (b.costs.promptTokens + b.costs.completionTokens) : 0
          comparison = aCost - bCost
          break
      }
      return options.sortOrder === 'desc' ? -comparison : comparison
    })
  }

  return results
} 