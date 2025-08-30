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
    const response = await fetch('https://models.github.ai/catalog/models', {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'umwelten/github-models-provider'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch GitHub Models: ${response.statusText}`);
    }

    const data = await response.json();
    
    // GitHub Models catalog API returns array of models
    if (!data || !Array.isArray(data)) {
      return [];
    }

    // Map GitHub Models catalog data to ModelDetails
    return data.map((model: any) => ({
      provider: "github-models",
      name: model.id ?? '',
      displayName: model.name || model.id,
      contextLength: model.limits?.max_input_tokens || 4096,
      costs: {
        // GitHub Models pricing not available in catalog
        promptTokens: 0,
        completionTokens: 0,
      },
      details: {
        description: model.summary || `GitHub Models: ${model.id}`,
        family: model.id?.split('/')[0] || 'unknown', // e.g., 'openai', 'meta'
        modelId: model.id,
        publisher: model.publisher,
        version: model.version,
        registry: model.registry,
        rateLimitTier: model.rate_limit_tier,
        supportedInputModalities: model.supported_input_modalities,
        supportedOutputModalities: model.supported_output_modalities,
        tags: model.tags,
        capabilities: model.capabilities,
        htmlUrl: model.html_url,
      },
      addedDate: new Date(), // Catalog doesn't provide creation date
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