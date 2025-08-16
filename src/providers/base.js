/**
 * Base class for all model providers.
 * Each provider must implement:
 * 1. listModels() - List all available models from this provider
 * 2. getLanguageModel() - Get a specific model instance
 */
export class BaseProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }
    /**
     * Validate that required configuration is present
     */
    validateConfig() {
        if (this.requiresApiKey && !this.apiKey) {
            throw new Error(`${this.constructor.name} requires an API key`);
        }
    }
    /**
     * Whether this provider requires an API key
     */
    get requiresApiKey() {
        return true;
    }
}
//# sourceMappingURL=base.js.map