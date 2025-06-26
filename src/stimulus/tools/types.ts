import { z } from "zod";
import { tool as vercelTool } from "ai";

/**
 * Tool execution context providing additional information about the execution environment
 */
export interface ToolExecutionContext {
  /** Unique identifier for this tool call */
  toolCallId: string;
  /** Messages that led to this tool call */
  messages: any[];
  /** Abort signal for cancelling long-running operations */
  abortSignal?: AbortSignal;
  /** Additional metadata about the execution */
  metadata?: Record<string, any>;
}

/**
 * Result of a tool execution
 */
export interface ToolExecutionResult {
  /** The result data from the tool execution */
  result: any;
  /** Optional metadata about the execution */
  metadata?: {
    /** Time taken to execute the tool in milliseconds */
    executionTime?: number;
    /** Any warnings or informational messages */
    warnings?: string[];
    /** Success status */
    success: boolean;
  };
}

/**
 * Tool definition compatible with both Vercel AI SDK and MCP
 */
export interface ToolDefinition<TParameters extends z.ZodSchema = z.ZodSchema> {
  /** Unique identifier for the tool */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** Zod schema defining the tool's input parameters */
  parameters: TParameters;
  /** Function that executes the tool */
  execute: (
    args: z.infer<TParameters>,
    context: ToolExecutionContext
  ) => Promise<ToolExecutionResult>;
  /** Optional metadata about the tool */
  metadata?: {
    /** Category for organizing tools */
    category?: string;
    /** Tags for tool discovery */
    tags?: string[];
    /** Version of the tool */
    version?: string;
    /** Whether the tool is experimental */
    experimental?: boolean;
  };
}

/**
 * Tool registry for managing available tools
 */
export interface ToolRegistry {
  /** Register a new tool */
  register<T extends z.ZodSchema>(tool: ToolDefinition<T>): void;
  /** Unregister a tool by name */
  unregister(name: string): void;
  /** Get a tool by name */
  get(name: string): ToolDefinition | undefined;
  /** List all registered tools */
  list(): ToolDefinition[];
  /** List tools by category */
  listByCategory(category: string): ToolDefinition[];
  /** Search tools by tag */
  searchByTag(tag: string): ToolDefinition[];
}

/**
 * Tool execution error types
 */
export class ToolExecutionError extends Error {
  constructor(
    message: string,
    public toolName: string,
    public cause?: Error
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

export class ToolValidationError extends Error {
  constructor(
    message: string,
    public toolName: string,
    public validationErrors: z.ZodError
  ) {
    super(message);
    this.name = "ToolValidationError";
  }
}

export class ToolNotFoundError extends Error {
  constructor(public toolName: string) {
    super(`Tool '${toolName}' not found`);
    this.name = "ToolNotFoundError";
  }
}

/**
 * Type helper for extracting tool call union types
 */
export type ToolCall<T extends ToolDefinition> = {
  type: "tool-call";
  toolCallId: string;
  toolName: T["name"];
  args: z.infer<T["parameters"]>;
};

/**
 * Type helper for extracting tool result union types
 */
export type ToolResult<T extends ToolDefinition> = {
  type: "tool-result";
  toolCallId: string;
  toolName: T["name"];
  result: Awaited<ReturnType<T["execute"]>>;
};

/**
 * Convert our tool definition to Vercel AI SDK format
 */
export function toVercelTool<T extends z.ZodSchema>(
  toolDef: ToolDefinition<T>
) {
  return vercelTool({
    description: toolDef.description,
    parameters: toolDef.parameters,
    execute: async (args: z.infer<T>, options?: any) => {
      const context: ToolExecutionContext = {
        toolCallId: options?.toolCallId || "",
        messages: options?.messages || [],
        abortSignal: options?.abortSignal,
      };
      
      const result = await toolDef.execute(args, context);
      return result.result;
    },
  });
}

/**
 * Tool set type for organizing multiple tools
 */
export type ToolSet = Record<string, ToolDefinition>;

/**
 * Convert a tool set to Vercel AI SDK format
 */
export function toVercelToolSet(toolSet: ToolSet) {
  const vercelTools: Record<string, any> = {};
  
  for (const [name, tool] of Object.entries(toolSet)) {
    vercelTools[name] = toVercelTool(tool);
  }
  
  return vercelTools;
}