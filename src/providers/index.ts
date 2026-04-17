import { createOllamaProvider, getOllamaModelUrl } from "./ollama.js";
import { createOpenRouterProvider, getOpenRouterModelUrl } from "./openrouter.js";
import { createGoogleProvider, getGoogleModelUrl } from "./google.js";
import { createGitHubModelsProvider, getGitHubModelsModelUrl } from "./github-models.js";
import { createFireworksProvider, getFireworksModelUrl } from "./fireworks.js";
import {
  createMiniMaxProvider,
  getMiniMaxCanonicalModelName,
  getMiniMaxModelUrl,
} from "./minimax.js";
import type { ModelDetails } from "../cognition/types.js";
import { createDeepInfraProvider, getDeepInfraModelUrl } from "./deepinfra.js";
import { createTogetherAIProvider, getTogetherAIModelUrl } from "./togetherai.js";
import { createNvidiaProvider, getNvidiaModelUrl } from "./nvidia.js";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import { createLMStudioProvider } from "./lmstudio.js";
import { createLlamaBarnProvider } from "./llamabarn.js";
import { registerProvider, getRegisteredProvider, listRegisteredProviders } from "./registry.js";

// Re-export registry functions
export { registerProvider, getRegisteredProvider, listRegisteredProviders } from "./registry.js";

// Register all built-in providers at module load time
registerProvider("google", {
  create: (key) => createGoogleProvider(key!),
  envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
  getModelUrl: getGoogleModelUrl,
});

registerProvider("openrouter", {
  create: (key) => createOpenRouterProvider(key!),
  envVar: "OPENROUTER_API_KEY",
  getModelUrl: getOpenRouterModelUrl,
});

registerProvider("github-models", {
  create: (key) => createGitHubModelsProvider(key!),
  envVar: "GITHUB_TOKEN",
  getModelUrl: getGitHubModelsModelUrl,
});

registerProvider("fireworks", {
  create: (key) => createFireworksProvider(key!),
  envVar: "FIREWORKS_API_KEY",
  getModelUrl: getFireworksModelUrl,
});

registerProvider("minimax", {
  create: (key) => createMiniMaxProvider(key!, process.env.MINIMAX_BASE_URL),
  envVar: "MINIMAX_API_KEY",
  getModelUrl: getMiniMaxModelUrl,
});

registerProvider("deepinfra", {
  create: (key) => createDeepInfraProvider(key!),
  envVar: "DEEPINFRA_API_KEY",
  getModelUrl: getDeepInfraModelUrl,
});

registerProvider("nvidia", {
  create: (key) => createNvidiaProvider(key!),
  envVar: "NVIDIA_API_KEY",
  getModelUrl: getNvidiaModelUrl,
});

registerProvider("togetherai", {
  create: (key) => createTogetherAIProvider(key!),
  envVar: "TOGETHER_API_KEY",
  getModelUrl: getTogetherAIModelUrl,
});

registerProvider("ollama", {
  create: () => createOllamaProvider(),
  getModelUrl: getOllamaModelUrl,
});

registerProvider("lmstudio", {
  create: () => createLMStudioProvider(),
});

registerProvider("llamabarn", {
  create: () => createLlamaBarnProvider(),
});


export function getModelUrl(model: ModelDetails): string | undefined {
  const entry = getRegisteredProvider(model.provider);
  return entry?.getModelUrl?.(model.name);
}

export async function getModel(
  modelDetails: ModelDetails
): Promise<LanguageModel | undefined> {
  try {
    const provider = await getModelProvider(modelDetails);
    return provider?.getLanguageModel(modelDetails);
  } catch (error) {
    console.error("Error creating model:", error);
    return undefined;
  }
}

/**
 * Gets the ModelDetails for a given LanguageModelV1 instance by looking up the model
 * from its provider
 */
export async function getModelDetails(model: LanguageModel): Promise<ModelDetails | undefined> {
  try {
    // For string models, we can't determine the provider
    if (typeof model === 'string') {
      return undefined;
    }
    
    // For LanguageModelV2, we need to determine the provider differently
    // Since we don't have direct access to provider info, we'll try to match by model ID
    const modelId = model.toString();
    
    // Try to find the model in our known providers
    const providers = listRegisteredProviders();
    
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
      } catch (error) {
        // Continue to next provider
        continue;
      }
    }
    
    return undefined;

  } catch (error) {
    console.error("Error getting model details:", error);
    return undefined;
  }
}


export async function getModelProvider(
  modelDetails: ModelDetails
): Promise<BaseProvider | undefined> {
  const entry = getRegisteredProvider(modelDetails.provider);
  if (!entry) {
    throw new Error(
      `Unsupported provider for modelId: ${modelDetails.provider} ${modelDetails.name}`
    );
  }
  if (entry.envVar) {
    const key = process.env[entry.envVar];
    if (!key) {
      throw new Error(`${entry.envVar} environment variable is required`);
    }
    return entry.create(key);
  }
  return entry.create();
}

// Known OpenRouter model variant suffixes (e.g. `:thinking`, `:free`, `:extended`)
const VARIANT_SUFFIX_RE = /:(thinking|free|extended|nitro|floor)$/;

export async function validateModel(
  modelDetails: ModelDetails
): Promise<ModelDetails | undefined> {
  const modelProvider = await getModelProvider(modelDetails);
  if (!modelProvider) {
    return undefined;
  }
  try {
    const models = await modelProvider.listModels();
    // Try exact match first
    const exact = models.find(
      (model: ModelDetails) => model.name === modelDetails.name
    );
    if (exact) return exact;

    // For variant suffixes (e.g. "model:thinking"), validate the base model
    // but return the original details so the variant is preserved for the API call
    const variantMatch = modelDetails.name.match(VARIANT_SUFFIX_RE);
    if (variantMatch) {
      const baseName = modelDetails.name.replace(VARIANT_SUFFIX_RE, '');
      const baseModel = models.find(
        (model: ModelDetails) => model.name === baseName
      );
      if (baseModel) {
        return { ...modelDetails };
      }
    }

    if (modelDetails.provider === "minimax") {
      const canonicalName = getMiniMaxCanonicalModelName(modelDetails.name);
      const canonicalModel = models.find(
        (model: ModelDetails) => model.name === canonicalName
      );
      if (canonicalModel) {
        return { ...modelDetails };
      }
    }

    return undefined;
  } catch (error) {
    // Network errors (timeouts, DNS, etc.) should not block the request —
    // return the original model details so the actual API call can proceed.
    console.error("Error checking model validity:", error);
    return { ...modelDetails };
  }
}
