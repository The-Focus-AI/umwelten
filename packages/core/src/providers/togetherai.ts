import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

const DEFAULT_BASE_URL = "https://api.together.xyz/v1";

export class TogetherAIProvider extends BaseProvider {
  constructor(apiKey: string) {
    super(apiKey);
    this.validateConfig();
  }

  protected get requiresApiKey(): boolean {
    return true;
  }

  async listModels(): Promise<ModelDetails[]> {
    this.validateConfig();

    const response = await fetch(`${DEFAULT_BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Together AI models: ${response.statusText}`
      );
    }

    const data = await response.json();

    // Together AI returns an array directly (not wrapped in { data: [...] })
    const models = Array.isArray(data) ? data : data.data;
    if (!models || !Array.isArray(models)) {
      return [];
    }

    return models
      .filter((model: any) => model.type === "chat" || !model.type)
      .map((model: any) => ({
        provider: "togetherai",
        name: model.id ?? "",
        displayName: model.display_name || model.id,
        contextLength: model.context_length || 4096,
        costs: {
          // Together AI returns pricing per token; convert to per-million
          promptTokens: model.pricing?.input
            ? parseFloat(model.pricing.input) * 1_000_000
            : 0,
          completionTokens: model.pricing?.output
            ? parseFloat(model.pricing.output) * 1_000_000
            : 0,
        },
        details: {
          description: `Together AI: ${model.id}`,
          family: model.id?.split("/")[0] || "unknown",
          modelId: model.id,
          organization: model.organization,
        },
        addedDate: model.created
          ? new Date(model.created * 1000)
          : new Date(),
        lastUpdated: new Date(),
      }));
  }

  getLanguageModel(route: ModelRoute): LanguageModel {
    this.validateConfig();

    const provider = createOpenAICompatible({
      name: "togetherai",
      baseURL: DEFAULT_BASE_URL,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    return provider(route.name);
  }
}

export function createTogetherAIProvider(apiKey: string): TogetherAIProvider {
  return new TogetherAIProvider(apiKey);
}

export function getTogetherAIModelUrl(modelId: string): string {
  return `https://api.together.xyz/models/${modelId}`;
}
