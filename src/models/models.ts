import { createOpenRouterProvider } from "../providers/openrouter.js";
import { createOllamaProvider } from "../providers/ollama.js";
import { createGoogleProvider } from "../providers/google.js";
import type { ModelDetails } from "./types.js";
// Function to get all available models from all providers
export async function getAllModels(): Promise<ModelDetails[]> {
  try {
    const providers = [
      createOllamaProvider(),
      ...(process.env.OPENROUTER_API_KEY
        ? [createOpenRouterProvider(process.env.OPENROUTER_API_KEY)]
        : []),
      ...(process.env.GOOGLE_GENERATIVE_AI_API_KEY
        ? [createGoogleProvider(process.env.GOOGLE_GENERATIVE_AI_API_KEY)]
        : []),
    ];

    const modelLists = await Promise.allSettled(
      providers.map((provider) => provider.listModels())
    );

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
