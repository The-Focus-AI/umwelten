import { z } from "zod";

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  userId?: string;
  sessionId?: string;
  toolCallId?: string;
  messages?: any[];
  abortSignal?: AbortSignal;
  metadata?: Record<string, any>;
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  result: any;
  metadata?: {
    success: boolean;
    warnings?: string[];
    errors?: string[];
  };
}

/**
 * Tool definition interface
 */
export interface ToolDefinition<T = any> {
  name: string;
  description: string;
  parameters: z.ZodSchema<T>;
  metadata?: {
    category?: string;
    tags?: string[];
    version?: string;
  };
  execute: (params: T, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
}
