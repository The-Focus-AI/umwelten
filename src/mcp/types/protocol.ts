import { z } from 'zod';

/**
 * Model Context Protocol (MCP) Type Definitions
 * Based on MCP specification and JSON-RPC 2.0
 * 
 * This file defines the core protocol types for MCP communication,
 * including JSON-RPC message formats, MCP-specific message types,
 * and validation schemas.
 */

// =============================================================================
// JSON-RPC 2.0 Base Types
// =============================================================================

export const JSONRPCVersionSchema = z.literal('2.0');
export type JSONRPCVersion = z.infer<typeof JSONRPCVersionSchema>;

export const JSONRPCIdSchema = z.union([z.string(), z.number()]);
export type JSONRPCId = z.infer<typeof JSONRPCIdSchema>;

// JSON-RPC Request
export const JSONRPCRequestSchema = z.object({
  jsonrpc: JSONRPCVersionSchema,
  id: JSONRPCIdSchema,
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});
export type JSONRPCRequest = z.infer<typeof JSONRPCRequestSchema>;

// JSON-RPC Response (Success)
export const JSONRPCSuccessResponseSchema = z.object({
  jsonrpc: JSONRPCVersionSchema,
  id: JSONRPCIdSchema,
  result: z.record(z.unknown()).optional(),
});
export type JSONRPCSuccessResponse = z.infer<typeof JSONRPCSuccessResponseSchema>;

// JSON-RPC Error Object
export const JSONRPCErrorObjectSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type JSONRPCErrorObject = z.infer<typeof JSONRPCErrorObjectSchema>;

// JSON-RPC Response (Error)
export const JSONRPCErrorResponseSchema = z.object({
  jsonrpc: JSONRPCVersionSchema,
  id: JSONRPCIdSchema,
  error: JSONRPCErrorObjectSchema,
});
export type JSONRPCErrorResponse = z.infer<typeof JSONRPCErrorResponseSchema>;

// JSON-RPC Response (Union)
export const JSONRPCResponseSchema = z.union([
  JSONRPCSuccessResponseSchema,
  JSONRPCErrorResponseSchema,
]);
export type JSONRPCResponse = z.infer<typeof JSONRPCResponseSchema>;

// JSON-RPC Notification
export const JSONRPCNotificationSchema = z.object({
  jsonrpc: JSONRPCVersionSchema,
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});
export type JSONRPCNotification = z.infer<typeof JSONRPCNotificationSchema>;

// JSON-RPC Message (Union of all message types)
export const JSONRPCMessageSchema = z.union([
  JSONRPCRequestSchema,
  JSONRPCResponseSchema,
  JSONRPCNotificationSchema,
]);
export type JSONRPCMessage = z.infer<typeof JSONRPCMessageSchema>;

// =============================================================================
// MCP Protocol Types
// =============================================================================

// MCP Implementation Info
export const MCPImplementationSchema = z.object({
  name: z.string(),
  version: z.string(),
});
export type MCPImplementation = z.infer<typeof MCPImplementationSchema>;

// MCP Client Capabilities
export const MCPClientCapabilitiesSchema = z.object({
  roots: z.object({
    listChanged: z.boolean().optional(),
  }).optional(),
  sampling: z.object({}).optional(),
  experimental: z.record(z.unknown()).optional(),
});
export type MCPClientCapabilities = z.infer<typeof MCPClientCapabilitiesSchema>;

// MCP Server Capabilities
export const MCPServerCapabilitiesSchema = z.object({
  logging: z.object({}).optional(),
  prompts: z.object({
    listChanged: z.boolean().optional(),
  }).optional(),
  resources: z.object({
    subscribe: z.boolean().optional(),
    listChanged: z.boolean().optional(),
  }).optional(),
  tools: z.object({
    listChanged: z.boolean().optional(),
  }).optional(),
  experimental: z.record(z.unknown()).optional(),
});
export type MCPServerCapabilities = z.infer<typeof MCPServerCapabilitiesSchema>;

// =============================================================================
// MCP Tool Types
// =============================================================================

export const MCPToolInputSchemaSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.unknown()).optional(),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
});
export type MCPToolInputSchema = z.infer<typeof MCPToolInputSchemaSchema>;

export const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: MCPToolInputSchemaSchema,
});
export type MCPTool = z.infer<typeof MCPToolSchema>;

export const MCPToolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.unknown()).optional(),
});
export type MCPToolCall = z.infer<typeof MCPToolCallSchema>;

export const MCPToolResultSchema = z.object({
  content: z.array(z.object({
    type: z.enum(['text', 'image', 'resource']),
    text: z.string().optional(),
    data: z.string().optional(),
    mimeType: z.string().optional(),
  })),
  isError: z.boolean().optional(),
});
export type MCPToolResult = z.infer<typeof MCPToolResultSchema>;

// =============================================================================
// MCP Resource Types
// =============================================================================

export const MCPResourceSchema = z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});
export type MCPResource = z.infer<typeof MCPResourceSchema>;

export const MCPResourceContentsSchema = z.object({
  uri: z.string(),
  mimeType: z.string().optional(),
  contents: z.array(z.object({
    type: z.enum(['text', 'blob']),
    text: z.string().optional(),
    blob: z.string().optional(),
    mimeType: z.string().optional(),
  })),
});
export type MCPResourceContents = z.infer<typeof MCPResourceContentsSchema>;

// =============================================================================
// MCP Prompt Types
// =============================================================================

export const MCPPromptArgumentSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
});
export type MCPPromptArgument = z.infer<typeof MCPPromptArgumentSchema>;

export const MCPPromptSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  arguments: z.array(MCPPromptArgumentSchema).optional(),
});
export type MCPPrompt = z.infer<typeof MCPPromptSchema>;

export const MCPPromptMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.object({
    type: z.enum(['text', 'image', 'resource']),
    text: z.string().optional(),
    data: z.string().optional(),
    mimeType: z.string().optional(),
  }),
});
export type MCPPromptMessage = z.infer<typeof MCPPromptMessageSchema>;

export const MCPGetPromptResultSchema = z.object({
  description: z.string().optional(),
  messages: z.array(MCPPromptMessageSchema),
});
export type MCPGetPromptResult = z.infer<typeof MCPGetPromptResultSchema>;

// =============================================================================
// MCP Message Types
// =============================================================================

// Initialize Request/Response
export const MCPInitializeRequestParamsSchema = z.object({
  protocolVersion: z.string(),
  capabilities: MCPClientCapabilitiesSchema,
  clientInfo: MCPImplementationSchema,
});
export type MCPInitializeRequestParams = z.infer<typeof MCPInitializeRequestParamsSchema>;

export const MCPInitializeResultSchema = z.object({
  protocolVersion: z.string(),
  capabilities: MCPServerCapabilitiesSchema,
  serverInfo: MCPImplementationSchema,
});
export type MCPInitializeResult = z.infer<typeof MCPInitializeResultSchema>;

// Tools Messages
export const MCPListToolsResultSchema = z.object({
  tools: z.array(MCPToolSchema),
});
export type MCPListToolsResult = z.infer<typeof MCPListToolsResultSchema>;

export const MCPCallToolRequestParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.unknown()).optional(),
});
export type MCPCallToolRequestParams = z.infer<typeof MCPCallToolRequestParamsSchema>;

// Resources Messages
export const MCPListResourcesResultSchema = z.object({
  resources: z.array(MCPResourceSchema),
});
export type MCPListResourcesResult = z.infer<typeof MCPListResourcesResultSchema>;

export const MCPReadResourceRequestParamsSchema = z.object({
  uri: z.string(),
});
export type MCPReadResourceRequestParams = z.infer<typeof MCPReadResourceRequestParamsSchema>;

// Prompts Messages
export const MCPListPromptsResultSchema = z.object({
  prompts: z.array(MCPPromptSchema),
});
export type MCPListPromptsResult = z.infer<typeof MCPListPromptsResultSchema>;

export const MCPGetPromptRequestParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.unknown()).optional(),
});
export type MCPGetPromptRequestParams = z.infer<typeof MCPGetPromptRequestParamsSchema>;

// =============================================================================
// MCP Error Codes
// =============================================================================

export enum MCPErrorCode {
  // Standard JSON-RPC errors
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,

  // MCP-specific errors
  INVALID_PROTOCOL_VERSION = -32000,
  TOOL_NOT_FOUND = -32001,
  RESOURCE_NOT_FOUND = -32002,
  PROMPT_NOT_FOUND = -32003,
  UNAUTHORIZED = -32004,
  RATE_LIMITED = -32005,
}

// =============================================================================
// Transport Types
// =============================================================================

export type MCPTransportType = 'stdio' | 'sse' | 'websocket';

export interface MCPTransportConfig {
  type: MCPTransportType;
  options?: Record<string, unknown>;
}

export interface MCPStdioTransportConfig extends MCPTransportConfig {
  type: 'stdio';
  options?: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
}

export interface MCPSSETransportConfig extends MCPTransportConfig {
  type: 'sse';
  options?: {
    url: string;
    headers?: Record<string, string>;
  };
}

export interface MCPWebSocketTransportConfig extends MCPTransportConfig {
  type: 'websocket';
  options?: {
    url: string;
    protocols?: string[];
    headers?: Record<string, string>;
  };
}

// =============================================================================
// Utility Types
// =============================================================================

export interface MCPMessageHandler<T = unknown> {
  (message: T): Promise<void> | void;
}

export interface MCPRequestHandler<TParams = unknown, TResult = unknown> {
  (params: TParams): Promise<TResult> | TResult;
}

export interface MCPNotificationHandler<TParams = unknown> {
  (params: TParams): Promise<void> | void;
}

// Type guards for message discrimination
export function isJSONRPCRequest(message: JSONRPCMessage): message is JSONRPCRequest {
  return 'id' in message && 'method' in message;
}

export function isJSONRPCResponse(message: JSONRPCMessage): message is JSONRPCResponse {
  return 'id' in message && ('result' in message || 'error' in message);
}

export function isJSONRPCNotification(message: JSONRPCMessage): message is JSONRPCNotification {
  return !('id' in message) && 'method' in message;
}

export function isJSONRPCSuccessResponse(response: JSONRPCResponse): response is JSONRPCSuccessResponse {
  return 'result' in response;
}

export function isJSONRPCErrorResponse(response: JSONRPCResponse): response is JSONRPCErrorResponse {
  return 'error' in response;
}