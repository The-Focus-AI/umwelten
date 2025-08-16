import { shouldAllowRequest, updateRateLimitState, } from "../rate-limit/rate-limit.js";
import { generateText, generateObject, streamObject, streamText, } from "ai";
import { calculateCost } from "../costs/costs.js";
import { getModel, validateModel } from "../providers/index.js";
const DEFAULT_CONFIG = {
    maxRetries: 3,
    maxTokens: 4096, // Default safeguard
};
export class BaseModelRunner {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    logModelDetails(modelIdString, params) {
        console.log("Model ID:", modelIdString);
        console.log("Provider:", params.modelDetails.provider);
        console.log("Model Name:", params.modelDetails.name);
        console.log("Prompt:", params.prompt);
        console.log("Options:", params.options);
        console.log("Max Tokens:", params.options?.maxTokens);
        console.log("Costs:", JSON.stringify(params.modelDetails.costs, null, 2));
    }
    handleError(error, modelIdString, action) {
        updateRateLimitState(modelIdString, false, error, error.response?.headers, this.config.rateLimitConfig);
        if (error instanceof Error) {
            console.error(`Error during model ${action} for ${modelIdString}:`, error);
            throw new Error(`Model ${action} failed: ${error.message}`);
        }
        console.error(`Unknown error during model ${action} for ${modelIdString}:`, error);
        throw new Error(`Model ${action} failed with unknown error`);
    }
    async validateAndPrepareModel(params) {
        const modelIdString = `${params.interaction.modelDetails.provider}/${params.interaction.modelDetails.name}`;
        const validatedModel = await validateModel(params.interaction.modelDetails);
        if (!validatedModel) {
            throw new Error(`Invalid model details: ${JSON.stringify(params.interaction.modelDetails)}`);
        }
        if (params.interaction.modelDetails.numCtx) {
            validatedModel.numCtx = params.interaction.modelDetails.numCtx;
        }
        if (params.interaction.modelDetails.temperature) {
            validatedModel.temperature = params.interaction.modelDetails.temperature;
        }
        if (params.interaction.modelDetails.topP) {
            validatedModel.topP = params.interaction.modelDetails.topP;
        }
        if (params.interaction.modelDetails.topK) {
            validatedModel.topK = params.interaction.modelDetails.topK;
        }
        params.interaction.modelDetails = validatedModel;
        // this.logModelDetails(modelIdString, {
        //   prompt: params.prompt,
        //   modelDetails: params.interaction.modelDetails,
        //   options: params.interaction.options,
        // });
        const model = await getModel(params.interaction.modelDetails);
        if (!model) {
            throw new Error(`Failed to get LanguageModel for ${modelIdString}`);
        }
        if (!shouldAllowRequest(modelIdString, this.config.rateLimitConfig)) {
            throw new Error("Rate limit exceeded - backoff in progress");
        }
        return { model, modelIdString };
    }
    calculateCostBreakdown(usage, params) {
        return usage &&
            usage.promptTokens !== undefined &&
            usage.completionTokens !== undefined
            ? calculateCost(params.modelDetails, {
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                total: usage.totalTokens || usage.promptTokens + usage.completionTokens,
            })
            : null;
    }
    async generateText(interaction) {
        const { startTime, model, modelIdString } = await this.startUp(interaction);
        const mergedOptions = {
            maxTokens: this.config.maxTokens,
            ...interaction.options,
        };
        const generateOptions = {
            model: model,
            messages: interaction.getMessages(),
            temperature: interaction.modelDetails.temperature,
            topP: interaction.modelDetails.topP,
            topK: interaction.modelDetails.topK,
            ...mergedOptions,
            onError: (err) => {
                console.error(`[onError] generateText:`, err);
            },
        };
        // Enable usage accounting for OpenRouter
        if (interaction.modelDetails.provider === "openrouter") {
            generateOptions.usage = { include: true };
        }
        // Add tools if available
        if (interaction.hasTools()) {
            generateOptions.tools = interaction.getVercelTools();
            if (interaction.maxSteps) {
                generateOptions.maxSteps = interaction.maxSteps;
            }
            if (process.env.DEBUG === '1') {
                console.log("[DEBUG] Passing tools to model (generateText):", Object.keys(interaction.getVercelTools() || {}));
            }
        }
        const response = await generateText(generateOptions);
        return this.makeResult({
            response,
            content: await response.text,
            usage: response.usage,
            interaction,
            startTime,
            modelIdString,
        });
    }
    async streamText(interaction) {
        const { startTime, model, modelIdString } = await this.startUp(interaction);
        try {
            const mergedOptions = {
                maxTokens: this.config.maxTokens,
                ...interaction.options,
            };
            const streamOptions = {
                model: model,
                messages: interaction.getMessages(),
                temperature: interaction.modelDetails.temperature,
                topP: interaction.modelDetails.topP,
                topK: interaction.modelDetails.topK,
                ...mergedOptions,
                onError: (err) => {
                    console.error(`[onError] streamText:`, err);
                },
            };
            // Enable usage accounting for OpenRouter
            if (interaction.modelDetails.provider === "openrouter") {
                streamOptions.usage = { include: true };
            }
            if (interaction.hasTools()) {
                streamOptions.tools = interaction.getVercelTools();
                if (interaction.maxSteps) {
                    streamOptions.maxSteps = interaction.maxSteps;
                }
                if (process.env.DEBUG === '1') {
                    console.log("[DEBUG] Passing tools to model (streamText):", Object.keys(interaction.getVercelTools() || {}));
                }
            }
            const response = await streamText(streamOptions);
            let fullText = '';
            if (response.fullStream) {
                for await (const event of response.fullStream) {
                    switch (event.type) {
                        case 'text-delta':
                            const textDelta = event.textDelta;
                            if (textDelta !== undefined && textDelta !== null) {
                                process.stdout.write(textDelta);
                                fullText += textDelta;
                            }
                            break;
                        case 'tool-call':
                            console.log(`\n[TOOL CALL] ${event.toolName} called with:`, event.args);
                            break;
                        case 'tool-result':
                            console.log(`\n[TOOL RESULT] ${event.toolName} result:`, event.result);
                            break;
                        // Ignore other event types (reasoning, error, finish, etc.)
                        default:
                            break;
                    }
                }
            }
            else if (response.textStream) {
                for await (const textPart of response.textStream) {
                    if (textPart !== undefined && textPart !== null) {
                        process.stdout.write(textPart);
                        fullText += textPart;
                    }
                }
            }
            else {
                // fallback: await the full text if streaming is not available
                fullText = await response.text;
                if (fullText !== undefined && fullText !== null) {
                    process.stdout.write(fullText);
                }
            }
            return this.makeResult({
                response,
                content: fullText,
                usage: response.usage,
                interaction,
                startTime,
                modelIdString,
            });
        }
        catch (err) {
            this.handleError(err, modelIdString, "streamText");
        }
    }
    async generateObject(interaction, schema) {
        const { startTime, model, modelIdString } = await this.startUp(interaction);
        try {
            const mergedOptions = {
                maxTokens: this.config.maxTokens,
                ...interaction.options,
            };
            const generateOptions = {
                model: model,
                messages: interaction.getMessages(),
                schema,
                temperature: interaction.modelDetails.temperature,
                topP: interaction.modelDetails.topP,
                topK: interaction.modelDetails.topK,
                ...mergedOptions,
                onError: (err) => {
                    console.error(`[onError] generateObject:`, err);
                },
            };
            // Enable usage accounting for OpenRouter
            if (interaction.modelDetails.provider === "openrouter") {
                generateOptions.usage = { include: true };
            }
            if (interaction.hasTools()) {
                generateOptions.tools = interaction.getVercelTools();
                if (interaction.maxSteps) {
                    generateOptions.maxSteps = interaction.maxSteps;
                }
                if (process.env.DEBUG === '1') {
                    console.log("[DEBUG] Passing tools to model (generateObject):", Object.keys(interaction.getVercelTools() || {}));
                }
            }
            const response = await generateObject(generateOptions);
            return this.makeResult({
                response,
                content: response.object,
                usage: response.usage,
                interaction,
                startTime,
                modelIdString,
            });
        }
        catch (err) {
            this.handleError(err, modelIdString, "generateObject");
        }
    }
    async streamObject(interaction, schema) {
        const { startTime, model, modelIdString } = await this.startUp(interaction);
        try {
            const mergedOptions = {
                maxTokens: this.config.maxTokens,
                ...interaction.options,
            };
            const streamOptions = {
                model: model,
                messages: interaction.getMessages(),
                schema,
                temperature: interaction.modelDetails.temperature,
                topP: interaction.modelDetails.topP,
                topK: interaction.modelDetails.topK,
                ...mergedOptions,
                onError: (err) => {
                    console.error(`[onError] streamObject:`, err);
                },
            };
            // Enable usage accounting for OpenRouter
            if (interaction.modelDetails.provider === "openrouter") {
                streamOptions.usage = { include: true };
            }
            if (interaction.hasTools()) {
                streamOptions.tools = interaction.getVercelTools();
                if (interaction.maxSteps) {
                    streamOptions.maxSteps = interaction.maxSteps;
                }
                if (process.env.DEBUG === '1') {
                    console.log("[DEBUG] Passing tools to model (streamObject):", Object.keys(interaction.getVercelTools() || {}));
                }
            }
            const response = await streamObject(streamOptions);
            return this.makeResult({
                response,
                content: String(await response.object),
                usage: response.usage,
                interaction,
                startTime,
                modelIdString,
            });
        }
        catch (err) {
            this.handleError(err, modelIdString, "streamObject");
        }
    }
    async startUp(interaction) {
        const startTime = new Date();
        const { model, modelIdString } = await this.validateAndPrepareModel({
            interaction: interaction,
            prompt: interaction.prompt,
        });
        return { startTime, model, modelIdString };
    }
    async makeResult({ response, content, usage, interaction, startTime, modelIdString, }) {
        updateRateLimitState(modelIdString, true, undefined, undefined, this.config.rateLimitConfig);
        // console.log('usage', usage);
        const costBreakdown = this.calculateCostBreakdown(usage, {
            modelDetails: interaction.modelDetails,
        });
        // console.log('cost breakdown', costBreakdown);
        if (!usage ||
            usage.promptTokens === undefined ||
            usage.completionTokens === undefined) {
            console.warn(`Warning: Usage statistics (prompt/completion tokens) not available for model ${modelIdString}. Cost cannot be calculated.`);
        }
        // For generateObject, content is the actual object, not a string
        const contentString = typeof content === 'string' ? content : JSON.stringify(content);
        interaction.addMessage({
            role: "assistant",
            content: contentString,
        });
        const modelResponse = {
            content: contentString,
            metadata: {
                startTime,
                endTime: new Date(),
                tokenUsage: {
                    promptTokens: usage?.promptTokens || 0,
                    completionTokens: usage?.completionTokens || 0,
                    total: usage?.totalTokens ||
                        (usage?.promptTokens || 0) + (usage?.completionTokens || 0),
                },
                cost: costBreakdown || undefined,
                // costInfo: costBreakdown ? formatCostBreakdown(costBreakdown) : undefined,
                provider: interaction.modelDetails.provider,
                model: interaction.modelDetails.name,
            },
        };
        // console.log("Response object:", response);
        return modelResponse;
    }
}
//# sourceMappingURL=runner.js.map