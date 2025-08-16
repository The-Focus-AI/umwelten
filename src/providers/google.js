import { google } from "@ai-sdk/google";
import { BaseProvider } from "./base.js";
const GEMINI_PRICING = {
    "gemini-2.5-pro": { promptTokens: 0.00000125, completionTokens: 0.00001 },
    "gemini-2.5-pro-exp-03-25": { promptTokens: 0.0000025, completionTokens: 0.000015 },
    "gemini-2.0-flash": { promptTokens: 0.0000001, completionTokens: 0.0000004 },
    "gemini-1.5-pro": { promptTokens: 0.00000125, completionTokens: 0.000005 },
    "gemini-1.5-pro-exp-03-25": { promptTokens: 0.0000025, completionTokens: 0.00001 },
    "gemini-ultra": { promptTokens: 0.001, completionTokens: 0.002 },
    "gemini-ultra-vision": { promptTokens: 0.001, completionTokens: 0.002 },
    default: { promptTokens: 0.00025, completionTokens: 0.0005 }, // Default to Pro pricing
};
export class GoogleProvider extends BaseProvider {
    constructor(apiKey) {
        super(apiKey);
        this.validateConfig();
    }
    async listModels() {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.statusText}`);
        }
        const data = await response.json();
        const baseDate = new Date("2024-01-01");
        return data.models.map((model) => {
            const modelId = model.name.replace("models/", "");
            const baseModel = modelId.split("-").slice(0, 3).join("-");
            return {
                provider: "google",
                name: modelId,
                displayName: model.displayName,
                contextLength: model.inputTokenLimit,
                costs: GEMINI_PRICING[baseModel] ||
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
            };
        });
    }
    getLanguageModel(route) {
        this.validateConfig();
        // Use the Vercel AI SDK wrapper for Google
        return google(route.name);
    }
}
// Factory function to create a provider instance
export function createGoogleProvider(apiKey) {
    return new GoogleProvider(apiKey);
}
export function getGoogleModelUrl(modelId) {
    return `https://ai.google.dev/models/${modelId}`;
}
//# sourceMappingURL=google.js.map