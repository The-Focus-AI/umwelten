import { getOllamaModelUrl } from './ollama.js';
import { getOpenRouterModelUrl } from './openrouter.js';
import type { ModelDetails } from '../models/models.js';

export function getModelUrl(model: ModelDetails): string | undefined {
  switch (model.provider) {
    case 'openrouter':
      return getOpenRouterModelUrl(model.id);
    case 'ollama':
      return getOllamaModelUrl(model.id);
    default:
      return undefined;
  }
}

export * from './ollama.js';
export * from './openrouter.js'; 