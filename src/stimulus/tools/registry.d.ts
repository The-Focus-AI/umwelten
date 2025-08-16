import { z } from "zod";
import { ToolDefinition, ToolRegistry, ToolExecutionContext, ToolExecutionResult } from "./types.js";
/**
 * Default implementation of the tool registry
 */
export declare class DefaultToolRegistry implements ToolRegistry {
    private tools;
    /**
     * Register a new tool
     */
    register<T extends z.ZodSchema>(tool: ToolDefinition<T>): void;
    /**
     * Unregister a tool by name
     */
    unregister(name: string): void;
    /**
     * Get a tool by name
     */
    get(name: string): ToolDefinition | undefined;
    /**
     * List all registered tools
     */
    list(): ToolDefinition[];
    /**
     * List tools by category
     */
    listByCategory(category: string): ToolDefinition[];
    /**
     * Search tools by tag
     */
    searchByTag(tag: string): ToolDefinition[];
    /**
     * Execute a tool with validation and error handling
     */
    execute(toolName: string, args: any, context: ToolExecutionContext): Promise<ToolExecutionResult>;
    /**
     * Get tool metadata for discovery
     */
    getToolMetadata(): Array<{
        name: string;
        description: string;
        parameters: z.ZodSchema;
        metadata?: ToolDefinition["metadata"];
    }>;
    /**
     * Clear all registered tools
     */
    clear(): void;
    /**
     * Get the number of registered tools
     */
    size(): number;
    /**
     * Check if a tool is registered
     */
    has(name: string): boolean;
}
/**
 * Global tool registry instance
 */
export declare const globalToolRegistry: DefaultToolRegistry;
/**
 * Helper function to register a tool globally
 */
export declare function registerTool<T extends z.ZodSchema>(tool: ToolDefinition<T>): void;
/**
 * Helper function to get a tool from the global registry
 */
export declare function getTool(name: string): ToolDefinition | undefined;
/**
 * Helper function to list all tools from the global registry
 */
export declare function listTools(): ToolDefinition[];
/**
 * Helper function to execute a tool from the global registry
 */
export declare function executeTool(toolName: string, args: any, context: ToolExecutionContext): Promise<ToolExecutionResult>;
