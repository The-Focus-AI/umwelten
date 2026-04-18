import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

const DEFAULT_BASE_URL = "http://localhost:8080/v1";

export class LlamaSwapProvider extends BaseProvider {
  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    super(undefined, baseUrl);
  }

  protected get requiresApiKey(): boolean {
    return false;
  }

  async listModels(): Promise<ModelDetails[]> {
    const baseUrl = this.baseUrl || DEFAULT_BASE_URL;
    const response = await fetch(`${baseUrl}/models`);
    if (!response.ok) throw new Error("Failed to fetch llama-swap models");
    const data = await response.json();
    if (!data || !Array.isArray(data.data)) return [];
    return data.data.map((model: any) => {
      const created = typeof model.created === "number" ? new Date(model.created * 1000) : undefined;
      return {
        provider: "llamaswap",
        name: model.id ?? "",
        costs: {
          promptTokens: 0,
          completionTokens: 0,
        },
        details: {
          ownedBy: model.owned_by,
        },
        addedDate: created,
        lastUpdated: created,
      } as ModelDetails;
    });
  }

  getLanguageModel(route: ModelRoute): LanguageModel {
    const baseUrl = this.baseUrl || DEFAULT_BASE_URL;
    const llamaswap = createOpenAICompatible({
      name: "llamaswap",
      baseURL: baseUrl,
    });
    return llamaswap(route.name);
  }
}

export function createLlamaSwapProvider(baseUrl?: string): LlamaSwapProvider {
  return new LlamaSwapProvider(baseUrl);
}
