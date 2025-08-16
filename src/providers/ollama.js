import { ollama } from "ai-sdk-ollama";
import { BaseProvider } from "./base.js";
const now = new Date();
function parseDate(dateStr) {
    try {
        const date = new Date(dateStr);
        // Don't accept future dates
        return date > now ? undefined : date;
    }
    catch {
        return undefined;
    }
}
export class OllamaProvider extends BaseProvider {
    constructor(baseUrl = "http://localhost:11434") {
        super(undefined, baseUrl);
    }
    get requiresApiKey() {
        return false;
    }
    async listModels() {
        const response = await fetch(`${this.baseUrl}/api/tags`);
        const data = await response.json();
        return data.models.map((model) => ({
            provider: "ollama",
            name: model.name,
            contextLength: 4096, // Default context length, could be adjusted based on model
            costs: {
                promptTokens: 0,
                completionTokens: 0,
            },
            details: {
                format: model.details?.format,
                family: model.details?.family,
                parameterSize: model.details?.parameter_size,
                quantizationLevel: model.details?.quantization_level,
            },
            addedDate: parseDate(model.modified_at),
            lastUpdated: parseDate(model.modified_at),
        }));
    }
    getLanguageModel(route) {
        return ollama(route.name, {
            options: {
                num_ctx: route.numCtx
            }
        });
    }
}
// Factory function to create a provider instance
export function createOllamaProvider(baseUrl) {
    return new OllamaProvider(baseUrl);
}
export function getOllamaModelUrl(modelId) {
    // Strip off version/tags to get base model name
    return `https://ollama.com/library/${modelId}`;
}
//# sourceMappingURL=ollama.js.map