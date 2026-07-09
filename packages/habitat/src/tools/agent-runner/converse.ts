/**
 * `agent_converse` — run a multi-turn Dialogue between managed agents.
 *
 * Guard rails: every participant is checked against the agent-call chain up
 * front (the cycle check inherently rejects the calling agent joining its
 * own dialogue), and each participant's turns run inside `withAgentCall`
 * (see HabitatAgentParticipant) so nested `agent_ask` / `agent_converse`
 * calls count against the normal depth limit. `maxTurns` is capped tighter
 * than the CLI since agent-initiated dialogues burn tokens invisibly.
 */

import { join } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import { Dialogue } from "@umwelten/core/dialogue/index.js";
import type { Participant } from "@umwelten/core/dialogue/index.js";
import { checkAgentCall } from "../../identity/agent-call-context.js";
import { participantFromHabitatAgent } from "../../dialogue/habitat-agent-participant.js";
import type { HabitatAgent } from "../../habitat-agent.js";
import type { AgentEntry } from "../../types.js";
import type { AgentRunnerToolsContext } from "./context.js";

/** Turns returned to the calling agent — full transcript stays in the session. */
const MAX_RETURN_TURNS = 12;
/** Per-turn text cap in the returned transcript. */
const MAX_TURN_CHARS = 1500;

export function createAgentConverseTool(
	ctx: AgentRunnerToolsContext,
	/** Test seam: replace the participant factory with scripted participants. */
	deps: {
		buildParticipant?: (
			agent: AgentEntry,
			habitatAgent: HabitatAgent,
		) => Participant;
	} = {},
): Tool {
	const buildParticipant = deps.buildParticipant ?? participantFromHabitatAgent;
	return tool({
		description:
			"Run a multi-turn dialogue between two or more managed agents on a topic. " +
			"Each agent takes labeled turns; the full transcript is persisted as a " +
			"dialogue session (inspect it with the sessions tools via the returned sessionId).",
		inputSchema: z.object({
			agentIds: z
				.array(z.string())
				.min(2)
				.max(4)
				.describe("Agent ids or names that will participate (2-4, no duplicates)"),
			topic: z.string().describe("Opening prompt that starts the dialogue"),
			maxTurns: z
				.number()
				.int()
				.min(2)
				.max(16)
				.optional()
				.describe("Total turns before the dialogue stops (default 8)"),
		}),
		execute: async ({ agentIds, topic, maxTurns }) => {
			const entries: AgentEntry[] = [];
			for (const id of agentIds) {
				const agent = ctx.getAgent(id);
				if (!agent) {
					return {
						error: "AGENT_NOT_FOUND",
						message: `No agent found: ${id}. Available: ${ctx
							.getAgents()
							.map((a) => a.id)
							.join(", ")}`,
					};
				}
				entries.push(agent);
			}
			if (new Set(entries.map((a) => a.id)).size !== entries.length) {
				return {
					error: "DUPLICATE_PARTICIPANTS",
					message: "Each agent can join the dialogue only once",
				};
			}

			// Recursion guard for every participant — a caller mid-agent_ask cannot
			// pull itself into a dialogue (cycle), nor exceed the chain depth.
			for (const agent of entries) {
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
			}

			try {
				const participants: Participant[] = [];
				for (const agent of entries) {
					const habitatAgent = await ctx.getOrCreateHabitatAgent(agent.id);
					participants.push(buildParticipant(agent, habitatAgent));
				}

				let sessionId = `dialogue-${Date.now()}`;
				let persistDir: string;
				if (ctx.getOrCreateSession) {
					const session = await ctx.getOrCreateSession("dialogue", sessionId);
					sessionId = session.sessionId;
					persistDir = session.sessionDir;
				} else {
					persistDir = join(ctx.getWorkDir(), "sessions", sessionId);
				}

				const dialogue = new Dialogue({
					id: sessionId,
					participants,
					seed: { content: topic },
					stop: { maxTurns: Math.min(maxTurns ?? 8, 16) },
					persistDir,
				});

				let runError: string | undefined;
				try {
					await dialogue.run();
				} catch (err) {
					// Partial dialogue — the session is already persisted; report what we have.
					runError = err instanceof Error ? err.message : String(err);
				}

				const messages = dialogue.events.filter(
					(e) => e.kind === "message" && e.content.trim(),
				);
				const tail = messages.slice(-MAX_RETURN_TURNS);
				const transcript = tail.map((e) => ({
					speaker: e.displayName,
					text:
						e.content.length > MAX_TURN_CHARS
							? `${e.content.slice(0, MAX_TURN_CHARS)}…`
							: e.content,
				}));
				const truncated =
					messages.length > tail.length ||
					tail.some((e) => e.content.length > MAX_TURN_CHARS);

				return {
					sessionId,
					participants: entries.map((a) => a.id),
					turnCount: messages.length,
					transcript,
					truncated,
					...(runError
						? { error: "AGENT_CONVERSE_FAILED", message: runError }
						: {}),
				};
			} catch (err: any) {
				return {
					error: "AGENT_CONVERSE_FAILED",
					message: err.message || String(err),
				};
			}
		},
	});
}
