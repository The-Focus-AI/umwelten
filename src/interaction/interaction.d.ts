import { CoreMessage } from "ai";
import { ModelDetails, ModelOptions } from "../cognition/types.js";
import { ToolSet } from "../stimulus/tools/index.js";
import { z } from "zod";
export declare class Interaction {
    private messages;
    userId: string;
    modelDetails: ModelDetails;
    prompt: string;
    options?: ModelOptions;
    outputFormat?: z.ZodSchema;
    tools?: ToolSet;
    maxSteps?: number;
    constructor(modelDetails: ModelDetails, prompt: string, options?: ModelOptions);
    addMessage(message: CoreMessage): void;
    addAttachmentFromPath(attachment: string, mime_type?: string): Promise<void>;
    setOutputFormat(outputFormat: z.ZodSchema): void;
    /**
     * Set tools for this interaction
     */
    setTools(tools: ToolSet): void;
    /**
     * Set maximum number of steps for multi-step tool calling
     */
    setMaxSteps(maxSteps: number): void;
    /**
     * Get tools in Vercel AI SDK format
     */
    getVercelTools(): Record<string, any> | undefined;
    /**
     * Check if this interaction has tools
     */
    hasTools(): boolean;
    getMessages(): CoreMessage[];
    clearContext(): void;
}
