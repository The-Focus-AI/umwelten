/**
 * Agent Discovery
 *
 * Manages discovery and connection to running agent MCP servers.
 * The main habitat uses this to auto-detect agents and aggregate their tools.
 *
 * Updated for MCP SDK 1.26+ compatibility.
 */

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { AgentEntry, AgentMCPStatus } from "./types.js";
import type { Habitat } from "./habitat.js";

export interface DiscoveredAgent {
  agent: AgentEntry;
  status: AgentMCPStatus;
  port?: number;
  endpoint?: string;
  tools?: string[];
  error?: string;
  client?: Client;
}

export interface AgentDiscoveryOptions {
  habitat: Habitat;
  basePort?: number;
  discoveryInterval?: number;
}

export class AgentDiscovery {
  private habitat: Habitat;
  private discoveredAgents: Map<string, DiscoveredAgent> = new Map();
  private discoveryInterval: number;
  private intervalId?: NodeJS.Timeout;

  constructor(options: AgentDiscoveryOptions) {
    this.habitat = options.habitat;
    this.discoveryInterval = options.discoveryInterval ?? 5000; // 5 seconds default
  }

  /**
   * Start periodic discovery of agents
   */
  start(): void {
    // Run initial discovery
    void this.discoverAll();

    // Set up periodic discovery
    this.intervalId = setInterval(() => {
      void this.discoverAll();
    }, this.discoveryInterval);
  }

  /**
   * Stop periodic discovery
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Disconnect all clients
    for (const discovered of this.discoveredAgents.values()) {
      if (discovered.client) {
        void discovered.client.close();
      }
    }
    this.discoveredAgents.clear();
  }

  /**
   * Discover all registered agents and their MCP status
   */
  async discoverAll(): Promise<DiscoveredAgent[]> {
    const agents = this.habitat.getAgents();
    const results: DiscoveredAgent[] = [];

    for (const agent of agents) {
      const discovered = await this.discoverAgent(agent);
      results.push(discovered);
    }

    return results;
  }

  /**
   * Check if a specific agent's MCP server is running
   */
  async discoverAgent(agent: AgentEntry): Promise<DiscoveredAgent> {
    // If no port is configured, agent is not running
    if (!agent.mcpPort) {
      const discovered: DiscoveredAgent = {
        agent,
        status: "stopped",
      };
      this.discoveredAgents.set(agent.id, discovered);
      return discovered;
    }

    const endpoint = `http://localhost:${agent.mcpPort}/mcp`;

    try {
      // Try to connect and list tools
      const transport = new StreamableHTTPClientTransport(new URL(endpoint));
      const client = new Client(
        {
          name: `habitat-discovery-${agent.id}`,
          version: "1.0.0",
        },
        {
          capabilities: {},
        },
      );

      // Connect - this will automatically handle the initialize handshake
      await client.connect(transport);

      // List available tools
      const toolsResponse = await client.listTools();
      const toolNames = toolsResponse.tools.map((t) => t.name);

      const discovered: DiscoveredAgent = {
        agent,
        status: "running",
        port: agent.mcpPort,
        endpoint,
        tools: toolNames,
        client,
      };

      this.discoveredAgents.set(agent.id, discovered);

      // Update agent status in config
      if (agent.mcpStatus !== "running") {
        await this.habitat.updateAgent(agent.id, { mcpStatus: "running" });
      }

      return discovered;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      const discovered: DiscoveredAgent = {
        agent,
        status: "error",
        port: agent.mcpPort,
        endpoint,
        error: errorMessage,
      };

      this.discoveredAgents.set(agent.id, discovered);

      // Update agent status in config
      if (agent.mcpStatus !== "error") {
        await this.habitat.updateAgent(agent.id, {
          mcpStatus: "error",
          mcpError: errorMessage,
        });
      }

      return discovered;
    }
  }

  /**
   * Get all discovered agents
   */
  getDiscoveredAgents(): DiscoveredAgent[] {
    return Array.from(this.discoveredAgents.values());
  }

  /**
   * Get a specific discovered agent by ID
   */
  getDiscoveredAgent(agentId: string): DiscoveredAgent | undefined {
    return this.discoveredAgents.get(agentId);
  }

  /**
   * Get all running agents
   */
  getRunningAgents(): DiscoveredAgent[] {
    return this.getDiscoveredAgents().filter((d) => d.status === "running");
  }

  /**
   * Call a tool on a specific agent's MCP server
   */
  async callAgentTool(
    agentId: string,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const discovered = this.discoveredAgents.get(agentId);

    if (!discovered) {
      throw new Error(`Agent ${agentId} not discovered`);
    }

    if (discovered.status !== "running") {
      throw new Error(
        `Agent ${agentId} is not running (status: ${discovered.status})`,
      );
    }

    if (!discovered.client) {
      throw new Error(`Agent ${agentId} has no connected client`);
    }

    const result = await discovered.client.callTool({
      name: toolName,
      arguments: params,
    });

    return result;
  }

  /**
   * Aggregate tools from all running agents
   * Returns a map of tool names to agent IDs
   */
  getAggregatedTools(): Map<string, string> {
    const tools = new Map<string, string>();

    for (const discovered of this.discoveredAgents.values()) {
      if (discovered.status === "running" && discovered.tools) {
        for (const toolName of discovered.tools) {
          // Prefix tool name with agent ID to avoid collisions
          const prefixedName = `${discovered.agent.id}/${toolName}`;
          tools.set(prefixedName, discovered.agent.id);
        }
      }
    }

    return tools;
  }

  /**
   * Format discovered agents for display
   */
  formatAgentList(): string {
    const agents = this.getDiscoveredAgents();

    if (agents.length === 0) {
      return "No agents registered.";
    }

    const lines: string[] = [];
    lines.push(`Agents (${agents.length}):`);
    lines.push("");

    for (const discovered of agents) {
      const { agent, status, port, tools } = discovered;
      const statusEmoji =
        status === "running" ? "🟢" : status === "stopped" ? "⚪" : "🔴";

      lines.push(`${statusEmoji} ${agent.name} (${agent.id})`);
      lines.push(`   Status: ${status}`);

      if (port) {
        lines.push(`   Port: ${port}`);
      }

      if (tools && tools.length > 0) {
        lines.push(`   Tools: ${tools.length} available`);
      }

      if (discovered.error) {
        lines.push(`   Error: ${discovered.error}`);
      }

      lines.push("");
    }

    return lines.join("\n");
  }
}

/**
 * Check if an MCP server is running on a specific port
 */
export async function isMCPServerRunning(port: number): Promise<boolean> {
  try {
    const endpoint = `http://localhost:${port}/mcp`;
    const transport = new StreamableHTTPClientTransport(new URL(endpoint));
    const client = new Client(
      {
        name: "habitat-health-check",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    await client.connect(transport);

    // Try to call the health tool
    try {
      await client.callTool({
        name: "health",
        arguments: {},
      });
    } catch {
      // Health tool might not exist, that's ok
    }

    await client.close();
    return true;
  } catch {
    return false;
  }
}
