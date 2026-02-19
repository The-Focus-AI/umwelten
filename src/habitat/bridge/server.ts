#!/usr/bin/env node
/**
 * Habitat Bridge Server
 *
 * Runs inside Dagger containers, exposes MCP protocol over HTTP.
 * Uses the official @modelcontextprotocol/sdk with Streamable HTTP transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { join } from "path";
import { createServer } from "http";

const execAsync = promisify(exec);

// Parse command line arguments
const args = process.argv.slice(2);
const portArg = args.find((arg) => arg.startsWith("--port="));
const PORT = portArg ? parseInt(portArg.split("=")[1], 10) : 8080;

// Log buffer for debugging
const logBuffer: Array<{ timestamp: string; level: string; message: string }> =
  [];
const MAX_LOG_BUFFER = 1000;

// Helper type for text content
type TextContent = { type: "text"; text: string };

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
  // Handle relative paths
  if (!inputPath.startsWith("/")) {
    inputPath = join("/workspace", inputPath);
  }
  return inputPath;
}

function isAllowedPath(path: string): boolean {
  // Only allow paths within /workspace or /opt
  return path.startsWith("/workspace") || path.startsWith("/opt");
}

// Create MCP Server
const server = new McpServer({
  name: "habitat-bridge",
  version: "1.0.0",
});

// Git tools
server.tool(
  "git/clone",
  {
    repoUrl: z.string().describe("Git repository URL to clone"),
    path: z
      .string()
      .optional()
      .describe("Target directory (defaults to /workspace)"),
  },
  async ({ repoUrl, path }) => {
    const targetPath = path || "/workspace";

    log("info", `Cloning ${repoUrl} to ${targetPath}`);

    // Use GITHUB_TOKEN if available for private repos
    const env = process.env.GITHUB_TOKEN
      ? {
          ...process.env,
          GIT_ASKPASS: "echo",
          GIT_USERNAME: "token",
          GIT_PASSWORD: process.env.GITHUB_TOKEN,
        }
      : process.env;

    const { stdout, stderr } = await execAsync(
      `git clone --depth 1 "${repoUrl}" "${targetPath}"`,
      { env, timeout: 60000 },
    );

    log("info", `Clone completed: ${stdout || "OK"}`);

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully cloned ${repoUrl} to ${targetPath}`,
        },
      ],
      metadata: { stdout, stderr },
    };
  },
);

server.tool(
  "git/status",
  {
    path: z
      .string()
      .optional()
      .describe("Repository path (defaults to /workspace)"),
  },
  async ({ path }) => {
    const repoPath = path || "/workspace";

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
      content: [{ type: "text" as const, text: `Git status for ${repoPath}` }],
      metadata: { files },
    };
  },
);

server.tool(
  "git/commit",
  {
    message: z.string().describe("Commit message"),
    path: z
      .string()
      .optional()
      .describe("Repository path (defaults to /workspace)"),
  },
  async ({ message, path }) => {
    const repoPath = path || "/workspace";

    const { stdout, stderr } = await execAsync(
      `cd "${repoPath}" && git add -A && git commit -m "${message.replace(/"/g, '\\"')}"`,
      { timeout: 30000 },
    );

    return {
      content: [
        { type: "text" as const, text: `Committed changes: ${message}` },
      ],
      metadata: { stdout, stderr },
    };
  },
);

server.tool(
  "git/push",
  {
    path: z
      .string()
      .optional()
      .describe("Repository path (defaults to /workspace)"),
  },
  async ({ path }) => {
    const repoPath = path || "/workspace";

    const env = process.env.GITHUB_TOKEN
      ? {
          ...process.env,
          GIT_ASKPASS: "echo",
          GIT_USERNAME: "token",
          GIT_PASSWORD: process.env.GITHUB_TOKEN,
        }
      : process.env;

    const { stdout, stderr } = await execAsync(`cd "${repoPath}" && git push`, {
      env,
      timeout: 30000,
    });

    return {
      content: [{ type: "text" as const, text: "Pushed changes to remote" }],
      metadata: { stdout, stderr },
    };
  },
);

// File system tools
server.tool(
  "fs/read",
  {
    path: z.string().describe("File path to read"),
  },
  async ({ path: inputPath }) => {
    const resolved = await resolvePath(inputPath);

    if (!isAllowedPath(resolved)) {
      throw new Error("Access denied: path outside allowed directories");
    }

    const content = await readFile(resolved, "utf-8");

    return {
      content: [{ type: "text" as const, text: content }],
      metadata: { path: resolved, size: content.length },
    };
  },
);

server.tool(
  "fs/write",
  {
    path: z.string().describe("File path to write"),
    content: z.string().describe("Content to write"),
  },
  async ({ path: inputPath, content }) => {
    const resolved = await resolvePath(inputPath);

    if (!isAllowedPath(resolved)) {
      throw new Error("Access denied: path outside allowed directories");
    }

    // Ensure directory exists
    const dir = resolved.substring(0, resolved.lastIndexOf("/"));
    if (dir) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(resolved, content, "utf-8");

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully wrote ${content.length} bytes to ${resolved}`,
        },
      ],
      metadata: { path: resolved, bytes: content.length },
    };
  },
);

server.tool(
  "fs/list",
  {
    path: z
      .string()
      .optional()
      .describe("Directory path (defaults to /workspace)"),
  },
  async ({ path: inputPath }) => {
    const resolved = await resolvePath(inputPath || "/workspace");

    if (!isAllowedPath(resolved)) {
      throw new Error("Access denied: path outside allowed directories");
    }

    const entries = await readdir(resolved, { withFileTypes: true });

    const formatted: Array<{ name: string; type: "directory" | "file" }> =
      entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
      }));

    return {
      content: [
        {
          type: "text" as const,
          text: formatted
            .map((e) => `${e.type === "directory" ? "[D]" : "[F]"} ${e.name}`)
            .join("\n"),
        },
      ],
      metadata: { path: resolved, entries: formatted },
    };
  },
);

server.tool(
  "fs/exists",
  {
    path: z.string().describe("Path to check"),
  },
  async ({ path: inputPath }) => {
    const resolved = await resolvePath(inputPath);

    if (!isAllowedPath(resolved)) {
      throw new Error("Access denied: path outside allowed directories");
    }

    try {
      await stat(resolved);
      return {
        content: [{ type: "text" as const, text: `Path exists: ${resolved}` }],
        metadata: { exists: true, path: resolved },
      };
    } catch {
      return {
        content: [
          { type: "text" as const, text: `Path does not exist: ${resolved}` },
        ],
        metadata: { exists: false, path: resolved },
      };
    }
  },
);

server.tool(
  "fs/stat",
  {
    path: z.string().describe("Path to stat"),
  },
  async ({ path: inputPath }) => {
    const resolved = await resolvePath(inputPath);

    if (!isAllowedPath(resolved)) {
      throw new Error("Access denied: path outside allowed directories");
    }

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
  },
);

// Execution tools
server.tool(
  "exec/run",
  {
    command: z.string().describe("Command to execute"),
    timeout: z
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 60000)"),
    cwd: z
      .string()
      .optional()
      .describe("Working directory (default: /workspace)"),
  },
  async ({ command, timeout, cwd }) => {
    const workingDir = cwd || "/workspace";
    const resolvedCwd = await resolvePath(workingDir);

    if (!isAllowedPath(resolvedCwd)) {
      throw new Error("Access denied: cwd outside allowed directories");
    }

    log("info", `Executing: ${command} in ${resolvedCwd}`);

    const { stdout, stderr } = await execAsync(command, {
      cwd: resolvedCwd,
      timeout: timeout || 60000,
      env: process.env,
    });

    const content: Array<{ type: "text"; text: string }> = [
      { type: "text" as const, text: stdout || "(no stdout)" },
    ];
    if (stderr) {
      content.push({ type: "text" as const, text: `STDERR:\n${stderr}` });
    }

    return {
      content,
    };
  },
);

// Bridge lifecycle tools
server.tool("bridge/health", {}, async () => {
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

server.tool(
  "bridge/logs",
  {
    lines: z
      .number()
      .optional()
      .describe("Number of log lines to return (default: 100)"),
  },
  async ({ lines }) => {
    const count = lines || 100;
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

// Create HTTP server
const httpServer = createServer();

// Create Streamable HTTP transport
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // Stateless mode
});

// Handle requests
httpServer.on("request", async (req, res) => {
  // Only handle POST requests to /mcp
  if (req.method !== "POST" || req.url !== "/mcp") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  try {
    await transport.handleRequest(req, res, { server });
  } catch (error) {
    log(
      "error",
      `Request handling error: ${error instanceof Error ? error.message : String(error)}`,
    );
    res.writeHead(500);
    res.end("Internal server error");
  }
});

// Start server
httpServer.listen(PORT, () => {
  log("info", `Habitat Bridge Server listening on port ${PORT}`);
  log(
    "info",
    "Available tools: git/clone, git/status, git/commit, git/push, fs/read, fs/write, fs/list, fs/exists, fs/stat, exec/run, bridge/health, bridge/logs",
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
