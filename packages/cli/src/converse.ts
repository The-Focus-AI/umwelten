/**
 * `umwelten converse` — run a Dialogue between two or more agents/personas.
 *
 * Participants come from a habitat (`--agent <id>`, needs `--work-dir` or the
 * default habitat) and/or ad-hoc personas (`--persona "Name=system prompt"`,
 * optionally `"Name:provider/model=prompt"`). Turns stream live with
 * per-speaker colors; the dialogue persists as a `dialogue` session. Habitat
 * dialogues land in the habitat's sessions dir (visible in `umwelten
 * browse`); persona-only dialogues land in `~/.umwelten/dialogues/<id>` —
 * read those with `sessions messages --session-dir <path>`.
 *
 * Examples:
 *   umwelten converse "Are microservices overrated?" \
 *     --persona "Advocate=You argue passionately in favor." \
 *     --persona "Skeptic=You argue against, with evidence." \
 *     -p google -m gemini-3-flash-preview
 *
 *   umwelten converse "How should we split this repo?" \
 *     --agent architect --agent reviewer --work-dir ~/my-habitat --moderator
 */

import { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import {
	Dialogue,
	InteractionParticipant,
	ModeratorPolicy,
	MODERATOR_INSTRUCTIONS,
} from "@umwelten/core/dialogue/index.js";
import type {
	DialogueObserver,
	Participant,
	TurnPolicy,
} from "@umwelten/core/dialogue/index.js";
import { speakerPalette } from "@umwelten/ui";

export interface PersonaSpec {
	name: string;
	provider?: string;
	model?: string;
	prompt: string;
}

/**
 * Parse `"Name=system prompt"` or `"Name:provider/model=system prompt"`.
 * Exported for tests.
 */
export function parsePersonaSpec(spec: string): PersonaSpec {
	const eq = spec.indexOf("=");
	if (eq <= 0 || eq === spec.length - 1) {
		throw new Error(
			`Invalid persona spec "${spec}". Expected "Name=prompt" or "Name:provider/model=prompt".`,
		);
	}
	const head = spec.slice(0, eq).trim();
	const prompt = spec.slice(eq + 1).trim();
	const colon = head.indexOf(":");
	if (colon === -1) {
		return { name: head, prompt };
	}
	const name = head.slice(0, colon).trim();
	const modelRef = head.slice(colon + 1).trim();
	const slash = modelRef.indexOf("/");
	if (!name || slash <= 0 || slash === modelRef.length - 1) {
		throw new Error(
			`Invalid persona spec "${spec}". Model must be "provider/model" (e.g. "google/gemini-3-flash-preview").`,
		);
	}
	return {
		name,
		provider: modelRef.slice(0, slash),
		model: modelRef.slice(slash + 1),
		prompt,
	};
}

export interface AgentSpec {
	id: string;
	modelDetails?: ModelDetails;
}

/**
 * Parse `"agentId"` or `"agentId:provider/model"` (per-agent model override,
 * mirroring the persona syntax). Exported for tests.
 */
export function parseAgentSpec(spec: string): AgentSpec {
	const colon = spec.indexOf(":");
	if (colon === -1) {
		return { id: spec.trim() };
	}
	const id = spec.slice(0, colon).trim();
	if (!id) {
		throw new Error(
			`Invalid agent spec "${spec}". Expected "agentId" or "agentId:provider/model".`,
		);
	}
	return { id, modelDetails: parseModelRef(spec.slice(colon + 1).trim()) };
}

/** Parse `"provider/model"`. Exported for tests. */
export function parseModelRef(ref: string): ModelDetails {
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1) {
		throw new Error(`Invalid model reference "${ref}". Expected "provider/model".`);
	}
	return { provider: ref.slice(0, slash), name: ref.slice(slash + 1) };
}

/** Stable speaker → chalk color assignment by join order. Exported for tests. */
export function speakerColor(index: number): (text: string) => string {
	const name = speakerPalette[index % speakerPalette.length];
	const fn = (chalk as unknown as Record<string, (t: string) => string>)[name];
	return typeof fn === "function" ? fn : (t) => t;
}

function collect(value: string, previous: string[]): string[] {
	return [...previous, value];
}

interface ConverseOptions {
	agent: string[];
	persona: string[];
	workDir?: string;
	provider?: string;
	model?: string;
	maxTurns: string;
	historyWindow?: string;
	moderator?: boolean;
	moderatorModel?: string;
	json?: boolean;
	save: boolean;
	sessionId?: string;
}

export const converseCommand = new Command("converse")
	.description("Run a dialogue between two or more agents/personas")
	.argument("<topic...>", "Opening prompt that starts the dialogue")
	.option(
		"-a, --agent <spec>",
		'Habitat agent id, optionally "id:provider/model" (repeatable)',
		collect,
		[],
	)
	.option(
		"--persona <spec>",
		'Ad-hoc persona: "Name=prompt" or "Name:provider/model=prompt" (repeatable)',
		collect,
		[],
	)
	.option("--work-dir <path>", "Habitat work directory (for --agent participants)")
	.option("-p, --provider <provider>", "Default provider for personas/moderator")
	.option("-m, --model <model>", "Default model for personas/moderator")
	.option("--max-turns <n>", "Stop after N total turns", "8")
	.option(
		"--history-window <n>",
		"Bound each participant's private view to its last N messages (own turns become one-line self-narrations) — keeps long dialogues cheap",
	)
	.option(
		"--moderator",
		"Let a moderator model pick the next speaker and end the dialogue",
	)
	.option("--moderator-model <provider/model>", "Model for the moderator")
	.option("--json", "Print the final transcript as JSON instead of live text")
	.option("--no-save", "Do not persist the dialogue as a session")
	.option("--session-id <id>", "Name the dialogue session")
	.action(async (topicParts: string[], options: ConverseOptions) => {
		try {
			await runConverse(topicParts.join(" "), options);
		} catch (err) {
			console.error(
				chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
			);
			process.exitCode = 1;
		}
	});

async function runConverse(topic: string, options: ConverseOptions): Promise<void> {
	const defaultModel: ModelDetails | undefined =
		options.provider && options.model
			? { provider: options.provider, name: options.model }
			: undefined;

	let historyWindow: number | undefined;
	if (options.historyWindow !== undefined) {
		historyWindow = Number.parseInt(options.historyWindow, 10);
		if (!Number.isFinite(historyWindow) || historyWindow < 2) {
			throw new Error(
				`Invalid --history-window "${options.historyWindow}" — expected an integer >= 2.`,
			);
		}
	}

	// ── Load habitat when agents are requested ─────────────────────────
	let habitat: import("@umwelten/habitat").Habitat | undefined;
	if (options.agent.length > 0) {
		const { Habitat } = await import("@umwelten/habitat");
		habitat = await Habitat.create({
			workDir: options.workDir,
			envPrefix: "HABITAT",
			defaultWorkDirName: "habitats",
		});
	}

	// ── Build participants ─────────────────────────────────────────────
	const participants: Participant[] = [];
	for (const agentSpec of options.agent) {
		const { id, modelDetails } = parseAgentSpec(agentSpec);
		const { createHabitatAgentParticipant } = await import(
			"@umwelten/habitat/dialogue/habitat-agent-participant.js"
		);
		if (!habitat!.getAgent(id)) {
			const available = habitat!
				.getAgents()
				.map((a) => a.id)
				.join(", ");
			throw new Error(
				`No agent found: ${id}. Available: ${available || "(none)"}`,
			);
		}
		participants.push(
			await createHabitatAgentParticipant(habitat!, id, {
				...(modelDetails ? { modelDetails } : {}),
				...(historyWindow !== undefined ? { historyWindow } : {}),
			}),
		);
	}
	for (const spec of options.persona) {
		const persona = parsePersonaSpec(spec);
		const model: ModelDetails | undefined =
			persona.provider && persona.model
				? { provider: persona.provider, name: persona.model }
				: (defaultModel ?? habitat?.getDefaultModelDetails());
		if (!model) {
			throw new Error(
				`No model for persona "${persona.name}". Set -p/-m or use "Name:provider/model=prompt".`,
			);
		}
		const stimulus = new Stimulus({
			role: persona.name,
			instructions: [persona.prompt],
		});
		participants.push(
			new InteractionParticipant({
				id: persona.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
				displayName: persona.name,
				interaction: new Interaction(model, stimulus),
				...(historyWindow !== undefined ? { historyWindow } : {}),
			}),
		);
	}

	if (participants.length < 2) {
		throw new Error(
			"A dialogue needs at least 2 participants — combine --agent and/or --persona flags.",
		);
	}

	// ── Moderator ──────────────────────────────────────────────────────
	let policy: TurnPolicy | undefined;
	if (options.moderator) {
		const moderatorModel = options.moderatorModel
			? parseModelRef(options.moderatorModel)
			: (defaultModel ?? habitat?.getDefaultModelDetails());
		if (!moderatorModel) {
			throw new Error(
				"No model for the moderator. Set --moderator-model, -p/-m, or a habitat default.",
			);
		}
		const stimulus = new Stimulus({
			role: "conversation moderator",
			instructions: [...MODERATOR_INSTRUCTIONS],
		});
		policy = new ModeratorPolicy(new Interaction(moderatorModel, stimulus));
	}

	// ── Persistence ────────────────────────────────────────────────────
	const sessionId = options.sessionId ?? `dialogue-${Date.now()}`;
	let persistDir: string | undefined;
	if (options.save) {
		if (habitat) {
			const session = await habitat.getOrCreateSession("dialogue", sessionId);
			persistDir = session.sessionDir;
		} else {
			persistDir = join(homedir(), ".umwelten", "dialogues", sessionId);
		}
	}

	// ── Live rendering ─────────────────────────────────────────────────
	const colorByParticipant = new Map(
		participants.map((p, i) => [p.id, speakerColor(i)]),
	);
	const observer: DialogueObserver | undefined = options.json
		? undefined
		: {
				onTurnStart: ({ participantId, displayName }) => {
					const color = colorByParticipant.get(participantId) ?? ((t: string) => t);
					process.stdout.write(`\n${chalk.bold(color(`[${displayName}]`))}\n`);
				},
				onTextDelta: (_participantId, delta) => {
					process.stdout.write(delta);
				},
				onToolCall: (_participantId, toolName) => {
					process.stdout.write(chalk.dim(`\n(tool: ${toolName})\n`));
				},
				onTurnEnd: () => {
					process.stdout.write("\n");
				},
				onStop: (reason) => {
					process.stdout.write(chalk.dim(`\n— dialogue ended: ${reason} —\n`));
				},
			};

	const maxTurns = Number.parseInt(options.maxTurns, 10);
	if (!Number.isFinite(maxTurns) || maxTurns < 1) {
		throw new Error(`Invalid --max-turns "${options.maxTurns}".`);
	}

	if (!options.json) {
		const names = participants.map((p) => p.displayName).join(", ");
		console.log(chalk.dim(`Dialogue: ${names} — "${topic}"`));
	}

	const dialogue = new Dialogue({
		id: sessionId,
		participants,
		...(policy ? { policy } : {}),
		seed: { content: topic },
		stop: { maxTurns },
		...(observer ? { observer } : {}),
		...(persistDir ? { persistDir } : {}),
	});

	const result = await dialogue.run();

	if (options.json) {
		console.log(
			JSON.stringify(
				{
					sessionId: result.id,
					participants: dialogue.roster,
					stoppedBy: result.stoppedBy,
					turns: result.turns,
					transcript: result.events
						.filter((e) => e.content.trim())
						.map((e) => ({
							speaker: e.displayName,
							kind: e.kind,
							text: e.content,
							timestamp: e.timestamp,
						})),
				},
				null,
				2,
			),
		);
	} else if (persistDir) {
		console.log(
			chalk.dim(`Dialogue saved: ${sessionId} (${result.turns} turns) → ${persistDir}`),
		);
	}
}
