import type { LanguageModel } from "ai";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";
import { BaseProvider } from "./base.js";
export declare class GoogleProvider extends BaseProvider {
    constructor(apiKey: string);
    listModels(): Promise<ModelDetails[]>;
    getLanguageModel(route: ModelRoute): LanguageModel;
}
export declare function createGoogleProvider(apiKey: string): GoogleProvider;
export declare function getGoogleModelUrl(modelId: string): string;
