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
 */

import { Command } from "commander";
import path from "node:path";
import { createInterface } from "node:readline";
import type { CoreMessage } from "ai";
import { Habitat } from "../habitat/index.js";
import { Interaction } from "../interaction/core/interaction.js";
import { InteractionStore } from "../interaction/persistence/interaction-store.js";
import { writeSessionTranscript } from "../habitat/transcript.js";
import {
  estimateContextSize,
  listCompactionStrategies,
} from "../context/index.js";
import type { ModelDetails } from "../cognition/types.js";

// ── Shared habitat options ────────────────────────────────────────────

interface HabitatCLIOptions {
  provider?: string;
  model?: string;
  workDir?: string;
  sessionsDir?: string;
  envPrefix?: string;
  skipOnboard?: boolean;
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
    defaultSessionsDirName: "habitats-sessions",
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

/**
 * Print habitat startup info.
 */
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

// ── Helpers ──────────────────────────────────────────────────────────

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

// ── One-shot ─────────────────────────────────────────────────────────

async function oneShotRun(
  interaction: Interaction,
  store: InteractionStore,
  prompt: string,
): Promise<void> {
  interaction.addMessage({ role: "user", content: prompt });
  process.stdout.write("Habitat: ");
  const response = await interaction.streamText();
  const text =
    typeof response.content === "string"
      ? response.content
      : String(response.content ?? "");
  if (text && !text.trim().endsWith("\n")) {
    process.stdout.write("\n");
  }
  console.log(formatContextSize(interaction.getMessages()));
  await saveInteraction(store, interaction);
}

// ── REPL ─────────────────────────────────────────────────────────────

async function repl(
  interaction: Interaction,
  store: InteractionStore,
  habitat: Habitat,
): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("Habitat agent ready. Type a message and press Enter.");
  console.log(
    "Commands: /exit, /agents, /skills, /tools, /context, /onboard, /compact [strategy], /compact help\n",
  );

  const ask = () => {
    rl.question("You: ", async (line) => {
      const input = line?.trim();
      if (!input) {
        ask();
        return;
      }

      // ── Commands ──

      if (input === "/exit" || input === "/quit") {
        await saveInteraction(store, interaction);
        rl.close();
        process.exit(0);
      }

      if (input === "/agents") {
        const agents = habitat.getAgents();
        if (agents.length === 0) {
          console.log(
            "No agents registered. Use agent_clone or agents_add tools to register agents.",
          );
        } else {
          console.log(`Agents (${agents.length}):`);
          for (const a of agents) {
            const cmds = a.commands
              ? ` [${Object.keys(a.commands).join(", ")}]`
              : "";
            console.log(`  ${a.id} — ${a.name} (${a.projectPath})${cmds}`);
          }
        }
        console.log("");
        ask();
        return;
      }

      if (input === "/skills") {
        const skills = habitat.getSkills();
        if (skills.length === 0) {
          console.log(
            "No skills loaded. Add skillsDirs or skillsFromGit to config.json.",
          );
        } else {
          console.log(`Skills (${skills.length}):`);
          for (const s of skills) {
            console.log(`  ${s.name} — ${s.description}`);
          }
        }
        console.log("");
        ask();
        return;
      }

      if (input === "/tools") {
        const tools = habitat.getTools();
        const names = Object.keys(tools);
        if (names.length === 0) {
          console.log("No tools registered.");
        } else {
          console.log(`Tools (${names.length}): ${names.join(", ")}`);
        }
        console.log("");
        ask();
        return;
      }

      if (input === "/onboard") {
        const result = await habitat.onboard();
        console.log("Onboarding complete.");
        if (result.created.length > 0)
          console.log("  Created:", result.created.join(", "));
        if (result.skipped.length > 0)
          console.log("  Already present:", result.skipped.join(", "));
        console.log("  Work directory:", result.workDir);
        console.log("");
        ask();
        return;
      }

      if (input === "/context") {
        console.log(formatContextSize(interaction.getMessages()));
        console.log("");
        ask();
        return;
      }

      if (input === "/compact help") {
        const strategies = await listCompactionStrategies();
        console.log("Compaction strategies:");
        for (const s of strategies) {
          console.log(`  ${s.id} — ${s.description}`);
        }
        console.log(
          "\nUsage: /compact [strategyId]   (default: through-line-and-facts)",
        );
        console.log("");
        ask();
        return;
      }

      if (input === "/compact" || input.startsWith("/compact ")) {
        const strategyId =
          input === "/compact"
            ? "through-line-and-facts"
            : input.slice(9).trim();
        try {
          const result = await interaction.compactContext(strategyId, {
            fromCheckpoint: true,
          });
          if (result) {
            console.log(
              `Compacted segment [${result.segmentStart}..${result.segmentEnd}] into ${result.replacementCount} message(s).`,
            );
            console.log(formatContextSize(interaction.getMessages()));
          } else {
            console.log("No segment to compact.");
          }
        } catch (err) {
          console.error("Compaction error:", err);
        }
        console.log("");
        ask();
        return;
      }

      // ── Regular message → LLM ──

      try {
        interaction.addMessage({ role: "user", content: input });
        process.stdout.write("Habitat: ");

        // Set up keyboard listener to abort stream on Escape key
        const abortController = new AbortController();
        let streamAborted = false;

        const keypressHandler = (
          str: string,
          key: { name?: string; ctrl?: boolean; meta?: boolean },
        ) => {
          if (key.name === "escape" || (key.ctrl && key.name === "c")) {
            abortController.abort();
            streamAborted = true;
            process.stdout.write("\n[Stream aborted by user]\n");
          }
        };

        // Enable raw mode to capture keypresses immediately
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
          process.stdin.on("keypress", keypressHandler);
        }

        const response = await interaction.streamText();
        const text =
          typeof response.content === "string"
            ? response.content
            : String(response.content ?? "");
        if (text && !text.trim().endsWith("\n")) {
          process.stdout.write("\n");
        }

        // Clean up keypress handler
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
          process.stdin.removeListener("keypress", keypressHandler);
        }

        console.log(formatContextSize(interaction.getMessages()));
        await saveInteraction(store, interaction);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Stream was aborted, this is expected
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

// ── CLI REPL action ───────────────────────────────────────────────────

async function cliAction(
  promptParts: string[],
  options: HabitatCLIOptions,
): Promise<void> {
  const oneShot =
    promptParts.length > 0 ? promptParts.join(" ").trim() : undefined;

  const habitat = await createHabitatFromOptions(options);
  const modelDetails = resolveModelDetails(habitat, options);

  if (!modelDetails) {
    console.error(
      "No model configured. Provide --provider and --model, or add defaultProvider/defaultModel to config.json.",
    );
    process.exit(1);
  }

  printStartupInfo(habitat, modelDetails);

  // Create session + interaction
  const store = habitat.getStore();
  const { sessionId, sessionDir } = await habitat.getOrCreateSession("cli");
  console.log(`[habitat] Session: ${sessionId}`);

  const stimulus = await habitat.getStimulus();
  const interaction = new Interaction(modelDetails, stimulus, {
    id: sessionId,
    source: "native",
    sourceId: sessionId,
  });

  // Wire transcript persistence
  interaction.setOnTranscriptUpdate((messages) => {
    void writeSessionTranscript(sessionDir, messages);
    void saveInteraction(store, interaction);
  });

  if (oneShot) {
    await oneShotRun(interaction, store, oneShot);
    process.exit(0);
  }

  await repl(interaction, store, habitat);
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
    console.error(
      "No model configured. Provide --provider and --model, or add defaultProvider/defaultModel to config.json.",
    );
    process.exit(1);
  }

  printStartupInfo(habitat, modelDetails);

  const stimulus = await habitat.getStimulus();

  // Lazy import to avoid requiring grammy when not using telegram
  const { TelegramAdapter } = await import("../ui/telegram/TelegramAdapter.js");

  const adapter = new TelegramAdapter({
    token,
    modelDetails,
    stimulus,
    getSessionMediaDir: async (chatId: number) => {
      const { sessionDir } = await habitat.getOrCreateSession(
        "telegram",
        chatId,
      );
      return path.join(sessionDir, "media");
    },
    getSessionDir: async (chatId: number) => {
      return habitat.getOrCreateSession("telegram", chatId);
    },
    writeTranscript: writeSessionTranscript,
    startNewThread: async (chatId: number) => {
      await habitat.startNewThread("telegram", chatId);
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

// ── Web (Gaia) action ────────────────────────────────────────────────

async function webAction(
  options: HabitatCLIOptions & { port?: string },
): Promise<void> {
  const habitat = await createHabitatFromOptions(options);

  // Persist CLI-provided provider/model into config so createInteraction can use them
  const modelDetails = resolveModelDetails(habitat, options);
  if (modelDetails && !habitat.getDefaultModelDetails()) {
    await habitat.updateConfig({
      defaultProvider: modelDetails.provider,
      defaultModel: modelDetails.name,
    });
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

  const { startGaiaServer } = await import("../habitat/gaia-server.js");

  const port = options.port ? parseInt(options.port, 10) : 3000;
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
  .action(async (options: HabitatCLIOptions & { token?: string }) => {
    await telegramAction(options);
  });

habitatCommand.addCommand(telegramSubcommand);

// Web (Gaia) subcommand
const webSubcommand = new Command("web").description(
  "Start Gaia — the habitat manager web UI.",
);
addSharedOptions(webSubcommand)
  .option("--port <port>", "HTTP port (default: 3000)")
  .action(async (options: HabitatCLIOptions & { port?: string }) => {
    await webAction(options);
  });

habitatCommand.addCommand(webSubcommand);

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
  .action(async (options: HabitatCLIOptions) => {
    const habitat = await createHabitatFromOptions({
      ...options,
      skipOnboard: options.skipOnboard,
    });
    const names = habitat.listSecretNames();
    if (names.length === 0) {
      console.log(
        'No secrets stored. Use "umwelten habitat secrets set <name> <value>" to add one.',
      );
    } else {
      console.log(`Secrets (${names.length}):`);
      for (const name of names) {
        console.log(`  ${name}`);
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

      const habitat = await createHabitatFromOptions({
        ...options,
        skipOnboard: options.skipOnboard,
      });
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
  .action(async (name: string, options: HabitatCLIOptions) => {
    const habitat = await createHabitatFromOptions({
      ...options,
      skipOnboard: options.skipOnboard,
    });
    await habitat.removeSecret(name);
    console.log(`Secret "${name}" removed.`);
  });

habitatCommand.addCommand(secretsSubcommand);
