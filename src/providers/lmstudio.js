// NOTE: Requires `@ai-sdk/openai-compatible` package. Install with: pnpm add @ai-sdk/openai-compatible
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { BaseProvider } from "./base.js";
// Default LM Studio API base URL
const DEFAULT_BASE_URL = "http://localhost:1234/v1";
export class LMStudioProvider extends BaseProvider {
    constructor(baseUrl = DEFAULT_BASE_URL) {
        super(undefined, baseUrl);
    }
    get requiresApiKey() {
        return false;
    }
    // List available models from LM Studio
    async listModels() {
        const baseUrl = this.baseUrl || DEFAULT_BASE_URL;
        const response = await fetch(`${baseUrl.replace(/\/v1$/, '')}/api/v0/models`);
        if (!response.ok)
            throw new Error("Failed to fetch LM Studio models");
        const data = await response.json();
        if (!data || !Array.isArray(data.data))
            return [];
        // Map LM Studio model info to ModelDetails
        return data.data.map((model) => ({
            provider: "lmstudio",
            name: model.id ?? '',
            contextLength: model.max_context_length,
            costs: {
                promptTokens: 0,
                completionTokens: 0,
            },
            details: {
                description: model.object,
                arch: model.arch,
                quantization: model.quantization,
                type: model.type,
                publisher: model.publisher,
                state: model.state,
                compatibility_type: model.compatibility_type,
            },
            addedDate: undefined,
            lastUpdated: undefined,
        }));
    }
    // Return a LanguageModelV1 instance for the given route
    getLanguageModel(route) {
        // Use the OpenAI-compatible provider instance
        const baseUrl = this.baseUrl || DEFAULT_BASE_URL;
        const lmstudio = createOpenAICompatible({
            name: "lmstudio",
            baseURL: baseUrl,
        });
        return lmstudio(route.name);
    }
}
// Factory function to create a provider instance
export function createLMStudioProvider(baseUrl) {
    return new LMStudioProvider(baseUrl);
}
//# sourceMappingURL=lmstudio.js.map