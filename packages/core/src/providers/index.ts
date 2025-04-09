import { getOllamaModelUrl } from "./ollama.js";
import { getOpenRouterModelUrl } from "./openrouter.js";
import { getGoogleModelUrl } from "./google.js";
import type { ModelDetails } from "../models/types.js";
import { createGoogleProvider } from "./google.js";
import { createOpenRouterProvider } from "./openrouter.js";
import { createOllamaProvider } from "./ollama.js";
import type { LanguageModelV1 } from "ai";
import { BaseProvider } from "./base.js";


export function getModelUrl(model: ModelDetails): string | undefined {
  switch (model.provider) {
    case "openrouter":
      return getOpenRouterModelUrl(model.name);
    case "ollama":
      return getOllamaModelUrl(model.name);
    case "google":
      return getGoogleModelUrl(model.name);
    default:
      return undefined;
  }
}

export async function getModel(
  modelDetails: ModelDetails
): Promise<LanguageModelV1 | undefined> {
  try {
    const provider = await getModelProvider(modelDetails);
    return provider?.getLanguageModel(modelDetails);
  } catch (error) {
    console.error("Error creating model:", error);
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
    case "ollama":
      return createOllamaProvider();
    default:
      throw new Error(
        `Unsupported provider for modelId: ${modelDetails.provider} ${modelDetails.name}`
      );
  }
}

export async function validateModel(
  modelDetails: ModelDetails
): Promise<boolean> {
  const modelProvider = await getModelProvider(modelDetails);
  if (!modelProvider) {
    return false;
  }
  try {
    const models = await modelProvider.listModels();
    return models.some(
      (model: ModelDetails) => model.name === modelDetails.name
    );
  } catch (error) {
    console.error("Error checking model validity:", error);
    return false;
  }
}
