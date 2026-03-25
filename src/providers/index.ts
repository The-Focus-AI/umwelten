import { getOllamaModelUrl } from "./ollama.js";
import { getOpenRouterModelUrl } from "./openrouter.js";
import { getGoogleModelUrl } from "./google.js";
import { getGitHubModelsModelUrl } from "./github-models.js";
import { getFireworksModelUrl } from "./fireworks.js";
import {
  createMiniMaxProvider,
  getMiniMaxCanonicalModelName,
  getMiniMaxModelUrl,
} from "./minimax.js";
import type { ModelDetails } from "../cognition/types.js";
import { createGoogleProvider } from "./google.js";
import { createOpenRouterProvider } from "./openrouter.js";
import { createOllamaProvider } from "./ollama.js";
import { createGitHubModelsProvider } from "./github-models.js";
import { createFireworksProvider } from "./fireworks.js";
import { createDeepInfraProvider, getDeepInfraModelUrl } from "./deepinfra.js";
import { createTogetherAIProvider, getTogetherAIModelUrl } from "./togetherai.js";
import { createNvidiaProvider, getNvidiaModelUrl } from "./nvidia.js";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import { createLMStudioProvider } from "./lmstudio.js";


export function getModelUrl(model: ModelDetails): string | undefined {
  switch (model.provider) {
    case "openrouter":
      return getOpenRouterModelUrl(model.name);
    case "ollama":
      return getOllamaModelUrl(model.name);
    case "google":
      return getGoogleModelUrl(model.name);
    case "github-models":
      return getGitHubModelsModelUrl(model.name);
    case "fireworks":
      return getFireworksModelUrl(model.name);
    case "minimax":
      return getMiniMaxModelUrl(model.name);
    case "deepinfra":
      return getDeepInfraModelUrl(model.name);
    case "nvidia":
      return getNvidiaModelUrl(model.name);
    case "togetherai":
      return getTogetherAIModelUrl(model.name);
    case "lmstudio":
      return undefined;
    default:
      return undefined;
  }
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
    const providers = ['google', 'openrouter', 'ollama', 'github-models', 'fireworks', 'minimax', 'deepinfra', 'nvidia', 'togetherai', 'lmstudio'] as const;
    
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
  switch (modelDetails.provider) {
    case "google":
      const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      if (!googleKey) {
        throw new Error(
          "GOOGLE_GENERATIVE_AI_API_KEY environment variable is required"
        );
      }
      return createGoogleProvider(googleKey);
    case "openrouter":
      const openrouterKey = process.env.OPENROUTER_API_KEY;
      if (!openrouterKey) {
        throw new Error("OPENROUTER_API_KEY environment variable is required");
      }
      return createOpenRouterProvider(openrouterKey);
    case "github-models":
      const githubToken = process.env.GITHUB_TOKEN;
      if (!githubToken) {
        throw new Error("GITHUB_TOKEN environment variable is required");
      }
      return createGitHubModelsProvider(githubToken);
    case "fireworks":
      const fireworksKey = process.env.FIREWORKS_API_KEY;
      if (!fireworksKey) {
        throw new Error("FIREWORKS_API_KEY environment variable is required");
      }
      return createFireworksProvider(fireworksKey);
    case "minimax":
      const minimaxKey = process.env.MINIMAX_API_KEY;
      if (!minimaxKey) {
        throw new Error("MINIMAX_API_KEY environment variable is required");
      }
      return createMiniMaxProvider(minimaxKey, process.env.MINIMAX_BASE_URL);
    case "deepinfra":
      const deepinfraKey = process.env.DEEPINFRA_API_KEY;
      if (!deepinfraKey) {
        throw new Error("DEEPINFRA_API_KEY environment variable is required");
      }
      return createDeepInfraProvider(deepinfraKey);
    case "nvidia":
      const nvidiaKey = process.env.NVIDIA_API_KEY;
      if (!nvidiaKey) {
        throw new Error("NVIDIA_API_KEY environment variable is required");
      }
      return createNvidiaProvider(nvidiaKey);
    case "togetherai":
      const togetheraiKey = process.env.TOGETHER_API_KEY;
      if (!togetheraiKey) {
        throw new Error("TOGETHER_API_KEY environment variable is required");
      }
      return createTogetherAIProvider(togetheraiKey);
    case "ollama":
      return createOllamaProvider();
    case "lmstudio":
      return createLMStudioProvider();
    default:
      throw new Error(
        `Unsupported provider for modelId: ${modelDetails.provider} ${modelDetails.name}`
      );
  }
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
