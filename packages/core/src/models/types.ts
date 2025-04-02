import { z } from 'zod';

export type Route = "direct" | "openrouter" | "ollama";

export interface ModelRoute {
  modelId: string;      // Base model identifier
  provider: string;     // Original provider
  route: Route;         // Access method
  variant?: string;     // Optional variant (e.g. "free")
}

export const ModelRouteSchema = z.object({
  modelId: z.string(),
  provider: z.string(),
  route: z.enum(["direct", "openrouter", "ollama"]),
  variant: z.string().optional()
});

export function parseModelIdentifier(id: string): ModelRoute {
  // Handle OpenRouter format (openrouter/provider/model:variant)
  if (id.includes('/')) {
    const [route, ...rest] = id.split('/');
    const [modelId, variant] = rest.join('/').split(':');
    
    if (route !== 'openrouter') {
      throw new Error(`Invalid route: ${route}. Only 'openrouter' is supported for path-style model IDs.`);
    }
    
    return {
      modelId,
      provider: rest[0], // First part after route is provider
      route: 'openrouter',
      ...(variant && { variant })
    };
  }
  
  // Handle direct access
  return {
    modelId: id,
    provider: inferProviderFromModelId(id),
    route: 'direct'
  };
}

export function formatModelIdentifier(route: ModelRoute): string {
  if (route.route === 'openrouter') {
    const base = `openrouter/${route.provider}/${route.modelId}`;
    return route.variant ? `${base}:${route.variant}` : base;
  }
  return route.modelId;
}

export function inferProviderFromModelId(id: string): string {
  if (id.startsWith('gemini-') || id.startsWith('text-bison-') || id.startsWith('chat-bison-')) {
    return 'google';
  }
  if (id.startsWith('gpt-')) {
    return 'openai';
  }
  if (id.match(/^[a-z0-9-]+:[a-z0-9]+$/)) {
    return 'ollama';
  }
  throw new Error(`Unable to infer provider for model ID: ${id}`);
} 