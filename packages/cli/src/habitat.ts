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
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { CoreMessage, Tool } from "ai";
import {
  Habitat,
  getAgentMemoryPath,
  buildAgentStimulus,
} from "@umwelten/habitat";
import type { AgentEntry, DiscordChannelRuntimeMode } from "@umwelten/habitat";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { InteractionStore } from "@umwelten/core/interaction/persistence/interaction-store.js";
import { writeSessionTranscript } from "@umwelten/habitat/transcript.js";
import { createCurrentSessionTool } from "@umwelten/habitat/tools/session-tools.js";
import { fileExists } from "@umwelten/habitat/config.js";
import {
  configureManagedAgent,
  registerManagedAgentDirectory,
} from "@umwelten/habitat/tools/agent-runner-tools.js";
import {
  estimateContextSize,
  listCompactionStrategies,
} from "@umwelten/core/context/index.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import { cliStdoutObserver } from "@umwelten/core/cognition/observers.js";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
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

/**
 * Print habitat startup info.
 */
async function cloneHabitatStimulus(
  habitat: Habitat,
  extraTools?: Record<string, Tool>,
): Promise<Stimulus> {
  const base = await habitat.getStimulus();
  const s = new Stimulus(base.options);
  for (const [name, tool] of Object.entries(base.getTools())) {
    s.addTool(name, tool);
  }
  if (extraTools) {
    for (const [name, tool] of Object.entries(extraTools)) {
      s.addTool(name, tool);
    }
  }
  return s;
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
  const response = await interaction.streamText(undefined, cliStdoutObserver());
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
  options?: {
    banner?: string;
  },
): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(
    options?.banner ?? "Habitat agent ready. Type a message and press Enter.",
  );
  console.log(
    "Commands: /exit, /agents, /agent-start <id>, /agent-stop <id>, /agent-status [id], /skills, /tools, /context, /onboard, /compact [strategy], /compact help\n",
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
            console.log(
              `  ${a.id} — ${a.name} (${a.projectPath})${cmds}`,
            );
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

        const response = await interaction.streamText(undefined, cliStdoutObserver());
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
    void saveInteraction(store, interaction);
  });

  if (oneShot) {
    await oneShotRun(interaction, store, oneShot);
    process.exit(0);
  }

  await repl(interaction, store, habitat);
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
      console.log(`[habitat] Analyzing project configuration to generate MEMORY.md (this may take a minute)...`);
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

  const habitatAgent = await habitat.getOrCreateHabitatAgent(localAgent.agent.id);
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
    await oneShotRun(interaction, store, oneShot);
    process.exit(0);
  }

  await repl(interaction, store, habitat, {
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
  const { TelegramAdapter } = await import("@umwelten/ui/telegram/TelegramAdapter.js");
  const { ChannelBridge } = await import("@umwelten/habitat/bridge/channel-bridge.js");

  const bridge = new ChannelBridge(habitat, {
    platformInstruction: 'You are responding in Telegram. Never use markdown tables — they render poorly. Use bold labels on separate lines. Keep formatting simple: bold, italic, code blocks, and links only.',
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

async function readClaudeSdkVersionFromRepoPackageJson(): Promise<string> {
  try {
    const pkgPath = fileURLToPath(
      new URL("../../package.json", import.meta.url),
    );
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return (
      pkg.dependencies?.["@anthropic-ai/claude-agent-sdk"] ??
      pkg.devDependencies?.["@anthropic-ai/claude-agent-sdk"] ??
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

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

  const routingPath = process.env.DISCORD_ROUTING_PATH;
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

  const { DiscordAdapter } = await import("@umwelten/ui/discord/DiscordAdapter.js");
  const { readRecentDiscordSessionChannelIds } = await import(
    "@umwelten/ui/discord/discord-backfill-sessions.js"
  );
  const { ChannelBridge } = await import("@umwelten/habitat/bridge/channel-bridge.js");
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
    const parentKey = parentChannelId ? `discord:${parentChannelId}` : undefined;
    return bridge.resolveRoute(key, parentKey);
  };

  const claudeSdkSpec = await readClaudeSdkVersionFromRepoPackageJson();

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
    async (options: HabitatCLIOptions & { port?: string }, command: Command) => {
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
  .argument("[prompt...]", "One-shot prompt for the local agent (omit for REPL mode)")
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
        console.log(`  ${name}=${value ?? '(not set)'}`);
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
  .action(async (name: string, options: HabitatCLIOptions, command: Command) => {
    const habitat = await createHabitatFromOptions(
      mergedHabitatCliOptions(command, options),
    );
    await habitat.removeSecret(name);
    console.log(`Secret "${name}" removed.`);
  });

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
      options: HabitatCLIOptions & { port?: string; host?: string; allTools?: boolean; mcpOnly?: boolean },
      command: Command,
    ) => {
      const merged = mergedHabitatCliOptions(command, options) as typeof options;

      // Use container-minimal tool sets by default; --all-tools for full orchestrator set.
      // Gaia-managed containers (HABITAT_API_KEY set) get managedContainerToolSets
      // which excludes secretsToolSet — secrets are managed by Gaia's master vault.
      const { containerToolSets, managedContainerToolSets } = await import("@umwelten/habitat/tool-sets.js");
      const isManaged = !!process.env.HABITAT_API_KEY;
      const habitat = await Habitat.create({
        workDir: merged.workDir,
        sessionsDir: merged.sessionsDir,
        envPrefix: merged.envPrefix ?? "HABITAT",
        defaultWorkDirName: "habitats",
        toolSets: (merged as any).allTools ? undefined : (isManaged ? managedContainerToolSets : containerToolSets),
      });

      // Onboard if needed
      if (!merged.skipOnboard && !(await habitat.isOnboarded())) {
        console.log("[habitat] Work directory not set up. Running onboarding...");
        const result = await habitat.onboard();
        if (result.created.length > 0)
          console.log("[habitat] Created:", result.created.join(", "));
        console.log(`[habitat] Work directory: ${result.workDir}`);
      }

      // Set runtime model from CLI flags so chat/bridge can find it
      const modelDetails = resolveModelDetails(habitat, merged);
      if (modelDetails) {
        habitat.setRuntimeModelDetails(modelDetails);
      }

      if ((merged as any).mcpOnly) {
        // Legacy MCP-only mode
        const { startHabitatMcpServer } = await import(
          "@umwelten/habitat/mcp-local-server.js"
        );
        const server = await startHabitatMcpServer({
          habitat,
          port: parseInt(merged.port ?? "7430", 10),
          host: merged.host ?? "0.0.0.0",
          name: habitat.getConfig().name ?? "habitat-mcp",
        });
        const shutdown = () => {
          console.log("\n[habitat-mcp] Shutting down...");
          server.close();
          process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      } else {
        // Unified container server (MCP + chat + web UI)
        const { startContainerServer } = await import(
          "@umwelten/habitat/container-server.js"
        );
        const server = await startContainerServer({
          habitat,
          port: parseInt(merged.port ?? "7430", 10),
          host: merged.host ?? "0.0.0.0",
          name: habitat.getConfig().name ?? "habitat",
        });
        const shutdown = () => {
          console.log("\n[container] Shutting down...");
          server.close();
          process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      }
    },
  );

habitatCommand.addCommand(serveSubcommand);

// Gaia orchestrator subcommand — a normal habitat with extra tools + routes
const gaiaSubcommand = new Command("gaia").description(
  "Start the Gaia orchestrator — manage multiple habitat containers from a dashboard.",
);
addSharedOptions(gaiaSubcommand)
  .option("--port <port>", "HTTP port (default: 7420)", "7420")
  .option("--data-dir <path>", "Data directory (default: ./gaia-data)", "./gaia-data")
  .action(
    async (
      options: HabitatCLIOptions & { port?: string; dataDir?: string },
      command: Command,
    ) => {
      const merged = mergedHabitatCliOptions(command, options);
      const { resolve: pathResolve } = await import("node:path");
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { fileURLToPath: toPath } = await import("node:url");
      const { fileExists } = await import("@umwelten/habitat/config.js");
      const { containerToolSets } = await import("@umwelten/habitat/tool-sets.js");
      const { GaiaRegistryManager } = await import("@umwelten/habitat/gaia/registry.js");
      const { GaiaSecretVault } = await import("@umwelten/habitat/gaia/secrets.js");
      const { DockerManager } = await import("@umwelten/habitat/gaia/docker.js");
      const { CredentialCatalog } = await import("@umwelten/habitat/gaia/credential-catalog.js");
      const { createGaiaToolSet } = await import("@umwelten/habitat/gaia/gaia-tools.js");
      const { handleGaiaRoute } = await import("@umwelten/habitat/gaia/routes.js");

      const dataDir = pathResolve(options.dataDir ?? "./gaia-data");
      await mkdir(dataDir, { recursive: true });

      // Write default STIMULUS.md if missing
      const stimulusPath = pathResolve(dataDir, "STIMULUS.md");
      if (!(await fileExists(stimulusPath))) {
        await writeFile(stimulusPath, [
          "# Gaia — Habitat Orchestrator",
          "",
          "You are Gaia, the habitat orchestrator. You manage multiple habitat containers — creating, starting, stopping, querying, and configuring them.",
          "",
          "You can also manage the master secret vault and delegate tasks to running habitats via A2A (Agent-to-Agent protocol).",
          "",
          "## Important: Config-Driven Habitat Management",
          "",
          "Habitats are managed declaratively through their config. NEVER ask a running habitat to install skills at runtime — those changes are lost on rebuild.",
          "",
          "To add a skill to a habitat, use `add_skill` with the git repo (e.g. 'typefully/agent-skills'). This records it in the habitat's config. Then `rebuild_habitat` to apply. The container will clone and load the skill on startup.",
          "",
          "To check what a running habitat knows or can do, use `ask_habitat` or `discover_habitats`.",
          "",
          "The goal is that a habitat can be fully recreated from its config: provider, model, secrets, and skills. If you destroy and rebuild a habitat, it should come back exactly as configured.",
          "",
          "## Sharing Links",
          "",
          "When listing habitats or reporting status, ALWAYS include the web UI URL (from the `url` field in tool results). These URLs contain the auth token so the user can click them directly. Format them as clickable links.",
          "",
          "When users ask about their habitats, use your tools to check status, view logs, or relay questions. Be proactive about suggesting next steps.",
          "",
        ].join("\n"));
      }

      // Write default config.json if missing
      const configPath = pathResolve(dataDir, "config.json");
      if (!(await fileExists(configPath))) {
        await writeFile(configPath, JSON.stringify({
          name: "Gaia Orchestrator",
          defaultProvider: merged.provider,
          defaultModel: merged.model,
        }, null, 2) + "\n");
      }

      // Initialize gaia components
      const registry = new GaiaRegistryManager(dataDir);
      await registry.load();
      const vault = new GaiaSecretVault(dataDir);
      await vault.load();
      const projectRoot = pathResolve(toPath(import.meta.url), "..", "..", "..");
      const docker = new DockerManager(dataDir, projectRoot);
      await docker.ensureNetwork().catch(() => {});

      // Create habitat with container tools + gaia orchestrator tools
      const catalog = new CredentialCatalog(dataDir);
      await catalog.load();
      const gaiaToolSet = createGaiaToolSet({ registry, vault, docker, catalog });
      const habitat = await Habitat.create({
        workDir: dataDir,
        sessionsDir: pathResolve(dataDir, "sessions"),
        envPrefix: "HABITAT",
        toolSets: [...containerToolSets, gaiaToolSet],
      });

      if (merged.provider && merged.model) {
        habitat.setRuntimeModelDetails({ provider: merged.provider, name: merged.model });
      }

      // Start the standard container server with gaia routes
      const { startContainerServer } = await import("@umwelten/habitat/container-server.js");
      const routeCtx = { registry, vault, docker };
      const server = await startContainerServer({
        habitat,
        port: parseInt(options.port ?? "7420", 10),
        host: "0.0.0.0",
        name: "Gaia Orchestrator",
        extraRawHandler: (req, res) => handleGaiaRoute(routeCtx, req, res),
      });

      const shutdown = () => {
        console.log("\n[container] Shutting down...");
        server.close();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    },
  );

habitatCommand.addCommand(gaiaSubcommand);

// ── habitat chat — connect to a running habitat's /api/chat ──────────────
const chatSubcommand = new Command("chat")
  .description(
    "Connect to a running habitat and chat with it (uses the habitat's own LLM).",
  )
  .requiredOption("--url <url>", "Habitat base URL (e.g. http://localhost:7440)")
  .option("--token <token>", "Bearer token for auth (or set HABITAT_CHAT_TOKEN env var)")
  .option("--one-shot <prompt>", "Send a single prompt and exit")
  .action(async (opts: { url: string; token?: string; oneShot?: string }) => {
    const chalk = (await import("chalk")).default;
    const { createInterface } = await import("node:readline");
    const { createMarkdownChatObserver } = await import(
      "@umwelten/core/cognition/observers.js"
    );
    const http = await import("node:http");
    const https = await import("node:https");

    const baseUrl = opts.url.replace(/\/+$/, "");
    let token = opts.token ?? process.env.HABITAT_CHAT_TOKEN;

    // Auto-discover token from Gaia registry if not provided
    if (!token) {
      token = await discoverToken(baseUrl);
      if (token) {
        console.log(chalk.dim("(token auto-discovered from gaia registry)"));
      }
    }

    // Thread ID for session continuity across turns
    const threadId = `cli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Check health first
    try {
      const health = await fetchJson(`${baseUrl}/health`, token);
      console.log(
        `Connected to ${chalk.green(health.name ?? "habitat")} (${health.tools ?? "?"} tools, model: ${chalk.cyan(health.model ?? "none")})`,
      );
      if (!health.model) {
        console.log(
          chalk.yellow("Warning: No model configured — the habitat may not respond."),
        );
      }
    } catch (err: any) {
      console.error(chalk.red(`Cannot reach ${baseUrl}: ${err.message}`));
      process.exit(1);
    }

    async function sendMessage(text: string): Promise<void> {
      const obs = await createMarkdownChatObserver();
      const body = JSON.stringify({
        id: threadId,
        messages: [{ role: "user", content: text }],
      });

      const url = new URL(`${baseUrl}/api/chat`);
      const isHttps = url.protocol === "https:";
      const reqModule = isHttps ? https : http;

      return new Promise<void>((resolve, reject) => {
        const req = reqModule.request(
          {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname,
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
          },
          (res) => {
            if (res.statusCode && res.statusCode >= 400) {
              let data = "";
              res.on("data", (c) => (data += c));
              res.on("end", () => {
                console.error(chalk.red(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
                resolve();
              });
              return;
            }

            let buffer = "";
            res.on("data", (chunk: Buffer) => {
              buffer += chunk.toString();
              // Process complete SSE lines
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? ""; // Keep incomplete last line
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6).trim();
                if (payload === "[DONE]") continue;
                try {
                  const event = JSON.parse(payload);
                  switch (event.type) {
                    case "text-delta":
                      obs.onTextDelta?.(event.delta);
                      break;
                    case "reasoning-delta":
                      process.stdout.write(chalk.dim(event.delta));
                      break;
                    case "tool-input-available":
                      console.log(
                        chalk.dim(`\n  [tool] ${event.toolName}(${truncateJson(event.input, 80)})`),
                      );
                      break;
                    case "tool-output-available": {
                      const out = typeof event.output === "string"
                        ? event.output
                        : JSON.stringify(event.output);
                      const isErr = !!event.errorText;
                      console.log(
                        isErr
                          ? chalk.red(`  [error] ${out.slice(0, 200)}`)
                          : chalk.dim(`  [result] ${out.slice(0, 200)}${out.length > 200 ? "..." : ""}`),
                      );
                      break;
                    }
                    case "error":
                      console.error(chalk.red(`  [error] ${event.errorText}`));
                      break;
                  }
                } catch {
                  // Skip unparseable lines
                }
              }
            });
            res.on("end", () => {
              obs.end();
              process.stdout.write("\n");
              resolve();
            });
          },
        );
        req.on("error", reject);
        req.write(body);
        req.end();
      });
    }

    // One-shot mode
    if (opts.oneShot) {
      await sendMessage(opts.oneShot);
      return;
    }

    // REPL mode
    console.log(chalk.dim("Type a message, or /quit to exit.\n"));
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    const askQuestion = (): void => {
      rl.question(chalk.blue("you> "), async (input) => {
        const trimmed = input.trim();
        if (!trimmed) { askQuestion(); return; }
        if (trimmed === "/quit" || trimmed === "/exit" || trimmed === "/q") {
          rl.close();
          return;
        }
        await sendMessage(trimmed);
        askQuestion();
      });
    };
    askQuestion();
  });

function truncateJson(input: unknown, max: number): string {
  const s = typeof input === "string" ? input : JSON.stringify(input);
  return s.length > max ? s.slice(0, max) + "..." : s;
}

async function fetchJson(url: string, token?: string): Promise<any> {
  const http = await import("node:http");
  const https = await import("node:https");
  const parsed = new URL(url);
  const reqModule = parsed.protocol === "https:" ? https : http;
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    reqModule.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers,
      },
      (res: any) => {
        let data = "";
        res.on("data", (c: string) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error(`Invalid JSON from ${url}`)); }
        });
      },
    ).on("error", reject);
  });
}

/**
 * Auto-discover a habitat's API key from a gaia registry file.
 * Looks for gaia-data/registry.json in the cwd and matches by port.
 */
async function discoverToken(baseUrl: string): Promise<string | undefined> {
  const { readFile: rf } = await import("node:fs/promises");
  const { resolve: resolvePath } = await import("node:path");

  // Try common locations for the registry
  const candidates = [
    resolvePath("gaia-data", "registry.json"),
    resolvePath("registry.json"),
  ];

  const parsed = new URL(baseUrl);
  const port = parseInt(parsed.port || "80", 10);

  for (const candidate of candidates) {
    try {
      const raw = await rf(candidate, "utf-8");
      const registry = JSON.parse(raw);
      const habitats = registry.habitats ?? [];
      // Match by port
      const match = habitats.find((h: any) => h.containerPort === port);
      if (match?.apiKey) return match.apiKey;
    } catch {
      // File doesn't exist — try next
    }
  }
  return undefined;
}

habitatCommand.addCommand(chatSubcommand);
