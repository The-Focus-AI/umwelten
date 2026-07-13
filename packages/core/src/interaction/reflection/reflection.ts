/**
 * Reflective Interaction construction for Explorations.
 *
 * Builds model-facing Interactions that ask questions about one or more
 * Explorations using the existing Interaction and ModelRunner execution
 * path — no new runner abstraction is introduced.
 *
 * See CONTEXT.md: "Reflection is not a new runner. Reflection is an
 * Interaction constructed to ask questions about other Interactions or
 * Explorations and executed with the existing model runner."
 */
import type { ModelMessage } from "ai";
import { Stimulus } from "../../stimulus/stimulus.js";
import { Interaction } from "../core/interaction.js";
import type { Exploration } from "../types/domain-types.js";
import type { ModelDetails } from "../../cognition/types.js";

// ── Constants ───────────────────────────────────────────────────────────

const DEFAULT_REFLECTION_ROLE = "reflective analyst";
const DEFAULT_REFLECTION_OBJECTIVE =
	"Answer questions about past coding sessions and extracted knowledge.";

const DEFAULT_REFLECTION_INSTRUCTIONS: string[] = [
	"You are reviewing a set of AI coding sessions grouped as an Exploration.",
	"Answer the user's question based on the session context provided below.",
	"Be specific and reference session content where possible.",
	"If you cannot answer from the provided context, say so clearly.",
	"Keep answers concise and actionable.",
];

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Options for building a reflective Interaction.
 */
export interface BuildReflectionOptions {
	/** Override the model details (required). */
	model: ModelDetails;
	/** Optional instructions prepended to the default reflection instructions. */
	customInstructions?: string[];
	/** Optional system context prepended before the exploration data. */
	systemContext?: string;
}

/**
 * Build a complete reflective Interaction for asking a question about
 * one or more Explorations.
 *
 * The Interaction is pre-populated with context messages describing
 * the Exploration(s) and their Source Sessions. The caller then calls
 * interaction.chat(userQuestion) or interaction.generateText() to
 * execute the reflection.
 *
 * No new runner is introduced — uses the existing Interaction class
 * and ModelRunner execution path.
 */
export function buildReflectiveInteraction(
	explorations: Exploration[],
	question: string,
	options: BuildReflectionOptions,
): Interaction {
	const { model, customInstructions, systemContext } = options;

	// 1. Build context messages from the explorations
	const contextMessages = buildReflectionContext(explorations, {
		systemContext,
	});

	// 2. Create the stimulus
	const stimulus = new Stimulus({
		role: DEFAULT_REFLECTION_ROLE,
		objective: DEFAULT_REFLECTION_OBJECTIVE,
		instructions: [
			...(customInstructions ?? []),
			...DEFAULT_REFLECTION_INSTRUCTIONS,
		],
	});

	// 3. Create the interaction
	const interaction = new Interaction(model, stimulus, {
		source: "native",
		sourceId: `reflection-${Date.now()}`,
	});

	// 4. Pre-populate with context messages (after the system prompt)
	for (const msg of contextMessages) {
		interaction.messages.push(msg);
	}

	// 5. Add the user's question
	interaction.messages.push({
		role: "user",
		content: question,
	});

	return interaction;
}

/**
 * Options for building the reflection context (messages only, no Interaction).
 */
export interface BuildContextOptions {
	/** Optional system context prepended before the exploration data. */
	systemContext?: string;
}

/**
 * Build context messages describing one or more Explorations.
 *
 * Returns ModelMessage[] that can be injected into any Interaction's
 * message list. Deterministic and testable — no LLM calls involved.
 */
export function buildReflectionContext(
	explorations: Exploration[],
	options?: BuildContextOptions,
): ModelMessage[] {
	const messages: ModelMessage[] = [];

	// System-level context
	if (options?.systemContext) {
		messages.push({ role: "system", content: options.systemContext });
	}

	// Exploration overview
	const overview = buildExplorationOverview(explorations);
	messages.push({
		role: "system",
		content: overview,
	});

	// Per-Exploration detail
	for (const exp of explorations) {
		const detail = buildExplorationDetail(exp);
		messages.push({
			role: "system",
			content: detail,
		});
	}

	return messages;
}

/**
 * Build a summary of an Exploration's metadata and members.
 * Deterministic — no LLM calls.
 */
export function buildExplorationDetail(exploration: Exploration): string {
	const lines: string[] = [];
	lines.push(`--- Exploration: ${exploration.name} ---`);
	lines.push(`ID: ${exploration.id}`);
	lines.push(`Kind: ${exploration.kind}`);
	lines.push(`Members: ${exploration.memberCount}`);
	lines.push(`Created: ${exploration.created}`);
	lines.push(`Modified: ${exploration.modified}`);

	if (exploration.kind === "virtual" && exploration.searchQuery) {
		lines.push(`Search query: "${exploration.searchQuery}"`);
	}

	lines.push("");
	lines.push("Source Sessions:");

	for (const member of exploration.members) {
		lines.push(`  - Source: ${member.source}`);
		lines.push(`    Session ID: ${member.sourceSessionId}`);
		if (member.label) {
			lines.push(`    Label: ${member.label}`);
		}
	}

	return lines.join("\n");
}

// ── Helpers ─────────────────────────────────────────────────────────────

function buildExplorationOverview(explorations: Exploration[]): string {
	const totalMembers = explorations.reduce((s, e) => s + e.memberCount, 0);
	const sourceTypes = new Set(
		explorations.flatMap((e) => e.members.map((m) => m.source)),
	);

	const lines: string[] = [
		"You are reviewing the following Exploration(s) of AI coding sessions.",
		"",
		`Total Explorations: ${explorations.length}`,
		`Total Source Sessions: ${totalMembers}`,
		`Source types: ${[...sourceTypes].join(", ")}`,
		"",
		"Each Exploration below includes its name, members, and metadata.",
		"Answer the question using the context provided.",
	];

	return lines.join("\n");
}
