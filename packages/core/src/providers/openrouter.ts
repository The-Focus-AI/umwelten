import { openrouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModelV1 } from 'ai'
import { ModelDetails } from '../models/models.ts'

export function createOpenRouterModel(modelName: string): LanguageModelV1 {
  return openrouter(modelName)
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
