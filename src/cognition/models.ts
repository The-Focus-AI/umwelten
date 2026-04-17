import { createOpenRouterProvider } from "../providers/openrouter.js";
import { createOllamaProvider } from "../providers/ollama.js";
import { createGoogleProvider } from "../providers/google.js";
import { createLMStudioProvider } from "../providers/lmstudio.js";
import { createLlamaBarnProvider } from "../providers/llamabarn.js";
import { createGitHubModelsProvider } from "../providers/github-models.js";
import { createFireworksProvider } from "../providers/fireworks.js";
import { createMiniMaxProvider } from "../providers/minimax.js";
import { createDeepInfraProvider } from "../providers/deepinfra.js";
import { createTogetherAIProvider } from "../providers/togetherai.js";
import { createNvidiaProvider } from "../providers/nvidia.js";
import type { ModelDetails } from "./types.js";
// Function to get all available models from all providers
export async function getAllModels(): Promise<ModelDetails[]> {
  try {
    const providerEntries: { label: string; listModels: () => Promise<ModelDetails[]> }[] = [
      { label: "ollama", listModels: () => createOllamaProvider().listModels() },
      { label: "lmstudio", listModels: () => createLMStudioProvider().listModels() },
      { label: "llamabarn", listModels: () => createLlamaBarnProvider().listModels() },
      ...(process.env.OPENROUTER_API_KEY
        ? [{ label: "openrouter", listModels: () => createOpenRouterProvider(process.env.OPENROUTER_API_KEY!).listModels() }]
        : []),
      ...(process.env.GOOGLE_GENERATIVE_AI_API_KEY
        ? [{ label: "google", listModels: () => createGoogleProvider(process.env.GOOGLE_GENERATIVE_AI_API_KEY!).listModels() }]
        : []),
      ...(process.env.GITHUB_TOKEN
        ? [{ label: "github-models", listModels: () => createGitHubModelsProvider(process.env.GITHUB_TOKEN!).listModels() }]
        : []),
      ...(process.env.FIREWORKS_API_KEY
        ? [{ label: "fireworks", listModels: () => createFireworksProvider(process.env.FIREWORKS_API_KEY!).listModels() }]
        : []),
      ...(process.env.MINIMAX_API_KEY
        ? [{ label: "minimax", listModels: () => createMiniMaxProvider(process.env.MINIMAX_API_KEY!, process.env.MINIMAX_BASE_URL).listModels() }]
        : []),
      ...(process.env.DEEPINFRA_API_KEY
        ? [{ label: "deepinfra", listModels: () => createDeepInfraProvider(process.env.DEEPINFRA_API_KEY!).listModels() }]
        : []),
      ...(process.env.TOGETHER_API_KEY
        ? [{ label: "togetherai", listModels: () => createTogetherAIProvider(process.env.TOGETHER_API_KEY!).listModels() }]
        : []),
      ...(process.env.NVIDIA_API_KEY
        ? [{ label: "nvidia", listModels: () => createNvidiaProvider(process.env.NVIDIA_API_KEY!).listModels() }]
        : []),
    ];

    const modelLists = await Promise.allSettled(
      providerEntries.map((entry) => entry.listModels())
    );

    modelLists.forEach((result, i) => {
      if (result.status === "rejected") {
        const label = providerEntries[i]?.label ?? "provider";
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.error(`Warning: Could not list ${label} models: ${msg}`);
      }
    });

    return modelLists
      .filter(
        (result): result is PromiseFulfilledResult<ModelDetails[]> =>
          result.status === "fulfilled"
      )
      .flatMap((result) => result.value);
  } catch (error) {
    console.error("Error fetching models:", error);
    return [];
  }
}

/**
 * Search through available models using various criteria
 */
export async function searchModels(
  query: string,
  models: ModelDetails[]
): Promise<ModelDetails[]> {
  const searchTerms = query.toLowerCase().split(/\s+/);
  return models.filter((model) => {
    const searchText =
      `${model.name} ${model.description || ""}`.toLowerCase();
    return searchTerms.every((term) => searchText.includes(term));
  });
}

export function findModelByIdAndProvider(
  models: ModelDetails[],
  name: string,
  provider: string
): ModelDetails | undefined {
  return models.find((model) => model.name === name && model.provider === provider);
}

export function sortModelsByName(models: ModelDetails[]): ModelDetails[] {
  return [...models].sort((a, b) => {
    const nameA = a.name;
    const nameB = b.name;
    return nameA.localeCompare(nameB);
  });
}

export function sortModelsByContextLength(
  models: ModelDetails[]
): ModelDetails[] {
  return [...models].sort((a, b) => {
    const lengthA = a.contextLength || 0;
    const lengthB = b.contextLength || 0;
    return lengthB - lengthA;
  });
}
