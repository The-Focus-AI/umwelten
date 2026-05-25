/**
 * `agent_register_directory` — register an existing local directory as a
 * managed agent without cloning it. Use for repo-local agents you want
 * the habitat to inspect and manage in place.
 *
 * Also exports `registerManagedAgentDirectory` (used by `cli/habitat.ts`
 * for the `umwelten habitat local` / `here` subcommands).
 */

import { stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import type { AgentEntry } from "../../types.js";
import {
	type AgentRunnerToolsContext,
	deriveAgentId,
	deriveAgentName,
	getUniqueAgentId,
	inferGitRemote,
} from "./context.js";

export async function registerManagedAgentDirectory(
	ctx: AgentRunnerToolsContext,
	options: {
		projectPath: string;
		name?: string;
		id?: string;
		memoryPath?: string;
		gitRemote?: string;
	},
): Promise<{
	registered: boolean;
	reused: boolean;
	agent: AgentEntry;
	message: string;
}> {
	const resolvedProjectPath = resolve(options.projectPath);
	const projectStats = await stat(resolvedProjectPath).catch(() => null);

	if (!projectStats?.isDirectory()) {
		throw new Error(`PROJECT_PATH_NOT_FOUND: ${resolvedProjectPath}`);
	}

	const gitRemote =
		options.gitRemote ?? (await inferGitRemote(resolvedProjectPath));

	const existingByPath = ctx
		.getAgents()
		.find((agent) => resolve(agent.projectPath) === resolvedProjectPath);

	if (existingByPath) {
		const updates: Partial<AgentEntry> = {};
		if (
			options.memoryPath &&
			existingByPath.memoryPath !== resolve(options.memoryPath)
		) {
			updates.memoryPath = resolve(options.memoryPath);
		}
		if (gitRemote && existingByPath.gitRemote !== gitRemote) {
			updates.gitRemote = gitRemote;
		}
		if (Object.keys(updates).length > 0) {
			await ctx.updateAgent(existingByPath.id, updates);
			Object.assign(existingByPath, updates);
		}

		return {
			registered: false,
			reused: true,
			agent: existingByPath,
			message: `Agent "${existingByPath.name}" (${existingByPath.id}) already manages ${resolvedProjectPath}.`,
		};
	}

	const requestedId =
		options.id ?? deriveAgentId(options.name ?? deriveAgentName(resolvedProjectPath));
	const existingById = ctx.getAgent(requestedId);
	if (existingById) {
		if (options.id) {
			throw new Error(`AGENT_ID_EXISTS: ${requestedId}`);
		}
	}

	const agentId = existingById ? getUniqueAgentId(ctx, requestedId) : requestedId;
	const agent: AgentEntry = {
		id: agentId,
		name: options.name ?? deriveAgentName(resolvedProjectPath),
		projectPath: resolvedProjectPath,
		memoryPath: options.memoryPath ? resolve(options.memoryPath) : undefined,
		gitRemote,
	};

	await ctx.addAgent(agent);

	return {
		registered: true,
		reused: false,
		agent,
		message: `Registered ${resolvedProjectPath} as agent "${agent.name}" (${agent.id}).`,
	};
}

export function createAgentRegisterDirectoryTool(
	ctx: AgentRunnerToolsContext,
): Tool {
	return tool({
		description:
			"Register an existing local directory as a managed agent without cloning it. Use this for repo-local agents you want Habitat to inspect and manage directly.",
		inputSchema: z.object({
			projectPath: z
				.string()
				.describe("Local directory to register as a managed agent"),
			name: z
				.string()
				.optional()
				.describe(
					"Display name for the agent (defaults to the directory name)",
				),
			id: z
				.string()
				.optional()
				.describe(
					"Unique agent ID (defaults to a slug derived from the name or directory)",
				),
			memoryInProject: z
				.boolean()
				.optional()
				.default(true)
				.describe("Whether to store MEMORY.md inside the project directory"),
		}),
		execute: async ({ projectPath, name, id, memoryInProject = true }) => {
			try {
				const resolvedProjectPath = resolve(projectPath);
				return await registerManagedAgentDirectory(ctx, {
					projectPath: resolvedProjectPath,
					name,
					id,
					memoryPath: memoryInProject
						? join(resolvedProjectPath, "MEMORY.md")
						: undefined,
				});
			} catch (err: any) {
				const message = err.message || String(err);
				if (message.startsWith("PROJECT_PATH_NOT_FOUND:")) {
					return { error: "PROJECT_PATH_NOT_FOUND", message };
				}
				if (message.startsWith("AGENT_ID_EXISTS:")) {
					return { error: "AGENT_ID_EXISTS", message };
				}
				return { error: "AGENT_REGISTER_DIRECTORY_FAILED", message };
			}
		},
	});
}
