import { LanguageModelV1 } from 'ai';
import { ModelDetails } from '../models/models.js';
import { ModelRoute } from '../models/types.js';

/**
 * Base class for all model providers.
 * Each provider must implement:
 * 1. listModels() - List all available models from this provider
 * 2. getLanguageModel() - Get a specific model instance
 */
export abstract class BaseProvider {
  protected constructor(
    protected readonly apiKey?: string,
    protected readonly baseUrl?: string
  ) {}

  /**
   * List all available models from this provider
   */
  abstract listModels(): Promise<ModelDetails[]>;

  /**
   * Get a specific model instance that implements the Vercel AI SDK interface
   * @param route The model route specification
   */
  abstract getLanguageModel(route: ModelRoute): LanguageModelV1;

  /**
   * Validate that required configuration is present
   */
  protected validateConfig() {
    if (this.requiresApiKey && !this.apiKey) {
      throw new Error(`${this.constructor.name} requires an API key`);
    }
  }

  /**
   * Whether this provider requires an API key
   */
  protected get requiresApiKey(): boolean {
    return true;
  }

  /**
   * Check if a model is valid by comparing it against the list of available models
   * @param modelId The model identifier to check
   * @returns A promise that resolves to true if the model is valid, false otherwise
   */
  async validModel?(modelId: string): Promise<boolean> {
    try {
      const models = await this.listModels();
      return models.some(model => model.modelId === modelId);
    } catch (error) {
      console.error('Error checking model validity:', error);
      return false;
    }
  }
} 