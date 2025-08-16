import { z } from "zod";
import { ToolNotFoundError, ToolValidationError, ToolExecutionError, } from "./types.js";
/**
 * Default implementation of the tool registry
 */
export class DefaultToolRegistry {
    constructor() {
        this.tools = new Map();
    }
    /**
     * Register a new tool
     */
    register(tool) {
        if (this.tools.has(tool.name)) {
            console.warn(`Tool '${tool.name}' is already registered. Overwriting.`);
        }
        this.tools.set(tool.name, tool);
    }
    /**
     * Unregister a tool by name
     */
    unregister(name) {
        this.tools.delete(name);
    }
    /**
     * Get a tool by name
     */
    get(name) {
        return this.tools.get(name);
    }
    /**
     * List all registered tools
     */
    list() {
        return Array.from(this.tools.values());
    }
    /**
     * List tools by category
     */
    listByCategory(category) {
        return this.list().filter((tool) => tool.metadata?.category === category);
    }
    /**
     * Search tools by tag
     */
    searchByTag(tag) {
        return this.list().filter((tool) => tool.metadata?.tags?.includes(tag));
    }
    /**
     * Execute a tool with validation and error handling
     */
    async execute(toolName, args, context) {
        const tool = this.get(toolName);
        if (!tool) {
            throw new ToolNotFoundError(toolName);
        }
        // Validate arguments against the tool's schema
        try {
            const validatedArgs = tool.parameters.parse(args);
            // Execute the tool with timing
            const startTime = Date.now();
            const result = await tool.execute(validatedArgs, context);
            const endTime = Date.now();
            // Add execution metadata if not present
            if (!result.metadata) {
                result.metadata = {
                    success: true,
                    executionTime: endTime - startTime,
                };
            }
            else {
                result.metadata.executionTime = endTime - startTime;
                if (result.metadata.success === undefined) {
                    result.metadata.success = true;
                }
            }
            return result;
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                throw new ToolValidationError(`Invalid arguments for tool '${toolName}'`, toolName, error);
            }
            throw new ToolExecutionError(`Error executing tool '${toolName}': ${error instanceof Error ? error.message : String(error)}`, toolName, error instanceof Error ? error : undefined);
        }
    }
    /**
     * Get tool metadata for discovery
     */
    getToolMetadata() {
        return this.list().map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            metadata: tool.metadata,
        }));
    }
    /**
     * Clear all registered tools
     */
    clear() {
        this.tools.clear();
    }
    /**
     * Get the number of registered tools
     */
    size() {
        return this.tools.size;
    }
    /**
     * Check if a tool is registered
     */
    has(name) {
        return this.tools.has(name);
    }
}
/**
 * Global tool registry instance
 */
export const globalToolRegistry = new DefaultToolRegistry();
/**
 * Helper function to register a tool globally
 */
export function registerTool(tool) {
    globalToolRegistry.register(tool);
}
/**
 * Helper function to get a tool from the global registry
 */
export function getTool(name) {
    return globalToolRegistry.get(name);
}
/**
 * Helper function to list all tools from the global registry
 */
export function listTools() {
    return globalToolRegistry.list();
}
/**
 * Helper function to execute a tool from the global registry
 */
export async function executeTool(toolName, args, context) {
    return globalToolRegistry.execute(toolName, args, context);
}
//# sourceMappingURL=registry.js.map