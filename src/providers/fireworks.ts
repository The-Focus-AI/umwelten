import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

const DEFAULT_BASE_URL = "https://api.fireworks.ai/inference/v1";

export class FireworksProvider extends BaseProvider {
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
        `Failed to fetch Fireworks models: ${response.statusText}`
      );
    }

    const data = await response.json();

    // OpenAI-compatible list models response: { data: [...] }
    if (!data || !Array.isArray(data.data)) {
      return [];
    }

    return data.data.map((model: any) => ({
      provider: "fireworks",
      name: model.id ?? "",
      displayName: model.id,
      contextLength: model.context_length || 4096,
      costs: {
        promptTokens: 0,
        completionTokens: 0,
      },
      details: {
        description: `Fireworks: ${model.id}`,
        family: model.id?.split("/")[0] || "unknown",
        modelId: model.id,
        ownedBy: model.owned_by,
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
      name: "fireworks",
      baseURL: DEFAULT_BASE_URL,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    return provider(route.name);
  }
}

export function createFireworksProvider(apiKey: string): FireworksProvider {
  return new FireworksProvider(apiKey);
}

export function getFireworksModelUrl(modelId: string): string {
  return `https://fireworks.ai/models/${modelId}`;
}
