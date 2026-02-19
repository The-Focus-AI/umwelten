/**
 * Agent runner tools: agent_clone, agent_logs, agent_status, agent_ask.
 * These tools let the main habitat agent manage sub-agents (HabitatAgents).
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import type { AgentEntry, LogPattern } from "../types.js";
import { BridgeAgent } from "../bridge/agent.js";
import { BridgeAnalyzer, TOOL_PACKAGES } from "../bridge/analyzer.js";

const execFileAsync = promisify(execFile);

/** Interface for the habitat context that agent runner tools need. */
export interface AgentRunnerToolsContext {
  getWorkDir(): string;
  getAgent(idOrName: string): AgentEntry | undefined;
  addAgent(agent: AgentEntry): Promise<void>;
  updateAgent(idOrName: string, updates: Partial<AgentEntry>): Promise<void>;
  getOrCreateHabitatAgent(
    agentId: string,
  ): Promise<{ ask(message: string): Promise<string> }>;
}

export function createAgentRunnerTools(
  ctx: AgentRunnerToolsContext,
): Record<string, Tool> {
  // ── agent_clone ────────────────────────────────────────────────────

  const agentCloneTool = tool({
    description:
      "Register a git repository as a managed agent and start it in a Bridge container. The repo is cloned INSIDE the container, not on the host filesystem.",
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

      // Register agent metadata (no local clone - repo will be in container)
      const agent: AgentEntry = {
        id: agentId,
        name,
        projectPath: `/workspace`, // Path inside container, not local
        gitRemote: gitUrl,
      };

      await ctx.addAgent(agent);

      // Immediately create a BridgeAgent which will clone inside the container
      try {
        const bridgeAgent = new BridgeAgent({
          id: agentId,
          repoUrl: gitUrl,
          maxIterations: 10,
        });

        // Initialize with iterative provisioning (clones repo inside container)
        await bridgeAgent.initialize();

        // Get the client for interaction
        const bridgeClient = await bridgeAgent.getClient();

        // Verify it's working
        const health = await bridgeClient.health();

        return {
          registered: true,
          agent: { id: agentId, name, gitRemote: gitUrl },
          bridge: {
            status: "ready",
            health: health,
          },
          message: `Agent "${name}" (${agentId}) registered and BridgeAgent started. The repo ${gitUrl} has been cloned inside the container and auto-provisioned. Ready for use!`,
        };
      } catch (bridgeErr: any) {
        // Bridge creation failed but registration succeeded
        return {
          registered: true,
          agent: { id: agentId, name, gitRemote: gitUrl },
          bridgeError: bridgeErr.message || String(bridgeErr),
          message: `Agent "${name}" (${agentId}) registered, but BridgeAgent creation failed: ${bridgeErr.message}.`,
        };
      }
    },
  });

  // ── agent_logs ─────────────────────────────────────────────────────

  const agentLogsTool = tool({
    description:
      "Read log files from a managed agent project. Uses configured logPatterns to find log files.",
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

      if (logPatterns.length === 0) {
        return {
          error: "NO_LOG_PATTERNS",
          message: `No log patterns configured for agent "${agent.name}". Configure logPatterns in the agent entry.`,
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
      "Get quick status/health check for a managed agent. Reads status file, lists recent log files, and shows available commands.",
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

      try {
        // Create a BridgeAgent for this agent with iterative provisioning
        const bridgeAgent = new BridgeAgent({
          id: agentId,
          repoUrl: agent.gitRemote,
          maxIterations: 5, // Analyze and re-provision if needed
        });

        // Initialize with analysis and auto-provisioning
        await bridgeAgent.initialize();

        // Store bridge agent in context for later use
        (ctx as any).activeBridge = bridgeAgent;

        // Get connection info
        const port = bridgeAgent.getPort();
        const state = bridgeAgent.getState();

        return {
          bridgeId: agentId,
          repoUrl: agent.gitRemote,
          mcpUrl: `http://localhost:${port}/mcp`,
          port: port,
          status: "running",
          iterations: state.iteration,
          detectedTools: state.analysis?.detectedTools || [],
          aptPackages: state.analysis?.aptPackages || [],
          message: `Bridge MCP server started for ${agentId} at http://localhost:${port}/mcp after ${state.iteration} iteration(s). Detected: ${state.analysis?.detectedTools.join(", ") || "none"}. Use bridge_ls, bridge_read, bridge_exec to interact.`,
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
      path: z
        .string()
        .optional()
        .describe("Directory path to list (default: /workspace)"),
    }),
    execute: async ({ path }) => {
      const bridgeAgent = (ctx as any).activeBridge;
      if (!bridgeAgent) {
        return {
          error: "NO_ACTIVE_BRIDGE",
          message:
            "No bridge is currently running. Start one with bridge_start first.",
        };
      }

      try {
        const client = await bridgeAgent.getClient();
        const result = await client.listDirectory(path || "/workspace");
        return { entries: result };
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
      path: z.string().describe("File path to read (relative to /workspace)"),
    }),
    execute: async ({ path }) => {
      const bridgeAgent = (ctx as any).activeBridge;
      if (!bridgeAgent) {
        return {
          error: "NO_ACTIVE_BRIDGE",
          message:
            "No bridge is currently running. Start one with bridge_start first.",
        };
      }

      try {
        const client = await bridgeAgent.getClient();
        const content = await client.readFile(path);
        return { path, content };
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
      command: z.string().describe("Command to execute"),
      cwd: z
        .string()
        .optional()
        .describe("Working directory (default: /workspace)"),
    }),
    execute: async ({ command, cwd }) => {
      const bridgeAgent = (ctx as any).activeBridge;
      if (!bridgeAgent) {
        return {
          error: "NO_ACTIVE_BRIDGE",
          message:
            "No bridge is currently running. Start one with bridge_start first.",
        };
      }

      try {
        const client = await bridgeAgent.getClient();
        const result = await client.execute(command, { cwd });
        return { command, stdout: result.stdout, stderr: result.stderr };
      } catch (err: any) {
        return {
          error: "BRIDGE_COMMAND_FAILED",
          message: err.message || String(err),
        };
      }
    },
  });

  // ── agent_analyze ─────────────────────────────────────────────────────
  /** Analyze an agent to determine what it needs to run successfully */
  const agentAnalyzeTool = tool({
    description:
      "Analyze an agent's project to detect dependencies, tools, and configuration issues. Returns a detailed report of what the agent needs.",
    inputSchema: z.object({
      agentId: z.string().describe("ID of the agent to analyze"),
      deep: z
        .boolean()
        .optional()
        .describe(
          "Perform deep analysis including script content scanning (default: true)",
        ),
    }),
    execute: async ({ agentId, deep = true }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent) {
        return {
          error: "AGENT_NOT_FOUND",
          message: `No agent found: ${agentId}`,
        };
      }

      try {
        // Start a bridge to analyze the agent
        const bridgeAgent = new BridgeAgent({
          id: `${agentId}-analyze`,
          repoUrl: agent.gitRemote || "",
          maxIterations: 1,
        });

        await bridgeAgent.start();
        const client = await bridgeAgent.getClient();
        const analyzer = new BridgeAnalyzer(client);

        // Run analysis
        const analysis = await analyzer.analyze("/workspace");

        // Check for common issues
        const issues: string[] = [];

        // Check if scripts reference tools not available
        const missingTools = analysis.detectedTools.filter((t) => {
          const pkg = TOOL_PACKAGES[t];
          return pkg && !analysis.aptPackages.includes(pkg);
        });

        if (missingTools.length > 0) {
          issues.push(`Missing tools: ${missingTools.join(", ")}`);
        }

        // Check for environment variables
        if (analysis.envVarNames.length > 0) {
          const missingEnv = analysis.envVarNames.filter(
            (e) => !process.env[e],
          );
          if (missingEnv.length > 0) {
            issues.push(`Missing env vars: ${missingEnv.join(", ")}`);
          }
        }

        // Cleanup
        await bridgeAgent.destroy();

        return {
          agentId,
          projectType: analysis.projectType,
          detectedTools: analysis.detectedTools,
          requiredPackages: analysis.aptPackages,
          envVarNames: analysis.envVarNames,
          skills: analysis.skillRepos.map((s) => s.name),
          setupCommands: analysis.setupCommands,
          issues,
          recommendations:
            issues.length > 0
              ? [
                  `Install packages: ${analysis.aptPackages.join(", ")}`,
                  `Set env vars: ${analysis.envVarNames.join(", ")}`,
                  "Consider adding setup commands to agent config",
                ]
              : ["Agent appears ready to run"],
        };
      } catch (err: any) {
        return {
          error: "ANALYSIS_FAILED",
          message: err.message || String(err),
        };
      }
    },
  });

  // ── agent_heal ─────────────────────────────────────────────────────────
  /** Attempt to heal an agent by installing dependencies and updating config */
  const agentHealTool = tool({
    description:
      "Heal an agent by detecting issues and creating a plan to fix them. Updates the agent's bridge configuration with correct dependencies.",
    inputSchema: z.object({
      agentId: z.string().describe("ID of the agent to heal"),
      autoFix: z
        .boolean()
        .optional()
        .describe("Automatically apply fixes (default: true)"),
    }),
    execute: async ({ agentId, autoFix = true }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent) {
        return {
          error: "AGENT_NOT_FOUND",
          message: `No agent found: ${agentId}`,
        };
      }

      try {
        // First, analyze what the agent needs
        const bridgeAgent = new BridgeAgent({
          id: `${agentId}-heal`,
          repoUrl: agent.gitRemote || "",
          maxIterations: 1,
        });

        await bridgeAgent.start();
        const client = await bridgeAgent.getClient();
        const analyzer = new BridgeAnalyzer(client);
        const analysis = await analyzer.analyze("/workspace");

        const fixes: string[] = [];

        // Check for missing tools
        if (analysis.aptPackages.length > 0) {
          fixes.push(`Will install: ${analysis.aptPackages.join(", ")}`);
        }

        // Check for missing env vars
        const missingEnv = analysis.envVarNames.filter((e) => !process.env[e]);
        if (missingEnv.length > 0) {
          fixes.push(`Will prompt for env vars: ${missingEnv.join(", ")}`);
        }

        // Update agent with detected skills if autoFix
        if (autoFix && analysis.skillRepos.length > 0) {
          await ctx.updateAgent(agentId, {
            skillsFromGit: analysis.skillRepos.map((s) => s.gitRepo),
          });

          fixes.push("Updated agent configuration with detected skills");
        }

        // Cleanup temp bridge
        await bridgeAgent.destroy();

        return {
          agentId,
          healed: fixes.length > 0,
          fixes,
          analysis: {
            projectType: analysis.projectType,
            detectedTools: analysis.detectedTools,
            requiredPackages: analysis.aptPackages,
            envVarNames: analysis.envVarNames,
          },
          nextSteps: [
            "Run 'bridge_start' to start the agent with correct dependencies",
            "Check agent_stimulus to verify the agent has healing instructions",
          ],
        };
      } catch (err: any) {
        return { error: "HEAL_FAILED", message: err.message || String(err) };
      }
    },
  });

  return {
    agent_clone: agentCloneTool,
    agent_logs: agentLogsTool,
    agent_status: agentStatusTool,
    agent_ask: agentAskTool,
    agent_analyze: agentAnalyzeTool,
    agent_heal: agentHealTool,
    bridge_start: bridgeStartTool,
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
