/**
 * `agent_status` — quick status/health check for a managed agent.
 * Reads status file if configured, lists recent log files, surfaces
 * commands and secret refs.
 */

import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import type { AgentRunnerToolsContext } from "./context.js";
import { findMatchingFiles } from "./glob.js";

export function createAgentStatusTool(ctx: AgentRunnerToolsContext): Tool {
	return tool({
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
				const recentLogs: Array<{
					file: string;
					mtime: string;
					size: number;
				}> = [];
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
}
