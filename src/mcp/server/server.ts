import { EventEmitter } from 'events';
import { 
  JSONRPCRequest, 
  JSONRPCResponse, 
  JSONRPCNotification,
  JSONRPCMessage,
  JSONRPCErrorObject,
  MCPInitializeRequestParams,
  MCPInitializeResult,
  MCPListToolsResult,
  MCPCallToolRequestParams,
  MCPToolResult,
  MCPListResourcesResult,
  MCPReadResourceRequestParams,
  MCPResourceContents,
  MCPListPromptsResult,
  MCPGetPromptRequestParams,
  MCPGetPromptResult,
  MCPServerCapabilities,
  MCPImplementation,
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPErrorCode,
  isJSONRPCRequest,
  isJSONRPCNotification
} from '../types/protocol.js';
import { MCPTransport, BaseTransport } from '../types/transport.js';
import { ToolDefinition } from '../../stimulus/tools/types.js';

/**
 * MCP Server Framework
 * 
 * This framework provides a builder pattern for creating custom MCP servers
 * that expose tools, resources, and prompts to external applications.
 */

// =============================================================================
// Server Configuration and Types
// =============================================================================

export interface MCPServerConfig {
  name: string;
  version: string;
  capabilities?: Partial<MCPServerCapabilities>;
  protocolVersion?: string;
}

export interface MCPToolHandler {
  (params: Record<string, unknown>): Promise<MCPToolResult> | MCPToolResult;
}

export interface MCPResourceHandler {
  (uri: string): Promise<MCPResourceContents> | MCPResourceContents;
}

export interface MCPPromptHandler {
  (params: Record<string, unknown>): Promise<MCPGetPromptResult> | MCPGetPromptResult;
}

export interface MCPServerEvents {
  'client-connected': (clientInfo: MCPImplementation) => void;
  'client-disconnected': () => void;
  'error': (error: Error) => void;
  'tool-called': (toolName: string, params: any) => void;
  'resource-read': (uri: string) => void;
  'prompt-requested': (promptName: string, params: any) => void;
}

// =============================================================================
// MCP Server Implementation
// =============================================================================

export class MCPServer extends EventEmitter {
  private config: MCPServerConfig;
  private transport?: MCPTransport;
  private initialized: boolean = false;
  private clientInfo?: MCPImplementation;
  
  // Registry of handlers
  private tools = new Map<string, { definition: MCPTool; handler: MCPToolHandler }>();
  private resources = new Map<string, { definition: MCPResource; handler: MCPResourceHandler }>();
  private prompts = new Map<string, { definition: MCPPrompt; handler: MCPPromptHandler }>();

  constructor(config: MCPServerConfig) {
    super();
    this.config = {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: { listChanged: true },
        logging: {},
      },
      ...config,
    };
  }

  /**
   * Start the server with the specified transport
   */
  async start(transport: MCPTransport): Promise<void> {
    if (this.transport) {
      throw new Error('Server already started');
    }

    this.transport = transport;

    // Set up transport event handlers
    this.transport.on('message', this.handleMessage.bind(this));
    this.transport.on('connect', () => {
      // Client connected via transport
    });
    this.transport.on('disconnect', () => {
      this.initialized = false;
      this.clientInfo = undefined;
      this.emit('client-disconnected');
    });
    this.transport.on('error', (error) => this.emit('error', error));

    // Start the transport
    await this.transport.start();
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = undefined;
    }
    this.initialized = false;
    this.clientInfo = undefined;
  }

  /**
   * Check if the server is running and has a connected client
   */
  isRunning(): boolean {
    return this.transport?.isConnected() && this.initialized || false;
  }

  /**
   * Get connected client information
   */
  getClientInfo(): MCPImplementation | undefined {
    return this.clientInfo;
  }

  // =============================================================================
  // Tool Registration
  // =============================================================================

  /**
   * Register a tool with the server
   */
  registerTool(name: string, definition: Omit<MCPTool, 'name'>, handler: MCPToolHandler): void {
    const toolDef: MCPTool = {
      name,
      ...definition,
    };

    this.tools.set(name, {
      definition: toolDef,
      handler,
    });

    // Notify clients if server is running
    if (this.isRunning()) {
      this.sendNotification('notifications/tools/list_changed', {}).catch(console.error);
    }
  }

  /**
   * Register a tool from our existing tool definition format
   */
  registerToolFromDefinition(toolDef: ToolDefinition<any>): void {
    const mcpTool: Omit<MCPTool, 'name'> = {
      description: toolDef.description,
      inputSchema: {
        type: 'object',
        properties: toolDef.parameters._def?.shape ? 
          Object.fromEntries(
            Object.entries(toolDef.parameters._def.shape).map(([key, schema]) => [
              key, 
              this.zodSchemaToJsonSchema(schema as any)
            ])
          ) : {},
        required: toolDef.parameters._def?.shape ? 
          Object.keys(toolDef.parameters._def.shape) : [],
      },
    };

    const handler: MCPToolHandler = async (params) => {
      try {
        const validatedParams = toolDef.parameters.parse(params);
        const result = await toolDef.execute(validatedParams, {
          toolCallId: `mcp-${Date.now()}`,
          messages: [],
          abortSignal: new AbortController().signal,
        });

        return {
          content: [
            {
              type: 'text',
              text: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
            }
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            }
          ],
          isError: true,
        };
      }
    };

    this.registerTool(toolDef.name, mcpTool, handler);
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): boolean {
    const deleted = this.tools.delete(name);
    
    if (deleted && this.isRunning()) {
      this.sendNotification('notifications/tools/list_changed', {}).catch(console.error);
    }
    
    return deleted;
  }

  // =============================================================================
  // Resource Registration
  // =============================================================================

  /**
   * Register a resource with the server
   */
  registerResource(uri: string, definition: Omit<MCPResource, 'uri'>, handler: MCPResourceHandler): void {
    const resourceDef: MCPResource = {
      uri,
      ...definition,
    };

    this.resources.set(uri, {
      definition: resourceDef,
      handler,
    });

    // Notify clients if server is running
    if (this.isRunning()) {
      this.sendNotification('notifications/resources/list_changed', {}).catch(console.error);
    }
  }

  /**
   * Unregister a resource
   */
  unregisterResource(uri: string): boolean {
    const deleted = this.resources.delete(uri);
    
    if (deleted && this.isRunning()) {
      this.sendNotification('notifications/resources/list_changed', {}).catch(console.error);
    }
    
    return deleted;
  }

  // =============================================================================
  // Prompt Registration
  // =============================================================================

  /**
   * Register a prompt with the server
   */
  registerPrompt(name: string, definition: Omit<MCPPrompt, 'name'>, handler: MCPPromptHandler): void {
    const promptDef: MCPPrompt = {
      name,
      ...definition,
    };

    this.prompts.set(name, {
      definition: promptDef,
      handler,
    });

    // Notify clients if server is running
    if (this.isRunning()) {
      this.sendNotification('notifications/prompts/list_changed', {}).catch(console.error);
    }
  }

  /**
   * Unregister a prompt
   */
  unregisterPrompt(name: string): boolean {
    const deleted = this.prompts.delete(name);
    
    if (deleted && this.isRunning()) {
      this.sendNotification('notifications/prompts/list_changed', {}).catch(console.error);
    }
    
    return deleted;
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private async handleMessage(message: JSONRPCMessage): Promise<void> {
    try {
      if (isJSONRPCRequest(message)) {
        await this.handleRequest(message);
      } else if (isJSONRPCNotification(message)) {
        await this.handleNotification(message);
      }
    } catch (error) {
      this.emit('error', new Error(`Failed to handle message: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private async handleRequest(request: JSONRPCRequest): Promise<void> {
    try {
      let result: any;

      switch (request.method) {
        case 'initialize':
          result = await this.handleInitialize(request.params as MCPInitializeRequestParams);
          break;
        case 'tools/list':
          result = await this.handleListTools();
          break;
        case 'tools/call':
          result = await this.handleCallTool(request.params as MCPCallToolRequestParams);
          break;
        case 'resources/list':
          result = await this.handleListResources();
          break;
        case 'resources/read':
          result = await this.handleReadResource(request.params as MCPReadResourceRequestParams);
          break;
        case 'prompts/list':
          result = await this.handleListPrompts();
          break;
        case 'prompts/get':
          result = await this.handleGetPrompt(request.params as MCPGetPromptRequestParams);
          break;
        case 'ping':
          result = {}; // Simple ping response
          break;
        default:
          throw this.createError(MCPErrorCode.METHOD_NOT_FOUND, `Unknown method: ${request.method}`);
      }

      await this.sendResponse(request.id, result);
    } catch (error) {
      await this.sendErrorResponse(request.id, error);
    }
  }

  private async handleNotification(notification: JSONRPCNotification): Promise<void> {
    switch (notification.method) {
      case 'notifications/initialized':
        // Client has completed initialization
        break;
      default:
        // Unknown notification - ignore
        break;
    }
  }

  private async handleInitialize(params: MCPInitializeRequestParams): Promise<MCPInitializeResult> {
    this.clientInfo = params.clientInfo;
    this.initialized = true;

    this.emit('client-connected', params.clientInfo);

    return {
      protocolVersion: this.config.protocolVersion!,
      capabilities: this.config.capabilities as MCPServerCapabilities,
      serverInfo: {
        name: this.config.name,
        version: this.config.version,
      },
    };
  }

  private async handleListTools(): Promise<MCPListToolsResult> {
    const tools = Array.from(this.tools.values()).map(({ definition }) => definition);
    return { tools };
  }

  private async handleCallTool(params: MCPCallToolRequestParams): Promise<MCPToolResult> {
    const tool = this.tools.get(params.name);
    if (!tool) {
      throw this.createError(MCPErrorCode.TOOL_NOT_FOUND, `Tool not found: ${params.name}`);
    }

    this.emit('tool-called', params.name, params.arguments);

    try {
      return await tool.handler(params.arguments || {});
    } catch (error) {
      throw this.createError(
        MCPErrorCode.INTERNAL_ERROR,
        `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleListResources(): Promise<MCPListResourcesResult> {
    const resources = Array.from(this.resources.values()).map(({ definition }) => definition);
    return { resources };
  }

  private async handleReadResource(params: MCPReadResourceRequestParams): Promise<MCPResourceContents> {
    const resource = this.resources.get(params.uri);
    if (!resource) {
      throw this.createError(MCPErrorCode.RESOURCE_NOT_FOUND, `Resource not found: ${params.uri}`);
    }

    this.emit('resource-read', params.uri);

    try {
      return await resource.handler(params.uri);
    } catch (error) {
      throw this.createError(
        MCPErrorCode.INTERNAL_ERROR,
        `Resource read failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleListPrompts(): Promise<MCPListPromptsResult> {
    const prompts = Array.from(this.prompts.values()).map(({ definition }) => definition);
    return { prompts };
  }

  private async handleGetPrompt(params: MCPGetPromptRequestParams): Promise<MCPGetPromptResult> {
    const prompt = this.prompts.get(params.name);
    if (!prompt) {
      throw this.createError(MCPErrorCode.PROMPT_NOT_FOUND, `Prompt not found: ${params.name}`);
    }

    this.emit('prompt-requested', params.name, params.arguments);

    try {
      return await prompt.handler(params.arguments || {});
    } catch (error) {
      throw this.createError(
        MCPErrorCode.INTERNAL_ERROR,
        `Prompt execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async sendResponse(id: string | number, result: any): Promise<void> {
    if (!this.transport) return;

    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };

    await this.transport.send(response);
  }

  private async sendErrorResponse(id: string | number, error: any): Promise<void> {
    if (!this.transport) return;

    let errorObj: JSONRPCErrorObject;

    if (error && typeof error.code === 'number') {
      errorObj = {
        code: error.code,
        message: error.message || 'Unknown error',
        data: error.data,
      };
    } else {
      errorObj = {
        code: MCPErrorCode.INTERNAL_ERROR,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id,
      error: errorObj,
    };

    await this.transport.send(response);
  }

  private async sendNotification(method: string, params: any): Promise<void> {
    if (!this.transport) return;

    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    await this.transport.send(notification);
  }

  private createError(code: MCPErrorCode, message: string, data?: any): Error & { code: number; data?: any } {
    const error = new Error(message) as Error & { code: number; data?: any };
    error.code = code;
    error.data = data;
    return error;
  }

  private zodSchemaToJsonSchema(schema: any): any {
    // Simple Zod to JSON Schema conversion
    // This is a basic implementation - you might want to use a proper library
    const type = schema._def?.typeName;
    
    switch (type) {
      case 'ZodString':
        return { type: 'string' };
      case 'ZodNumber':
        return { type: 'number' };
      case 'ZodBoolean':
        return { type: 'boolean' };
      case 'ZodArray':
        return { type: 'array', items: this.zodSchemaToJsonSchema(schema._def.type) };
      case 'ZodObject':
        const properties: Record<string, any> = {};
        const shape = schema._def.shape();
        for (const [key, value] of Object.entries(shape)) {
          properties[key] = this.zodSchemaToJsonSchema(value);
        }
        return { type: 'object', properties };
      default:
        return { type: 'string' }; // Fallback
    }
  }
}

// =============================================================================
// Server Builder Pattern
// =============================================================================

export class MCPServerBuilder {
  private config: Partial<MCPServerConfig> = {};
  private toolsToRegister: Array<{ name: string; definition: Omit<MCPTool, 'name'>; handler: MCPToolHandler }> = [];
  private resourcesToRegister: Array<{ uri: string; definition: Omit<MCPResource, 'uri'>; handler: MCPResourceHandler }> = [];
  private promptsToRegister: Array<{ name: string; definition: Omit<MCPPrompt, 'name'>; handler: MCPPromptHandler }> = [];

  /**
   * Set the server name
   */
  withName(name: string): this {
    this.config.name = name;
    return this;
  }

  /**
   * Set the server version
   */
  withVersion(version: string): this {
    this.config.version = version;
    return this;
  }

  /**
   * Set server capabilities
   */
  withCapabilities(capabilities: Partial<MCPServerCapabilities>): this {
    this.config.capabilities = capabilities;
    return this;
  }

  /**
   * Add a tool to the server
   */
  addTool(name: string, definition: Omit<MCPTool, 'name'>, handler: MCPToolHandler): this {
    this.toolsToRegister.push({ name, definition, handler });
    return this;
  }

  /**
   * Add tools from existing tool definitions
   */
  addToolsFromDefinitions(toolDefs: ToolDefinition<any>[]): this {
    // This would be implemented to convert our existing tools
    // For now, we'll leave it as a placeholder
    return this;
  }

  /**
   * Add a resource to the server
   */
  addResource(uri: string, definition: Omit<MCPResource, 'uri'>, handler: MCPResourceHandler): this {
    this.resourcesToRegister.push({ uri, definition, handler });
    return this;
  }

  /**
   * Add a prompt to the server
   */
  addPrompt(name: string, definition: Omit<MCPPrompt, 'name'>, handler: MCPPromptHandler): this {
    this.promptsToRegister.push({ name, definition, handler });
    return this;
  }

  /**
   * Build the MCP server
   */
  build(): MCPServer {
    if (!this.config.name || !this.config.version) {
      throw new Error('Server name and version are required');
    }

    const server = new MCPServer(this.config as MCPServerConfig);

    // Register all tools
    for (const { name, definition, handler } of this.toolsToRegister) {
      server.registerTool(name, definition, handler);
    }

    // Register all resources
    for (const { uri, definition, handler } of this.resourcesToRegister) {
      server.registerResource(uri, definition, handler);
    }

    // Register all prompts
    for (const { name, definition, handler } of this.promptsToRegister) {
      server.registerPrompt(name, definition, handler);
    }

    return server;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a new MCP server builder
 */
export function createMCPServer(): MCPServerBuilder {
  return new MCPServerBuilder();
}