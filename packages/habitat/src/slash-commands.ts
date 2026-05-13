/**
 * Habitat slash commands consumed by REPLs (CLI, Discord, etc.).
 *
 * A REPL gets a list of `SlashCommand` from `habitat.getSlashCommands()` and
 * dispatches `/name args` lines to them. Each command runs against a
 * `SlashCommandContext` that exposes the habitat, the active interaction, and
 * a `print` function the REPL provides (so the same command works in CLI
 * stdout, a Discord channel, etc.).
 */

import type { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { CoreMessage } from "ai";
import {
	estimateContextSize,
	listCompactionStrategies,
} from "@umwelten/core/context/index.js";
import type { Habitat } from "./habitat.js";

export interface SlashCommandContext {
	habitat: Habitat;
	interaction: Interaction;
	/** Print a line to whatever output channel the REPL is using. */
	print: (line: string) => void;
}

export interface SlashCommand {
	name: string; // without the leading slash
	description: string;
	/** Argument string after the command name (may be empty). */
	run(args: string, ctx: SlashCommandContext): Promise<void> | void;
}

function formatContextSize(messages: CoreMessage[]): string {
	const size = estimateContextSize(messages);
	const kTokens =
		size.estimatedTokens >= 1000
			? (size.estimatedTokens / 1000).toFixed(1) + "K"
			: String(size.estimatedTokens);
	return `[Context: ${size.messageCount} messages, ~${kTokens} tokens]`;
}

export function getHabitatSlashCommands(): SlashCommand[] {
	return [
		{
			name: "agents",
			description: "List registered agents",
			run(_args, { habitat, print }) {
				const agents = habitat.getAgents();
				if (agents.length === 0) {
					print(
						"No agents registered. Use agent_clone or agents_add tools to register agents.",
					);
					return;
				}
				print(`Agents (${agents.length}):`);
				for (const a of agents) {
					const cmds = a.commands
						? ` [${Object.keys(a.commands).join(", ")}]`
						: "";
					print(`  ${a.id} — ${a.name} (${a.projectPath})${cmds}`);
				}
			},
		},
		{
			name: "skills",
			description: "List loaded skills",
			run(_args, { habitat, print }) {
				const skills = habitat.getSkills();
				if (skills.length === 0) {
					print(
						"No skills loaded. Add skillsDirs or skillsFromGit to config.json.",
					);
					return;
				}
				print(`Skills (${skills.length}):`);
				for (const s of skills) {
					print(`  ${s.name} — ${s.description}`);
				}
			},
		},
		{
			name: "tools",
			description: "List registered tools",
			run(_args, { habitat, print }) {
				const tools = habitat.getTools();
				const names = Object.keys(tools);
				if (names.length === 0) {
					print("No tools registered.");
					return;
				}
				print(`Tools (${names.length}): ${names.join(", ")}`);
			},
		},
		{
			name: "onboard",
			description: "Run habitat onboarding",
			async run(_args, { habitat, print }) {
				const result = await habitat.onboard();
				print("Onboarding complete.");
				if (result.created.length > 0)
					print(`  Created: ${result.created.join(", ")}`);
				if (result.skipped.length > 0)
					print(`  Already present: ${result.skipped.join(", ")}`);
				print(`  Work directory: ${result.workDir}`);
			},
		},
		{
			name: "context",
			description: "Show context size",
			run(_args, { interaction, print }) {
				print(formatContextSize(interaction.getMessages()));
			},
		},
		{
			name: "compact",
			description: "Compact context (use `/compact help` for strategies)",
			async run(args, { interaction, print }) {
				const trimmed = args.trim();
				if (trimmed === "help") {
					const strategies = await listCompactionStrategies();
					print("Compaction strategies:");
					for (const s of strategies) {
						print(`  ${s.id} — ${s.description}`);
					}
					print(
						"\nUsage: /compact [strategyId]   (default: through-line-and-facts)",
					);
					return;
				}
				const strategyId = trimmed === "" ? "through-line-and-facts" : trimmed;
				try {
					const result = await interaction.compactContext(strategyId, {
						fromCheckpoint: true,
					});
					if (result) {
						print(
							`Compacted segment [${result.segmentStart}..${result.segmentEnd}] into ${result.replacementCount} message(s).`,
						);
						print(formatContextSize(interaction.getMessages()));
					} else {
						print("No segment to compact.");
					}
				} catch (err) {
					print(`Compaction error: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
		},
	];
}
