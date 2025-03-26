import { openrouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModelV1 } from 'ai'

export function createOpenRouterModel(modelName: string): LanguageModelV1 {
  return openrouter(modelName)
} 