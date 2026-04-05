import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ThreadAutoArchiveDuration,
  type ChatInputCommandInteraction,
  type Message,
  type TextChannel,
  type DMChannel,
  type NewsChannel,
  type ThreadChannel,
} from "discord.js";
import type { CoreMessage } from "ai";
import path from "node:path";
import fs from "node:fs/promises";
import { Interaction } from "../../interaction/core/interaction.js";
import { Stimulus } from "../../stimulus/stimulus.js";
import type { ModelDetails } from "../../cognition/types.js";
import {
  ambientInboundAllowed,
  channelAmbientFlags,
} from "./discord-message-gate.js";
import { transcriptJsonlHasAssistant } from "./discord-transcript-ambient.js";

const DISCORD_MESSAGE_MAX = 2000;

/** Discord gateway close code when the app requests intents not enabled in the portal. */
const DISCORD_CLOSE_DISALLOWED_INTENTS = 4014;

function logDiscordPrivilegedIntentHelp(): void {
  console.error(
    "[DISCORD] The gateway rejected this bot because a requested intent is not allowed for your application.",
  );
  console.error(
    "[DISCORD] Fix: https://discord.com/developers/applications → select your app → Bot → scroll to “Privileged Gateway Intents” → turn ON “Message Content Intent” (required for reading normal chat text). Save, then restart the bot.",
  );
}

/**
 * Optional context for routing and on-disk sessions.
 * `isDiscordThread`: native Discord thread → stable session dir per thread id.
 */
export type DiscordStimulusContext = {
  parentChannelId?: string | null;
  isDiscordThread?: boolean;
};

export interface DiscordAdapterConfig {
  token: string;
  modelDetails: ModelDetails;
  visionModelDetails?: ModelDetails;
  /** Resolve stimulus for this Discord channel (main habitat vs buildAgentStimulus per routing). */
  getStimulusForChannel: (
    channelId: string,
    context?: DiscordStimulusContext,
  ) => Promise<Stimulus>;
  /**
   * When set, compared on each message so a changed discord.json invalidates the cached Interaction
   * for this channel/thread without `/reload-routing`.
   */
  getDiscordRouteSignature?: (
    channelId: string,
    context?: DiscordStimulusContext,
  ) => Promise<string>;
  /**
   * When true, the bot replies to every message (dedicated sub-agent channel).
   * When false, only @mentions in a **thread** (guild) or @mentions in **DMs**.
   * If omitted, every message is processed (legacy).
   */
  getDiscordUnrestrictedMessages?: (
    channelId: string,
    context?: DiscordStimulusContext,
  ) => Promise<boolean>;
  getSessionMediaDir?: (
    channelId: string,
    context?: DiscordStimulusContext,
  ) => Promise<string>;
  getSessionDir?: (
    channelId: string,
    context?: DiscordStimulusContext,
  ) => Promise<{ sessionId: string; sessionDir: string }>;
  writeTranscript?: (
    sessionDir: string,
    messages: CoreMessage[],
    reasoning?: string,
  ) => Promise<void>;
  startNewThread?: (
    channelId: string,
    opts?: { isDiscordThread?: boolean },
  ) => Promise<void>;
  resumeMessagePairs?: number;
  /** Register slash commands to this guild (recommended for dev); omit for global registration. */
  guildId?: string;
  /** Habitat work dir for `/provision` (optional; falls back to env). */
  workDir?: string;
  /** Override path to discord.json for `/provision`. */
  discordRoutingPath?: string;
}

type SendableChannel = TextChannel | DMChannel | NewsChannel | ThreadChannel;

export class DiscordAdapter {
  private client: Client;
  private config: DiscordAdapterConfig;
  private interactions = new Map<string, Interaction>();
  private routeSignatures = new Map<string, string>();
  private typingIntervals = new Map<string, NodeJS.Timeout>();
  /** Throttle Discord thread title renames (API limits). */
  private threadTitleLastUpdate = new Map<string, number>();
  /**
   * DM / thread ids where the bot has already replied in ambient mode — follow-up
   * messages do not need @mention (parent channels still do).
   */
  private ambientConversationUnlocked = new Set<string>();
  /**
   * Thread/DM ids we already scanned on disk for a prior assistant transcript (avoid
   * re-reading transcript.jsonl on every message).
   */
  private ambientDiskUnlockScanned = new Set<string>();

  constructor(config: DiscordAdapterConfig) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      // Without Channel partials, MESSAGE_CREATE for a new DM is dropped: the DM channel
      // is not in cache yet, so discord.js never emits messageCreate (see Action#getChannel).
      partials: [Partials.Channel],
    });
    this.setupHandlers();
  }

  private logMessage(
    direction: "←" | "→",
    message: Message,
    content: string,
  ): void {
    const user = message.author.username;
    const ch = message.channelId;
    const timestamp = new Date().toISOString().slice(11, 19);
    const preview =
      content.length > 100 ? content.slice(0, 100) + "..." : content;
    console.log(`[${timestamp}] ${direction} [${ch}] @${user}: ${preview}`);
  }

  private setupHandlers(): void {
    this.client.once(Events.ClientReady, async (c) => {
      console.log(`[DISCORD] Logged in as ${c.user?.tag}`);
      await this.registerSlashCommands();
    });

    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;
      if (!message.channel) return;
      await this.handleIncomingMessage(message);
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.handleSlash(interaction);
    });

    this.client.on(Events.Error, (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("disallowed intents") ||
        msg.includes("Disallowed intent")
      ) {
        logDiscordPrivilegedIntentHelp();
      }
      console.error("[DISCORD] Client error:", err);
    });

    this.client.on(Events.ShardDisconnect, (closeEvent, _shardId) => {
      const code = (closeEvent as { code?: number }).code;
      if (code === DISCORD_CLOSE_DISALLOWED_INTENTS) {
        logDiscordPrivilegedIntentHelp();
      }
    });
  }

  private async registerSlashCommands(): Promise<void> {
    const appId = this.client.application?.id ?? this.client.user?.id;
    if (!appId) {
      console.error("[DISCORD] Could not resolve application id for slash commands");
      return;
    }

    const commands = [
      new SlashCommandBuilder()
        .setName("start")
        .setDescription("Start a new conversation thread in this channel"),
      new SlashCommandBuilder()
        .setName("reset")
        .setDescription("Clear conversation history in this channel"),
      new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show help for this bot"),
      new SlashCommandBuilder()
        .setName("reload-routing")
        .setDescription("Reload discord.json routing (admin only)"),
      new SlashCommandBuilder()
        .setName("provision")
        .setDescription("Create a text channel for an agent (admin, DISCORD_AUTO_CHANNELS=1)")
        .addStringOption((o) =>
          o
            .setName("agent_id")
            .setDescription("Habitat agent id from config.json")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("channel_name")
            .setDescription("Discord channel name slug, e.g. operations")
            .setRequired(true),
        ),
      new SlashCommandBuilder()
        .setName("bind-agent")
        .setDescription(
          "Map this channel or thread to a habitat agent (Manage Channels)",
        )
        .addStringOption((o) =>
          o
            .setName("agent_id")
            .setDescription("Agent id from habitat config.json (e.g. ops, coding)")
            .setRequired(true),
        ),
      new SlashCommandBuilder()
        .setName("unbind-agent")
        .setDescription(
          "Remove agent mapping for this channel or thread; inherits parent or main (Manage Channels)",
        ),
    ].map((c) => c.toJSON());

    const rest = new REST({ version: "10" }).setToken(this.config.token);
    try {
      if (this.config.guildId) {
        await rest.put(Routes.applicationGuildCommands(appId, this.config.guildId), {
          body: commands,
        });
        console.log(
          `[DISCORD] Registered slash commands for guild ${this.config.guildId}`,
        );
      } else {
        await rest.put(Routes.applicationCommands(appId), { body: commands });
        console.log("[DISCORD] Registered global slash commands (may take up to 1h to appear)");
      }
    } catch (e) {
      console.error("[DISCORD] Failed to register slash commands:", e);
    }
  }

  private startTypingLoop(channel: SendableChannel, key: string): void {
    this.stopTypingLoop(key);
    const tick = (): void => {
      if (channel.isSendable()) {
        channel.sendTyping().catch(() => {});
      }
    };
    tick();
    const interval = setInterval(tick, 8000);
    this.typingIntervals.set(key, interval);
  }

  private stopTypingLoop(key: string): void {
    const t = this.typingIntervals.get(key);
    if (t) {
      clearInterval(t);
      this.typingIntervals.delete(key);
    }
  }

  private clearChannelSession(channelId: string): void {
    this.interactions.delete(channelId);
    this.ambientConversationUnlocked.delete(channelId);
    this.ambientDiskUnlockScanned.delete(channelId);
  }

  private afterAmbientBotReply(
    sessionChannelId: string,
    unrestricted: boolean,
  ): void {
    if (!unrestricted) {
      this.ambientConversationUnlocked.add(sessionChannelId);
    }
  }

  private ambientAllowsInboundMessage(
    message: Message,
    unrestricted: boolean,
  ): boolean {
    const flags = channelAmbientFlags(message);
    return ambientInboundAllowed({
      unrestricted,
      unlockedChannelIds: this.ambientConversationUnlocked,
      ...flags,
    });
  }

  /**
   * After a process restart, in-memory ambient unlock is empty. If this DM/thread has a
   * persisted transcript that includes an assistant turn, treat it as unlocked so
   * follow-ups without @mention still work (matches pre-restart behavior).
   */
  private async hydrateAmbientUnlockFromTranscript(
    message: Message,
    unrestricted: boolean,
  ): Promise<void> {
    if (unrestricted || !this.config.getSessionDir) {
      return;
    }
    const flags = channelAmbientFlags(message);
    if (!flags.isDm && !flags.isThread) {
      return;
    }
    const channelId = flags.channelId;
    if (this.ambientConversationUnlocked.has(channelId)) {
      return;
    }
    if (this.ambientDiskUnlockScanned.has(channelId)) {
      return;
    }
    const ctx: DiscordStimulusContext = {
      parentChannelId: parentChannelIdFromChannel(message.channel),
      isDiscordThread: flags.isThread,
    };
    try {
      const { sessionDir } = await this.config.getSessionDir(channelId, ctx);
      this.ambientDiskUnlockScanned.add(channelId);
      if (await transcriptJsonlHasAssistant(sessionDir)) {
        this.ambientConversationUnlocked.add(channelId);
      }
    } catch {
      /* ignore */
    }
  }

  private async handleSlash(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const channelId = interaction.channelId;
    if (!channelId) {
      await interaction.reply({
        content: "No channel context.",
        ephemeral: true,
      });
      return;
    }

    const name = interaction.commandName;

    if (
      name === "reload-routing" ||
      name === "provision" ||
      name === "bind-agent" ||
      name === "unbind-agent"
    ) {
      const isGuild = interaction.inGuild();
      if (!isGuild) {
        await interaction.reply({
          content: "This command only works in a server.",
          ephemeral: true,
        });
        return;
      }
    }

    if (name === "reload-routing" || name === "provision") {
      if (
        !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
      ) {
        await interaction.reply({
          content: "Administrator permission required.",
          ephemeral: true,
        });
        return;
      }
    }

    if (name === "bind-agent" || name === "unbind-agent") {
      if (
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)
      ) {
        await interaction.reply({
          content: "Manage Channels permission required.",
          ephemeral: true,
        });
        return;
      }
    }

    if (name === "reload-routing") {
      this.interactions.clear();
      this.routeSignatures.clear();
      this.ambientConversationUnlocked.clear();
      this.ambientDiskUnlockScanned.clear();
      await interaction.reply({
        content:
          "Cleared all in-memory channel sessions. New messages pick up updated discord.json.",
        ephemeral: true,
      });
      return;
    }

    if (name === "provision") {
      await interaction.deferReply({ ephemeral: true });
      const agentId = interaction.options.getString("agent_id", true);
      const channelName = interaction.options.getString("channel_name", true);
      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply({ content: "Guild not found." });
        return;
      }
      try {
        const { provisionDiscordAgentChannel } = await import(
          "../../habitat/discord-provision.js"
        );
        const workDir =
          this.config.workDir ??
          process.env.HABITAT_WORK_DIR ??
          process.env.JEEVES_WORK_DIR ??
          "";
        if (!workDir) {
          await interaction.editReply({
            content:
              "Configure habitat work directory (CLI) or set HABITAT_WORK_DIR / JEEVES_WORK_DIR.",
          });
          return;
        }
        const result = await provisionDiscordAgentChannel({
          guild,
          workDir,
          agentId,
          channelName,
          routingPath:
            this.config.discordRoutingPath ?? process.env.DISCORD_ROUTING_PATH,
        });
        if (result.ok) {
          await interaction.editReply({
            content: `Created <#${result.channelId}> and mapped to agent \`${agentId}\`.`,
          });
        } else {
          await interaction.editReply({ content: result.error });
        }
      } catch (e) {
        await interaction.editReply({
          content: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    if (name === "bind-agent" || name === "unbind-agent") {
      await interaction.deferReply({ ephemeral: true });
      const workDir =
        this.config.workDir ??
        process.env.HABITAT_WORK_DIR ??
        process.env.JEEVES_WORK_DIR ??
        "";
      if (!workDir) {
        await interaction.editReply({
          content:
            "Configure habitat work directory or set HABITAT_WORK_DIR / JEEVES_WORK_DIR.",
        });
        return;
      }
      const routingPath =
        this.config.discordRoutingPath ?? process.env.DISCORD_ROUTING_PATH;
      try {
        const { setDiscordChannelRoute } = await import(
          "../../habitat/discord-routing.js"
        );
        if (name === "unbind-agent") {
          await setDiscordChannelRoute(workDir, channelId, null, routingPath);
          this.clearChannelSession(channelId);
          this.routeSignatures.delete(channelId);
          await interaction.editReply({
            content:
              "Removed mapping for this channel/thread. Next message uses parent channel, default, or main.",
          });
        } else {
          const agentId = interaction.options.getString("agent_id", true).trim();
          if (!agentId) {
            await interaction.editReply({ content: "agent_id cannot be empty." });
            return;
          }
          await setDiscordChannelRoute(workDir, channelId, agentId, routingPath);
          this.clearChannelSession(channelId);
          this.routeSignatures.delete(channelId);
          await interaction.editReply({
            content: `Mapped this channel/thread to habitat agent \`${agentId}\`. Chat here to talk to that agent.`,
          });
        }
      } catch (e) {
        await interaction.editReply({
          content: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    if (name === "start") {
      await interaction.deferReply();
      const isDiscordThread =
        interaction.channel != null &&
        "isThread" in interaction.channel &&
        typeof interaction.channel.isThread === "function" &&
        interaction.channel.isThread();
      if (this.config.startNewThread) {
        await this.config.startNewThread(channelId, {
          isDiscordThread,
        });
      }
      this.clearChannelSession(channelId);
      const text =
        "Hello! I'm ready to chat.\n\n" +
        "Without `/bind-agent`: @mention me in **DM**, in a **thread**, or in a **channel** (I'll open a thread). With `/bind-agent`, I answer every message here.\n\n" +
        "Commands: `/reset`, `/help`, `/bind-agent`, `/unbind-agent` (Manage Channels), `/reload-routing` (admin)";
      await interaction.editReply(text);
      return;
    }

    if (name === "reset") {
      await interaction.deferReply();
      const isDiscordThread =
        interaction.channel != null &&
        "isThread" in interaction.channel &&
        typeof interaction.channel.isThread === "function" &&
        interaction.channel.isThread();
      if (this.config.startNewThread) {
        await this.config.startNewThread(channelId, {
          isDiscordThread,
        });
      }
      this.clearChannelSession(channelId);
      await interaction.editReply(
        "Conversation cleared. Send a message to start fresh.",
      );
      return;
    }

    if (name === "help") {
      await interaction.reply({
        content:
          "Without `/bind-agent`: @mention in a **thread**, in **DM**, or in a **channel** (the bot opens a thread from your message). After `/bind-agent`, it answers every message there. `/unbind-agent` restores mention mode. Admins: `/provision`, `/reload-routing`. See the Jeeves README.",
        ephemeral: false,
      });
    }
  }

  private async computeUnrestricted(message: Message): Promise<boolean> {
    if (!this.config.getDiscordUnrestrictedMessages) {
      return true;
    }
    return this.config.getDiscordUnrestrictedMessages(message.channelId, {
      parentChannelId: parentChannelIdFromChannel(message.channel),
    });
  }

  private async resolveReplyTarget(
    message: Message,
    unrestricted: boolean,
  ): Promise<{
    sessionChannelId: string;
    parentChannelId: string | undefined;
    replyChannel: SendableChannel;
    isDiscordThread: boolean;
  } | null> {
    const ch = message.channel;
    if (!ch?.isTextBased() || !ch.isSendable()) {
      return null;
    }

    if (unrestricted) {
      const isDiscordThread =
        "isThread" in ch &&
        typeof ch.isThread === "function" &&
        ch.isThread();
      return {
        sessionChannelId: message.channelId,
        parentChannelId: parentChannelIdFromChannel(ch),
        replyChannel: ch as SendableChannel,
        isDiscordThread,
      };
    }

    if (ch.isDMBased()) {
      return {
        sessionChannelId: message.channelId,
        parentChannelId: undefined,
        replyChannel: ch as SendableChannel,
        isDiscordThread: false,
      };
    }

    if (ch.isThread()) {
      return {
        sessionChannelId: message.channelId,
        parentChannelId: ch.parentId ?? undefined,
        replyChannel: ch as SendableChannel,
        isDiscordThread: true,
      };
    }

    if (!message.inGuild()) {
      return null;
    }

    try {
      const name = threadTitleFromUserMessage(message);
      const th = await message.startThread({
        name,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        reason: "Jeeves conversation",
      });
      return {
        sessionChannelId: th.id,
        parentChannelId: message.channelId,
        replyChannel: th as SendableChannel,
        isDiscordThread: true,
      };
    } catch (e) {
      console.error("[DISCORD] Could not create thread for @mention:", e);
      await (ch as SendableChannel)
        .send(
          "I could not create a thread here — the bot needs **Create Public Threads** (and **Send Messages in Threads**). Try @mentioning me inside an existing thread instead.",
        )
        .catch(() => {});
      return null;
    }
  }

  private maybeRefreshThreadTitle(
    replyChannel: SendableChannel,
    userText: string,
    assistantText: string,
  ): void {
    if (
      !("isThread" in replyChannel) ||
      typeof replyChannel.isThread !== "function" ||
      !replyChannel.isThread()
    ) {
      return;
    }
    const thread = replyChannel as ThreadChannel;
    const minMs = 90_000;
    const now = Date.now();
    const last = this.threadTitleLastUpdate.get(thread.id);
    if (last !== undefined && now - last < minMs) {
      return;
    }
    const u = userText.replace(/\s+/g, " ").trim().slice(0, 42);
    const a = assistantText.replace(/\s+/g, " ").trim().slice(0, 42);
    const basis = u || a || "Chat";
    let name = `Jeeves · ${basis}`.slice(0, 100);
    if (name.length < 8) {
      name = "Jeeves";
    }
    if (name === thread.name) {
      return;
    }
    this.threadTitleLastUpdate.set(thread.id, now);
    void thread.setName(name).catch(() => {});
  }

  private async handleIncomingMessage(message: Message): Promise<void> {
    if (!message.content && message.attachments.size === 0) return;

    const channel = message.channel;
    if (!channel?.isTextBased() || !channel.isSendable()) return;

    const unrestricted = await this.computeUnrestricted(message);
    await this.hydrateAmbientUnlockFromTranscript(message, unrestricted);
    if (!this.ambientAllowsInboundMessage(message, unrestricted)) {
      return;
    }

    const target = await this.resolveReplyTarget(message, unrestricted);
    if (!target) {
      return;
    }

    const stimulusCtx: DiscordStimulusContext = {
      parentChannelId: target.parentChannelId,
      isDiscordThread: target.isDiscordThread,
    };

    if (message.attachments.size > 0) {
      await this.handleAttachments(
        message,
        target,
        stimulusCtx,
        unrestricted,
      );
      return;
    }

    const text = message.content?.trim();
    if (!text) return;

    this.logMessage("←", message, text);

    const { sessionChannelId, replyChannel } = target;
    const interaction = await this.getInteraction(sessionChannelId, stimulusCtx);
    const typingKey = sessionChannelId;
    this.startTypingLoop(replyChannel, typingKey);

    if (this.config.getSessionDir && this.config.writeTranscript) {
      const { sessionDir } = await this.config.getSessionDir(
        sessionChannelId,
        stimulusCtx,
      );
      interaction.setOnTranscriptUpdate((messages) => {
        void this.config.writeTranscript!(sessionDir, messages);
      });
    }

    try {
      interaction.addMessage({ role: "user", content: text });
      const response = await interaction.streamText();
      const responseText = messageContentForDiscord(response.content as string);

      if (
        !responseText &&
        response.metadata &&
        (response.metadata as { toolCalls?: unknown[] }).toolCalls
      ) {
        const toolCalls = (response.metadata as { toolCalls?: unknown[] })
          .toolCalls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          try {
            const followUp = await interaction.streamText();
            const followText = messageContentForDiscord(
              followUp.content as string,
            );
            if (followText) {
              await this.sendChunks(replyChannel, followText);
              this.afterAmbientBotReply(sessionChannelId, unrestricted);
              this.logMessage("→", message, followText);
              this.maybeRefreshThreadTitle(replyChannel, text, followText);
              if (this.config.getSessionDir && this.config.writeTranscript) {
                const { sessionDir } = await this.config.getSessionDir(
                  sessionChannelId,
                  stimulusCtx,
                );
                const reasoning =
                  typeof followUp.reasoning === "string"
                    ? followUp.reasoning
                    : followUp.reasoning != null
                      ? String(followUp.reasoning)
                      : undefined;
                await this.config.writeTranscript(
                  sessionDir,
                  interaction.getMessages(),
                  reasoning,
                );
              }
              return;
            }
          } catch {
            // fall through
          }
        }
      }

      if (!responseText) {
        await replyChannel.send(
          "I looked into that but don't have a clear result. Try rephrasing or `/reset`.",
        );
        this.logMessage("→", message, "(no content – fallback)");
      } else {
        await this.sendChunks(replyChannel, responseText);
        this.afterAmbientBotReply(sessionChannelId, unrestricted);
        this.logMessage("→", message, responseText);
        this.maybeRefreshThreadTitle(replyChannel, text, responseText);
      }

      if (this.config.getSessionDir && this.config.writeTranscript) {
        const { sessionDir } = await this.config.getSessionDir(
          sessionChannelId,
          stimulusCtx,
        );
        const reasoning =
          typeof response.reasoning === "string"
            ? response.reasoning
            : response.reasoning != null
              ? String(response.reasoning)
              : undefined;
        await this.config.writeTranscript(
          sessionDir,
          interaction.getMessages(),
          reasoning,
        );
      }
    } catch (error) {
      console.error("[DISCORD] Error processing message:", error);
      await replyChannel
        .send("Sorry, something went wrong. Try again or `/reset`.")
        .catch(() => {});
      if (this.config.getSessionDir && this.config.writeTranscript) {
        try {
          const { sessionDir } = await this.config.getSessionDir(
            sessionChannelId,
            stimulusCtx,
          );
          await this.config.writeTranscript(
            sessionDir,
            interaction.getMessages(),
          );
        } catch {
          /* ignore */
        }
      }
    } finally {
      this.stopTypingLoop(typingKey);
    }
  }

  private async handleAttachments(
    message: Message,
    target: {
      sessionChannelId: string;
      replyChannel: SendableChannel;
    },
    stimulusCtx: DiscordStimulusContext,
    unrestricted: boolean,
  ): Promise<void> {
    const { sessionChannelId, replyChannel } = target;
    const caption = message.content?.trim() ?? "";
    this.logMessage("←", message, `[attachments] ${caption}`);

    const hasVisual = message.attachments.some((a) =>
      a.contentType?.startsWith("image/"),
    );
    const hasVideo = message.attachments.some((a) =>
      a.contentType?.startsWith("video/"),
    );
    const isVisual = hasVisual || hasVideo;

    const { interaction, isVisionModel } = isVisual
      ? await this.getVisionInteraction(sessionChannelId, stimulusCtx)
      : {
          interaction: await this.getInteraction(sessionChannelId, stimulusCtx),
          isVisionModel: false,
        };

    if (isVisionModel && this.config.visionModelDetails) {
      console.log(
        `[DISCORD] Using vision model: ${this.config.visionModelDetails.name}`,
      );
    }

    const typingKey = sessionChannelId;
    this.startTypingLoop(replyChannel, typingKey);

    const maxBytes = 25 * 1024 * 1024;

    try {
      const mediaDir = this.config.getSessionMediaDir
        ? await this.config.getSessionMediaDir(sessionChannelId, stimulusCtx)
        : path.join(process.cwd(), "discord-media");

      await fs.mkdir(mediaDir, { recursive: true });

      for (const att of message.attachments.values()) {
        if (att.size > maxBytes) {
          await replyChannel.send(
            `Attachment **${att.name}** is too large (max ~25MB).`,
          );
          this.stopTypingLoop(typingKey);
          return;
        }

        const ext =
          path.extname(att.name || "").slice(1) ||
          (att.contentType?.split("/")[1]?.split(";")[0] ?? "bin");
        const safeName = `${att.id}.${ext}`;
        const filePath = path.join(mediaDir, safeName);

        const res = await fetch(att.url);
        if (!res.ok) {
          await replyChannel.send(`Could not download **${att.name}**.`);
          this.stopTypingLoop(typingKey);
          return;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(filePath, buf);

        const mime = att.contentType ?? undefined;
        const isAudio = mime?.startsWith("audio/") ?? false;
        const isVid = mime?.startsWith("video/") ?? false;
        const provider = this.config.modelDetails.provider;
        const supportsAudio =
          provider === "google" ||
          provider === "openai" ||
          provider === "anthropic";
        const supportsVideo = supportsAudio;

        if (isAudio && !supportsAudio) {
          await replyChannel.send(
            `The current provider (${provider}) may not support audio; try another model or send text.`,
          );
          this.stopTypingLoop(typingKey);
          return;
        }
        if (isVid && !supportsVideo) {
          await replyChannel.send(
            `The current provider (${provider}) may not support video.`,
          );
          this.stopTypingLoop(typingKey);
          return;
        }

        try {
          await interaction.addAttachmentFromPath(filePath, mime);
        } catch (attachErr: unknown) {
          const msg =
            attachErr instanceof Error ? attachErr.message : String(attachErr);
          await replyChannel.send(`Could not use attachment: ${msg}`);
          this.stopTypingLoop(typingKey);
          return;
        }
      }

      if (caption) {
        interaction.addMessage({ role: "user", content: caption });
      }

      if (this.config.getSessionDir && this.config.writeTranscript) {
        const { sessionDir } = await this.config.getSessionDir(
          sessionChannelId,
          stimulusCtx,
        );
        interaction.setOnTranscriptUpdate((messages) => {
          void this.config.writeTranscript!(sessionDir, messages);
        });
      }

      const response = await interaction.streamText();
      const responseText = messageContentForDiscord(response.content as string);

      if (!responseText) {
        await replyChannel.send(
          "I couldn't produce a clear reply for those files. Try `/reset` or different inputs.",
        );
      } else {
        await this.sendChunks(replyChannel, responseText);
        this.afterAmbientBotReply(sessionChannelId, unrestricted);
        this.logMessage("→", message, responseText);
        this.maybeRefreshThreadTitle(replyChannel, caption, responseText);
      }

      if (this.config.getSessionDir && this.config.writeTranscript) {
        const { sessionDir } = await this.config.getSessionDir(
          sessionChannelId,
          stimulusCtx,
        );
        const reasoning =
          typeof response.reasoning === "string"
            ? response.reasoning
            : response.reasoning != null
              ? String(response.reasoning)
              : undefined;
        await this.config.writeTranscript(
          sessionDir,
          interaction.getMessages(),
          reasoning,
        );
      }
    } catch (error: unknown) {
      console.error("[DISCORD] Attachment error:", error);
      await replyChannel
        .send("Sorry, I couldn't process those attachments.")
        .catch(() => {});
    } finally {
      this.stopTypingLoop(typingKey);
    }
  }

  private createInteraction(
    modelDetails: ModelDetails,
    stimulus: Stimulus,
  ): Interaction {
    const s = new Stimulus(stimulus.options);
    for (const [name, tool] of Object.entries(stimulus.getTools())) {
      s.addTool(name, tool);
    }
    s.addInstruction(
      "You are responding in Discord. Prefer short paragraphs. Avoid wide markdown tables; use bullet lists or labeled lines. Keep code in fenced blocks when needed.",
    );
    return new Interaction(modelDetails, s);
  }

  private async getInteraction(
    channelId: string,
    ctx: DiscordStimulusContext,
  ): Promise<Interaction> {
    if (this.config.getDiscordRouteSignature) {
      const sig = await this.config.getDiscordRouteSignature(channelId, ctx);
      const prev = this.routeSignatures.get(channelId);
      if (prev !== undefined && prev !== sig) {
        this.interactions.delete(channelId);
      }
      this.routeSignatures.set(channelId, sig);
    }

    if (!this.interactions.has(channelId)) {
      const stimulus = await this.config.getStimulusForChannel(channelId, ctx);
      const interaction = this.createInteraction(
        this.config.modelDetails,
        stimulus,
      );
      this.interactions.set(channelId, interaction);
      await this.resumeFromTranscript(channelId, interaction, ctx);
    }
    return this.interactions.get(channelId)!;
  }

  private async getVisionInteraction(
    channelId: string,
    ctx: DiscordStimulusContext,
  ): Promise<{ interaction: Interaction; isVisionModel: boolean }> {
    const vision = this.config.visionModelDetails;
    if (
      vision &&
      (vision.name !== this.config.modelDetails.name ||
        vision.provider !== this.config.modelDetails.provider)
    ) {
      const stimulus = await this.config.getStimulusForChannel(channelId, ctx);
      return {
        interaction: this.createInteraction(vision, stimulus),
        isVisionModel: true,
      };
    }
    return {
      interaction: await this.getInteraction(channelId, ctx),
      isVisionModel: false,
    };
  }

  private async resumeFromTranscript(
    channelId: string,
    interaction: Interaction,
    ctx: DiscordStimulusContext,
  ): Promise<void> {
    if (!this.config.getSessionDir) return;
    try {
      const { sessionDir } = await this.config.getSessionDir(channelId, ctx);
      const transcriptPath = path.join(sessionDir, "transcript.jsonl");
      const content = await fs.readFile(transcriptPath, "utf-8").catch(() => "");
      if (!content.trim()) return;

      const lines = content.trim().split("\n");
      const messages: CoreMessage[] = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as {
            message?: { role?: string; content?: string };
          };
          if (
            entry.message?.role === "user" &&
            typeof entry.message.content === "string"
          ) {
            messages.push({ role: "user", content: entry.message.content });
          } else if (
            entry.message?.role === "assistant" &&
            typeof entry.message.content === "string"
          ) {
            messages.push({
              role: "assistant",
              content: entry.message.content,
            });
          }
        } catch {
          /* skip */
        }
      }
      if (messages.length === 0) return;

      const pairCount = this.config.resumeMessagePairs ?? 4;
      const maxMessages = pairCount * 2;
      const recent = messages.slice(-maxMessages);
      while (recent.length > 0 && recent[0].role !== "user") {
        recent.shift();
      }
      if (recent.length === 0) return;
      for (const msg of recent) {
        interaction.addMessage(msg);
      }
      console.log(
        `[DISCORD] Resumed ${recent.length} messages for channel ${channelId}`,
      );
    } catch (err) {
      console.error(`[DISCORD] Could not resume transcript ${channelId}:`, err);
    }
  }

  private async sendChunks(
    channel: SendableChannel,
    content: string,
  ): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) return;

    const chunks = splitDiscordChunks(trimmed, DISCORD_MESSAGE_MAX);
    for (const chunk of chunks) {
      await channel.send({
        content: chunk,
        allowedMentions: { parse: [] },
      });
    }
  }

  async start(): Promise<void> {
    console.log("[DISCORD] Starting bot…");
    console.log(
      `Model: ${this.config.modelDetails.name} (${this.config.modelDetails.provider})`,
    );
    try {
      await this.client.login(this.config.token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("disallowed intents") ||
        msg.includes("Disallowed intent")
      ) {
        logDiscordPrivilegedIntentHelp();
      }
      throw e;
    }
  }

  async stop(): Promise<void> {
    for (const key of this.typingIntervals.keys()) {
      this.stopTypingLoop(key);
    }
    this.client.destroy();
    console.log("[DISCORD] Bot stopped.");
  }
}

function threadTitleFromUserMessage(message: Message): string {
  let raw = "";
  try {
    raw = message.cleanContent ?? message.content ?? "";
  } catch {
    raw = message.content ?? "";
  }
  let t = raw.replace(/<@!?[0-9]+>/g, "").replace(/\s+/g, " ").trim();
  if (!t) {
    t = "Jeeves";
  }
  const max = 100;
  if (t.length > max) {
    t = `${t.slice(0, max - 1)}…`;
  }
  return t;
}

function parentChannelIdFromChannel(
  channel: Message["channel"] | null | undefined,
): string | undefined {
  if (!channel) return undefined;
  if (!("isThread" in channel) || typeof channel.isThread !== "function") {
    return undefined;
  }
  if (channel.isThread()) {
    return channel.parentId ?? undefined;
  }
  return undefined;
}

function messageContentForDiscord(content: string): string {
  if (!content || typeof content !== "string") return "";
  let text = content.trim();
  if (!text) return "";
  text = text
    .replace(/\s*<redacted_thinking>[\s\S]*?<\/think>\s*/gi, "")
    .replace(/\s*\[REASONING[^\]]*\][\s\S]*?(?=\n\n|$)/gi, "")
    .trim();
  const updatePatterns = [
    /^\s*(I've?|I have)\s+(added|updated|appended|written to|saved to)\s+(your\s+)?(memories\.md|facts\.md|private\s+journal\.md|journal)\s*[.!]?\s*$/gim,
    /^\s*(Added|Updated|Appended)\s+(to\s+)?(memories\.md|facts\.md|private\s+journal\.md)\s*[.!]?\s*$/gim,
    /^\s*(Memories|Facts|Private\s+journal)\s+(have\s+been\s+)?updated\.?\s*$/gim,
    /^\s*\[?(Updated?|Wrote)\s+(memories|facts|private\s+journal)[^\]]*\]?\s*$/gim,
  ];
  let prev = "";
  while (prev !== text) {
    prev = text;
    for (const re of updatePatterns) {
      text = text.replace(re, "");
    }
    text = text.replace(/\n{3,}/g, "\n\n").trim();
  }
  return text || "";
}

function splitDiscordChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n\n", maxLen);
    if (splitAt < maxLen / 3) splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen / 3) splitAt = remaining.lastIndexOf(" ", maxLen);
    if (splitAt < maxLen / 3) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks.filter(Boolean);
}
