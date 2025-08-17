import type { LanguageModel } from 'ai';
import { BaseProvider } from './base.js';
import type { ModelDetails, ModelRoute } from '../cognition/types.js';
export declare function createOpenRouterModel(modelName: string): LanguageModel;
export declare class OpenRouterProvider extends BaseProvider {
    constructor(apiKey: string);
    listModels(): Promise<ModelDetails[]>;
    getLanguageModel(route: ModelRoute): LanguageModel;
}
export declare function createOpenRouterProvider(apiKey: string): OpenRouterProvider;
export declare function getOpenRouterModelUrl(modelId: string): string;
