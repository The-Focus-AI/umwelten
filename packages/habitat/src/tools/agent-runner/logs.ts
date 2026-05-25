/**
 * `agent_logs` — read log files from a managed agent's project, using
 * its configured `logPatterns` (or an override pattern) plus optional
 * tail and substring filter.
 */

import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import type { LogPattern } from "../../types.js";
import type { AgentRunnerToolsContext } from "./context.js";
import { findMatchingFiles } from "./glob.js";

export function createAgentLogsTool(ctx: AgentRunnerToolsContext): Tool {
	return tool({
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
				? [
						{
							pattern,
							format: pattern.endsWith(".jsonl") ? "jsonl" : "plain",
						},
					]
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
}
