/**
 * Agent runner tools: agent_clone, agent_logs, agent_status, agent_ask.
 * These tools let the main habitat agent manage sub-agents (HabitatAgents).
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tool } from 'ai';
import { z } from 'zod';
import type { Tool } from 'ai';
import type { AgentEntry, LogPattern } from '../types.js';

const execFileAsync = promisify(execFile);

/** Interface for the habitat context that agent runner tools need. */
export interface AgentRunnerToolsContext {
  getWorkDir(): string;
  getAgent(idOrName: string): AgentEntry | undefined;
  addAgent(agent: AgentEntry): Promise<void>;
  getOrCreateHabitatAgent(agentId: string): Promise<{ ask(message: string): Promise<string> }>;
}

export function createAgentRunnerTools(ctx: AgentRunnerToolsContext): Record<string, Tool> {

  // ── agent_clone ────────────────────────────────────────────────────

  const agentCloneTool = tool({
    description: 'Clone a git repository and register it as a managed agent. The repo is cloned into the repos/ directory under the work dir.',
    inputSchema: z.object({
      gitUrl: z.string().describe('Git URL to clone (e.g. git@github.com:org/repo.git or https://...)'),
      name: z.string().describe('Display name for the agent'),
      id: z.string().optional().describe('Unique agent ID (defaults to name, lowercased, hyphened)'),
    }),
    execute: async ({ gitUrl, name, id }) => {
      const agentId = id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

      // Check if agent already exists
      const existing = ctx.getAgent(agentId);
      if (existing) {
        return { error: 'AGENT_EXISTS', message: `Agent "${agentId}" already exists at ${existing.projectPath}` };
      }

      const reposDir = join(ctx.getWorkDir(), 'repos');
      const projectPath = join(reposDir, agentId);

      try {
        await execFileAsync('git', ['clone', gitUrl, projectPath], {
          timeout: 120000, // 2 minute timeout for clone
        });
      } catch (err: any) {
        return { error: 'CLONE_FAILED', message: err.message || String(err) };
      }

      const agent: AgentEntry = {
        id: agentId,
        name,
        projectPath,
        gitRemote: gitUrl,
      };

      // Auto-discover capabilities from the cloned project
      await discoverAgentCapabilities(agent);

      await ctx.addAgent(agent);

      return {
        cloned: true,
        agent: {
          id: agentId, name, projectPath, gitRemote: gitUrl,
          commands: agent.commands,
          logPatterns: agent.logPatterns,
          statusFile: agent.statusFile,
        },
        message: `Cloned ${gitUrl} to ${projectPath} and registered as agent "${name}" (${agentId}).`,
      };
    },
  });

  // ── agent_logs ─────────────────────────────────────────────────────

  const agentLogsTool = tool({
    description: 'Read log files from a managed agent project. Uses configured logPatterns to find log files.',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID or name'),
      pattern: z.string().optional().describe('Override glob pattern (e.g. "logs/*.jsonl")'),
      tail: z.number().int().min(1).max(1000).optional().default(50).describe('Number of lines from the end (default: 50)'),
      filter: z.string().optional().describe('Filter string to match in log lines'),
    }),
    execute: async ({ agentId, pattern, tail = 50, filter }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent) return { error: 'AGENT_NOT_FOUND', message: `No agent found: ${agentId}` };

      const logPatterns: LogPattern[] = pattern
        ? [{ pattern, format: pattern.endsWith('.jsonl') ? 'jsonl' : 'plain' }]
        : agent.logPatterns ?? [];

      if (logPatterns.length === 0) {
        return { error: 'NO_LOG_PATTERNS', message: `No log patterns configured for agent "${agent.name}". Configure logPatterns in the agent entry.` };
      }

      const results: Array<{ file: string; lines: string[]; format: string }> = [];

      for (const lp of logPatterns) {
        try {
          const matchingFiles = await findMatchingFiles(agent.projectPath, lp.pattern);

          // Sort by mtime, most recent first
          const filesWithStats = await Promise.all(
            matchingFiles.map(async (f) => {
              try {
                const s = await stat(f);
                return { path: f, mtime: s.mtimeMs };
              } catch {
                return null;
              }
            })
          );
          const sorted = filesWithStats
            .filter((x): x is NonNullable<typeof x> => x !== null)
            .sort((a, b) => b.mtime - a.mtime);

          // Read the most recent file
          const mostRecent = sorted[0];
          if (!mostRecent) continue;

          const content = await readFile(mostRecent.path, 'utf-8');
          let lines = content.split('\n').filter(Boolean);

          // Apply filter
          if (filter) {
            lines = lines.filter(line => line.includes(filter));
          }

          // Tail
          lines = lines.slice(-tail);

          // Parse JSONL if needed
          if (lp.format === 'jsonl') {
            lines = lines.map(line => {
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
        return { message: 'No log files found matching configured patterns.', agentId: agent.id };
      }

      return { agentId: agent.id, logs: results };
    },
  });

  // ── agent_status ───────────────────────────────────────────────────

  const agentStatusTool = tool({
    description: 'Get quick status/health check for a managed agent. Reads status file, lists recent log files, and shows available commands.',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID or name'),
    }),
    execute: async ({ agentId }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent) return { error: 'AGENT_NOT_FOUND', message: `No agent found: ${agentId}` };

      const status: Record<string, unknown> = {
        id: agent.id,
        name: agent.name,
        projectPath: agent.projectPath,
      };

      // Read status file if configured
      if (agent.statusFile) {
        try {
          const content = await readFile(join(agent.projectPath, agent.statusFile), 'utf-8');
          status.statusFile = { path: agent.statusFile, content: content.trim() };
        } catch {
          status.statusFile = { path: agent.statusFile, error: 'File not found' };
        }
      }

      // List recent log files
      if (agent.logPatterns?.length) {
        const recentLogs: Array<{ file: string; mtime: string; size: number }> = [];
        for (const lp of agent.logPatterns) {
          try {
            const files = await findMatchingFiles(agent.projectPath, lp.pattern);
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
    description: 'Send a message to a managed agent sub-agent. The agent has persistent memory and uses tools to explore its project. Use for project exploration, log analysis, debugging, etc.',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID or name'),
      message: z.string().describe('Message to send to the agent (question, task, etc.)'),
    }),
    execute: async ({ agentId, message }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent) return { error: 'AGENT_NOT_FOUND', message: `No agent found: ${agentId}` };

      try {
        const habitatAgent = await ctx.getOrCreateHabitatAgent(agentId);
        const response = await habitatAgent.ask(message);
        return { agentId: agent.id, response };
      } catch (err: any) {
        return { error: 'AGENT_ASK_FAILED', message: err.message || String(err) };
      }
    },
  });

  return {
    agent_clone: agentCloneTool,
    agent_logs: agentLogsTool,
    agent_status: agentStatusTool,
    agent_ask: agentAskTool,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Find files matching a glob-like pattern relative to a base directory.
 * Supports simple patterns like "logs/*.jsonl" or "*.log".
 * Uses directory listing for simple patterns (no external deps).
 */
async function findMatchingFiles(basePath: string, pattern: string): Promise<string[]> {
  const parts = pattern.split('/');
  return walkPattern(basePath, parts);
}

async function walkPattern(dir: string, parts: string[]): Promise<string[]> {
  if (parts.length === 0) return [];

  const [current, ...rest] = parts;
  const results: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    if (current === '**') {
      // Recursive: match in this dir and all subdirs
      // Try matching rest in current dir
      results.push(...await walkPattern(dir, rest));
      // Recurse into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory()) {
          results.push(...await walkPattern(join(dir, entry.name), parts));
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
      if (current.includes('*')) {
        const regex = globToRegex(current);
        for (const entry of entries) {
          if (entry.isDirectory() && regex.test(entry.name)) {
            results.push(...await walkPattern(join(dir, entry.name), rest));
          }
        }
      } else {
        // Exact directory name
        results.push(...await walkPattern(join(dir, current), rest));
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }

  return results;
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/**
 * Auto-discover capabilities from a cloned project.
 * Scans for package.json scripts, shell scripts, log directories, and status files.
 * Mutates the AgentEntry in place.
 */
export async function discoverAgentCapabilities(agent: AgentEntry): Promise<void> {
  const projectPath = agent.projectPath;

  // 1. Read package.json → extract scripts as commands
  try {
    const pkgContent = await readFile(join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent);
    if (pkg.scripts && typeof pkg.scripts === 'object') {
      const interestingScripts = ['start', 'dev', 'test', 'build', 'serve', 'lint'];
      const commands: Record<string, string> = {};
      for (const key of interestingScripts) {
        if (pkg.scripts[key]) {
          commands[key] = pkg.scripts[key];
        }
      }
      if (Object.keys(commands).length > 0) {
        agent.commands = { ...commands, ...agent.commands };
      }
    }
  } catch {
    // No package.json or invalid JSON
  }

  // 2. Look for shell scripts in root
  try {
    const entries = await readdir(projectPath, { withFileTypes: true });
    const shellScripts = entries.filter(
      e => e.isFile() && (e.name.endsWith('.sh') || e.name === 'Makefile')
    );
    if (shellScripts.length > 0) {
      if (!agent.commands) agent.commands = {};
      for (const script of shellScripts) {
        const key = script.name.replace(/\.sh$/, '');
        if (!agent.commands[key]) {
          agent.commands[key] = script.name === 'Makefile' ? 'make' : `./${script.name}`;
        }
      }
    }
  } catch {
    // Can't read directory
  }

  // 3. Check if logs/ dir exists → add default logPatterns
  try {
    const logsStat = await stat(join(projectPath, 'logs'));
    if (logsStat.isDirectory()) {
      if (!agent.logPatterns) {
        agent.logPatterns = [
          { pattern: 'logs/*.log', format: 'plain' },
          { pattern: 'logs/*.jsonl', format: 'jsonl' },
        ];
      }
    }
  } catch {
    // No logs directory
  }

  // 4. Check for status file
  if (!agent.statusFile) {
    for (const candidate of ['STATUS.md', 'status.md']) {
      try {
        const s = await stat(join(projectPath, candidate));
        if (s.isFile()) {
          agent.statusFile = candidate;
          break;
        }
      } catch {
        // Not found
      }
    }
  }
}
