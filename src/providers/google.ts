import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";
import { BaseProvider } from "./base.js";

// Google Gemini pricing in USD per 1 million tokens (to match cost calculation format)
const GEMINI_PRICING = {
  "gemini-3-flash-preview": { promptTokens: 0.15, completionTokens: 0.60 },
  "gemini-2.5-pro": { promptTokens: 1.25, completionTokens: 10 },
  "gemini-2.5-pro-exp-03-25": { promptTokens: 2.5, completionTokens: 15 },
  "gemini-2.5-flash": { promptTokens: 0.15, completionTokens: 0.60 },
  "gemini-2.0-flash": { promptTokens: 0.075, completionTokens: 0.30 },
  "gemini-1.5-pro": { promptTokens: 1.25, completionTokens: 5 },
  "gemini-1.5-pro-exp-03-25": { promptTokens: 2.5, completionTokens: 10 },
  "gemini-1.5-flash": { promptTokens: 0.075, completionTokens: 0.30 },
  "gemini-ultra": { promptTokens: 1000, completionTokens: 2000 },
  "gemini-ultra-vision": { promptTokens: 1000, completionTokens: 2000 },
  default: { promptTokens: 0.25, completionTokens: 0.5 }, // Default pricing
} as const;

export class GoogleProvider extends BaseProvider {
  constructor(apiKey: string) {
    super(apiKey);
    this.validateConfig();
  }

  async listModels(): Promise<ModelDetails[]> {
    this.validateConfig();

    const allModels: any[] = [];
    let pageToken: string | undefined;
    const baseDate = new Date("2024-01-01");

    // Fetch all pages of models
    do {
      const url = new URL(
        "https://generativelanguage.googleapis.com/v1beta/models"
      );
      url.searchParams.set("key", this.apiKey!);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.models) {
        allModels.push(...data.models);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    const modelDetails = allModels.map((model: any) => {
      const modelId = model.name.replace("models/", "");
      const baseModel = modelId.split("-").slice(0, 3).join("-");
      return {
        provider: "google",
        name: modelId,
        displayName: model.displayName,
        contextLength: model.inputTokenLimit,
        costs:
          GEMINI_PRICING[baseModel as keyof typeof GEMINI_PRICING] ||
          GEMINI_PRICING.default,
        details: {
          description: model.description,
          family: "gemini",
          version: model.version,
          inputTokenLimit: model.inputTokenLimit,
          outputTokenLimit: model.outputTokenLimit,
          supportedGenerationMethods: model.supportedGenerationMethods,
          temperature: model.temperature,
          topP: model.topP,
          topK: model.topK,
          maxTemperature: model.maxTemperature,
        },
        addedDate: baseDate,
        lastUpdated: new Date(),
      } as ModelDetails;
    });

    // Sort models: Gemini 3.x first, then 2.5, then 2.0, then 1.5, then others
    return modelDetails.sort((a, b) => {
      const getVersionPriority = (name: string): number => {
        if (name.startsWith('gemini-3')) return 0;
        if (name.startsWith('gemini-2.5')) return 1;
        if (name.startsWith('gemini-2.0')) return 2;
        if (name.startsWith('gemini-1.5')) return 3;
        if (name.startsWith('gemini-1')) return 4;
        return 5; // Other models (veo, embedding, etc.)
      };

      const priorityA = getVersionPriority(a.name);
      const priorityB = getVersionPriority(b.name);

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // Within same version, sort alphabetically
      return a.name.localeCompare(b.name);
    });
  }

  getLanguageModel(route: ModelRoute): LanguageModel {
    this.validateConfig();

    // Use the Vercel AI SDK wrapper for Google
    return google(route.name);
  }
}

// Factory function to create a provider instance
export function createGoogleProvider(apiKey: string): GoogleProvider {
  return new GoogleProvider(apiKey);
}

export function getGoogleModelUrl(modelId: string): string {
  return `https://ai.google.dev/models/${modelId}`;
}
