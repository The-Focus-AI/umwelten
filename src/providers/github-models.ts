// NOTE: Requires `@ai-sdk/openai-compatible` package. Install with: npm add @ai-sdk/openai-compatible
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

// GitHub Models API base URL
const DEFAULT_BASE_URL = "https://models.github.ai/inference";

export class GitHubModelsProvider extends BaseProvider {
  constructor(apiKey?: string, baseUrl?: string) {
    super(apiKey, baseUrl);
    this.validateConfig();
  }

  protected get requiresApiKey(): boolean {
    return true;
  }

  // List available models from GitHub Models
  async listModels(): Promise<ModelDetails[]> {
    const baseUrl = this.baseUrl || DEFAULT_BASE_URL;
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
        'User-Agent': 'umwelten/github-models-provider'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch GitHub Models: ${response.statusText}`);
    }

    const data = await response.json();
    
    // GitHub Models uses OpenAI-compatible API format
    if (!data || !Array.isArray(data.data)) {
      return [];
    }

    // Map GitHub Models model info to ModelDetails
    return data.data.map((model: any) => ({
      provider: "github-models",
      name: model.id ?? '',
      displayName: model.name || model.id,
      contextLength: model.context_window || 4096, // Default context window
      costs: {
        // GitHub Models is free during preview
        promptTokens: 0,
        completionTokens: 0,
      },
      details: {
        description: model.description || `GitHub Models: ${model.id}`,
        family: model.id?.split('/')[0] || 'unknown', // e.g., 'openai', 'meta'
        modelId: model.id,
        object: model.object,
        created: model.created,
        owned_by: model.owned_by,
      },
      addedDate: model.created ? new Date(model.created * 1000) : undefined,
      lastUpdated: new Date(),
    }));
  }

  // Return a LanguageModelV1 instance for the given route
  getLanguageModel(route: ModelRoute): LanguageModel {
    this.validateConfig();
    
    // Use the OpenAI-compatible provider instance
    const baseUrl = this.baseUrl || DEFAULT_BASE_URL;
    const githubModels = createOpenAICompatible({
      name: "github-models",
      baseURL: baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'User-Agent': 'umwelten/github-models-provider'
      }
    });
    
    return githubModels(route.name);
  }
}

// Factory function to create a provider instance
export function createGitHubModelsProvider(apiKey?: string, baseUrl?: string): GitHubModelsProvider {
  return new GitHubModelsProvider(apiKey, baseUrl);
}

export function getGitHubModelsModelUrl(modelId: string): string {
  return `https://github.com/marketplace/models/${modelId.replace('/', '-')}`;
}