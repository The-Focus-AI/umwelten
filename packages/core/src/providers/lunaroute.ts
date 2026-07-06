import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

const DEFAULT_BASE_URL = "https://gw.lunaroute.com/v1";

/**
 * Published LunaRoute pricing per 1M tokens (lunaroute.com, 2026-07-06).
 * The gateway's /v1/models does not include pricing, and served model IDs
 * carry variant suffixes (e.g. "glm-5.2-nvfp4"), so lookup is by longest
 * matching prefix.
 */
const KNOWN_PRICING: Record<string, { promptTokens: number; completionTokens: number }> = {
  "glm-5.2": { promptTokens: 2.1, completionTokens: 6.6 },
  "kimi-k2.7": { promptTokens: 1.5, completionTokens: 6.0 },
  "qwen-3.7-plus": { promptTokens: 0.4, completionTokens: 1.6 },
  "minimax-m3": { promptTokens: 0.45, completionTokens: 1.8 },
  "deepseek-v4-pro": { promptTokens: 2.61, completionTokens: 5.22 },
};

function pricingForModel(id: string): { promptTokens: number; completionTokens: number } | undefined {
  const key = Object.keys(KNOWN_PRICING)
    .filter((k) => id === k || id.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? KNOWN_PRICING[key] : undefined;
}

export class LunaRouteProvider extends BaseProvider {
  constructor(apiKey: string, baseUrl: string = DEFAULT_BASE_URL) {
    super(apiKey, baseUrl);
    this.validateConfig();
  }

  async listModels(): Promise<ModelDetails[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    const data = await response.json();

    if (!response.ok || !Array.isArray(data?.data)) {
      throw new Error(
        `LunaRoute API error: ${data?.error?.message || data?.error || response.statusText || "unexpected response format"}`,
      );
    }

    return data.data.map((model: any) => {
      const created =
        typeof model.created === "number" && model.created > 0
          ? new Date(model.created * 1000)
          : undefined;
      // Prefer pricing from the API response; fall back to the published table
      const apiPrompt = parseFloat(model.pricing?.prompt ?? "");
      const apiCompletion = parseFloat(model.pricing?.completion ?? "");
      const fallback = pricingForModel(model.id);
      return {
        provider: "lunaroute",
        name: model.id,
        contextLength: model.context_length,
        costs: {
          promptTokens: Number.isFinite(apiPrompt) ? apiPrompt * 1_000_000 : fallback?.promptTokens ?? 0,
          completionTokens: Number.isFinite(apiCompletion) ? apiCompletion * 1_000_000 : fallback?.completionTokens ?? 0,
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
    this.validateConfig();
    const lunaroute = createOpenAICompatible({
      name: "lunaroute",
      baseURL: this.baseUrl || DEFAULT_BASE_URL,
      apiKey: this.apiKey,
      includeUsage: true,
    });
    return lunaroute(route.name);
  }
}

export function createLunaRouteProvider(apiKey: string, baseUrl?: string): LunaRouteProvider {
  return new LunaRouteProvider(apiKey, baseUrl);
}

export function getLunaRouteModelUrl(_modelId: string): string {
  return "https://lunaroute.com";
}
