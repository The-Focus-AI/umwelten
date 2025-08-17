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
export declare const ModelRouteSchema: z.ZodObject<{
    name: z.ZodString;
    provider: z.ZodString;
    variant: z.ZodOptional<z.ZodString>;
    numCtx: z.ZodOptional<z.ZodNumber>;
    temperature: z.ZodOptional<z.ZodNumber>;
    topP: z.ZodOptional<z.ZodNumber>;
    topK: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
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
export declare const ModelDetailsSchema: z.ZodObject<{
    name: z.ZodString;
    provider: z.ZodString;
    variant: z.ZodOptional<z.ZodString>;
    numCtx: z.ZodOptional<z.ZodNumber>;
    temperature: z.ZodOptional<z.ZodNumber>;
    topP: z.ZodOptional<z.ZodNumber>;
    topK: z.ZodOptional<z.ZodNumber>;
    description: z.ZodOptional<z.ZodString>;
    contextLength: z.ZodOptional<z.ZodNumber>;
    costs: z.ZodOptional<z.ZodObject<{
        promptTokens: z.ZodNumber;
        completionTokens: z.ZodNumber;
    }, z.core.$strip>>;
    addedDate: z.ZodOptional<z.ZodDate>;
    lastUpdated: z.ZodOptional<z.ZodDate>;
    details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    originalProvider: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export interface ModelConfig extends ModelRoute {
    description?: string;
    parameters?: Record<string, unknown>;
}
export declare const ModelConfigSchema: z.ZodObject<{
    name: z.ZodString;
    provider: z.ZodString;
    variant: z.ZodOptional<z.ZodString>;
    numCtx: z.ZodOptional<z.ZodNumber>;
    temperature: z.ZodOptional<z.ZodNumber>;
    topP: z.ZodOptional<z.ZodNumber>;
    topK: z.ZodOptional<z.ZodNumber>;
    description: z.ZodOptional<z.ZodString>;
    parameters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export interface ModelsConfig {
    models: ModelConfig[];
    metadata?: {
        created?: string;
        version?: string;
        notes?: string;
        requirements?: Record<string, string>;
    };
}
export declare const ModelsConfigSchema: z.ZodObject<{
    models: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        provider: z.ZodString;
        variant: z.ZodOptional<z.ZodString>;
        numCtx: z.ZodOptional<z.ZodNumber>;
        temperature: z.ZodOptional<z.ZodNumber>;
        topP: z.ZodOptional<z.ZodNumber>;
        topK: z.ZodOptional<z.ZodNumber>;
        description: z.ZodOptional<z.ZodString>;
        parameters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
    metadata: z.ZodOptional<z.ZodObject<{
        created: z.ZodOptional<z.ZodString>;
        version: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
        requirements: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const ModelCapabilitiesSchema: z.ZodObject<{
    maxTokens: z.ZodNumber;
    streaming: z.ZodBoolean;
    functionCalling: z.ZodBoolean;
}, z.core.$strip>;
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;
export declare const ModelOptionsSchema: z.ZodObject<{
    temperature: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    stop: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type ModelOptions = z.infer<typeof ModelOptionsSchema>;
export declare const ResponseMetadataSchema: z.ZodObject<{
    startTime: z.ZodDate;
    endTime: z.ZodDate;
    tokenUsage: z.ZodObject<{
        promptTokens: z.ZodNumber;
        completionTokens: z.ZodNumber;
        total: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    provider: z.ZodString;
    model: z.ZodString;
    cost: z.ZodObject<{
        promptCost: z.ZodNumber;
        completionCost: z.ZodNumber;
        totalCost: z.ZodNumber;
        usage: z.ZodObject<{
            promptTokens: z.ZodNumber;
            completionTokens: z.ZodNumber;
            total: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const ModelResponseSchema: z.ZodObject<{
    content: z.ZodString;
    metadata: z.ZodObject<{
        startTime: z.ZodDate;
        endTime: z.ZodDate;
        tokenUsage: z.ZodObject<{
            promptTokens: z.ZodNumber;
            completionTokens: z.ZodNumber;
            total: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
        provider: z.ZodString;
        model: z.ZodString;
        cost: z.ZodObject<{
            promptCost: z.ZodNumber;
            completionCost: z.ZodNumber;
            totalCost: z.ZodNumber;
            usage: z.ZodObject<{
                promptTokens: z.ZodNumber;
                completionTokens: z.ZodNumber;
                total: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type ModelResponse = z.infer<typeof ModelResponseSchema>;
export declare const ScoreSchema: z.ZodObject<{
    evals: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodString;
        score: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const ScoreResponseSchema: z.ZodObject<{
    evals: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodString;
        score: z.ZodNumber;
    }, z.core.$strip>>;
    metadata: z.ZodObject<{
        startTime: z.ZodDate;
        endTime: z.ZodDate;
        tokenUsage: z.ZodObject<{
            promptTokens: z.ZodNumber;
            completionTokens: z.ZodNumber;
            total: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
        provider: z.ZodString;
        model: z.ZodString;
        cost: z.ZodObject<{
            promptCost: z.ZodNumber;
            completionCost: z.ZodNumber;
            totalCost: z.ZodNumber;
            usage: z.ZodObject<{
                promptTokens: z.ZodNumber;
                completionTokens: z.ZodNumber;
                total: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>;
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
