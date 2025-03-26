import { ollama } from 'ollama-ai-provider'
import type { LanguageModelV1 } from 'ai'
import { ModelDetails } from '../models/models.ts'

export function createOllamaModel(modelName: string): LanguageModelV1 {
  return ollama(modelName)
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