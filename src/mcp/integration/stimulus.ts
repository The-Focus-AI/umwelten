import { MCPClient, createMCPClient, createStdioConfig } from '../client/client.js';
import { MCPTool, MCPResource } from '../types/protocol.js';
import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../../stimulus/tools/types.js';
import { z } from 'zod';

/**
 * MCP Integration for Stimulus/Interaction System
 * 
 * This module provides integration between MCP clients and the existing
 * Interaction/Stimulus system, allowing external MCP tools to be used
 * in model stimulation.
 */

// =============================================================================
// MCP Tool Adapter
// =============================================================================

/**
 * Convert an MCP tool to our internal ToolDefinition format
 */
export function mcpToolToToolDefinition(mcpTool: MCPTool, client: MCPClient): ToolDefinition<any> {
  // Convert MCP JSON Schema to Zod schema
  const zodSchema = jsonSchemaToZod(mcpTool.inputSchema);

  return {
    name: mcpTool.name,
    description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
    parameters: zodSchema,
    metadata: {
      category: 'mcp',
      tags: ['external', 'mcp'],
      version: '1.0.0',
    },
    execute: async (params: any, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      try {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: params,
        });

        // Convert MCP result to our format
        const textContent = result.content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');

        return {
          result: textContent || JSON.stringify(result.content),
          metadata: {
            success: !result.isError,
            warnings: result.isError ? ['MCP tool returned error'] : undefined,
          },
        };
      } catch (error) {
        return {
          result: `MCP tool error: ${error instanceof Error ? error.message : String(error)}`,
          metadata: {
            success: false,
            warnings: [error instanceof Error ? error.message : String(error)],
          },
        };
      }
    },
  };
}

/**
 * Simple JSON Schema to Zod conversion
 * This is a basic implementation - could be enhanced with a proper library
 */
function jsonSchemaToZod(schema: any): z.ZodSchema {
  if (!schema || typeof schema !== 'object') {
    return z.unknown();
  }

  switch (schema.type) {
    case 'string':
      let stringSchema = z.string();
      if (schema.enum) {
        return z.enum(schema.enum);
      }
      if (schema.minLength) stringSchema = stringSchema.min(schema.minLength);
      if (schema.maxLength) stringSchema = stringSchema.max(schema.maxLength);
      return stringSchema;

    case 'number':
    case 'integer':
      let numberSchema = z.number();
      if (schema.minimum) numberSchema = numberSchema.min(schema.minimum);
      if (schema.maximum) numberSchema = numberSchema.max(schema.maximum);
      if (schema.type === 'integer') numberSchema = numberSchema.int();
      return numberSchema;

    case 'boolean':
      return z.boolean();

    case 'array':
      const itemSchema = schema.items ? jsonSchemaToZod(schema.items) : z.unknown();
      let arraySchema = z.array(itemSchema);
      if (schema.minItems) arraySchema = arraySchema.min(schema.minItems);
      if (schema.maxItems) arraySchema = arraySchema.max(schema.maxItems);
      return arraySchema;

    case 'object':
      if (!schema.properties) {
        return z.record(z.string(), z.unknown());
      }

      const shape: Record<string, z.ZodSchema> = {};
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        shape[key] = jsonSchemaToZod(propSchema);
      }

      let objectSchema = z.object(shape);
      
      // Handle required fields
      if (schema.required && Array.isArray(schema.required)) {
        // Zod objects are required by default, so we need to make optional fields optional
        const requiredFields = new Set(schema.required);
        const newShape: Record<string, z.ZodSchema> = {};
        
        for (const [key, zodSchema] of Object.entries(shape)) {
          newShape[key] = requiredFields.has(key) ? zodSchema : zodSchema.optional();
        }
        
        objectSchema = z.object(newShape);
      }

      return objectSchema;

    default:
      return z.unknown();
  }
}

// =============================================================================
// MCP Stimulus Manager
// =============================================================================

export interface MCPStimulusConfig {
  name: string;
  version: string;
  serverCommand: string;
  serverArgs?: string[];
  serverEnv?: Record<string, string>;
  autoConnect?: boolean;
}

/**
 * Manages MCP connections and provides tools for stimulus
 */
export class MCPStimulusManager {
  private client: MCPClient;
  private config: MCPStimulusConfig;
  private connected: boolean = false;
  private availableTools: ToolDefinition<any>[] = [];
  private availableResources: MCPResource[] = [];

  constructor(config: MCPStimulusConfig) {
    this.config = config;
    this.client = createMCPClient({
      name: config.name,
      version: config.version,
    });

    // Set up event handlers
    this.client.on('connected', () => {
      this.connected = true;
      this.refreshCapabilities();
    });

    this.client.on('disconnected', () => {
      this.connected = false;
      this.availableTools = [];
      this.availableResources = [];
    });

    this.client.on('error', (error) => {
      console.error('MCP Client Error:', error);
    });
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const transportConfig = createStdioConfig(
      this.config.serverCommand,
      this.config.serverArgs,
      this.config.serverEnv
    );

    await this.client.connect(transportConfig);
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  /**
   * Check if connected to the MCP server
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get all available tools as ToolDefinitions
   */
  getAvailableTools(): ToolDefinition<any>[] {
    return this.availableTools;
  }

  /**
   * Get all available resources
   */
  getAvailableResources(): MCPResource[] {
    return this.availableResources;
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): ToolDefinition<any> | undefined {
    return this.availableTools.find(tool => tool.name === name);
  }

  /**
   * Check if a tool is available
   */
  hasToolAvailable(name: string): boolean {
    return this.availableTools.some(tool => tool.name === name);
  }

  /**
   * Read a resource from the MCP server
   */
  async readResource(uri: string): Promise<string> {
    if (!this.connected) {
      throw new Error('Not connected to MCP server');
    }

    const result = await this.client.readResource({ uri });
    
    // Combine all text content
    return result.contents
      .filter(content => content.type === 'text')
      .map(content => content.text)
      .join('\n');
  }

  /**
   * Get server information
   */
  getServerInfo() {
    return this.client.getServerInfo();
  }

  /**
   * Refresh available capabilities from the server
   */
  private async refreshCapabilities(): Promise<void> {
    try {
      // Get tools
      const mcpTools = await this.client.getAllTools();
      this.availableTools = mcpTools.map(tool => mcpToolToToolDefinition(tool, this.client));

      // Get resources
      this.availableResources = await this.client.getAllResources();

    } catch (error) {
      console.error('Failed to refresh MCP capabilities:', error);
    }
  }
}

// =============================================================================
// Integration with Interaction System
// =============================================================================

/**
 * Add MCP tools to an interaction's tool set
 */
export async function addMCPToolsToInteraction(
  interaction: any, // Would be Interaction type
  mcpManager: MCPStimulusManager
): Promise<void> {
  if (!mcpManager.isConnected()) {
    await mcpManager.connect();
  }

  const mcpTools = mcpManager.getAvailableTools();
  
  // Add each MCP tool to the interaction
  for (const tool of mcpTools) {
    // This would integrate with the existing tool system
    // interaction.addTool(tool);
  }
}

/**
 * Create a resource context from MCP resources
 */
export async function createMCPResourceContext(
  mcpManager: MCPStimulusManager,
  resourceUris: string[]
): Promise<string> {
  if (!mcpManager.isConnected()) {
    await mcpManager.connect();
  }

  const contexts: string[] = [];

  for (const uri of resourceUris) {
    try {
      const content = await mcpManager.readResource(uri);
      contexts.push(`Resource: ${uri}\n${content}\n`);
    } catch (error) {
      contexts.push(`Resource: ${uri}\nError: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  return contexts.join('\n---\n\n');
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new MCP stimulus manager
 */
export function createMCPStimulusManager(config: MCPStimulusConfig): MCPStimulusManager {
  const manager = new MCPStimulusManager(config);
  
  if (config.autoConnect) {
    manager.connect().catch(error => {
      console.error('Failed to auto-connect to MCP server:', error);
    });
  }
  
  return manager;
}

/**
 * Create a quick MCP connection for testing
 */
export async function createQuickMCPConnection(
  serverCommand: string,
  serverArgs?: string[]
): Promise<MCPStimulusManager> {
  const manager = createMCPStimulusManager({
    name: 'quick-mcp-client',
    version: '1.0.0',
    serverCommand,
    serverArgs,
    autoConnect: false,
  });

  await manager.connect();
  return manager;
}