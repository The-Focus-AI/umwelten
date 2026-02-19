#!/usr/bin/env node
/**
 * Habitat Bridge Server
 *
 * Runs inside Dagger containers, exposes MCP protocol over HTTP.
 * Uses the official @modelcontextprotocol/sdk with Streamable HTTP transport.
 * Updated for SDK 1.26+ with stateless pattern and proper tool naming.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { join } from "path";
import { createServer, IncomingMessage, ServerResponse } from "http";

const execAsync = promisify(exec);

// Parse command line arguments
const args = process.argv.slice(2);
const portArg = args.find((arg) => arg.startsWith("--port="));
const PORT = portArg ? parseInt(portArg.split("=")[1], 10) : 8080;

// Log buffer for debugging
const logBuffer: Array<{ timestamp: string; level: string; message: string }> =
  [];
const MAX_LOG_BUFFER = 1000;

function log(level: string, message: string) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.shift();
  }
  console.error(`[${entry.timestamp}] ${level}: ${message}`);
}

// Helper functions
async function resolvePath(inputPath: string): Promise<string> {
  if (!inputPath.startsWith("/")) {
    inputPath = join("/workspace", inputPath);
  }
  return inputPath;
}

function isAllowedPath(path: string): boolean {
  return path.startsWith("/workspace") || path.startsWith("/opt");
}

// Create HTTP server
const httpServer = createServer();

// Handle requests with stateless pattern
httpServer.on("request", async (req: IncomingMessage, res: ServerResponse) => {
  // Only handle requests to /mcp
  if (req.url !== "/mcp") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  // Handle DELETE for session termination
  if (req.method === "DELETE") {
    res.writeHead(200);
    res.end("Session terminated");
    return;
  }

  // Only handle POST and GET
  if (req.method !== "POST" && req.method !== "GET") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  // Create new server and transport for each request (stateless pattern)
  let mcpServer: McpServer | null = null;
  let transport: StreamableHTTPServerTransport | null = null;

  try {
    // Read the request body
    const body = await new Promise<string>((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", () => {
        resolve(data);
      });
      req.on("error", reject);
    });

    // Create new server for each request
    mcpServer = new McpServer({
      name: "habitat-bridge",
      version: "1.0.0",
    });

    // Register all tools directly
    const srv = mcpServer as any;

    // Git tools
    srv.tool(
      "git_clone",
      { repoUrl: z.string(), path: z.string().optional() },
      async (params: any) => {
        try {
          const targetPath = params.path || "/workspace";
          log("info", `Cloning ${params.repoUrl} to ${targetPath}`);
          const env = process.env.GITHUB_TOKEN
            ? {
                ...process.env,
                GIT_ASKPASS: "echo",
                GIT_USERNAME: "token",
                GIT_PASSWORD: process.env.GITHUB_TOKEN,
              }
            : process.env;
          const { stdout, stderr } = await execAsync(
            `git clone --depth 1 "${params.repoUrl}" "${targetPath}"`,
            { env, timeout: 60000 },
          );
          return {
            content: [
              {
                type: "text" as const,
                text: `Successfully cloned ${params.repoUrl}`,
              },
            ],
            metadata: { stdout, stderr },
          };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    srv.tool(
      "git_status",
      { path: z.string().optional() },
      async (params: any) => {
        try {
          const repoPath = params.path || "/workspace";
          const { stdout } = await execAsync(
            `cd "${repoPath}" && git status --porcelain`,
            { timeout: 10000 },
          );
          const files = stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => ({
              status: line.substring(0, 2).trim(),
              path: line.substring(3),
            }));
          return {
            content: [
              { type: "text" as const, text: `Git status for ${repoPath}` },
            ],
            metadata: { files },
          };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    srv.tool(
      "git_commit",
      { message: z.string(), path: z.string().optional() },
      async (params: any) => {
        try {
          const repoPath = params.path || "/workspace";
          const { stdout, stderr } = await execAsync(
            `cd "${repoPath}" && git add -A && git commit -m "${params.message.replace(/"/g, '\\"')}"`,
            { timeout: 30000 },
          );
          return {
            content: [
              {
                type: "text" as const,
                text: `Committed changes: ${params.message}`,
              },
            ],
            metadata: { stdout, stderr },
          };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    srv.tool(
      "git_push",
      { path: z.string().optional() },
      async (params: any) => {
        try {
          const repoPath = params.path || "/workspace";
          const env = process.env.GITHUB_TOKEN
            ? {
                ...process.env,
                GIT_ASKPASS: "echo",
                GIT_USERNAME: "token",
                GIT_PASSWORD: process.env.GITHUB_TOKEN,
              }
            : process.env;
          const { stdout, stderr } = await execAsync(
            `cd "${repoPath}" && git push`,
            { env, timeout: 30000 },
          );
          return {
            content: [
              { type: "text" as const, text: "Pushed changes to remote" },
            ],
            metadata: { stdout, stderr },
          };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    // File system tools
    srv.tool("fs_read", { path: z.string() }, async (params: any) => {
      try {
        const resolved = await resolvePath(params.path);
        if (!isAllowedPath(resolved))
          throw new Error("Access denied: path outside allowed directories");
        const content = await readFile(resolved, "utf-8");
        return {
          content: [{ type: "text" as const, text: content }],
          metadata: { path: resolved, size: content.length },
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });

    srv.tool(
      "fs_write",
      { path: z.string(), content: z.string() },
      async (params: any) => {
        try {
          const resolved = await resolvePath(params.path);
          if (!isAllowedPath(resolved))
            throw new Error("Access denied: path outside allowed directories");
          const dir = resolved.substring(0, resolved.lastIndexOf("/"));
          if (dir) await mkdir(dir, { recursive: true });
          await writeFile(resolved, params.content, "utf-8");
          return {
            content: [
              {
                type: "text" as const,
                text: `Successfully wrote ${params.content.length} bytes to ${resolved}`,
              },
            ],
            metadata: { path: resolved, bytes: params.content.length },
          };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    srv.tool(
      "fs_list",
      { path: z.string().optional() },
      async (params: any) => {
        try {
          const resolved = await resolvePath(params.path || "/workspace");
          if (!isAllowedPath(resolved))
            throw new Error("Access denied: path outside allowed directories");
          const entries = await readdir(resolved, { withFileTypes: true });
          const formatted = entries.map((entry) => ({
            name: entry.name,
            type: entry.isDirectory()
              ? ("directory" as const)
              : ("file" as const),
          }));
          return {
            content: [
              {
                type: "text" as const,
                text: formatted
                  .map(
                    (e) =>
                      `${e.type === "directory" ? "[D]" : "[F]"} ${e.name}`,
                  )
                  .join("\n"),
              },
            ],
            metadata: { path: resolved, entries: formatted },
          };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    srv.tool("fs_exists", { path: z.string() }, async (params: any) => {
      try {
        const resolved = await resolvePath(params.path);
        if (!isAllowedPath(resolved))
          throw new Error("Access denied: path outside allowed directories");
        try {
          await stat(resolved);
          return {
            content: [
              { type: "text" as const, text: `Path exists: ${resolved}` },
            ],
            metadata: { exists: true, path: resolved },
          };
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: `Path does not exist: ${resolved}`,
              },
            ],
            metadata: { exists: false, path: resolved },
          };
        }
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });

    srv.tool("fs_stat", { path: z.string() }, async (params: any) => {
      try {
        const resolved = await resolvePath(params.path);
        if (!isAllowedPath(resolved))
          throw new Error("Access denied: path outside allowed directories");
        const stats = await stat(resolved);
        return {
          content: [
            {
              type: "text" as const,
              text: `${resolved}: ${stats.size} bytes, ${stats.isDirectory() ? "directory" : "file"}`,
            },
          ],
          metadata: {
            path: resolved,
            size: stats.size,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            modified: stats.mtime.toISOString(),
            created: stats.birthtime.toISOString(),
          },
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });

    // Execution tools
    srv.tool(
      "exec_run",
      {
        command: z.string(),
        timeout: z.number().optional(),
        cwd: z.string().optional(),
      },
      async (params: any) => {
        try {
          const workingDir = params.cwd || "/workspace";
          const resolvedCwd = await resolvePath(workingDir);
          if (!isAllowedPath(resolvedCwd))
            throw new Error("Access denied: cwd outside allowed directories");
          log("info", `Executing: ${params.command} in ${resolvedCwd}`);
          const { stdout, stderr } = await execAsync(params.command, {
            cwd: resolvedCwd,
            timeout: params.timeout || 60000,
            env: process.env,
          });
          const content: Array<{ type: "text"; text: string }> = [
            { type: "text" as const, text: stdout || "(no stdout)" },
          ];
          if (stderr)
            content.push({ type: "text" as const, text: `STDERR:\n${stderr}` });
          return { content };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    // Bridge lifecycle tools
    srv.tool("bridge_health", {}, async () => {
      return {
        content: [{ type: "text" as const, text: "Bridge is healthy" }],
        metadata: {
          status: "healthy",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          workspace: "/workspace",
        },
      };
    });

    srv.tool(
      "bridge_logs",
      { lines: z.number().optional() },
      async (params: any) => {
        const count = params.lines || 100;
        const recentLogs = logBuffer.slice(-count);
        return {
          content: [
            {
              type: "text" as const,
              text: recentLogs
                .map((l) => `[${l.timestamp}] ${l.level}: ${l.message}`)
                .join("\n"),
            },
          ],
          metadata: { logs: recentLogs, total: logBuffer.length },
        };
      },
    );

    // Create transport in stateless mode
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    // Connect server to transport
    await mcpServer.connect(transport);

    // Handle the request
    await transport.handleRequest(req, res, body);
  } catch (error) {
    log(
      "error",
      `Request handling error: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal server error");
    }
  } finally {
    // Clean up
    if (transport) {
      try {
        await transport.close();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
});

// Start server
httpServer.listen(PORT, () => {
  log("info", `Habitat Bridge MCP Server listening on port ${PORT}`);
  log(
    "info",
    "Available tools: git_clone, git_status, git_commit, git_push, fs_read, fs_write, fs_list, fs_exists, fs_stat, exec_run, bridge_health, bridge_logs",
  );
});

// Graceful shutdown
process.on("SIGTERM", () => {
  log("info", "SIGTERM received, shutting down gracefully");
  httpServer.close(() => {
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  log("info", "SIGINT received, shutting down gracefully");
  httpServer.close(() => {
    process.exit(0);
  });
});
