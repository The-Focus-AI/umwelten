import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

export class NvidiaProvider extends BaseProvider {
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
        `Failed to fetch NVIDIA models: ${response.statusText}`
      );
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.data)) {
      return [];
    }

    return data.data
      .filter((model: any) => model.id?.includes("nemotron") || model.id?.includes("llama") || !model.type || model.type === "chat")
      .map((model: any) => ({
        provider: "nvidia",
        name: model.id ?? "",
        displayName: model.id,
        contextLength: model.context_length || model.max_tokens || 4096,
        costs: {
          promptTokens: 0,
          completionTokens: 0,
        },
        details: {
          description: `NVIDIA NIM: ${model.id}`,
          family: model.id?.split("/")[0] || "nvidia",
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
      name: "nvidia",
      baseURL: DEFAULT_BASE_URL,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    return provider(route.name);
  }
}

export function createNvidiaProvider(apiKey: string): NvidiaProvider {
  return new NvidiaProvider(apiKey);
}

export function getNvidiaModelUrl(modelId: string): string {
  return `https://build.nvidia.com/explore/discover#${modelId}`;
}
