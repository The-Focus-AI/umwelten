import { openrouter } from '@openrouter/ai-sdk-provider';
import { BaseProvider } from './base.js';
export function createOpenRouterModel(modelName) {
    return openrouter(modelName);
}
// Function to get available models from OpenRouter
function parseUnixTimestamp(timestamp) {
    try {
        const date = new Date(timestamp * 1000);
        return date;
    }
    catch {
        return undefined;
    }
}
export class OpenRouterProvider extends BaseProvider {
    constructor(apiKey) {
        super(apiKey);
        this.validateConfig();
    }
    async listModels() {
        const response = await fetch('https://openrouter.ai/api/v1/models', {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            }
        });
        const data = await response.json();
        return data.data.map((model) => ({
            name: model.id,
            provider: 'openrouter',
            originalProvider: model.id.split('/')[0], // e.g., 'openai', 'anthropic'
            route: 'openrouter',
            contextLength: model.context_length,
            costs: {
                promptTokens: parseFloat(model.pricing?.prompt || '0'),
                completionTokens: parseFloat(model.pricing?.completion || '0'),
            },
            details: {
                provider: model.id.split('/')[0], // Include original provider in details
                architecture: model.architecture?.modality,
                tokenizer: model.architecture?.tokenizer,
                instructType: model.architecture?.instruct_type,
            },
            addedDate: model.created ? parseUnixTimestamp(model.created) : undefined,
            lastUpdated: model.created ? parseUnixTimestamp(model.created) : undefined,
        }));
    }
    getLanguageModel(route) {
        this.validateConfig();
        // Format the model ID for OpenRouter
        const modelId = route.name;
        // The openrouter function from the SDK automatically uses OPENROUTER_API_KEY from env
        return openrouter(modelId);
    }
}
// Factory function to create a provider instance
export function createOpenRouterProvider(apiKey) {
    return new OpenRouterProvider(apiKey);
}
export function getOpenRouterModelUrl(modelId) {
    return `https://openrouter.ai/${modelId}`;
}
//# sourceMappingURL=openrouter.js.map