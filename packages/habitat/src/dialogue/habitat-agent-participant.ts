/**
 * Adapt a managed habitat agent into a Dialogue Participant.
 *
 * Default: a dialogue-scoped Interaction built from the agent's stimulus, so
 * group chatter doesn't pollute the agent's persistent `habitat-agent-<id>`
 * memory session. Opt-in `useSharedMemorySession` drives the agent's own
 * persistent Interaction instead (the agent remembers the dialogue — and its
 * session transcript will contain it, alongside the canonical dialogue
 * session, and the group preamble instructions stay on its stimulus).
 *
 * Every turn runs inside `withAgentCall(agentId, ...)` so nested
 * `agent_ask` / `agent_converse` calls made by a participant mid-turn count
 * against the normal recursion depth/cycle guard.
 */

import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import { InteractionParticipant } from "@umwelten/core/dialogue/index.js";
import type { DialogueEvent, TurnContext, TurnResult } from "@umwelten/core/dialogue/index.js";
import { withAgentCall } from "../identity/agent-call-context.js";
import { buildAgentStimulus, type HabitatAgent } from "../habitat-agent.js";
import type { AgentEntry, AgentHost } from "../types.js";

/** AgentHost, optionally with Habitat's sub-agent cache (needed for shared-memory mode). */
export type DialogueAgentHost = AgentHost & {
	getOrCreateHabitatAgent?(agentId: string): Promise<HabitatAgent>;
};

/** Copy a stimulus so dialogue preamble instructions don't leak into the original. */
export function cloneStimulus(base: Stimulus): Stimulus {
	const clone = new Stimulus({
		...base.options,
		instructions: [...(base.options.instructions ?? [])],
	});
	for (const [name, tool] of Object.entries(base.getTools())) {
		clone.addTool(name, tool);
	}
	return clone;
}

class HabitatAgentParticipant extends InteractionParticipant {
	override takeTurn(
		newEvents: DialogueEvent[],
		ctx: TurnContext,
	): Promise<TurnResult> {
		return withAgentCall(this.id, () => super.takeTurn(newEvents, ctx));
	}
}

export interface HabitatAgentParticipantOptions {
	/**
	 * Drive the agent's persistent Interaction (session `habitat-agent-<id>`)
	 * instead of a dialogue-scoped one. The agent remembers the dialogue.
	 */
	useSharedMemorySession?: boolean;
	/**
	 * Model for this participant's dialogue-scoped Interaction (defaults to
	 * the habitat default). Incompatible with `useSharedMemorySession` — the
	 * shared Interaction already has its model.
	 */
	modelDetails?: import("@umwelten/core/cognition/types.js").ModelDetails;
	/**
	 * Bound the participant's private view to its last N messages (own turns
	 * stored as self-narration). See InteractionParticipant.
	 */
	historyWindow?: number;
}

/**
 * Build a dialogue-scoped participant from an already-created HabitatAgent:
 * same persona, tools, and model, but a fresh Interaction so the dialogue
 * doesn't land in the agent's persistent memory session. Used by the
 * `agent_converse` tool, whose context exposes `getOrCreateHabitatAgent`
 * but not the full AgentHost.
 */
export function participantFromHabitatAgent(
	agent: AgentEntry,
	habitatAgent: HabitatAgent,
): InteractionParticipant {
	const base = habitatAgent.getInteraction();
	const interaction = new Interaction(
		base.modelDetails,
		cloneStimulus(base.getStimulus()),
	);
	return new HabitatAgentParticipant({
		id: agent.id,
		displayName: agent.name || agent.id,
		interaction,
	});
}

export async function createHabitatAgentParticipant(
	habitat: DialogueAgentHost,
	agentId: string,
	opts?: HabitatAgentParticipantOptions,
): Promise<InteractionParticipant> {
	const agent = habitat.getAgent(agentId);
	if (!agent) {
		throw new Error(`Agent not found: ${agentId}`);
	}

	let interaction: Interaction;
	if (opts?.useSharedMemorySession) {
		if (opts.modelDetails) {
			throw new Error(
				"modelDetails cannot be combined with useSharedMemorySession — the shared Interaction already has its model",
			);
		}
		if (!habitat.getOrCreateHabitatAgent) {
			throw new Error(
				"useSharedMemorySession requires a host with getOrCreateHabitatAgent",
			);
		}
		const habitatAgent = await habitat.getOrCreateHabitatAgent(agent.id);
		interaction = habitatAgent.getInteraction();
	} else {
		const modelDetails = opts?.modelDetails ?? habitat.getDefaultModelDetails();
		if (!modelDetails) {
			throw new Error(
				`No default model configured for habitat; cannot build participant "${agentId}"`,
			);
		}
		const stimulus = await buildAgentStimulus(agent, habitat);
		interaction = new Interaction(modelDetails, cloneStimulus(stimulus));
	}

	return new HabitatAgentParticipant({
		id: agent.id,
		displayName: agent.name || agent.id,
		interaction,
		...(opts?.historyWindow !== undefined
			? { historyWindow: opts.historyWindow }
			: {}),
	});
}
