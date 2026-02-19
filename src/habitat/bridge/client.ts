/**
 * Habitat Bridge Client
 *
 * Host-side client that connects to the Habitat Bridge Server running in Dagger containers.
 * Uses the official MCP SDK with StreamableHTTPClientTransport.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

export interface BridgeConnectionOptions {
  host: string;
  port: number;
  timeout?: number;
  id?: string; // For logging
}

export interface BridgeToolResult {
  content: Array<{ type: string; text: string }>;
  metadata?: Record<string, unknown>;
}

export interface BridgeHealth {
  status: string;
  timestamp: string;
  uptime: number;
  workspace: string;
}

// Simple logger for client
function log(
  id: string | undefined,
  step: string,
  message: string,
  data?: unknown,
) {
  const timestamp = new Date().toISOString();
  const idStr = id ? `[${id}] ` : "";
  console.log(
    `[${timestamp}] [BridgeClient] ${idStr}[${step}] ${message}`,
    data ? JSON.stringify(data) : "",
  );
}

export class HabitatBridgeClient {
  private client: Client;
  private transport: StreamableHTTPClientTransport | null = null;
  private options: BridgeConnectionOptions;
  private id: string | undefined;

  constructor(options: BridgeConnectionOptions) {
    this.options = {
      timeout: 30000,
      ...options,
    };
    this.id = options.id;

    // Create MCP client
    this.client = new Client(
      {
        name: "habitat-bridge-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );
  }

  private getUrl(): string {
    return `http://${this.options.host}:${this.options.port}/mcp`;
  }

  async connect(): Promise<void> {
    log(this.id, "CONNECT", "Attempting connection");

    try {
      // Create transport
      this.transport = new StreamableHTTPClientTransport(
        new URL(this.getUrl()),
        {
          requestInit: {
            headers: {
              "Content-Type": "application/json",
            },
          },
        },
      );

      // Connect to server
      log(this.id, "CONNECT", "Connecting via StreamableHTTPClientTransport");
      await this.client.connect(this.transport);
      log(this.id, "CONNECT", "Connection established");
    } catch (error) {
      log(this.id, "CONNECT", "Connection failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to connect to bridge: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async disconnect(): Promise<void> {
    log(this.id, "DISCONNECT", "Closing connection");
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }

  isConnected(): boolean {
    return this.transport !== null;
  }

  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    log(this.id, "TOOLS", "Listing available tools");
    const result = await this.client.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<BridgeToolResult> {
    log(this.id, "TOOL", `Calling ${name}`, { args });

    const result = await this.client.request(
      {
        method: "tools/call",
        params: {
          name,
          arguments: args,
        },
      },
      CallToolResultSchema,
    );

    // Convert MCP result to BridgeToolResult format
    const content = result.content
      .filter((item) => item.type === "text")
      .map((item) => ({
        type: "text",
        text: (item as { text: string }).text,
      }));

    return {
      content,
      metadata: result.isError ? { isError: true } : undefined,
    };
  }

  // Convenience methods for common operations

  async readFile(filePath: string): Promise<string> {
    const result = await this.callTool("fs_read", { path: filePath });
    const textContent = result.content.find((c) => c.type === "text");
    if (!textContent) {
      throw new Error("No text content in response");
    }
    return textContent.text;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await this.callTool("fs_write", { path: filePath, content });
  }

  async listDirectory(
    dirPath?: string,
  ): Promise<Array<{ name: string; type: string }>> {
    const result = await this.callTool("fs_list", {
      path: dirPath || "/workspace",
    });
    const textContent = result.content.find((c) => c.type === "text");
    if (!textContent) {
      return [];
    }

    // Parse the output format: "[D] dirname" or "[F] filename"
    const entries: Array<{ name: string; type: string }> = [];
    const lines = textContent.text.split("\n");
    for (const line of lines) {
      const match = line.match(/^\[(D|F)\]\s+(.+)$/);
      if (match) {
        entries.push({
          name: match[2],
          type: match[1] === "D" ? "directory" : "file",
        });
      }
    }
    return entries;
  }

  async fileExists(filePath: string): Promise<boolean> {
    const result = await this.callTool("fs_exists", { path: filePath });
    const textContent = result.content.find((c) => c.type === "text");
    if (!textContent) {
      return false;
    }
    return textContent.text.includes("Path exists: true");
  }

  async stat(filePath: string): Promise<{
    size: number;
    isDirectory: boolean;
    isFile: boolean;
    modified: string;
    created: string;
  }> {
    const result = await this.callTool("fs_stat", { path: filePath });
    const textContent = result.content.find((c) => c.type === "text");
    if (!textContent) {
      throw new Error("No text content in response");
    }

    // Parse output like: "/workspace/file.txt: 123 bytes, file"
    const match = textContent.text.match(
      /^(.+):\s+(\d+)\s+bytes,\s+(file|directory)$/,
    );
    if (!match) {
      throw new Error("Unexpected stat output format");
    }

    return {
      size: parseInt(match[2], 10),
      isDirectory: match[3] === "directory",
      isFile: match[3] === "file",
      modified: "", // Not provided in current Go server output
      created: "", // Not provided in current Go server output
    };
  }

  async execute(
    command: string,
    options?: { timeout?: number; cwd?: string },
  ): Promise<{
    stdout: string;
    stderr?: string;
  }> {
    const result = await this.callTool("exec_run", {
      command,
      timeout: options?.timeout || 60000,
      cwd: options?.cwd || "/workspace",
    });

    const textContent = result.content.find((c) => c.type === "text");
    const output = textContent?.text || "";

    // The Go server returns combined output, so we treat it all as stdout
    return { stdout: output };
  }

  async health(): Promise<BridgeHealth> {
    const result = await this.callTool("bridge_health", {});
    const textContent = result.content.find((c) => c.type === "text");

    return {
      status: textContent?.text === "Bridge is healthy" ? "healthy" : "unknown",
      timestamp: new Date().toISOString(),
      uptime: 0,
      workspace: "/workspace",
    };
  }

  async getLogs(lines?: number): Promise<string[]> {
    const result = await this.callTool("bridge_logs", { lines: lines || 100 });
    const textContent = result.content.find((c) => c.type === "text");
    if (!textContent) {
      return [];
    }
    return textContent.text.split("\n").filter(Boolean);
  }
}
