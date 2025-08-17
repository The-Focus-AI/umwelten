import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";
export declare class LMStudioProvider extends BaseProvider {
    constructor(baseUrl?: string);
    protected get requiresApiKey(): boolean;
    listModels(): Promise<ModelDetails[]>;
    getLanguageModel(route: ModelRoute): LanguageModel;
}
export declare function createLMStudioProvider(baseUrl?: string): LMStudioProvider;
