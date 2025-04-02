import { ollama } from 'ollama-ai-provider'
import type { LanguageModelV1 } from 'ai'
import { ModelDetails } from '../models/models.js'
import { ModelRoute } from '../models/types.js'
import { BaseProvider } from './base.js'

const now = new Date();

function parseDate(dateStr: string): Date | undefined {
  try {
    const date = new Date(dateStr);
    // Don't accept future dates
    return date > now ? undefined : date;
  } catch {
    return undefined;
  }
}

export class OllamaProvider extends BaseProvider {
  constructor(baseUrl: string = 'http://localhost:11434') {
    super(undefined, baseUrl);
  }

  protected get requiresApiKey(): boolean {
    return false;
  }

  async listModels(): Promise<ModelDetails[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    const data = await response.json();
    
    return data.models.map((model: any) => ({
      modelId: model.name,
      provider: 'ollama',
      route: 'ollama' as const,
      name: model.name,
      contextLength: 4096, // Default context length, could be adjusted based on model
      costs: {
        promptTokens: 0,
        completionTokens: 0,
      },
      details: {
        format: model.details?.format,
        family: model.details?.family,
        parameterSize: model.details?.parameter_size,
        quantizationLevel: model.details?.quantization_level
      },
      addedDate: parseDate(model.modified_at),
      lastUpdated: parseDate(model.modified_at),
    }));
  }

  getLanguageModel(route: ModelRoute): LanguageModelV1 {
    // For Ollama, we just use the modelId directly
    return ollama(route.modelId);
  }
}

// Factory function to create a provider instance
export function createOllamaProvider(baseUrl?: string): OllamaProvider {
  return new OllamaProvider(baseUrl);
}

export function getOllamaModelUrl(modelId: string): string {
  // Strip off version/tags to get base model name
  const baseModel = modelId.split(':')[0];
  return `https://ollama.com/library/${baseModel}`;
}