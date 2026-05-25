/**
 * Schema and parsing helpers for the `agent_configure` run-contract.
 *
 * `agentConfigureSchema` is the Zod shape an LLM produces when asked to
 * analyze a project: purpose, summary, entrypoints, commands, env vars,
 * auth requirements, etc. The helpers in this file run that analysis
 * (LLM call), with one retry on parse failure and one further "repair"
 * round-trip that asks the LLM to reformat its own output as valid JSON.
 */

import { z } from "zod";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";

const configureEnvVarSchema = z.object({
	name: z.string(),
	reason: z.string(),
	required: z.boolean(),
});

const configureCliToolSchema = z.object({
	name: z.string(),
	reason: z.string(),
	required: z.boolean(),
});

const configureAuthRequirementSchema = z.object({
	system: z.string(),
	reason: z.string(),
	required: z.boolean(),
	secretRefs: z.array(z.string()).default([]),
	cliTools: z.array(z.string()).default([]),
	notes: z.array(z.string()).default([]),
});

const configureHostIntegrationSchema = z.object({
	name: z.string(),
	reason: z.string(),
	path: z.string().nullable().optional(),
	required: z.boolean(),
});

export const agentConfigureSchema = z.object({
	purpose: z.string().describe("Concise description of what the project does"),
	summary: z
		.string()
		.describe("Short operational summary of how the project is run"),
	entrypoints: z
		.array(z.string())
		.describe(
			"Actual runnable entrypoints that define the execution path",
		),
	setupCommand: z
		.string()
		.nullable()
		.describe("Primary setup command, or null if not needed"),
	runCommand: z
		.string()
		.nullable()
		.describe("Primary run command, or null if not identified"),
	requiredEnvVars: z.array(configureEnvVarSchema).default([]),
	requiredCliTools: z.array(configureCliToolSchema).default([]),
	authRequirements: z.array(configureAuthRequirementSchema).default([]),
	hostIntegrations: z.array(configureHostIntegrationSchema).default([]),
	logPatterns: z
		.array(
			z.object({
				pattern: z.string(),
				format: z.enum(["jsonl", "plain"]),
			}),
		)
		.default([]),
	recommendedRuntime: z.enum(["host", "container"]),
	notes: z.array(z.string()).default([]),
});

export type AgentConfigureContract = z.infer<typeof agentConfigureSchema>;

export function buildAgentConfigureStimulus(baseStimulus: Stimulus): Stimulus {
	return new Stimulus({
		role: "repository configuration analyst",
		objective:
			"extract a run contract from the provided repository context",
		instructions: [
			"You are analyzing repository context that has already been collected for you.",
			"Do not ask to inspect files, do not emit tool calls, and do not describe next steps.",
			"Reason only over the provided system context and return the requested contract.",
			"If something is uncertain, make the narrowest defensible inference and record it in notes.",
		],
		systemContext: baseStimulus.options.systemContext,
		maxToolSteps: 0,
		temperature: 0,
	});
}

export async function analyzeAgentConfiguration(
	interaction: Interaction,
): Promise<AgentConfigureContract> {
	const prompt = buildAgentConfigurePrompt();
	const modelDetails = { ...interaction.modelDetails, temperature: 0 };
	const attempts = [
		prompt,
		[
			prompt,
			"",
			"Your previous response was not valid JSON.",
			"Return a single valid JSON object only. Do not add commentary, markdown fences, or trailing text.",
		].join("\n"),
	];

	let lastRawText = "";

	for (const attemptPrompt of attempts) {
		const attemptInteraction = new Interaction(
			modelDetails,
			interaction.getStimulus(),
		);
		attemptInteraction.setTools({});
		attemptInteraction.addMessage({
			role: "user",
			content: attemptPrompt,
		});

		const response = await attemptInteraction.generateText();
		lastRawText = response.content;
		const direct = tryParseAgentConfigureContract(lastRawText);
		if (direct) return direct;

		const repaired = await parseAgentConfigureContract(
			lastRawText,
			modelDetails,
			interaction.getStimulus(),
		).catch(() => null);
		if (repaired) return repaired;
	}

	throw new Error(
		`Could not parse configure analysis into a valid run contract. Raw response:\n${lastRawText}`,
	);
}

function buildAgentConfigurePrompt(): string {
	return [
		"Inspect this repository and produce a structured run contract.",
		"",
		"You must inspect the actual runnable entrypoints first (for example run.sh, setup.sh, start.sh, Makefile targets, Dockerfile, and bin/* scripts), follow the scripts they invoke, and determine how this project really runs.",
		"",
		"Ignore incidental mentions in reports/, notes, or research documents unless they are part of the runnable path.",
		"",
		"Return ONLY a single JSON object. Do not wrap it in markdown fences or explanatory text.",
		"",
		"Use this exact shape:",
		"{",
		'  "purpose": "string",',
		'  "summary": "string",',
		'  "entrypoints": ["string"],',
		'  "setupCommand": "string or null",',
		'  "runCommand": "string or null",',
		'  "requiredEnvVars": [{"name": "ENV_VAR", "reason": "string", "required": true}],',
		'  "requiredCliTools": [{"name": "tool", "reason": "string", "required": true}],',
		'  "authRequirements": [{"system": "service", "reason": "string", "required": true, "secretRefs": ["ENV_VAR"], "cliTools": ["tool"], "notes": ["string"]}],',
		'  "hostIntegrations": [{"name": "integration", "reason": "string", "path": "string or null", "required": true}],',
		'  "logPatterns": [{"pattern": "logs/*.log", "format": "plain"}],',
		'  "recommendedRuntime": "host",',
		'  "notes": ["string"]',
		"}",
		"",
		"Rules:",
		"- Include auth requirements implied by the run path, not just explicit env vars.",
		"- If scripts call claude, include a Claude auth requirement with likely secret refs such as ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN unless the repo clearly depends on a pre-authenticated host session.",
		"- If the run path performs git push, include a git/GitHub auth requirement with likely secret refs such as GITHUB_TOKEN, and note if host SSH or a git credential helper could satisfy it instead.",
		"- secretRefs must be env-var style names only.",
		"- Use empty arrays instead of omitting fields.",
		"- recommendedRuntime should be host when the repo relies on host paths, host auth, desktop tooling, or host-specific state.",
	].join("\n");
}

async function parseAgentConfigureContract(
	rawText: string,
	modelDetails: Interaction["modelDetails"],
	stimulus: Interaction["stimulus"],
): Promise<AgentConfigureContract> {
	const direct = tryParseAgentConfigureContract(rawText);
	if (direct) return direct;

	const repairedText = await repairAgentConfigureContract(
		rawText,
		modelDetails,
		stimulus,
	);
	const repaired = tryParseAgentConfigureContract(repairedText);
	if (repaired) return repaired;

	throw new Error(
		"Could not parse configure analysis into a valid run contract.",
	);
}

function tryParseAgentConfigureContract(
	rawText: string,
): AgentConfigureContract | null {
	const candidates = [
		rawText.trim(),
		stripMarkdownCodeFence(rawText).trim(),
		extractFirstJsonObject(rawText)?.trim() ?? "",
	].filter(Boolean);

	for (const candidate of candidates) {
		try {
			return agentConfigureSchema.parse(JSON.parse(candidate));
		} catch {
			// Try next candidate
		}
	}

	return null;
}

async function repairAgentConfigureContract(
	rawText: string,
	modelDetails: Interaction["modelDetails"],
	stimulus: Interaction["stimulus"],
): Promise<string> {
	const repairInteraction = new Interaction(modelDetails, stimulus);
	repairInteraction.setTools({});
	repairInteraction.addMessage({
		role: "user",
		content: [
			"Reformat the following agent analysis into a single valid JSON object.",
			"",
			"Do not add new facts. Preserve the same conclusions, but return only valid JSON with the expected contract fields.",
			"",
			"Invalid analysis:",
			rawText,
		].join("\n"),
	});

	const repaired = await repairInteraction.generateText();
	return repaired.content;
}

function stripMarkdownCodeFence(text: string): string {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	return fenced ? fenced[1] : text;
}

function extractFirstJsonObject(text: string): string | null {
	const source = stripMarkdownCodeFence(text);
	const start = source.indexOf("{");
	if (start === -1) return null;

	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = start; i < source.length; i++) {
		const char = source[i];

		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			continue;
		}

		if (char === "{") {
			depth += 1;
		} else if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				return source.slice(start, i + 1);
			}
		}
	}

	return null;
}
