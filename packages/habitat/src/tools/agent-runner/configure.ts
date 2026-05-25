/**
 * `agent_configure` — inspect a managed agent's repo, infer its run
 * contract (purpose / commands / env vars / auth requirements / log
 * patterns), and persist the result into the agent's config and
 * MEMORY.md.
 *
 * Also exports `configureManagedAgent` (used by `cli/habitat.ts` for
 * the `umwelten habitat local` / `here` subcommands).
 */

import { writeFile } from "node:fs/promises";
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { AgentEntry, LogPattern } from "../../types.js";
import { getAgentMemoryPath } from "../../agent-paths.js";
import type { AgentRunnerToolsContext } from "./context.js";
import {
	type AgentConfigureContract,
	analyzeAgentConfiguration,
	buildAgentConfigureStimulus,
} from "./configure-contract.js";
import {
	collectAgentSecretRefs,
	renderAgentMemory,
} from "./memory-rendering.js";

export async function configureManagedAgent(
	ctx: AgentRunnerToolsContext,
	agentId: string,
	options?: { saveMemory?: boolean },
): Promise<{
	agentId: string;
	configured: true;
	contract: AgentConfigureContract;
	updated: {
		commands: AgentEntry["commands"];
		secrets: string[];
		logPatterns: LogPattern[];
	};
	memoryPath?: string;
	message: string;
}> {
	const agent = ctx.getAgent(agentId);
	if (!agent) {
		throw new Error(`AGENT_NOT_FOUND: ${agentId}`);
	}

	const saveMemory = options?.saveMemory ?? true;
	const habitatAgent = await ctx.getOrCreateHabitatAgent(agent.id);
	const baseInteraction = habitatAgent.getInteraction();
	const interaction = new Interaction(
		baseInteraction.modelDetails,
		buildAgentConfigureStimulus(baseInteraction.getStimulus()),
	);
	interaction.setTools({});

	const contract = await analyzeAgentConfiguration(interaction);

	const commands = { ...(agent.commands ?? {}) };
	if (contract.setupCommand) commands.setup = contract.setupCommand;
	if (contract.runCommand) commands.run = contract.runCommand;

	const secrets = collectAgentSecretRefs(agent, contract);

	await ctx.updateAgent(agent.id, {
		commands: Object.keys(commands).length > 0 ? commands : undefined,
		secrets: secrets.length > 0 ? secrets : undefined,
		logPatterns:
			contract.logPatterns.length > 0
				? contract.logPatterns
				: agent.logPatterns,
	});

	let memoryPath: string | undefined;
	if (saveMemory) {
		await ctx.ensureAgentDir(agent.id);
		memoryPath = getAgentMemoryPath(agent, ctx.getAgentDir.bind(ctx));
		await writeFile(memoryPath, renderAgentMemory(agent, contract), "utf-8");
	}

	return {
		agentId: agent.id,
		configured: true,
		contract,
		updated: {
			commands: Object.keys(commands).length > 0 ? commands : undefined,
			secrets,
			logPatterns: contract.logPatterns,
		},
		memoryPath,
		message:
			`Configured agent ${agent.id}. ` +
			`Saved run contract${memoryPath ? ` to ${memoryPath}` : ""}.`,
	};
}

export function createAgentConfigureTool(
	ctx: AgentRunnerToolsContext,
): Tool {
	return tool({
		description:
			"Inspect a managed agent repo, infer its run contract, and persist the result into agent config and MEMORY.md.",
		inputSchema: z.object({
			agentId: z.string().describe("Agent ID or name"),
			saveMemory: z
				.boolean()
				.optional()
				.default(true)
				.describe(
					"Whether to write the configure result to the agent's configured MEMORY.md path",
				),
		}),
		execute: async ({ agentId, saveMemory = true }) => {
			const agent = ctx.getAgent(agentId);
			if (!agent) {
				return {
					error: "AGENT_NOT_FOUND",
					message: `No agent found: ${agentId}`,
				};
			}

			try {
				return await configureManagedAgent(ctx, agent.id, { saveMemory });
			} catch (err: any) {
				const message = err.message || String(err);
				if (message.startsWith("AGENT_NOT_FOUND:")) {
					return {
						error: "AGENT_NOT_FOUND",
						message: `No agent found: ${agentId}`,
					};
				}
				return { error: "AGENT_CONFIGURE_FAILED", message };
			}
		},
	});
}
