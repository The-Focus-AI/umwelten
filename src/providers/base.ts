import { LanguageModel } from 'ai';
import { ModelDetails } from '../cognition/types.js';
import { ModelRoute } from '../cognition/types.js';

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
  abstract getLanguageModel(route: ModelRoute): LanguageModel;

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
} 