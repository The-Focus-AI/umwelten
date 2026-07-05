/**
 * `agent_ask_claude` — delegate a task to the Claude Code SDK running
 * against the agent's project directory. Spawns a Claude Code
 * subprocess with full agentic tools (Read, Edit, Bash, Grep, etc.).
 * Requires ANTHROPIC_API_KEY or a Claude CLI login token.
 */

import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import {
	claudeNativeSessionPath,
	runClaudeSDK,
} from "../../claude-sdk-runner.js";
import type { AgentRunnerToolsContext } from "./context.js";

export function createAgentAskClaudeTool(
	ctx: AgentRunnerToolsContext,
): Tool {
	return tool({
		description:
			"Delegate an agentic coding task to Claude Code SDK. Spawns a Claude Code subprocess with full tools (Read, Edit, Bash, Grep, Glob) against the agent's project directory. Use for tasks that need file editing, code generation, debugging, or running commands. Requires ANTHROPIC_API_KEY.",
		inputSchema: z.object({
			agentId: z.string().describe("Agent ID or name"),
			message: z
				.string()
				.describe(
					"Task or question for Claude Code (e.g. 'fix the failing tests', 'add error handling to server.ts')",
				),
			model: z
				.string()
				.optional()
				.describe(
					"Claude model to use (default: claude-sonnet-5). Options: claude-fable-5, claude-sonnet-5, claude-opus-4-8, claude-haiku-4-5-20251001",
				),
			maxTurns: z
				.number()
				.optional()
				.describe("Max agentic turns before stopping (default: 20)"),
			allowedTools: z
				.array(z.string())
				.optional()
				.describe(
					"Restrict to specific tools (default: all). E.g. ['Read', 'Grep', 'Glob'] for read-only",
				),
		}),
		execute: async ({
			agentId,
			message,
			model,
			maxTurns,
			allowedTools,
		}) => {
			const agent = ctx.getAgent(agentId);
			if (!agent)
				return {
					error: "AGENT_NOT_FOUND",
					message: `No agent found: ${agentId}`,
				};

			// API key is optional — the SDK also supports Claude CLI OAuth login token.
			// If neither is available, the subprocess will fail with an auth error.
			const apiKey = process.env.ANTHROPIC_API_KEY;

			try {
				const result = await runClaudeSDK(message, {
					cwd: agent.projectPath,
					apiKey, // undefined is fine — SDK falls back to CLI login token
					model: model ?? "claude-sonnet-5",
					maxTurns: maxTurns ?? 20,
					allowedTools,
					systemPrompt: agent.memoryPath ? undefined : undefined,
				});

				return {
					agentId: agent.id,
					success: result.success,
					response: result.content,
					numTurns: result.numTurns,
					durationMs: result.durationMs,
					errors: result.errors.length > 0 ? result.errors : undefined,
					// Same linkage as channel-bound claude-sdk runs (#118): the
					// full tool-call trace is reachable from the calling session.
					nativeSessionRef: result.sessionId
						? {
								runtime: "claude-sdk",
								nativeSessionId: result.sessionId,
								nativeSessionPath: claudeNativeSessionPath(
									agent.projectPath,
									result.sessionId,
								),
							}
						: undefined,
				};
			} catch (err: any) {
				return {
					error: "CLAUDE_SDK_FAILED",
					message: err.message || String(err),
				};
			}
		},
	});
}
