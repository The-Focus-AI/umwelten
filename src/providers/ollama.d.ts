import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";
export declare class OllamaProvider extends BaseProvider {
    constructor(baseUrl?: string);
    protected get requiresApiKey(): boolean;
    listModels(): Promise<ModelDetails[]>;
    getLanguageModel(route: ModelRoute): LanguageModel;
}
export declare function createOllamaProvider(baseUrl?: string): OllamaProvider;
export declare function getOllamaModelUrl(modelId: string): string;
