/**
 * Source-agnostic Interaction loader.
 *
 * Given a sessionId from any source (claude-code, pi, cursor, habitat, ...),
 * dispatches to the right adapter, fetches the NormalizedSession, and returns
 * a live Interaction ready for the runner.
 *
 * This is the single entry point consumers should use instead of:
 *   - parseSessionFile(fullPath)              // claude-only, file-only
 *   - adapter.getSession(...) + manual wiring // works but reinvented everywhere
 *
 * See reports/2026-05-24-session-types-inventory.md for the full type lineage.
 */

import type { CoreMessage } from "ai";
import type { ModelDetails } from "../../cognition/types.js";
import type { Stimulus } from "../../stimulus/stimulus.js";
import { calculateCost, type TokenUsage } from "../../costs/costs.js";
import { Interaction } from "../core/interaction.js";
import type {
	NormalizedMessage,
	NormalizedSession,
	SessionSource,
} from "../types/normalized-types.js";
import { adapterRegistry } from "./adapter.js";

/**
 * Infer the adapter source from a sessionId prefix.
 *
 * Today's prefix conventions (per each adapter's resolveSessionId):
 *   - "piloc:<projectPath>:<filename>"   → pi (project-local)
 *   - "pi-<encoded-dir>--<filename>"     → pi (global ~/.pi/agent/sessions/)
 *   - "cursor:<workspace>:<composerId>"  → cursor
 *   - "claude-code:<uuid>"               → claude-code (prefixed form)
 *   - bare UUID                          → claude-code (legacy default)
 *
 * Returns null when no prefix matches and the id doesn't look like a bare UUID.
 */
export function detectSourceFromSessionId(
	sessionId: string,
): SessionSource | null {
	if (sessionId.startsWith("piloc:") || sessionId.startsWith("pi-")) {
		return "pi";
	}
	if (sessionId.startsWith("cursor:")) {
		return "cursor";
	}
	if (sessionId.startsWith("claude-code:")) {
		return "claude-code";
	}
	// Bare 8-4-4-4-12 UUID (with or without short prefix) → assume claude-code,
	// since that was the legacy default before adapters were unified.
	if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/i.test(sessionId)) {
		return "claude-code";
	}
	return null;
}

/**
 * Filter NormalizedMessages down to roles the runner accepts without
 * structured-content remapping.
 *
 * `role: "tool"` requires CoreToolMessage which has Array<ToolResultPart>
 * content (not a string). Until we have a proper structured-content
 * converter, drop tool-role messages so the resulting Interaction is at
 * least schema-clean for downstream `interaction.chat()` calls. The
 * conversation history still has user + assistant turns; assistant turns
 * carry tool calls inlined into their text content (via the pi adapter's
 * extractTextContent and the claude normalizer).
 */
function toCleanCoreMessages(
	messages: NormalizedMessage[],
): CoreMessage[] {
	return messages
		.filter((m) => m.role !== "tool")
		.map((m) => ({ role: m.role, content: m.content }) as CoreMessage);
}

/**
 * Load a stored Source Session and project it into a live Interaction.
 *
 * @param sessionId  Source-prefixed session id. Prefix is used to dispatch
 *                   to the correct adapter via adapterRegistry.
 * @param modelDetails  Model the resulting Interaction will run against.
 * @param stimulus  Optional Stimulus. When omitted, an assistant-role
 *                  stimulus is constructed from the session's system content.
 *
 * @returns The Interaction, or null when no adapter recognizes the id or
 *          the session can't be loaded.
 */
export async function loadInteraction(
	sessionId: string,
	modelDetails: ModelDetails,
	stimulus?: Stimulus,
): Promise<Interaction | null> {
	const source = detectSourceFromSessionId(sessionId);
	if (!source) return null;

	const adapter = adapterRegistry.get(source);
	if (!adapter) return null;

	const normalized = await adapter.getSession(sessionId);
	if (!normalized) return null;

	return interactionFromNormalizedSession(
		normalized,
		modelDetails,
		stimulus,
	);
}

/**
 * Recreate an Interaction from a NormalizedSession, dropping schema-invalid
 * tool messages. This is a stricter version of Interaction.fromNormalizedSession
 * that filters before passing messages to the Interaction.
 *
 * Exposed so callers that already have a NormalizedSession in hand (e.g.
 * the digester after a beat-loading pass) can build the same Interaction
 * shape without going back through adapter.getSession.
 */
export function interactionFromNormalizedSession(
	session: NormalizedSession,
	modelDetails: ModelDetails,
	stimulus?: Stimulus,
): Interaction {
	const cleanedSession: NormalizedSession = {
		...session,
		messages: session.messages.filter((m) => m.role !== "tool"),
	};
	const interaction = Interaction.fromNormalizedSession(
		cleanedSession,
		modelDetails,
		stimulus,
	);
	// fromNormalizedSession's CoreMessage cast is { role, content }; we
	// already filtered out tool-role messages above so what lands on
	// interaction.messages is schema-clean for v5's ModelMessage union.
	return interaction;
}

// Re-export for callers that want to drop straight into Interaction.messages
// without going through fromNormalizedSession (rare).
export { toCleanCoreMessages };

/**
 * Per-session metrics derived from a NormalizedSession.
 *
 * Two layers of precedence:
 *   1. session.metrics — what the adapter pre-computed (pi/cursor today).
 *   2. fallback: sum per-message NormalizedMessage.tokens and run through
 *      the canonical costs/calculateCost() module when `modelDetails` is
 *      provided.
 *
 * This is the one path consumers should use; it removes hand-rolled
 * input_tokens + output_tokens + cache sums (claude-only) scattered
 * across habitat tools and web routes.
 */
export interface NormalizedSessionMetrics {
	messageCount: number;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	estimatedCost: number;
	durationMs: number;
}

export function summarizeNormalizedSession(
	session: NormalizedSession,
	modelDetails?: ModelDetails,
): NormalizedSessionMetrics {
	const messages = session.messages;
	let userMessages = 0;
	let assistantMessages = 0;
	let toolCalls = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;

	for (const m of messages) {
		if (m.role === "user") userMessages++;
		else if (m.role === "assistant") assistantMessages++;
		else if (m.role === "tool") toolCalls++;
		if (m.tokens) {
			inputTokens += m.tokens.input ?? 0;
			outputTokens += m.tokens.output ?? 0;
			cacheReadTokens += m.tokens.cacheRead ?? 0;
			cacheWriteTokens += m.tokens.cacheWrite ?? 0;
		}
	}

	const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

	// Prefer the adapter's pre-computed cost when available; otherwise run
	// the canonical costs module on summed per-message tokens.
	let estimatedCost = session.metrics?.estimatedCost ?? 0;
	if (!estimatedCost && modelDetails && (inputTokens > 0 || outputTokens > 0)) {
		const usage: TokenUsage = {
			promptTokens: inputTokens,
			completionTokens: outputTokens,
			total: inputTokens + outputTokens,
		};
		const breakdown = calculateCost(modelDetails, usage);
		estimatedCost = breakdown?.totalCost ?? 0;
	}

	// Duration from message timestamps (when present).
	const firstTs = messages[0]?.timestamp;
	const lastTs = messages[messages.length - 1]?.timestamp;
	const durationMs =
		firstTs && lastTs
			? new Date(lastTs).getTime() - new Date(firstTs).getTime()
			: 0;

	return {
		messageCount: messages.length,
		userMessages,
		assistantMessages,
		toolCalls,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		totalTokens,
		estimatedCost,
		durationMs,
	};
}
