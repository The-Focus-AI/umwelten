import { getOllamaModelUrl } from "./ollama.js";
import { getOpenRouterModelUrl } from "./openrouter.js";
import { getGoogleModelUrl } from "./google.js";
import { createGoogleProvider } from "./google.js";
import { createOpenRouterProvider } from "./openrouter.js";
import { createOllamaProvider } from "./ollama.js";
import { createLMStudioProvider } from "./lmstudio.js";
export function getModelUrl(model) {
    switch (model.provider) {
        case "openrouter":
            return getOpenRouterModelUrl(model.name);
        case "ollama":
            return getOllamaModelUrl(model.name);
        case "google":
            return getGoogleModelUrl(model.name);
        case "lmstudio":
            return undefined;
        default:
            return undefined;
    }
}
export async function getModel(modelDetails) {
    try {
        const provider = await getModelProvider(modelDetails);
        return provider?.getLanguageModel(modelDetails);
    }
    catch (error) {
        console.error("Error creating model:", error);
        return undefined;
    }
}
/**
 * Gets the ModelDetails for a given LanguageModelV1 instance by looking up the model
 * from its provider
 */
export async function getModelDetails(model) {
    try {
        // For string models, we can't determine the provider
        if (typeof model === 'string') {
            return undefined;
        }
        // For LanguageModelV2, we need to determine the provider differently
        // Since we don't have direct access to provider info, we'll try to match by model ID
        const modelId = model.toString();
        // Try to find the model in our known providers
        const providers = ['google', 'openrouter', 'ollama', 'lmstudio'];
        for (const providerName of providers) {
            try {
                const provider = await getModelProvider({
                    name: modelId,
                    provider: providerName
                });
                if (provider) {
                    const models = await provider.listModels();
                    const foundModel = models.find(m => m.name === modelId);
                    if (foundModel) {
                        return foundModel;
                    }
                }
            }
            catch (error) {
                // Continue to next provider
                continue;
            }
        }
        return undefined;
    }
    catch (error) {
        console.error("Error getting model details:", error);
        return undefined;
    }
}
export async function getModelProvider(modelDetails) {
    switch (modelDetails.provider) {
        case "google":
            const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
            if (!googleKey) {
                throw new Error("GOOGLE_GENERATIVE_AI_API_KEY environment variable is required");
            }
            return createGoogleProvider(googleKey);
        case "openrouter":
            const openrouterKey = process.env.OPENROUTER_API_KEY;
            if (!openrouterKey) {
                throw new Error("OPENROUTER_API_KEY environment variable is required");
            }
            return createOpenRouterProvider(openrouterKey);
        case "ollama":
            return createOllamaProvider();
        case "lmstudio":
            return createLMStudioProvider();
        default:
            throw new Error(`Unsupported provider for modelId: ${modelDetails.provider} ${modelDetails.name}`);
    }
}
export async function validateModel(modelDetails) {
    const modelProvider = await getModelProvider(modelDetails);
    if (!modelProvider) {
        return undefined;
    }
    try {
        const models = await modelProvider.listModels();
        return models.find((model) => model.name === modelDetails.name);
    }
    catch (error) {
        console.error("Error checking model validity:", error);
        return undefined;
    }
}
//# sourceMappingURL=index.js.map