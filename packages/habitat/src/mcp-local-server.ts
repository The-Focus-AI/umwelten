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
import type { Habitat } from "./habitat.js";
import { registerAiTool } from "./mcp-tool-bridge.js";

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
 * Start the Habitat MCP server.
 *
 * Creates an HTTP server at /mcp that speaks Streamable HTTP MCP protocol.
 * Each request gets a fresh McpServer instance (stateless pattern, same as bridge).
 */
export async function startHabitatMcpServer(
  options: HabitatMcpServerOptions,
): Promise<StartedHabitatMcpServer> {
  const { habitat, port = 7430, host = "0.0.0.0" } = options;
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
