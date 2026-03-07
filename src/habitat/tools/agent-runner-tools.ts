/**
 * Agent runner tools: agent_clone, agent_logs, agent_status, agent_ask.
 * These tools let the main habitat agent manage sub-agents (HabitatAgents).
 */

import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import type { AgentEntry, LogPattern } from "../types.js";
import { HabitatBridgeClient } from "../bridge/client.js";

const execFileAsync = promisify(execFile);

/** Interface for the habitat context that agent runner tools need. */
export interface AgentRunnerToolsContext {
  getWorkDir(): string;
  getAgent(idOrName: string): AgentEntry | undefined;
  getAgents(): AgentEntry[];
  addAgent(agent: AgentEntry): Promise<void>;
  updateAgent(idOrName: string, updates: Partial<AgentEntry>): Promise<void>;
  getOrCreateHabitatAgent(
    agentId: string,
  ): Promise<{ ask(message: string): Promise<string> }>;
  // Bridge agent management (via supervisor)
  startBridge(
    agentId: string,
    options?: { logFilePath?: string },
  ): Promise<import("../bridge/agent.js").BridgeAgent>;
  getBridgeAgent(
    agentId: string,
  ): import("../bridge/agent.js").BridgeAgent | undefined;
  getAllBridgeAgents(): import("../bridge/agent.js").BridgeAgent[];
  destroyBridgeAgent(agentId: string): Promise<void>;
  listBridgeAgents(): string[];
  // Bridge state persistence
  getAgentDir(agentId: string): string;
  ensureAgentDir(agentId: string): Promise<void>;
  saveBridgeState(
    agentId: string,
    state: import("../bridge/state.js").BridgeState,
  ): Promise<void>;
  loadBridgeState(
    agentId: string,
  ): Promise<import("../bridge/state.js").BridgeState | null>;
  loadAllBridgeStates(): Promise<import("../bridge/state.js").BridgeState[]>;
}

export function createAgentRunnerTools(
  ctx: AgentRunnerToolsContext,
): Record<string, Tool> {
  // Track clients connected to externally-started bridges (not in-memory BridgeAgent)
  const externalClients = new Map<string, HabitatBridgeClient>();

  /**
   * Get a bridge client for an agent, checking both:
   * 1. In-memory BridgeAgent (started in this process)
   * 2. External bridge (started from a separate CLI process, detected via mcpPort in config)
   */
  async function getBridgeClient(
    agentId: string,
  ): Promise<{ client: HabitatBridgeClient; port: number } | null> {
    // First check in-memory bridge
    const bridgeAgent = ctx.getBridgeAgent(agentId);
    if (bridgeAgent) {
      const client = await bridgeAgent.getClient();
      return { client, port: bridgeAgent.getPort() };
    }

    // Check if we already have a connected external client
    const existing = externalClients.get(agentId);
    if (existing && existing.isConnected()) {
      const agent = ctx.getAgent(agentId);
      return { client: existing, port: agent?.mcpPort || 0 };
    }

    // Try connecting to externally-started bridge via config port
    const agent = ctx.getAgent(agentId);
    if (agent?.mcpPort) {
      try {
        const client = new HabitatBridgeClient({
          host: "localhost",
          port: agent.mcpPort,
          timeout: 5000,
          id: agentId,
        });
        await client.connect();
        // Verify it's actually alive with a health check
        await client.health();
        externalClients.set(agentId, client);
        return { client, port: agent.mcpPort };
      } catch {
        // Port configured but not reachable — bridge is down
        // Clean up stale external client
        externalClients.delete(agentId);
        return null;
      }
    }

    return null;
  }

  // ── agent_clone ────────────────────────────────────────────────────

  const agentCloneTool = tool({
    description:
      "Clone a git repository into the habitat workspace and register it as a managed agent. Use bridge_start later only if the project needs an isolated runtime.",
    inputSchema: z.object({
      gitUrl: z
        .string()
        .describe(
          "Git URL to clone (e.g. git@github.com:org/repo.git or https://...)",
        ),
      name: z.string().describe("Display name for the agent"),
      id: z
        .string()
        .optional()
        .describe("Unique agent ID (defaults to name, lowercased, hyphened)"),
    }),
    execute: async ({ gitUrl, name, id }) => {
      const agentId =
        id ??
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

      // Check if agent already exists
      const existing = ctx.getAgent(agentId);
      if (existing) {
        return {
          error: "AGENT_EXISTS",
          message: `Agent "${agentId}" already exists`,
        };
      }

      await ctx.ensureAgentDir(agentId);
      const projectPath = join(ctx.getAgentDir(agentId), "repo");

      try {
        await execFileAsync("git", ["clone", gitUrl, projectPath], {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 5 * 60 * 1000,
        });
      } catch (cloneErr: any) {
        await rm(projectPath, { recursive: true, force: true }).catch(() => {});
        return {
          error: "AGENT_CLONE_FAILED",
          message: cloneErr.message || String(cloneErr),
          agent: { id: agentId, name, gitRemote: gitUrl, projectPath },
        };
      }

      // Register agent metadata with the host-side project path
      const agent: AgentEntry = {
        id: agentId,
        name,
        projectPath,
        gitRemote: gitUrl,
      };

      await ctx.addAgent(agent);

      return {
        registered: true,
        cloned: true,
        agent: { id: agentId, name, gitRemote: gitUrl, projectPath },
        message: `Agent "${name}" (${agentId}) cloned to ${projectPath} and registered. Use agent_ask to inspect it, or bridge_start if you need an isolated runtime.`,
      };
    },
  });

  // ── agent_logs ─────────────────────────────────────────────────────

  const agentLogsTool = tool({
    description:
      "Read log files from a managed agent project. Uses configured logPatterns to find log files, or queries the MCP server if no patterns are configured.",
    inputSchema: z.object({
      agentId: z.string().describe("Agent ID or name"),
      pattern: z
        .string()
        .optional()
        .describe('Override glob pattern (e.g. "logs/*.jsonl")'),
      tail: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .default(50)
        .describe("Number of lines from the end (default: 50)"),
      filter: z
        .string()
        .optional()
        .describe("Filter string to match in log lines"),
    }),
    execute: async ({ agentId, pattern, tail = 50, filter }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent)
        return {
          error: "AGENT_NOT_FOUND",
          message: `No agent found: ${agentId}`,
        };

      const logPatterns: LogPattern[] = pattern
        ? [{ pattern, format: pattern.endsWith(".jsonl") ? "jsonl" : "plain" }]
        : (agent.logPatterns ?? []);

      // If no log patterns configured but MCP server is running, try to get logs from MCP
      if (logPatterns.length === 0 && agent.mcpPort) {
        try {
          const { AgentDiscovery } = await import("../agent-discovery.js");
          const discovery = new AgentDiscovery({ habitat: ctx as any });
          const discovered = await discovery.discoverAgent(agent);

          if (discovered.status === "running" && discovered.client) {
            // Try to call the bridge health tool to get server info
            const result = await discovered.client.callTool({
              name: "bridge_health",
              arguments: {},
            });

            discovery.stop();

            return {
              agentId: agent.id,
              source: "mcp_server",
              mcpPort: agent.mcpPort,
              message:
                "MCP server is running. Use agent_status for detailed server info.",
              health: result,
            };
          }

          discovery.stop();

          return {
            agentId: agent.id,
            error: "MCP_SERVER_NOT_RUNNING",
            message: `MCP server on port ${agent.mcpPort} is not running (status: ${discovered.status}).`,
            mcpError: discovered.error,
          };
        } catch (e) {
          return {
            agentId: agent.id,
            error: "MCP_QUERY_FAILED",
            message: `Failed to query MCP server on port ${agent.mcpPort}: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
      }

      if (logPatterns.length === 0) {
        return {
          error: "NO_LOG_PATTERNS",
          message: `No log patterns configured for agent "${agent.name}" and no MCP server is running. Configure logPatterns in the agent entry or start an MCP server.`,
        };
      }

      const results: Array<{ file: string; lines: string[]; format: string }> =
        [];

      for (const lp of logPatterns) {
        try {
          const matchingFiles = await findMatchingFiles(
            agent.projectPath,
            lp.pattern,
          );

          // Sort by mtime, most recent first
          const filesWithStats = await Promise.all(
            matchingFiles.map(async (f) => {
              try {
                const s = await stat(f);
                return { path: f, mtime: s.mtimeMs };
              } catch {
                return null;
              }
            }),
          );
          const sorted = filesWithStats
            .filter((x): x is NonNullable<typeof x> => x !== null)
            .sort((a, b) => b.mtime - a.mtime);

          // Read the most recent file
          const mostRecent = sorted[0];
          if (!mostRecent) continue;

          const content = await readFile(mostRecent.path, "utf-8");
          let lines = content.split("\n").filter(Boolean);

          // Apply filter
          if (filter) {
            lines = lines.filter((line) => line.includes(filter));
          }

          // Tail
          lines = lines.slice(-tail);

          // Parse JSONL if needed
          if (lp.format === "jsonl") {
            lines = lines.map((line) => {
              try {
                return JSON.stringify(JSON.parse(line), null, 0);
              } catch {
                return line;
              }
            });
          }

          results.push({
            file: relative(agent.projectPath, mostRecent.path),
            lines,
            format: lp.format,
          });
        } catch {
          // Pattern didn't match or error reading
          continue;
        }
      }

      if (results.length === 0) {
        return {
          message: "No log files found matching configured patterns.",
          agentId: agent.id,
        };
      }

      return { agentId: agent.id, logs: results };
    },
  });

  // ── agent_status ───────────────────────────────────────────────────

  const agentStatusTool = tool({
    description:
      "Get quick status/health check for a managed agent. Checks MCP server status, reads status file, lists recent log files, and shows available commands.",
    inputSchema: z.object({
      agentId: z.string().describe("Agent ID or name"),
    }),
    execute: async ({ agentId }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent)
        return {
          error: "AGENT_NOT_FOUND",
          message: `No agent found: ${agentId}`,
        };

      const status: Record<string, unknown> = {
        id: agent.id,
        name: agent.name,
        projectPath: agent.projectPath,
      };

      // Check MCP server status if configured
      if (agent.mcpPort) {
        try {
          const { AgentDiscovery } = await import("../agent-discovery.js");
          const discovery = new AgentDiscovery({ habitat: ctx as any });
          const discovered = await discovery.discoverAgent(agent);

          status.mcpServer = {
            port: agent.mcpPort,
            status: discovered.status,
            endpoint: discovered.endpoint,
            tools: discovered.tools,
            error: discovered.error,
          };

          discovery.stop();
        } catch (e) {
          status.mcpServer = {
            port: agent.mcpPort,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }

      // Read status file if configured
      if (agent.statusFile) {
        try {
          const content = await readFile(
            join(agent.projectPath, agent.statusFile),
            "utf-8",
          );
          status.statusFile = {
            path: agent.statusFile,
            content: content.trim(),
          };
        } catch {
          status.statusFile = {
            path: agent.statusFile,
            error: "File not found",
          };
        }
      }

      // List recent log files
      if (agent.logPatterns?.length) {
        const recentLogs: Array<{ file: string; mtime: string; size: number }> =
          [];
        for (const lp of agent.logPatterns) {
          try {
            const files = await findMatchingFiles(
              agent.projectPath,
              lp.pattern,
            );
            for (const f of files) {
              try {
                const s = await stat(f);
                recentLogs.push({
                  file: relative(agent.projectPath, f),
                  mtime: new Date(s.mtimeMs).toISOString(),
                  size: s.size,
                });
              } catch {
                // skip
              }
            }
          } catch {
            // skip
          }
        }
        recentLogs.sort((a, b) => b.mtime.localeCompare(a.mtime));
        status.recentLogs = recentLogs.slice(0, 10);
      }

      // Show available commands
      if (agent.commands) {
        status.commands = agent.commands;
      }

      // Show secrets (references only)
      if (agent.secrets?.length) {
        status.secretRefs = agent.secrets;
      }

      return status;
    },
  });

  // ── agent_ask ──────────────────────────────────────────────────────

  const agentAskTool = tool({
    description:
      "Send a message to a managed agent sub-agent. The agent has persistent memory and uses tools to explore its project. Use for project exploration, log analysis, debugging, etc.",
    inputSchema: z.object({
      agentId: z.string().describe("Agent ID or name"),
      message: z
        .string()
        .describe("Message to send to the agent (question, task, etc.)"),
    }),
    execute: async ({ agentId, message }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent)
        return {
          error: "AGENT_NOT_FOUND",
          message: `No agent found: ${agentId}`,
        };

      try {
        const habitatAgent = await ctx.getOrCreateHabitatAgent(agentId);
        const response = await habitatAgent.ask(message);
        return { agentId: agent.id, response };
      } catch (err: any) {
        return {
          error: "AGENT_ASK_FAILED",
          message: err.message || String(err),
        };
      }
    },
  });

  // ── bridge_start ──────────────────────────────────────────────────────
  /** Start a Bridge MCP server for an agent in a Dagger container.
   *  This creates a container with the bridge MCP server running,
   *  clones the repo, and returns connection details for the CLI to use as a client.
   */
  const bridgeStartTool = tool({
    description:
      "Start a Bridge MCP server for an agent. Creates a Dagger container with MCP server running at localhost:PORT. Returns connection details for CLI to use as client.",
    inputSchema: z.object({
      agentId: z
        .string()
        .describe("ID of the registered agent to start bridge for"),
    }),
    execute: async ({ agentId }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent) {
        return {
          error: "AGENT_NOT_FOUND",
          message: `No agent found: ${agentId}`,
        };
      }

      if (!agent.gitRemote) {
        return {
          error: "NO_GIT_REMOTE",
          message: `Agent ${agentId} has no gitRemote configured. Only agents cloned from git repos can use Bridge mode.`,
        };
      }

      // Check if bridge already exists in-memory (started in this process)
      const inMemoryBridge = ctx.getBridgeAgent(agentId);
      if (inMemoryBridge) {
        const port = inMemoryBridge.getPort();
        // Verify the bridge is actually alive (port > 0 and reachable)
        if (port > 0) {
          try {
            const client = await inMemoryBridge.getClient();
            await client.health();
            return {
              bridgeId: agentId,
              repoUrl: agent.gitRemote,
              mcpUrl: `http://localhost:${port}/mcp`,
              port,
              status: "already_running",
              message: `Bridge MCP server for ${agentId} is already running at http://localhost:${port}/mcp. To restart with updated config/secrets, use bridge_stop first then bridge_start.`,
            };
          } catch {
            // Bridge exists in memory but is dead — clean it up and restart
            await ctx.destroyBridgeAgent(agentId);
          }
        } else {
          // Port 0 means it never started properly — clean up
          await ctx.destroyBridgeAgent(agentId);
        }
      }

      // Check for externally-started bridge (from CLI) — stop it so we can restart with current config
      const existingClient = await getBridgeClient(agentId);
      if (existingClient) {
        // Disconnect the external client — we'll start a fresh one
        const extClient = externalClients.get(agentId);
        if (extClient) {
          await extClient.disconnect();
          externalClients.delete(agentId);
        }
        // Note: the external container is still running, but we can't stop it from here.
        // Start a new bridge in this process which will get a new port.
      }

      try {
        const bridgeAgent = await ctx.startBridge(agentId);
        const port = bridgeAgent.getPort();

        return {
          bridgeId: agentId,
          repoUrl: agent.gitRemote,
          mcpUrl: `http://localhost:${port}/mcp`,
          port,
          status: "running",
          logFile: `${ctx.getAgentDir(agentId)}/logs/bridge.log`,
          message: `Bridge MCP server started for ${agentId} at http://localhost:${port}/mcp. Use bridge_ls, bridge_read, bridge_exec to inspect.`,
        };
      } catch (err: any) {
        return {
          error: "BRIDGE_START_FAILED",
          message: err.message || String(err),
        };
      }
    },
  });

  // ── bridge_ls ─────────────────────────────────────────────────────────
  /** List files in the bridge container */
  const bridgeLsTool = tool({
    description: "List files in the bridge container's /workspace directory",
    inputSchema: z.object({
      agentId: z.string().describe("ID of the bridge agent"),
      path: z
        .string()
        .optional()
        .describe("Directory path to list (default: /workspace)"),
    }),
    execute: async ({ agentId, path }) => {
      const bridge = await getBridgeClient(agentId);
      if (!bridge) {
        return {
          error: "BRIDGE_NOT_FOUND",
          message: `No running bridge found for agent ${agentId}. Start one with bridge_start first.`,
        };
      }

      try {
        const result = await bridge.client.listDirectory(path || "/workspace");
        return { agentId, entries: result };
      } catch (err: any) {
        return {
          error: "BRIDGE_COMMAND_FAILED",
          message: err.message || String(err),
        };
      }
    },
  });

  // ── bridge_read ────────────────────────────────────────────────────────
  /** Read a file from the bridge container */
  const bridgeReadTool = tool({
    description: "Read a file from the bridge container",
    inputSchema: z.object({
      agentId: z.string().describe("ID of the bridge agent"),
      path: z.string().describe("File path to read (relative to /workspace)"),
    }),
    execute: async ({ agentId, path }) => {
      const bridge = await getBridgeClient(agentId);
      if (!bridge) {
        return {
          error: "BRIDGE_NOT_FOUND",
          message: `No running bridge found for agent ${agentId}. Start one with bridge_start first.`,
        };
      }

      try {
        const content = await bridge.client.readFile(path);
        return { agentId, path, content };
      } catch (err: any) {
        return {
          error: "BRIDGE_COMMAND_FAILED",
          message: err.message || String(err),
        };
      }
    },
  });

  // ── bridge_exec ─────────────────────────────────────────────────────────
  /** Execute a command in the bridge container */
  const bridgeExecTool = tool({
    description: "Execute a command in the bridge container",
    inputSchema: z.object({
      agentId: z.string().describe("ID of the bridge agent"),
      command: z.string().describe("Command to execute"),
      cwd: z
        .string()
        .optional()
        .describe("Working directory (default: /workspace)"),
    }),
    execute: async ({ agentId, command, cwd }) => {
      const bridge = await getBridgeClient(agentId);
      if (!bridge) {
        return {
          error: "BRIDGE_NOT_FOUND",
          message: `No running bridge found for agent ${agentId}. Start one with bridge_start first.`,
        };
      }

      try {
        const result = await bridge.client.execute(command, { cwd });
        return {
          agentId,
          command,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      } catch (err: any) {
        return {
          error: "BRIDGE_COMMAND_FAILED",
          message: err.message || String(err),
        };
      }
    },
  });

  // ── bridge_list ────────────────────────────────────────────────────────
  /** List all running bridge agents */
  const bridgeListTool = tool({
    description:
      "List all bridge agents and their connection status. Checks actual MCP server connectivity.",
    inputSchema: z.object({}),
    execute: async () => {
      const allAgents = ctx.getAgents();
      const bridges = [];

      for (const agent of allAgents) {
        if (!agent.mcpPort && !agent.gitRemote) continue;

        // First check in-memory bridge (started in this process)
        const inMemoryBridge = ctx.getBridgeAgent(agent.id);
        if (inMemoryBridge) {
          const port = inMemoryBridge.getPort();
          if (port > 0) {
            // Verify it's actually alive
            try {
              const client = await inMemoryBridge.getClient();
              await client.health();
              bridges.push({
                agentId: agent.id,
                name: agent.name,
                port,
                status: "running",
                mcpUrl: `http://localhost:${port}/mcp`,
              });
              continue;
            } catch {
              // In-memory but dead
              bridges.push({
                agentId: agent.id,
                name: agent.name,
                status: "unhealthy",
                port,
                gitRemote: agent.gitRemote,
              });
              continue;
            }
          }
        }

        // Check external bridge via config port
        if (agent.mcpPort && agent.mcpPort > 0) {
          const { AgentDiscovery } = await import("../agent-discovery.js");
          const discovery = new AgentDiscovery({ habitat: ctx as any });
          const discovered = await discovery.discoverAgent(agent);
          discovery.stop();
          bridges.push({
            agentId: agent.id,
            name: agent.name,
            port: agent.mcpPort,
            status: discovered.status,
            mcpUrl: `http://localhost:${agent.mcpPort}/mcp`,
            tools: discovered.tools,
            error: discovered.error,
          });
        } else {
          // Agent has gitRemote but no port — not started
          bridges.push({
            agentId: agent.id,
            name: agent.name,
            status: "stopped",
            gitRemote: agent.gitRemote,
          });
        }
      }

      return {
        count: bridges.length,
        running: bridges.filter((b) => b.status === "running").length,
        bridges,
      };
    },
  });

  // ── bridge_stop ─────────────────────────────────────────────────────────
  /** Stop a running bridge agent */
  const bridgeStopTool = tool({
    description: "Stop a running bridge agent and clean up its resources",
    inputSchema: z.object({
      agentId: z.string().describe("ID of the bridge agent to stop"),
    }),
    execute: async ({ agentId }) => {
      // Check in-memory first (bridges started in this process)
      const bridgeAgent = ctx.getBridgeAgent(agentId);
      if (bridgeAgent) {
        try {
          await ctx.destroyBridgeAgent(agentId);
          return {
            agentId,
            status: "stopped",
            message: `Bridge agent ${agentId} stopped successfully`,
          };
        } catch (err: any) {
          return {
            error: "BRIDGE_STOP_FAILED",
            message: err.message || String(err),
          };
        }
      }

      // Check for externally-started bridge — disconnect our client
      const agent = ctx.getAgent(agentId);
      if (agent?.mcpPort) {
        const extClient = externalClients.get(agentId);
        if (extClient) {
          await extClient.disconnect();
          externalClients.delete(agentId);
        }
        await ctx.updateAgent(agentId, { mcpStatus: "stopped", mcpPort: undefined });
        return {
          agentId,
          status: "stopped",
          message: `Bridge agent ${agentId} disconnected. The external container may still be running (use Ctrl+C in its terminal). Use bridge_start to start a new bridge with current config and secrets.`,
        };
      }

      return {
        error: "BRIDGE_NOT_FOUND",
        message: `No bridge found for agent ${agentId}`,
      };
    },
  });

  return {
    agent_clone: agentCloneTool,
    agent_logs: agentLogsTool,
    agent_status: agentStatusTool,
    agent_ask: agentAskTool,
    bridge_start: bridgeStartTool,
    bridge_stop: bridgeStopTool,
    bridge_list: bridgeListTool,
    bridge_ls: bridgeLsTool,
    bridge_read: bridgeReadTool,
    bridge_exec: bridgeExecTool,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Find files matching a glob-like pattern relative to a base directory.
 * Supports simple patterns like "logs/*.jsonl" or "*.log".
 * Uses directory listing for simple patterns (no external deps).
 */
async function findMatchingFiles(
  basePath: string,
  pattern: string,
): Promise<string[]> {
  const parts = pattern.split("/");
  return walkPattern(basePath, parts);
}

async function walkPattern(dir: string, parts: string[]): Promise<string[]> {
  if (parts.length === 0) return [];

  const [current, ...rest] = parts;
  const results: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    if (current === "**") {
      // Recursive: match in this dir and all subdirs
      // Try matching rest in current dir
      results.push(...(await walkPattern(dir, rest)));
      // Recurse into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory()) {
          results.push(...(await walkPattern(join(dir, entry.name), parts)));
        }
      }
    } else if (rest.length === 0) {
      // Last part: match files
      const regex = globToRegex(current);
      for (const entry of entries) {
        if (entry.isFile() && regex.test(entry.name)) {
          results.push(join(dir, entry.name));
        }
      }
    } else {
      // Intermediate directory part
      if (current.includes("*")) {
        const regex = globToRegex(current);
        for (const entry of entries) {
          if (entry.isDirectory() && regex.test(entry.name)) {
            results.push(...(await walkPattern(join(dir, entry.name), rest)));
          }
        }
      } else {
        // Exact directory name
        results.push(...(await walkPattern(join(dir, current), rest)));
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }

  return results;
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}
