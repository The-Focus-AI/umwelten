/**
 * Generic readline REPL that dispatches `/foo args` lines to slash commands
 * and forwards everything else to an LLM `Interaction.streamText`.
 *
 * Habitat-aware code stays in `@umwelten/habitat/slash-commands.ts`; this file
 * is pure I/O glue.
 */

import { createInterface } from "node:readline";
import type { Habitat, SlashCommand } from "@umwelten/habitat";
import type { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { InteractionStore } from "@umwelten/core/interaction/persistence/interaction-store.js";
import { cliStdoutObserver } from "@umwelten/core/cognition/observers.js";
import { estimateContextSize } from "@umwelten/core/context/index.js";
import type { CoreMessage } from "ai";

export interface ReplOptions {
	interaction: Interaction;
	store: InteractionStore;
	habitat: Habitat;
	slashCommands?: SlashCommand[];
	banner?: string;
	prompt?: string;
	assistantLabel?: string;
}

function formatContextSize(messages: CoreMessage[]): string {
	const size = estimateContextSize(messages);
	const kTokens =
		size.estimatedTokens >= 1000
			? (size.estimatedTokens / 1000).toFixed(1) + "K"
			: String(size.estimatedTokens);
	return `[Context: ${size.messageCount} messages, ~${kTokens} tokens]`;
}

async function saveInteraction(
	store: InteractionStore,
	interaction: Interaction,
): Promise<void> {
	try {
		const normalized = interaction.toNormalizedSession();
		await store.saveSession(normalized);
	} catch (err) {
		console.error("Failed to save session:", err);
	}
}

export async function runRepl(opts: ReplOptions): Promise<void> {
	const {
		interaction,
		store,
		habitat,
		banner,
		prompt = "You: ",
		assistantLabel = "Habitat: ",
	} = opts;

	const slashCommands = opts.slashCommands ?? habitat.getSlashCommands();
	const commandsByName = new Map(slashCommands.map((c) => [c.name, c]));

	const rl = createInterface({ input: process.stdin, output: process.stdout });

	console.log(banner ?? "Habitat agent ready. Type a message and press Enter.");
	const helpLine = ["/exit", ...slashCommands.map((c) => `/${c.name}`)].join(", ");
	console.log(`Commands: ${helpLine}\n`);

	const print = (line: string) => console.log(line);

	const ask = () => {
		rl.question(prompt, async (line) => {
			const input = line?.trim();
			if (!input) {
				ask();
				return;
			}

			if (input === "/exit" || input === "/quit") {
				await saveInteraction(store, interaction);
				rl.close();
				process.exit(0);
			}

			// Slash-command dispatch
			if (input.startsWith("/")) {
				const space = input.indexOf(" ");
				const name = (space === -1 ? input.slice(1) : input.slice(1, space)).trim();
				const args = space === -1 ? "" : input.slice(space + 1);
				const cmd = commandsByName.get(name);
				if (cmd) {
					try {
						await cmd.run(args, { habitat, interaction, print });
					} catch (err) {
						console.error(`/${name} error:`, err);
					}
					console.log("");
					ask();
					return;
				}
				console.log(`Unknown command: /${name}. Try one of: ${helpLine}\n`);
				ask();
				return;
			}

			// Regular message → LLM
			try {
				interaction.addMessage({ role: "user", content: input });
				process.stdout.write(assistantLabel);

				const abortController = new AbortController();
				const keypressHandler = (
					_str: string,
					key: { name?: string; ctrl?: boolean; meta?: boolean },
				) => {
					if (key.name === "escape" || (key.ctrl && key.name === "c")) {
						abortController.abort();
						process.stdout.write("\n[Stream aborted by user]\n");
					}
				};

				if (process.stdin.isTTY) {
					process.stdin.setRawMode(true);
					process.stdin.on("keypress", keypressHandler);
				}

				const response = await interaction.streamText(
					undefined,
					cliStdoutObserver(),
				);
				const text =
					typeof response.content === "string"
						? response.content
						: String(response.content ?? "");
				if (text && !text.trim().endsWith("\n")) {
					process.stdout.write("\n");
				}

				if (process.stdin.isTTY) {
					process.stdin.setRawMode(false);
					process.stdin.removeListener("keypress", keypressHandler);
				}

				console.log(formatContextSize(interaction.getMessages()));
				await saveInteraction(store, interaction);
			} catch (err) {
				if (err instanceof Error && err.name === "AbortError") {
					console.log("\n");
				} else {
					console.error("Error:", err);
				}
			}
			console.log("");
			ask();
		});
	};
	ask();
}

export async function runOneShot(
	interaction: Interaction,
	store: InteractionStore,
	prompt: string,
	assistantLabel = "Habitat: ",
): Promise<void> {
	interaction.addMessage({ role: "user", content: prompt });
	process.stdout.write(assistantLabel);
	const response = await interaction.streamText(undefined, cliStdoutObserver());
	const text =
		typeof response.content === "string"
			? response.content
			: String(response.content ?? "");
	if (text && !text.trim().endsWith("\n")) {
		process.stdout.write("\n");
	}
	console.log(formatContextSize(interaction.getMessages()));
	try {
		const normalized = interaction.toNormalizedSession();
		await store.saveSession(normalized);
	} catch (err) {
		console.error("Failed to save session:", err);
	}
}
