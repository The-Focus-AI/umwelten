import { getOllamaModelUrl } from './ollama.js';
import { getOpenRouterModelUrl } from './openrouter.js';
import { getGoogleModelUrl } from './google.js';
import type { ModelDetails } from '../models/models.js';
import { parseModelIdentifier } from '../models/types.js';
import { createGoogleProvider } from './google.js';
import { createOpenRouterProvider } from './openrouter.js';
import { createOllamaProvider } from './ollama.js';
import type { LanguageModelV1 } from 'ai';

export function getModelUrl(model: ModelDetails): string | undefined {
  switch (model.provider) {
    case 'openrouter':
      return getOpenRouterModelUrl(model.modelId);
    case 'ollama':
      return getOllamaModelUrl(model.modelId);
    case 'google':
      return getGoogleModelUrl(model.modelId);
    default:
      return undefined;
  }
}

/**
 * Get a model instance for the given model identifier.
 * The model identifier can be in one of these formats:
 * - Direct access: "gemini-pro" (provider inferred from model ID)
 * - OpenRouter: "openrouter/openai/gpt-4-turbo:free"
 * - Ollama: "ollama/llama2"
 */
export async function getModelProvider(modelId: string): Promise<LanguageModelV1 | undefined> {
  try {
    const route = parseModelIdentifier(modelId);

    switch (route.provider) {
      case 'google':
        const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!googleKey) {
          throw new Error('GOOGLE_GENERATIVE_AI_API_KEY environment variable is required');
        }
        return createGoogleProvider(googleKey).getLanguageModel(route);
      case 'openrouter':
        const openrouterKey = process.env.OPENROUTER_API_KEY;
        if (!openrouterKey) {
          throw new Error('OPENROUTER_API_KEY environment variable is required');
        }
        return createOpenRouterProvider(openrouterKey).getLanguageModel(route);
      case 'ollama':
        return createOllamaProvider().getLanguageModel(route);
      default:
        throw new Error(`Unsupported provider: ${route.provider}`);
    }
  } catch (error) {
    console.error('Error creating model:', error);
    return undefined;
  }
}
