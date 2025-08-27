import { ollama } from "ai-sdk-ollama";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

// Known context windows for Ollama models (based on model architectures)
const OLLAMA_CONTEXT_WINDOWS: Record<string, number> = {
  // Llama models
  'llama3.3:70b': 131072,
  'llama3.2:1b': 131072,
  'llama3.2:3b': 131072,
  'llama3.2:latest': 131072,
  'llama3.1:8b': 131072,
  'llama3.1:70b': 131072,
  'llama3.1:405b': 131072,
  'llama3:8b': 8192,
  'llama3:70b': 8192,
  
  // Gemma models  
  'gemma3:12b': 8192,
  'gemma3:27b': 8192,
  'gemma3:4b': 8192,
  'gemma2:2b': 8192,
  'gemma2:9b': 8192,
  'gemma2:27b': 8192,
  
  // Code models
  'codestral:latest': 32768,
  'codegemma:7b': 8192,
  'deepseek-coder-v2:16b': 32768,
  'deepseek-coder-v2:236b': 32768,
  
  // Reasoning models
  'deepseek-r1:1.5b': 32768,
  'deepseek-r1:7b': 32768,
  'deepseek-r1:8b': 32768,
  'deepseek-r1:14b': 32768,
  'deepseek-r1:32b': 32768,
  'deepseek-r1:70b': 32768,
  
  // Mistral models
  'mistral:7b': 32768,
  'mistral-large:latest': 32768,
  'mistral-small3.1:latest': 32768,
  'mistral-small3.2:24b': 32768,
  'devstral:24b': 32768,
  
  // Qwen models
  'qwen2.5:0.5b': 32768,
  'qwen2.5:1.5b': 32768,
  'qwen2.5:3b': 32768,
  'qwen2.5:7b': 32768,
  'qwen2.5:14b': 32768,
  'qwen2.5:32b': 32768,
  'qwen2.5:72b': 32768,
  'qwen2.5-coder:0.5b': 32768,
  'qwen2.5-coder:1.5b': 32768,
  'qwen2.5-coder:3b': 32768,
  'qwen2.5-coder:7b': 32768,
  'qwen2.5-coder:14b': 32768,
  'qwen2.5-coder:32b': 32768,
  'qwen2.5vl:latest': 32768,
  'qwen3-coder:latest': 32768,
  
  // Phi models
  'phi4:latest': 16384,
  'phi4-mini:latest': 16384,
  'phi4-reasoning:latest': 16384,
  
  // Other models
  'nous-hermes2:10.7b': 4096,
  'nous-hermes2:34b': 4096,
  'yi:6b': 4096,
  'yi:34b': 4096,
  'solar:10.7b': 4096,
  'orca-mini': 2048,
  'vicuna:7b': 2048,
  'vicuna:13b': 2048,
  'vicuna:33b': 2048,
};

function getContextWindow(modelName: string): number {
  // Try exact match first
  if (OLLAMA_CONTEXT_WINDOWS[modelName]) {
    return OLLAMA_CONTEXT_WINDOWS[modelName];
  }
  
  // Try to match without version/tag
  const baseName = modelName.split(':')[0];
  const possibleKeys = Object.keys(OLLAMA_CONTEXT_WINDOWS).filter(key => 
    key.startsWith(baseName + ':') || key === baseName
  );
  
  if (possibleKeys.length > 0) {
    return OLLAMA_CONTEXT_WINDOWS[possibleKeys[0]];
  }
  
  // Try family-based matching
  if (modelName.includes('llama3.2') || modelName.includes('llama3.1')) return 131072;
  if (modelName.includes('llama3')) return 8192;
  if (modelName.includes('gemma3') || modelName.includes('gemma2')) return 8192;
  if (modelName.includes('deepseek-r1') || modelName.includes('deepseek-coder')) return 32768;
  if (modelName.includes('mistral') || modelName.includes('codestral') || modelName.includes('devstral')) return 32768;
  if (modelName.includes('qwen')) return 32768;
  if (modelName.includes('phi4')) return 16384;
  
  // Default for unknown models
  return 4096;
}
const now = new Date();

function parseDate(dateStr: string): Date | undefined {
  try {
    const date = new Date(dateStr);
    // Don't accept future dates
    return date > now ? undefined : date;
  } catch {
    return undefined;
  }
}

export class OllamaProvider extends BaseProvider {
  constructor(baseUrl: string = "http://localhost:11434") {
    super(undefined, baseUrl);
  }

  protected get requiresApiKey(): boolean {
    return false;
  }

  async listModels(): Promise<ModelDetails[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    const data = await response.json();

    return data.models.map(
      (model: any) =>
        ({
          provider: "ollama",
          name: model.name,
          contextLength: getContextWindow(model.name),
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
        }) as ModelDetails
    );
  }

  getLanguageModel(route: ModelRoute): LanguageModel {
    return ollama(route.name, { 
      options: { 
        num_ctx: route.numCtx 
      } 
    });
  }
}

// Factory function to create a provider instance
export function createOllamaProvider(baseUrl?: string): OllamaProvider {
  return new OllamaProvider(baseUrl);
}

export function getOllamaModelUrl(modelId: string): string {
  // Strip off version/tags to get base model name
  return `https://ollama.com/library/${modelId}`;
}
