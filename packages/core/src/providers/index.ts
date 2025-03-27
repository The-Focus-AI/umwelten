import { getOllamaModelUrl } from './ollama.ts';
import { getOpenRouterModelUrl } from './openrouter.ts';
import { getGoogleModelUrl } from './google.ts';
import type { ModelDetails } from '../models/models.ts';

export function getModelUrl(model: ModelDetails): string | undefined {
  switch (model.provider) {
    case 'openrouter':
      return getOpenRouterModelUrl(model.id);
    case 'ollama':
      return getOllamaModelUrl(model.id);
    case 'google':
      return getGoogleModelUrl(model.id);
    default:
      return undefined;
  }
}
