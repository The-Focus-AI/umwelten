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