/**
 * `agent_clone` — clone a git repository into the habitat workspace and
 * register it as a managed agent.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import type { AgentEntry } from "../../types.js";
import {
	type AgentRunnerToolsContext,
	deriveAgentId,
	execFileAsync,
} from "./context.js";

export function createAgentCloneTool(ctx: AgentRunnerToolsContext): Tool {
	return tool({
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
			const agentId = id ?? deriveAgentId(name);

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
				await rm(projectPath, { recursive: true, force: true }).catch(
					() => {},
				);
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
}
