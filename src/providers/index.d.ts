import type { ModelDetails } from "../cognition/types.js";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
export declare function getModelUrl(model: ModelDetails): string | undefined;
export declare function getModel(modelDetails: ModelDetails): Promise<LanguageModel | undefined>;
/**
 * Gets the ModelDetails for a given LanguageModelV1 instance by looking up the model
 * from its provider
 */
export declare function getModelDetails(model: LanguageModel): Promise<ModelDetails | undefined>;
export declare function getModelProvider(modelDetails: ModelDetails): Promise<BaseProvider | undefined>;
export declare function validateModel(modelDetails: ModelDetails): Promise<ModelDetails | undefined>;
