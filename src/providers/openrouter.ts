import { openrouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'
import { BaseProvider } from './base.js'
import type { ModelDetails, ModelRoute } from '../cognition/types.js'
export function createOpenRouterModel(modelName: string): LanguageModel {
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

export class OpenRouterProvider extends BaseProvider {
  constructor(apiKey: string) {
    super(apiKey);
    this.validateConfig();
  }

  async listModels(): Promise<ModelDetails[]> {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });
    const data = await response.json()
    
    return data.data.map((model: any) => ({
      name: model.id,
      provider: 'openrouter' as const,
      originalProvider: model.id.split('/')[0], // e.g., 'openai', 'anthropic'
      route: 'openrouter' as const,
      contextLength: model.context_length,
      costs: {
        promptTokens: parseFloat(model.pricing?.prompt || '0'),
        completionTokens: parseFloat(model.pricing?.completion || '0'),
      },
      details: {
        provider: model.id.split('/')[0], // Include original provider in details
        architecture: model.architecture?.modality,
        tokenizer: model.architecture?.tokenizer,
        instructType: model.architecture?.instruct_type,
      },
      addedDate: model.created ? parseUnixTimestamp(model.created) : undefined,
      lastUpdated: model.created ? parseUnixTimestamp(model.created) : undefined,
    }))
  }

  getLanguageModel(route: ModelRoute): LanguageModel {
    this.validateConfig();
    
    // Format the model ID for OpenRouter
    const modelId = route.name;

    // The openrouter function from the SDK automatically uses OPENROUTER_API_KEY from env
    return openrouter(modelId);
  }
}

// Factory function to create a provider instance
export function createOpenRouterProvider(apiKey: string): OpenRouterProvider {
  return new OpenRouterProvider(apiKey);
}

export function getOpenRouterModelUrl(modelId: string): string {
  return `https://openrouter.ai/${modelId}`;
}
