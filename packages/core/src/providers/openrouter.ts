import { openrouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModelV1 } from 'ai'
import { ModelDetails } from '../models/models.ts'

export function createOpenRouterModel(modelName: string): LanguageModelV1 {
  return openrouter(modelName)
} 

// Function to get available models from OpenRouter
function parseUnixTimestamp(timestamp: number): Date | undefined {
  try {
    const date = new Date(timestamp * 1000);
    return date;
  } catch {
    return undefined;
  }
}

export async function getOpenRouterModels(): Promise<ModelDetails[]> {
  const response = await fetch('https://openrouter.ai/api/v1/models')
  const data = await response.json()
  
  return data.data.map((model: any) => ({
    id: model.id,
    name: model.name,
    contextLength: model.context_length,
    costs: {
      promptTokens: parseFloat(model.pricing?.prompt || '0') * 1000,
      completionTokens: parseFloat(model.pricing?.completion || '0') * 1000,
    },
    provider: 'openrouter' as const,
    details: {
      architecture: model.architecture?.modality,
      tokenizer: model.architecture?.tokenizer,
      instructType: model.architecture?.instruct_type,
    },
    addedDate: model.created ? parseUnixTimestamp(model.created) : undefined,
    lastUpdated: model.created ? parseUnixTimestamp(model.created) : undefined,
  }))
}

export function getOpenRouterModelUrl(modelId: string): string {
  return `https://openrouter.ai/${modelId}`;
}
