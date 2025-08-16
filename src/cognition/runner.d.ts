import { ModelResponse, ModelRunner } from "./types.js";
import { RateLimitConfig } from "../rate-limit/rate-limit.js";
import { LanguageModel } from "ai";
import { Interaction } from "../interaction/interaction.js";
import { z } from "zod";
export interface ModelRunnerConfig {
    rateLimitConfig?: RateLimitConfig;
    maxRetries?: number;
    maxTokens?: number;
}
export declare class BaseModelRunner implements ModelRunner {
    private config;
    constructor(config?: Partial<ModelRunnerConfig>);
    private logModelDetails;
    private handleError;
    private validateAndPrepareModel;
    private calculateCostBreakdown;
    generateText(interaction: Interaction): Promise<ModelResponse>;
    streamText(interaction: Interaction): Promise<ModelResponse>;
    generateObject(interaction: Interaction, schema: z.ZodSchema): Promise<ModelResponse>;
    streamObject(interaction: Interaction, schema: z.ZodSchema): Promise<ModelResponse>;
    startUp(interaction: Interaction): Promise<{
        startTime: Date;
        model: LanguageModel;
        modelIdString: string;
    }>;
    makeResult({ response, content, usage, interaction, startTime, modelIdString, }: {
        response: any;
        content: string | unknown;
        usage: any;
        interaction: Interaction;
        startTime: Date;
        modelIdString: string;
    }): Promise<{
        content: string;
        metadata: {
            startTime: Date;
            endTime: Date;
            tokenUsage: {
                promptTokens: number;
                completionTokens: number;
                total?: number | undefined;
            };
            provider: string;
            model: string;
            cost: {
                promptCost: number;
                completionCost: number;
                totalCost: number;
                usage: {
                    promptTokens: number;
                    completionTokens: number;
                    total?: number | undefined;
                };
            };
        };
    }>;
}
