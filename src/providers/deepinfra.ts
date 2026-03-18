import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

const DEFAULT_BASE_URL = "https://api.deepinfra.com/v1/openai";

export class DeepInfraProvider extends BaseProvider {
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
        `Failed to fetch DeepInfra models: ${response.statusText}`
      );
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.data)) {
      return [];
    }

    return data.data
      .filter((model: any) => model.type === "chat" || !model.type)
      .map((model: any) => ({
        provider: "deepinfra",
        name: model.id ?? "",
        displayName: model.id,
        contextLength: model.context_length || model.max_tokens || 4096,
        costs: {
          // DeepInfra returns pricing per token; convert to per-million
          promptTokens: model.pricing?.input
            ? parseFloat(model.pricing.input) * 1_000_000
            : 0,
          completionTokens: model.pricing?.output
            ? parseFloat(model.pricing.output) * 1_000_000
            : 0,
        },
        details: {
          description: `DeepInfra: ${model.id}`,
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
      name: "deepinfra",
      baseURL: DEFAULT_BASE_URL,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    return provider(route.name);
  }
}

export function createDeepInfraProvider(apiKey: string): DeepInfraProvider {
  return new DeepInfraProvider(apiKey);
}

export function getDeepInfraModelUrl(modelId: string): string {
  return `https://deepinfra.com/models/${modelId}`;
}
