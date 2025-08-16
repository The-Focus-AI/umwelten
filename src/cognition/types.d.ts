import { z } from "zod";
import { Interaction } from '../interaction/interaction.js';
export interface ModelRoute {
    name: string;
    provider: string;
    variant?: string;
    temperature?: number;
    topP?: number;
    topK?: number;
    numCtx?: number;
}
export declare const ModelRouteSchema: any;
export interface ModelDetails extends ModelRoute {
    description?: string;
    contextLength?: number;
    costs?: {
        promptTokens: number;
        completionTokens: number;
    };
    addedDate?: Date;
    lastUpdated?: Date;
    details?: Record<string, unknown>;
    originalProvider?: string;
}
export declare const ModelDetailsSchema: any;
export interface ModelConfig extends ModelRoute {
    description?: string;
    parameters?: Record<string, unknown>;
}
export declare const ModelConfigSchema: any;
export interface ModelsConfig {
    models: ModelConfig[];
    metadata?: {
        created?: string;
        version?: string;
        notes?: string;
        requirements?: Record<string, string>;
    };
}
export declare const ModelsConfigSchema: any;
export declare const ModelCapabilitiesSchema: any;
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;
export declare const ModelOptionsSchema: any;
export type ModelOptions = z.infer<typeof ModelOptionsSchema>;
export declare const ResponseMetadataSchema: any;
export declare const ModelResponseSchema: any;
export type ModelResponse = z.infer<typeof ModelResponseSchema>;
export declare const ScoreSchema: any;
export declare const ScoreResponseSchema: any;
export type ScoreResponse = z.infer<typeof ScoreResponseSchema>;
export interface ModelRunner {
    generateText(interaction: Interaction): Promise<ModelResponse>;
    streamText(interaction: Interaction): Promise<ModelResponse>;
}
export interface ModelSearchOptions {
    query: string;
    provider?: "openrouter" | "ollama" | "google" | "all";
    sortBy?: "name" | "addedDate" | "contextLength" | "cost";
    sortOrder?: "asc" | "desc";
    onlyFree?: boolean;
}
