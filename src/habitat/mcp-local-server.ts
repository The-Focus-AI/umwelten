/**
 * Habitat MCP Server
 *
 * Exposes all habitat tools as MCP tools over Streamable HTTP.
 * Uses the official @modelcontextprotocol/sdk (same pattern as bridge/server.ts)
 * but registers tools dynamically from the habitat's ToolRegistry.
 *
 * Usage:
 *   const server = await startHabitatMcpServer({ habitat, port: 8080 });
 *   // server.port, server.close()
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { Tool } from "ai";
import type { Habitat } from "./habitat.js";

export interface HabitatMcpServerOptions {
  habitat: Habitat;
  port?: number;
  host?: string;
  /** Server name exposed in MCP initialize response */
  name?: string;
}

export interface StartedHabitatMcpServer {
  port: number;
  close: () => void;
}

/**
 * Convert a Vercel AI SDK Tool into a registration call on an McpServer.
 *
 * The official MCP SDK's `server.tool()` accepts:
 *   - name (string)
 *   - description (string) — optional
 *   - inputSchema (Zod object schema or raw shape)
 *   - handler (params => { content })
 *
 * We pull description + inputSchema from the AI SDK tool, and wrap execute().
 */
function registerAiTool(
  mcpServer: McpServer,
  toolName: string,
  aiTool: Tool,
): void {
  const description = (aiTool as any).description ?? "";
  const inputSchema = (aiTool as any).inputSchema;
  const execute = (aiTool as any).execute;

  // If the tool has no execute function (e.g. client-side only tools), skip it
  if (typeof execute !== "function") {
    return;
  }

  // Build the handler that bridges MCP → AI SDK tool execute
  const handler = async (params: Record<string, unknown>) => {
    const ts = new Date().toISOString();
    const argSummary = Object.entries(params)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    console.log(`[${ts}] ⚡ ${toolName}${argSummary ? " " + argSummary : ""}`);

    try {
      const result = await execute(params, {
        toolCallId: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        messages: [],
        abortSignal: new AbortController().signal,
      });

      // AI SDK tools return arbitrary objects; serialize to text for MCP
      const text =
        typeof result === "string" ? result : JSON.stringify(result, null, 2);

      console.log(`[${new Date().toISOString()}] ✓ ${toolName} (${text.length} chars)`);

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (error: any) {
      console.log(`[${new Date().toISOString()}] ✗ ${toolName}: ${error.message ?? String(error)}`);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error.message ?? String(error)}`,
          },
        ],
        isError: true,
      };
    }
  };

  // Use registerTool() which accepts Zod schema instances directly via config object.
  // The .tool() shorthand doesn't recognize Zod instances as schemas (only raw shapes).
  (mcpServer as any).registerTool(
    toolName,
    { description, inputSchema: inputSchema ?? undefined },
    handler,
  );
}

/**
 * Start the Habitat MCP server.
 *
 * Creates an HTTP server at /mcp that speaks Streamable HTTP MCP protocol.
 * Each request gets a fresh McpServer instance (stateless pattern, same as bridge).
 */
export async function startHabitatMcpServer(
  options: HabitatMcpServerOptions,
): Promise<StartedHabitatMcpServer> {
  const { habitat, port = 8080, host = "0.0.0.0" } = options;
  const serverName = options.name ?? "habitat-mcp";

  // Collect all tools from the habitat
  const tools = habitat.getTools();
  const toolNames = Object.keys(tools);

  const httpServer = createServer();

  httpServer.on(
    "request",
    async (req: IncomingMessage, res: ServerResponse) => {
      // CORS headers for browser-based MCP clients
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", name: serverName, tools: toolNames.length }));
        return;
      }

      // Only handle /mcp
      if (req.url !== "/mcp") {
        res.writeHead(404);
        res.end("Not found. MCP endpoint is at /mcp");
        return;
      }

      // DELETE = session termination
      if (req.method === "DELETE") {
        res.writeHead(200);
        res.end("Session terminated");
        return;
      }

      if (req.method !== "POST" && req.method !== "GET") {
        res.writeHead(405);
        res.end("Method not allowed");
        return;
      }

      let transport: StreamableHTTPServerTransport | null = null;

      try {
        // Read and parse body
        const rawBody = await new Promise<string>((resolve, reject) => {
          let data = "";
          req.on("data", (chunk) => (data += chunk));
          req.on("end", () => resolve(data));
          req.on("error", reject);
        });

        let parsedBody: unknown;
        try {
          parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
          return;
        }

        // Create fresh McpServer per request (stateless)
        const mcpServer = new McpServer({
          name: serverName,
          version: "1.0.0",
        });

        // Register all habitat tools
        for (const [name, tool] of Object.entries(tools)) {
          registerAiTool(mcpServer, name, tool);
        }

        // Create transport (stateless — no session ID generator)
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, parsedBody);
      } catch (error) {
        console.error(
          `[habitat-mcp] Request error: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (!res.headersSent) {
          res.writeHead(500);
          res.end("Internal server error");
        }
      } finally {
        if (transport) {
          try {
            await transport.close();
          } catch {
            // ignore cleanup errors
          }
        }
      }
    },
  );

  return new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      const addr = httpServer.address();
      const assignedPort =
        typeof addr === "object" && addr ? addr.port : port;

      console.log(
        `[habitat-mcp] Serving ${toolNames.length} tools at http://${host}:${assignedPort}/mcp`,
      );
      console.log(
        `[habitat-mcp] Tools: ${toolNames.slice(0, 10).join(", ")}${toolNames.length > 10 ? ` ... (+${toolNames.length - 10} more)` : ""}`,
      );

      resolve({
        port: assignedPort,
        close: () => {
          httpServer.close();
        },
      });
    });
  });
}
