import { EventEmitter } from 'events';
import { 
  JSONRPCRequest, 
  JSONRPCResponse, 
  JSONRPCNotification,
  JSONRPCMessage,
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
  MCPClientCapabilities,
  MCPImplementation,
  MCPErrorCode,
  isJSONRPCResponse,
  isJSONRPCSuccessResponse,
  isJSONRPCErrorResponse
} from '../types/protocol.js';
import { MCPTransport, TransportConfig, createTransport } from '../types/transport.js';

/**
 * MCP Client Implementation
 * 
 * This client connects to external MCP servers to consume tools, resources,
 * and prompts for use in model stimulation and evaluation.
 */

export interface MCPClientConfig {
  name: string;
  version: string;
  capabilities?: Partial<MCPClientCapabilities>;
  protocolVersion?: string;
}

export interface MCPClientEvents {
  'connected': () => void;
  'disconnected': () => void;
  'error': (error: Error) => void;
  'notification': (notification: JSONRPCNotification) => void;
}

export class MCPClient extends EventEmitter {
  private config: MCPClientConfig;
  private transport?: MCPTransport;
  private requestId: number = 0;
  private pendingRequests = new Map<number, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private initialized: boolean = false;
  private serverInfo?: MCPImplementation;
  private serverCapabilities?: any;

  constructor(config: MCPClientConfig) {
    super();
    this.config = {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: true },
        sampling: {},
      },
      ...config,
    };
  }

  /**
   * Connect to an MCP server using the specified transport
   */
  async connect(transportConfig: TransportConfig): Promise<void> {
    if (this.transport?.isConnected()) {
      throw new Error('Client already connected');
    }

    try {
      this.transport = createTransport(transportConfig);
      
      // Set up transport event handlers
      this.transport.on('message', this.handleMessage.bind(this));
      this.transport.on('connect', () => this.emit('connected'));
      this.transport.on('disconnect', () => {
        this.initialized = false;
        this.emit('disconnected');
      });
      this.transport.on('error', (error) => this.emit('error', error));

      // Start the transport
      await this.transport.start();

      // Initialize the MCP session
      await this.initialize();

    } catch (error) {
      throw new Error(`Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    // Cancel all pending requests
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Client disconnected'));
    }
    this.pendingRequests.clear();

    if (this.transport) {
      await this.transport.close();
      this.transport = undefined;
    }

    this.initialized = false;
  }

  /**
   * Check if the client is connected and initialized
   */
  isConnected(): boolean {
    return this.transport?.isConnected() && this.initialized || false;
  }

  /**
   * Get server information
   */
  getServerInfo(): { info?: MCPImplementation; capabilities?: any } {
    return {
      info: this.serverInfo,
      capabilities: this.serverCapabilities,
    };
  }

  // =============================================================================
  // MCP Protocol Methods
  // =============================================================================

  /**
   * List all available tools from the server
   */
  async listTools(): Promise<MCPListToolsResult> {
    this.ensureConnected();
    return this.sendRequest('tools/list', {});
  }

  /**
   * Call a tool on the server
   */
  async callTool(params: MCPCallToolRequestParams): Promise<MCPToolResult> {
    this.ensureConnected();
    return this.sendRequest('tools/call', params);
  }

  /**
   * List all available resources from the server
   */
  async listResources(): Promise<MCPListResourcesResult> {
    this.ensureConnected();
    return this.sendRequest('resources/list', {});
  }

  /**
   * Read a resource from the server
   */
  async readResource(params: MCPReadResourceRequestParams): Promise<MCPResourceContents> {
    this.ensureConnected();
    return this.sendRequest('resources/read', params);
  }

  /**
   * List all available prompts from the server
   */
  async listPrompts(): Promise<MCPListPromptsResult> {
    this.ensureConnected();
    return this.sendRequest('prompts/list', {});
  }

  /**
   * Get a prompt from the server
   */
  async getPrompt(params: MCPGetPromptRequestParams): Promise<MCPGetPromptResult> {
    this.ensureConnected();
    return this.sendRequest('prompts/get', params);
  }

  /**
   * Send a ping to the server
   */
  async ping(): Promise<void> {
    this.ensureConnected();
    await this.sendRequest('ping', {});
  }

  // =============================================================================
  // Convenience Methods
  // =============================================================================

  /**
   * Get all tools and return them as a simple array
   */
  async getAllTools() {
    const result = await this.listTools();
    return result.tools;
  }

  /**
   * Get all resources and return them as a simple array
   */
  async getAllResources() {
    const result = await this.listResources();
    return result.resources;
  }

  /**
   * Get all prompts and return them as a simple array
   */
  async getAllPrompts() {
    const result = await this.listPrompts();
    return result.prompts;
  }

  /**
   * Check if a specific tool is available
   */
  async hasToolAvailable(toolName: string): Promise<boolean> {
    try {
      const tools = await this.getAllTools();
      return tools.some(tool => tool.name === toolName);
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if a specific resource is available
   */
  async hasResourceAvailable(uri: string): Promise<boolean> {
    try {
      const resources = await this.getAllResources();
      return resources.some(resource => resource.uri === uri);
    } catch (error) {
      return false;
    }
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private async initialize(): Promise<void> {
    const initParams: MCPInitializeRequestParams = {
      protocolVersion: this.config.protocolVersion!,
      capabilities: this.config.capabilities as MCPClientCapabilities,
      clientInfo: {
        name: this.config.name,
        version: this.config.version,
      },
    };

    try {
      const result: MCPInitializeResult = await this.sendRequest('initialize', initParams);
      
      this.serverInfo = result.serverInfo;
      this.serverCapabilities = result.capabilities;
      this.initialized = true;

      // Send initialized notification
      await this.sendNotification('notifications/initialized', {});

    } catch (error) {
      throw new Error(`Failed to initialize MCP session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private ensureConnected(): void {
    if (!this.isConnected()) {
      throw new Error('Client not connected to MCP server');
    }
  }

  private async sendRequest<T = any>(method: string, params: any, timeoutMs: number = 30000): Promise<T> {
    if (!this.transport) {
      throw new Error('Transport not available');
    }

    const id = ++this.requestId;
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout,
      });

      this.transport!.send(request).catch((error) => {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private async sendNotification(method: string, params: any): Promise<void> {
    if (!this.transport) {
      throw new Error('Transport not available');
    }

    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    await this.transport.send(notification);
  }

  private handleMessage(message: JSONRPCMessage): void {
    try {
      if (isJSONRPCResponse(message)) {
        this.handleResponse(message);
      } else {
        // Handle notifications
        this.emit('notification', message as JSONRPCNotification);
      }
    } catch (error) {
      this.emit('error', new Error(`Failed to handle message: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private handleResponse(response: JSONRPCResponse): void {
    const id = typeof response.id === 'number' ? response.id : parseInt(String(response.id));
    const pending = this.pendingRequests.get(id);
    
    if (!pending) {
      this.emit('error', new Error(`Received response for unknown request ID: ${id}`));
      return;
    }

    this.pendingRequests.delete(id);
    clearTimeout(pending.timeout);

    if (isJSONRPCSuccessResponse(response)) {
      pending.resolve(response.result);
    } else if (isJSONRPCErrorResponse(response)) {
      const error = new Error(`MCP Error ${response.error.code}: ${response.error.message}`);
      (error as any).code = response.error.code;
      (error as any).data = response.error.data;
      pending.reject(error);
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a new MCP client with the specified configuration
 */
export function createMCPClient(config: MCPClientConfig): MCPClient {
  return new MCPClient(config);
}

/**
 * Check if an error is an MCP-specific error
 */
export function isMCPError(error: any): error is Error & { code: MCPErrorCode; data?: any } {
  return error && typeof error.code === 'number' && error.code >= -32005 && error.code <= -32000;
}

/**
 * Create a stdio transport configuration for connecting to a local MCP server
 */
export function createStdioConfig(command: string, args?: string[], env?: Record<string, string>) {
  return {
    type: 'stdio' as const,
    command,
    args,
    env,
  };
}

/**
 * Create an SSE transport configuration for connecting to a remote MCP server
 */
export function createSSEConfig(url: string, headers?: Record<string, string>) {
  return {
    type: 'sse' as const,
    url,
    headers,
  };
}

/**
 * Create a WebSocket transport configuration for connecting to a remote MCP server
 */
export function createWebSocketConfig(url: string, protocols?: string[], headers?: Record<string, string>) {
  return {
    type: 'websocket' as const,
    url,
    protocols,
    headers,
  };
}