/**
 * `umwelten habitat` — Boot a Habitat and start a REPL, one-shot, or interface.
 *
 * Habitat is the top-level "world" container. Interfaces (CLI REPL, Telegram,
 * TUI, web) run inside it, sharing config, agents, skills, and sessions.
 *
 * Usage:
 *   umwelten habitat -p google -m gemini-3-flash-preview
 *   umwelten habitat -p google -m gemini-3-flash-preview "list my agents"
 *   umwelten habitat --work-dir ~/my-habitat -p openrouter -m anthropic/claude-sonnet-4
 *   umwelten habitat telegram --token $TELEGRAM_BOT_TOKEN -p google -m gemini-3-flash-preview
 *   umwelten habitat discord --token $DISCORD_BOT_TOKEN -p google -m gemini-3-flash-preview
 */

import { Command } from "commander";
import path from "node:path";
import { Habitat, getAgentMemoryPath } from "@umwelten/habitat";
import type { AgentEntry, DiscordChannelRuntimeMode } from "@umwelten/habitat";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import { writeSessionTranscript } from "@umwelten/habitat/transcript.js";
import { createCurrentSessionTool } from "@umwelten/habitat/tools/session-tools.js";
import { fileExists } from "@umwelten/habitat/config.js";
import {
	configureManagedAgent,
	registerManagedAgentDirectory,
} from "@umwelten/habitat/tools/agent-runner-tools.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import { runRepl, runOneShot } from "@umwelten/ui/cli/repl.js";
// Discord routing tools kept for non-bridge paths (e.g. tools exposed to the LLM)

// ── Shared habitat options ────────────────────────────────────────────

interface HabitatCLIOptions {
	provider?: string;
	model?: string;
	workDir?: string;
	sessionsDir?: string;
	envPrefix?: string;
	skipOnboard?: boolean;
}

interface LocalAgentCLIOptions extends HabitatCLIOptions {
	project?: string;
	name?: string;
	id?: string;
	skipConfigure?: boolean;
}

/**
 * Shared flags like `--env-prefix` are parsed on the parent `habitat` command; leaf
 * `.action` handlers only receive `this.opts()` for the subcommand. Merge ancestor opts.
 */
function mergedHabitatCliOptions(
	command: Command,
	local: HabitatCLIOptions,
): HabitatCLIOptions {
	return { ...command.optsWithGlobals(), ...local };
}

/**
 * Create a Habitat from CLI options. Shared between all subcommands.
 */
async function createHabitatFromOptions(
	options: HabitatCLIOptions,
): Promise<Habitat> {
	const habitat = await Habitat.create({
		workDir: options.workDir,
		sessionsDir: options.sessionsDir,
		envPrefix: options.envPrefix ?? "HABITAT",
		defaultWorkDirName: "habitats",
	});

	// Onboard if needed
	if (!options.skipOnboard && !(await habitat.isOnboarded())) {
		console.log("[habitat] Work directory not set up. Running onboarding...");
		const result = await habitat.onboard();
		if (result.created.length > 0)
			console.log("[habitat] Created:", result.created.join(", "));
		console.log(`[habitat] Work directory: ${result.workDir}`);
	}

	return habitat;
}

/**
 * Resolve model details from CLI options or habitat config.
 */
function resolveModelDetails(
	habitat: Habitat,
	options: HabitatCLIOptions,
): ModelDetails | undefined {
	// Use CLI options if provided
	if (options.provider && options.model) {
		return { provider: options.provider, name: options.model };
	}

	// Fall back to habitat config defaults
	return habitat.getDefaultModelDetails();
}

function noDefaultModelCliHint(envPrefix: string): string {
	return (
		`No model configured. Provide --provider and --model, add defaultProvider/defaultModel to config.json, ` +
		`or set ${envPrefix}_PROVIDER and ${envPrefix}_MODEL.`
	);
}

function printStartupInfo(habitat: Habitat, modelDetails: ModelDetails): void {
	const toolCount = Object.keys(habitat.getTools()).length;
	const agentCount = habitat.getAgents().length;
	const skillCount = habitat.getSkills().length;
	console.log(`[habitat] ${modelDetails.provider}/${modelDetails.name}`);
	console.log(`[habitat] Work dir: ${habitat.workDir}`);
	console.log(
		`[habitat] ${toolCount} tools, ${skillCount} skills, ${agentCount} agents`,
	);
}

// ── CLI REPL action (REPL/one-shot live in @umwelten/ui/cli/repl) ──────

async function cliAction(
	promptParts: string[],
	options: HabitatCLIOptions,
): Promise<void> {
	const oneShot =
		promptParts.length > 0 ? promptParts.join(" ").trim() : undefined;

	const habitat = await createHabitatFromOptions(options);
	const modelDetails = resolveModelDetails(habitat, options);

	if (!modelDetails) {
		console.error(noDefaultModelCliHint(habitat.envPrefix));
		process.exit(1);
	}

	printStartupInfo(habitat, modelDetails);

	// Make the model available to tools without persisting to config
	habitat.setRuntimeModelDetails(modelDetails);

	// Create session + interaction
	const store = habitat.getStore();
	const { sessionId, sessionDir } = await habitat.getOrCreateSession("cli");
	console.log(`[habitat] Session: ${sessionId}`);

	// Record model in session metadata
	await habitat.updateSessionMetadata(sessionId, {
		provider: modelDetails.provider,
		model: modelDetails.name,
	});

	const stimulus = await habitat.getStimulus();
	const interaction = new Interaction(modelDetails, stimulus, {
		id: sessionId,
		source: "native",
		sourceId: sessionId,
	});

	// Add current_session introspection tool
	habitat.addTool(
		"current_session",
		createCurrentSessionTool({
			sessionId,
			sessionDir,
			startedAt: new Date(),
			getMessageCount: () => interaction.messages.length,
		}),
	);

	// Wire transcript persistence
	interaction.setOnTranscriptUpdate((messages) => {
		void writeSessionTranscript(sessionDir, messages);
	});

	if (oneShot) {
		await runOneShot(interaction, store, oneShot);
		process.exit(0);
	}

	await runRepl({ interaction, store, habitat });
}

async function ensureLocalAgent(
	habitat: Habitat,
	options: LocalAgentCLIOptions,
): Promise<{
	agent: AgentEntry;
	memoryPath: string;
	registrationMessage: string;
	configureMessage?: string;
}> {
	const projectPath = path.resolve(options.project ?? process.cwd());
	const memoryPath = path.join(projectPath, "MEMORY.md");

	const registration = await registerManagedAgentDirectory(habitat, {
		projectPath,
		name: options.name,
		id: options.id,
		memoryPath,
	});

	let agent = habitat.getAgent(registration.agent.id) ?? registration.agent;
	let configureMessage: string | undefined;

	if (!options.skipConfigure) {
		const missingMemory = !(await fileExists(memoryPath));
		const missingCommands = !agent.commands?.run && !agent.commands?.setup;

		if (missingMemory || missingCommands) {
			console.log(
				`[habitat] Analyzing project configuration to generate MEMORY.md (this may take a minute)...`,
			);
			const result = await configureManagedAgent(habitat, agent.id, {
				saveMemory: true,
			});
			configureMessage = result.message;
			agent = habitat.getAgent(agent.id) ?? agent;
		}
	}

	return {
		agent,
		memoryPath,
		registrationMessage: registration.message,
		configureMessage,
	};
}

async function localAction(
	promptParts: string[],
	options: LocalAgentCLIOptions,
): Promise<void> {
	const oneShot =
		promptParts.length > 0 ? promptParts.join(" ").trim() : undefined;

	const habitat = await createHabitatFromOptions(options);
	const modelDetails = resolveModelDetails(habitat, options);

	if (!modelDetails) {
		console.error(noDefaultModelCliHint(habitat.envPrefix));
		process.exit(1);
	}

	printStartupInfo(habitat, modelDetails);
	habitat.setRuntimeModelDetails(modelDetails);

	const localAgent = await ensureLocalAgent(habitat, options);
	const memoryPath = getAgentMemoryPath(
		localAgent.agent,
		habitat.getAgentDir.bind(habitat),
	);

	console.log(
		`[habitat] Local agent: ${localAgent.agent.name} (${localAgent.agent.id})`,
	);
	console.log(`[habitat] Project: ${localAgent.agent.projectPath}`);
	console.log(`[habitat] Memory: ${memoryPath}`);
	console.log(`[habitat] ${localAgent.registrationMessage}`);
	if (localAgent.configureMessage) {
		console.log(`[habitat] ${localAgent.configureMessage}`);
	}

	const habitatAgent = await habitat.getOrCreateHabitatAgent(
		localAgent.agent.id,
	);
	const interaction = habitatAgent.getInteraction();
	const store = habitat.getStore();

	await habitat.updateSessionMetadata(habitatAgent.getSessionId(), {
		provider: modelDetails.provider,
		model: modelDetails.name,
		metadata: {
			mode: "local-agent",
			agentId: localAgent.agent.id,
			projectPath: localAgent.agent.projectPath,
		},
	});

	console.log(`[habitat] Session: ${habitatAgent.getSessionId()}`);

	if (oneShot) {
		await runOneShot(interaction, store, oneShot);
		process.exit(0);
	}

	await runRepl({
		interaction,
		store,
		habitat,
		banner:
			`Local agent ready for ${localAgent.agent.name}. ` +
			"You are talking directly to that project sub-agent.",
	});
}

// ── Telegram action ───────────────────────────────────────────────────

async function telegramAction(
	options: HabitatCLIOptions & { token?: string },
): Promise<void> {
	const token = options.token ?? process.env.TELEGRAM_BOT_TOKEN;
	if (!token) {
		console.error(
			"Telegram bot token is required. Set TELEGRAM_BOT_TOKEN or pass --token.",
		);
		console.error("Get a token from @BotFather on Telegram.");
		process.exit(1);
	}

	const habitat = await createHabitatFromOptions(options);
	const modelDetails = resolveModelDetails(habitat, options);

	if (!modelDetails) {
		console.error(noDefaultModelCliHint(habitat.envPrefix));
		process.exit(1);
	}

	printStartupInfo(habitat, modelDetails);

	const stimulus = await habitat.getStimulus();

	// Lazy import to avoid requiring grammy when not using telegram
	const { TelegramAdapter } = await import(
		"@umwelten/ui/telegram/TelegramAdapter.js"
	);
	const { ChannelBridge } = await import(
		"@umwelten/habitat/bridge/channel-bridge.js"
	);

	const bridge = new ChannelBridge(habitat, {
		platformInstruction:
			"You are responding in Telegram. Never use markdown tables — they render poorly. Use bold labels on separate lines. Keep formatting simple: bold, italic, code blocks, and links only.",
	});

	const adapter = new TelegramAdapter({
		token,
		modelDetails,
		stimulus,
		bridge,
		getSessionMediaDir: async (chatId: number) => {
			const label =
				habitat.getConfig().name?.trim() ||
				path.basename(path.resolve(habitat.workDir));
			const { sessionDir } = await habitat.getOrCreateSession(
				"telegram",
				chatId,
				{
					sessionMetadata: {
						agentId: label,
						routeSignature: `telegram:${chatId}`,
					},
				},
			);
			return path.join(sessionDir, "media");
		},
		getSessionDir: async (chatId: number) => {
			const label =
				habitat.getConfig().name?.trim() ||
				path.basename(path.resolve(habitat.workDir));
			return habitat.getOrCreateSession("telegram", chatId, {
				sessionMetadata: {
					agentId: label,
					routeSignature: `telegram:${chatId}`,
				},
			});
		},
		writeTranscript: writeSessionTranscript,
		startNewThread: async (chatId: number) => {
			const label =
				habitat.getConfig().name?.trim() ||
				path.basename(path.resolve(habitat.workDir));
			await habitat.startNewThread("telegram", chatId, {
				sessionMetadata: {
					agentId: label,
					routeSignature: `telegram:${chatId}`,
				},
			});
		},
	});

	console.log(`[habitat] Telegram bot starting...`);

	process.on("SIGINT", async () => {
		console.log("\nShutting down...");
		await adapter.stop();
		process.exit(0);
	});
	process.on("SIGTERM", async () => {
		await adapter.stop();
		process.exit(0);
	});

	await adapter.start();
}

// ── Discord action ───────────────────────────────────────────────────

async function discordAction(
	options: HabitatCLIOptions & { token?: string; discordGuild?: string },
): Promise<void> {
	const token = options.token ?? process.env.DISCORD_BOT_TOKEN;
	if (!token) {
		console.error(
			"Discord bot token is required. Set DISCORD_BOT_TOKEN or pass --token.",
		);
		console.error(
			"Create an application and bot at https://discord.com/developers/applications (enable Message Content Intent).",
		);
		process.exit(1);
	}

	const habitat = await createHabitatFromOptions(options);
	const modelDetails = resolveModelDetails(habitat, options);

	if (!modelDetails) {
		console.error(noDefaultModelCliHint(habitat.envPrefix));
		process.exit(1);
	}

	printStartupInfo(habitat, modelDetails);

	const prefix = habitat.envPrefix;
	const visionProvider =
		process.env[`${prefix}_VISION_PROVIDER`] ??
		process.env.HABITAT_VISION_PROVIDER;
	const visionModel =
		process.env[`${prefix}_VISION_MODEL`] ?? process.env.HABITAT_VISION_MODEL;
	const visionModelDetails: ModelDetails | undefined =
		visionProvider && visionModel
			? { provider: visionProvider, name: visionModel }
			: undefined;

	const { DiscordAdapter } = await import(
		"@umwelten/ui/discord/DiscordAdapter.js"
	);
	const { readRecentDiscordSessionChannelIds } = await import(
		"@umwelten/ui/discord/discord-backfill-sessions.js"
	);
	const { ChannelBridge } = await import(
		"@umwelten/habitat/bridge/channel-bridge.js"
	);
	const { routeSignature: bridgeRouteSignature } = await import(
		"@umwelten/habitat/bridge/routing.js"
	);

	const bridge = new ChannelBridge(habitat, {
		platformInstruction:
			"You are responding in Discord. Prefer short paragraphs. Avoid wide markdown tables; use bullet lists or labeled lines. Keep code in fenced blocks when needed.",
	});

	/** Resolve route via the bridge (shared routing.json + discord.json fallback). */
	const resolveViaBridge = async (
		channelId: string,
		parentChannelId?: string | null,
	) => {
		const key = `discord:${channelId}`;
		const parentKey = parentChannelId
			? `discord:${parentChannelId}`
			: undefined;
		return bridge.resolveRoute(key, parentKey);
	};

	const buildDiscordBindingPinContent = async (opts: {
		agentId: string;
		runtime: DiscordChannelRuntimeMode;
	}) => {
		const agent = habitat.getAgent(opts.agentId);
		const runLine =
			opts.runtime === "claude-sdk"
				? "**Runtime:** Claude Agent SDK pass-through. Text only."
				: "**Runtime:** Habitat model + tools. Attachments and vision where supported.";
		const lines = [
			"# Habitat channel binding",
			"",
			`**Agent:** \`${opts.agentId}\`${agent ? ` — ${agent.name}` : ""}`,
			agent ? `**Project:** \`${agent.projectPath}\`` : "",
			runLine,
			"",
			"- Switch agent: `/switch <agent-id>` or `/switch main`",
			"- Claude SDK: `/switch-claude <agent-id>`",
			"- Status: `/status`",
			"- Unbind: `/unbind-agent`",
		];
		return lines.filter((l) => l !== "").join("\n");
	};

	const guildId =
		options.discordGuild?.trim() || process.env.DISCORD_GUILD_ID?.trim();

	const adapter = new DiscordAdapter({
		token,
		modelDetails,
		visionModelDetails,
		bridge,
		buildDiscordBindingPinContent,
		workDir: habitat.workDir,
		guildId: guildId || undefined,
		getSessionMediaDir: async (channelId, ctx) => {
			const resolved = await resolveViaBridge(channelId, ctx?.parentChannelId);
			const sig = bridgeRouteSignature(resolved);
			const agentId = resolved.kind === "agent" ? resolved.agentId : undefined;
			const { sessionDir } = await habitat.getOrCreateSession(
				"discord",
				channelId,
				{
					discordStableSession: ctx?.isDiscordThread === true,
					sessionMetadata: { agentId, routeSignature: sig },
				},
			);
			return path.join(sessionDir, "media");
		},
		getSessionDir: async (channelId, ctx) => {
			const resolved = await resolveViaBridge(channelId, ctx?.parentChannelId);
			const sig = bridgeRouteSignature(resolved);
			const agentId = resolved.kind === "agent" ? resolved.agentId : undefined;
			return habitat.getOrCreateSession("discord", channelId, {
				discordStableSession: ctx?.isDiscordThread === true,
				sessionMetadata: { agentId, routeSignature: sig },
			});
		},
		writeTranscript: writeSessionTranscript,
		startNewThread: async (channelId, opts) => {
			const resolved = await resolveViaBridge(channelId, opts?.parentChannelId);
			const sig = bridgeRouteSignature(resolved);
			const agentId = resolved.kind === "agent" ? resolved.agentId : undefined;
			await habitat.startNewThread("discord", channelId, {
				discordStableSession: opts?.isDiscordThread === true,
				sessionMetadata: { agentId, routeSignature: sig },
			});
		},
		listBackfillChannelIds: async () =>
			readRecentDiscordSessionChannelIds(habitat.sessionsDir),
		backfillMissedMessagesOnStartup:
			process.env.DISCORD_BACKFILL_ON_START !== "0",
	});

	console.log(`[habitat] Discord bot starting…`);

	process.on("SIGINT", async () => {
		console.log("\nShutting down...");
		await adapter.stop();
		process.exit(0);
	});
	process.on("SIGTERM", async () => {
		await adapter.stop();
		process.exit(0);
	});

	await adapter.start();
}

// ── Web (Gaia) action ────────────────────────────────────────────────

async function webAction(
	options: HabitatCLIOptions & { port?: string },
): Promise<void> {
	const habitat = await createHabitatFromOptions(options);

	// Make the model available to tools without persisting to agent config
	const modelDetails = resolveModelDetails(habitat, options);
	if (modelDetails) {
		habitat.setRuntimeModelDetails(modelDetails);
	}

	const config = habitat.getConfig();

	const toolCount = Object.keys(habitat.getTools()).length;
	const agentCount = habitat.getAgents().length;
	const skillCount = habitat.getSkills().length;
	console.log(`[gaia] Habitat: ${config.name ?? "unnamed"}`);
	console.log(
		`[gaia] Provider: ${config.defaultProvider ?? "not set"}, Model: ${config.defaultModel ?? "not set"}`,
	);
	console.log(`[gaia] Work dir: ${habitat.getWorkDir()}`);
	console.log(
		`[gaia] ${toolCount} tools, ${skillCount} skills, ${agentCount} agents`,
	);

	const { startGaiaServer } = await import("@umwelten/habitat/gaia-server.js");

	const port = options.port ? parseInt(options.port, 10) : 7421;
	let actualPort: number;
	try {
		const server = await startGaiaServer({ habitat, port });
		actualPort = server.port;
	} catch (err) {
		console.error(`[gaia] ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}

	console.log(
		`[gaia] Habitat manager running at http://localhost:${actualPort}`,
	);
	console.log(`[gaia] Press Ctrl+C to stop\n`);

	// Keep process alive
	process.on("SIGINT", () => {
		console.log("\n[gaia] Shutting down...");
		process.exit(0);
	});
	process.on("SIGTERM", () => {
		process.exit(0);
	});
}

// ── Shared options (applied to parent and inherited by subcommands) ───

function addSharedOptions(cmd: Command): Command {
	return cmd
		.option(
			"-p, --provider <provider>",
			"LLM provider (e.g. google, openrouter)",
		)
		.option("-m, --model <model>", "Model name (e.g. gemini-3-flash-preview)")
		.option("-w, --work-dir <path>", "Work directory (default: ~/habitats)")
		.option(
			"--sessions-dir <path>",
			"Sessions directory (default: ~/habitats-sessions)",
		)
		.option(
			"--env-prefix <prefix>",
			"Environment variable prefix (default: HABITAT)",
		)
		.option("--skip-onboard", "Skip automatic onboarding");
}

// ── Command definition ───────────────────────────────────────────────

export const habitatCommand = new Command("habitat").description(
	"Start a Habitat — the top-level world for agents, tools, skills, and sessions.",
);

// Default action: CLI REPL (or one-shot)
addSharedOptions(habitatCommand)
	.argument("[prompt...]", "One-shot prompt (omit for REPL mode)")
	.action(async (promptParts: string[], options: HabitatCLIOptions) => {
		await cliAction(promptParts, options);
	});

// Telegram subcommand
const telegramSubcommand = new Command("telegram").description(
	"Start a Telegram bot interface for this habitat.",
);
addSharedOptions(telegramSubcommand)
	.option(
		"--token <token>",
		"Telegram bot token (default: TELEGRAM_BOT_TOKEN env var)",
	)
	.action(
		async (
			options: HabitatCLIOptions & { token?: string },
			command: Command,
		) => {
			await telegramAction(mergedHabitatCliOptions(command, options));
		},
	);

habitatCommand.addCommand(telegramSubcommand);

// Discord subcommand
const discordSubcommand = new Command("discord").description(
	"Start a Discord bot interface for this habitat.",
);
addSharedOptions(discordSubcommand)
	.option(
		"--token <token>",
		"Discord bot token (default: DISCORD_BOT_TOKEN env var)",
	)
	.option(
		"--discord-guild <id>",
		"Register slash commands in this guild only (default: DISCORD_GUILD_ID; omit for global commands)",
	)
	.action(
		async (
			options: HabitatCLIOptions & { token?: string; discordGuild?: string },
			command: Command,
		) => {
			await discordAction(mergedHabitatCliOptions(command, options));
		},
	);

habitatCommand.addCommand(discordSubcommand);

// Web (Gaia) subcommand
const webSubcommand = new Command("web").description(
	"Start Gaia — the habitat manager web UI.",
);
addSharedOptions(webSubcommand)
	.option("--port <port>", "HTTP port (default: 7421)")
	.action(
		async (
			options: HabitatCLIOptions & { port?: string },
			command: Command,
		) => {
			await webAction(mergedHabitatCliOptions(command, options));
		},
	);

habitatCommand.addCommand(webSubcommand);

// Local agent subcommand
const localSubcommand = new Command("local")
	.alias("here")
	.description(
		"Talk directly to a managed sub-agent rooted at the current directory (or --project).",
	);
addSharedOptions(localSubcommand)
	.argument(
		"[prompt...]",
		"One-shot prompt for the local agent (omit for REPL mode)",
	)
	.option(
		"--project <path>",
		"Project directory to register/use (default: current working directory)",
	)
	.option("--name <name>", "Display name for the local agent")
	.option("--id <id>", "Stable agent id to use for the local agent")
	.option("--skip-configure", "Skip automatic configure on first attach")
	.action(
		async (
			promptParts: string[],
			options: LocalAgentCLIOptions,
			command: Command,
		) => {
			await localAction(
				promptParts,
				mergedHabitatCliOptions(command, options) as LocalAgentCLIOptions,
			);
		},
	);

habitatCommand.addCommand(localSubcommand);

// Secrets subcommand
const secretsSubcommand = new Command("secrets").description(
	"Manage habitat secrets (API keys, tokens).",
);

secretsSubcommand
	.command("list")
	.description("List secret names in the habitat store")
	.option("-w, --work-dir <path>", "Work directory (default: ~/habitats)")
	.option(
		"--env-prefix <prefix>",
		"Environment variable prefix (default: HABITAT)",
	)
	.option("--skip-onboard", "Skip automatic onboarding")
	.action(async (options: HabitatCLIOptions, command: Command) => {
		const habitat = await createHabitatFromOptions(
			mergedHabitatCliOptions(command, options),
		);
		const names = habitat.listSecretNames();
		if (names.length === 0) {
			console.log(
				'No secrets stored. Use "umwelten habitat secrets set <name> <value>" to add one.',
			);
		} else {
			console.log(`Secrets (${names.length}):`);
			for (const name of names) {
				const value = habitat.getSecret(name);
				console.log(`  ${name}=${value ?? "(not set)"}`);
			}
		}
	});

secretsSubcommand
	.command("set <name> [value]")
	.description(
		"Set a secret. Value can be passed as argument or via --from-op.",
	)
	.option("--from-op <path>", "Fetch value from 1Password CLI: op read <path>")
	.option("-w, --work-dir <path>", "Work directory (default: ~/habitats)")
	.option(
		"--env-prefix <prefix>",
		"Environment variable prefix (default: HABITAT)",
	)
	.option("--skip-onboard", "Skip automatic onboarding")
	.action(
		async (
			name: string,
			value: string | undefined,
			options: HabitatCLIOptions & { fromOp?: string },
			command: Command,
		) => {
			let secretValue = value;

			if (options.fromOp) {
				// Fetch from 1Password CLI
				const { execSync } = await import("node:child_process");
				try {
					secretValue = execSync(`op read "${options.fromOp}"`, {
						encoding: "utf-8",
					}).trim();
				} catch (err) {
					console.error(
						`Failed to read from 1Password: ${err instanceof Error ? err.message : err}`,
					);
					console.error(
						"Make sure the `op` CLI is installed and you are signed in.",
					);
					process.exit(1);
				}
			}

			if (!secretValue) {
				console.error(
					"No value provided. Pass the value as an argument or use --from-op.",
				);
				process.exit(1);
			}

			const habitat = await createHabitatFromOptions(
				mergedHabitatCliOptions(command, options),
			);
			await habitat.setSecret(name, secretValue);
			console.log(`Secret "${name}" set.`);
		},
	);

secretsSubcommand
	.command("remove <name>")
	.description("Remove a secret from the habitat store")
	.option("-w, --work-dir <path>", "Work directory (default: ~/habitats)")
	.option(
		"--env-prefix <prefix>",
		"Environment variable prefix (default: HABITAT)",
	)
	.option("--skip-onboard", "Skip automatic onboarding")
	.action(
		async (name: string, options: HabitatCLIOptions, command: Command) => {
			const habitat = await createHabitatFromOptions(
				mergedHabitatCliOptions(command, options),
			);
			await habitat.removeSecret(name);
			console.log(`Secret "${name}" removed.`);
		},
	);

habitatCommand.addCommand(secretsSubcommand);

// Agent subcommand

// Serve subcommand — unified container server (MCP + chat + web UI)
const serveSubcommand = new Command("serve").description(
	"Start the unified container server: MCP tools + LLM chat + web UI on one port.",
);
addSharedOptions(serveSubcommand)
	.option("--port <port>", "HTTP port (default: 7430)", "7430")
	.option("--host <host>", "Bind address (default: 0.0.0.0)", "0.0.0.0")
	.option("--all-tools", "Expose all tools (default: container-minimal set)")
	.option("--mcp-only", "MCP-only mode (no chat, no web UI)")
	.action(
		async (
			options: HabitatCLIOptions & {
				port?: string;
				host?: string;
				allTools?: boolean;
				mcpOnly?: boolean;
			},
			command: Command,
		) => {
			const merged = mergedHabitatCliOptions(
				command,
				options,
			) as typeof options;
			const mode = merged.mcpOnly
				? "mcp-only"
				: process.env.HABITAT_API_KEY
					? "managed"
					: "standalone";
			await Habitat.serve({
				workDir: merged.workDir,
				sessionsDir: merged.sessionsDir,
				envPrefix: merged.envPrefix ?? "HABITAT",
				defaultWorkDirName: "habitats",
				port: parseInt(merged.port ?? "7430", 10),
				host: merged.host ?? "0.0.0.0",
				mode,
				allTools: merged.allTools,
				skipOnboard: merged.skipOnboard,
				model:
					merged.provider && merged.model
						? { provider: merged.provider, name: merged.model }
						: undefined,
			});
		},
	);

habitatCommand.addCommand(serveSubcommand);

// Gaia orchestrator subcommand — a normal habitat with extra tools + routes
const gaiaSubcommand = new Command("gaia").description(
	"Start the Gaia orchestrator — manage multiple habitat containers from a dashboard.",
);
addSharedOptions(gaiaSubcommand)
	.option("--port <port>", "HTTP port (default: 7420)", "7420")
	.option(
		"--data-dir <path>",
		"Data directory (default: ./gaia-data)",
		"./gaia-data",
	)
	.action(
		async (
			options: HabitatCLIOptions & { port?: string; dataDir?: string },
			command: Command,
		) => {
			const merged = mergedHabitatCliOptions(command, options);
			const { Gaia } = await import("@umwelten/habitat");
			await Gaia.start({
				dataDir: options.dataDir ?? "./gaia-data",
				port: parseInt(options.port ?? "7420", 10),
				provider: merged.provider,
				model: merged.model,
			});
		},
	);

habitatCommand.addCommand(gaiaSubcommand);

// ── habitat chat — connect to a running habitat's /api/chat ──────────────
const chatSubcommand = new Command("chat")
	.description(
		"Connect to a running habitat and chat with it (uses the habitat's own LLM).",
	)
	.requiredOption(
		"--url <url>",
		"Habitat base URL (e.g. http://localhost:7440)",
	)
	.option(
		"--token <token>",
		"Bearer token for auth (or set HABITAT_CHAT_TOKEN env var)",
	)
	.option("--one-shot <prompt>", "Send a single prompt and exit")
	.action(async (opts: { url: string; token?: string; oneShot?: string }) => {
		const { a2aChat } = await import("@umwelten/protocols");
		await a2aChat({
			url: opts.url,
			token: opts.token ?? process.env.HABITAT_CHAT_TOKEN,
			prompt: opts.oneShot,
		});
	});

habitatCommand.addCommand(chatSubcommand);
