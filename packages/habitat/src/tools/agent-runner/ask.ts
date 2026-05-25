/**
 * `agent_ask` — send a message to a managed agent sub-agent.
 *
 * Wraps `HabitatAgent.ask()`. Recursion guard via
 * `checkAgentCall` / `withAgentCall` from `identity/agent-call-context.ts`
 * to prevent runaway agent-of-agent chains.
 */

import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import { checkAgentCall, withAgentCall } from "../../identity/agent-call-context.js";
import type { AgentRunnerToolsContext } from "./context.js";

export function createAgentAskTool(ctx: AgentRunnerToolsContext): Tool {
	return tool({
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

			// Recursion guard: refuse if the call would exceed max depth or form a cycle.
			const check = checkAgentCall(agent.id);
			if (!check.ok) {
				return {
					error:
						check.reason === "CYCLE"
							? "AGENT_CALL_CYCLE"
							: "AGENT_CALL_DEPTH_EXCEEDED",
					message: check.message,
					chain: check.chain,
				};
			}

			try {
				const habitatAgent = await ctx.getOrCreateHabitatAgent(agentId);
				const response = await withAgentCall(agent.id, () =>
					habitatAgent.ask(message),
				);
				return {
					agentId: agent.id,
					response,
					callChain: [...check.chain, agent.id],
				};
			} catch (err: any) {
				return {
					error: "AGENT_ASK_FAILED",
					message: err.message || String(err),
				};
			}
		},
	});
}
