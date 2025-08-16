/**
 * Tool execution error types
 */
export class ToolExecutionError extends Error {
    constructor(message, toolName, cause) {
        super(message);
        this.toolName = toolName;
        this.cause = cause;
        this.name = "ToolExecutionError";
    }
}
export class ToolValidationError extends Error {
    constructor(message, toolName, validationErrors) {
        super(message);
        this.toolName = toolName;
        this.validationErrors = validationErrors;
        this.name = "ToolValidationError";
    }
}
export class ToolNotFoundError extends Error {
    constructor(toolName) {
        super(`Tool '${toolName}' not found`);
        this.toolName = toolName;
        this.name = "ToolNotFoundError";
    }
}
/**
 * Convert our tool definition to Vercel AI SDK format
 */
export function toVercelTool(toolDef) {
    // TODO: Fix tool interface for AI SDK v5
    // For now, return a basic tool structure
    return {
        description: toolDef.description,
        parameters: toolDef.parameters,
        execute: async (args, options) => {
            const context = {
                toolCallId: options?.toolCallId || "",
                messages: options?.messages || [],
                abortSignal: options?.abortSignal,
            };
            const result = await toolDef.execute(args, context);
            return result.result;
        },
    };
}
/**
 * Convert a tool set to Vercel AI SDK format
 */
export function toVercelToolSet(toolSet) {
    const vercelTools = {};
    for (const [name, tool] of Object.entries(toolSet)) {
        vercelTools[name] = toVercelTool(tool);
    }
    return vercelTools;
}
//# sourceMappingURL=types.js.map