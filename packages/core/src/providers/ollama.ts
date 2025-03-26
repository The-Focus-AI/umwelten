import { ollama } from 'ollama-ai-provider'
import type { LanguageModelV1 } from 'ai'

export function createOllamaModel(modelName: string): LanguageModelV1 {
  return ollama(modelName)
} 