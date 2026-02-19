/**
 * Habitat Bridge Client
 *
 * Host-side client that connects to the Habitat Bridge Server running in Dagger containers.
 * Uses simple HTTP JSON-RPC instead of MCP SDK (which expects SSE streaming).
 */

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
  private connected = false;
  private options: BridgeConnectionOptions;
  private requestId = 0;
  private id: string | undefined;

  constructor(options: BridgeConnectionOptions) {
    this.options = {
      timeout: 30000,
      ...options,
    };
    this.id = options.id;
  }

  private getUrl(): string {
    return `http://${this.options.host}:${this.options.port}/mcp`;
  }

  private async rpcCall(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const reqId = ++this.requestId;
    log(this.id, "RPC", `Calling ${method}`, { reqId, params });

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.options.timeout,
    );

    try {
      log(this.id, "RPC", `Sending request to ${this.getUrl()}`, {
        reqId,
        method,
      });
      const response = await fetch(this.getUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: reqId,
          method,
          params,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      log(this.id, "RPC", `Received response`, {
        reqId,
        status: response.status,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as {
        jsonrpc: string;
        id: number;
        result?: unknown;
        error?: { code: number; message: string };
      };

      if (data.error) {
        log(this.id, "RPC", `RPC error`, { reqId, error: data.error.message });
        throw new Error(data.error.message);
      }

      log(this.id, "RPC", `Success`, { reqId, hasResult: !!data.result });
      return data.result;
    } catch (error) {
      log(this.id, "RPC", `Failed`, {
        reqId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `RPC call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async connect(): Promise<void> {
    log(this.id, "CONNECT", "Attempting connection");
    if (this.connected) {
      log(this.id, "CONNECT", "Already connected");
      return;
    }

    try {
      // Test connection with health check
      log(this.id, "CONNECT", "Testing with health check");
      await this.health();
      this.connected = true;
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
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<BridgeToolResult> {
    const result = (await this.rpcCall(name, args)) as BridgeToolResult;
    return result;
  }

  // Convenience methods for common operations

  async readFile(filePath: string): Promise<string> {
    const result = await this.callTool("fs/read", { path: filePath });
    const textContent = result.content.find((c) => c.type === "text");
    if (!textContent) {
      throw new Error("No text content in response");
    }
    return textContent.text;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await this.callTool("fs/write", { path: filePath, content });
  }

  async listDirectory(
    dirPath?: string,
  ): Promise<Array<{ name: string; type: string }>> {
    const result = await this.callTool("fs/list", {
      path: dirPath || "/workspace",
    });
    return (
      (result.metadata?.entries as Array<{ name: string; type: string }>) || []
    );
  }

  async fileExists(filePath: string): Promise<boolean> {
    const result = await this.callTool("fs/exists", { path: filePath });
    return (result.metadata?.exists as boolean) || false;
  }

  async stat(filePath: string): Promise<{
    size: number;
    isDirectory: boolean;
    isFile: boolean;
    modified: string;
    created: string;
  }> {
    const result = await this.callTool("fs/stat", { path: filePath });
    return {
      size: result.metadata?.size as number,
      isDirectory: result.metadata?.isDirectory as boolean,
      isFile: result.metadata?.isFile as boolean,
      modified: result.metadata?.modified as string,
      created: result.metadata?.created as string,
    };
  }

  async execute(
    command: string,
    options?: { timeout?: number; cwd?: string },
  ): Promise<{
    stdout: string;
    stderr?: string;
  }> {
    const result = await this.callTool("exec/run", {
      command,
      timeout: options?.timeout || 60000,
      cwd: options?.cwd || "/workspace",
    });

    const stdout =
      result.content.find(
        (c) => c.type === "text" && !c.text.startsWith("STDERR:"),
      )?.text || "";
    const stderrContent = result.content.find(
      (c) => c.type === "text" && c.text.startsWith("STDERR:"),
    );
    const stderr = stderrContent
      ? stderrContent.text.replace("STDERR:\n", "")
      : undefined;

    return { stdout, stderr };
  }

  async health(): Promise<BridgeHealth> {
    const result = await this.callTool("bridge/health", {});
    return {
      status: result.metadata?.status as string,
      timestamp: result.metadata?.timestamp as string,
      uptime: result.metadata?.uptime as number,
      workspace: result.metadata?.workspace as string,
    };
  }

  async getLogs(lines?: number): Promise<string[]> {
    const result = await this.callTool("bridge/logs", { lines: lines || 100 });
    const textContent = result.content.find((c) => c.type === "text");
    if (!textContent) {
      return [];
    }
    return textContent.text.split("\n").filter(Boolean);
  }
}
