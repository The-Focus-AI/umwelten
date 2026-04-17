import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

const DEFAULT_BASE_URL = "http://localhost:2276/v1";

function parseCtxSize(preset: string | undefined): number | undefined {
  if (!preset) return undefined;
  const match = preset.match(/^ctx-size\s*=\s*(\d+)/m);
  return match ? Number(match[1]) : undefined;
}

export class LlamaBarnProvider extends BaseProvider {
  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    super(undefined, baseUrl);
  }

  protected get requiresApiKey(): boolean {
    return false;
  }

  async listModels(): Promise<ModelDetails[]> {
    const baseUrl = this.baseUrl || DEFAULT_BASE_URL;
    const response = await fetch(`${baseUrl}/models`);
    if (!response.ok) throw new Error("Failed to fetch LlamaBarn models");
    const data = await response.json();
    if (!data || !Array.isArray(data.data)) return [];
    return data.data.map((model: any) => {
      const state = model.status?.value;
      const preset = model.status?.preset;
      const ctxSize = parseCtxSize(preset);
      const created = typeof model.created === "number" ? new Date(model.created * 1000) : undefined;
      return {
        provider: "llamabarn",
        name: model.id ?? "",
        contextLength: ctxSize,
        costs: {
          promptTokens: 0,
          completionTokens: 0,
        },
        details: {
          ownedBy: model.owned_by,
          state,
          aliases: model.aliases,
          tags: model.tags,
        },
        addedDate: created,
        lastUpdated: created,
      } as ModelDetails;
    });
  }

  getLanguageModel(route: ModelRoute): LanguageModel {
    const baseUrl = this.baseUrl || DEFAULT_BASE_URL;
    const llamabarn = createOpenAICompatible({
      name: "llamabarn",
      baseURL: baseUrl,
    });
    return llamabarn(route.name);
  }
}

export function createLlamaBarnProvider(baseUrl?: string): LlamaBarnProvider {
  return new LlamaBarnProvider(baseUrl);
}
