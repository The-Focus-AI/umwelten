import { Bot, Context } from "grammy";
import { hydrateFiles, FileFlavor } from "@grammyjs/files";
import { type CoreMessage } from "ai";
import { Interaction } from "../../interaction/core/interaction.js";
import { Stimulus } from "../../stimulus/stimulus.js";
import { ModelDetails } from "../../cognition/types.js";
import path from "path";
import fs from "fs/promises";
import { loadRecentHabitatTranscriptCoreMessages } from "../../session-record/habitat-transcript-load.js";
import type { ChannelBridge } from "../../ui/bridge/channel-bridge.js";

type MyContext = FileFlavor<Context>;

export interface TelegramAdapterConfig {
  token: string;
  modelDetails: ModelDetails;
  /** Optional vision-capable model used for image/video media. Falls back to modelDetails if not set. */
  visionModelDetails?: ModelDetails;
  stimulus: Stimulus;
  mediaDir?: string; // Deprecated: Directory where media files will be stored (use getSessionMediaDir instead)
  getSessionMediaDir?: (chatId: number) => Promise<string>; // Function to get session-specific media directory
  getSessionDir?: (chatId: number) => Promise<{ sessionId: string; sessionDir: string }>; // For transcript persistence
  writeTranscript?: (sessionDir: string, messages: import("ai").CoreMessage[], reasoning?: string) => Promise<void>;
  /** Called when user sends /reset or /start so a new session directory is created for the next messages */
  startNewThread?: (chatId: number) => Promise<void>;
  /** Number of recent user+assistant message pairs to restore from transcript on restart (default 4) */
  resumeMessagePairs?: number;
  /** Optional ChannelBridge — when set, delegates interaction management, transcript, and tool-call follow-ups to the bridge. */
  bridge?: ChannelBridge;
}

export class TelegramAdapter {
  private bot: Bot<MyContext>;
  private interactions: Map<number, Interaction> = new Map();
  private config: TelegramAdapterConfig;
  private typingIntervals: Map<number, NodeJS.Timeout> = new Map();

  private logMessage(direction: "←" | "→", ctx: Context, content: string) {
    const user = ctx.from;
    const username = user?.username ? `@${user.username}` : user?.first_name || "unknown";
    const chatId = ctx.chat?.id || "?";
    const timestamp = new Date().toISOString().slice(11, 19);
    const preview = content.length > 100 ? content.slice(0, 100) + "..." : content;
    console.log(`[${timestamp}] ${direction} [${chatId}] ${username}: ${preview}`);
  }

  constructor(config: TelegramAdapterConfig) {
    this.config = config;
    this.bot = new Bot<MyContext>(config.token);
    this.bot.api.config.use(hydrateFiles(config.token));
    this.setupHandlers();
  }

  private setupHandlers() {
    // Commands
    this.bot.command("start", (ctx) => this.handleStart(ctx));
    this.bot.command("reset", (ctx) => this.handleReset(ctx));
    this.bot.command("help", (ctx) => this.handleHelp(ctx));

    // Messages
    this.bot.on("message:text", (ctx) => this.handleText(ctx));
    this.bot.on("message:photo", (ctx) => this.handleMedia(ctx));
    this.bot.on("message:document", (ctx) => this.handleMedia(ctx));
    this.bot.on("message:audio", (ctx) => this.handleMedia(ctx));
    this.bot.on("message:voice", (ctx) => this.handleMedia(ctx));
    this.bot.on("message:video", (ctx) => this.handleMedia(ctx));
    this.bot.on("message:video_note", (ctx) => this.handleMedia(ctx));

    // Error handling
    this.bot.catch((err) => {
      console.error("Bot error:", err);
    });
  }

  private async getInteraction(chatId: number): Promise<Interaction> {
    if (!this.interactions.has(chatId)) {
      const interaction = this.createInteraction(this.config.modelDetails);
      this.interactions.set(chatId, interaction);
      await this.resumeFromTranscript(chatId, interaction);
    }
    return this.interactions.get(chatId)!;
  }

  private createInteraction(modelDetails: ModelDetails): Interaction {
    // Clone stimulus - need to copy tools separately since they're not in options
    const stimulus = new Stimulus(this.config.stimulus.options);
    const originalTools = this.config.stimulus.getTools();
    for (const [name, tool] of Object.entries(originalTools)) {
      stimulus.addTool(name, tool);
    }
    stimulus.addInstruction("You are responding in Telegram. Never use markdown tables — they render poorly. Instead use bold labels on separate lines (e.g. \"**Name**: value\"). Keep formatting simple: bold, italic, code blocks, and links only.");
    return new Interaction(modelDetails, stimulus);
  }

  /**
   * Get or create a vision-capable interaction for media handling.
   * If visionModelDetails is configured and differs from the main model,
   * creates a separate one-shot interaction with the vision model.
   * Otherwise falls back to the main interaction.
   */
  private async getVisionInteraction(chatId: number): Promise<{ interaction: Interaction; isVisionModel: boolean }> {
    const vision = this.config.visionModelDetails;
    if (vision && (vision.name !== this.config.modelDetails.name || vision.provider !== this.config.modelDetails.provider)) {
      return { interaction: this.createInteraction(vision), isVisionModel: true };
    }
    return { interaction: await this.getInteraction(chatId), isVisionModel: false };
  }

  /**
   * Load the last N user+assistant message pairs from a previous transcript into
   * the interaction so the model has conversational context after a bot restart.
   */
  private async resumeFromTranscript(chatId: number, interaction: Interaction): Promise<void> {
    if (!this.config.getSessionDir) return;

    try {
      const { sessionDir } = await this.config.getSessionDir(chatId);
      const pairCount = this.config.resumeMessagePairs ?? 4;
      const maxMessages = pairCount * 2;
      const recent = await loadRecentHabitatTranscriptCoreMessages(
        sessionDir,
        maxMessages,
      );
      if (recent.length === 0) return;

      for (const msg of recent) {
        interaction.addMessage(msg);
      }
      console.log(`[TELEGRAM] Resumed ${recent.length} messages from previous session for chat ${chatId}`);
    } catch (err) {
      // Non-fatal — just start fresh
      console.error(`[TELEGRAM] Could not resume transcript for chat ${chatId}:`, err);
    }
  }

  private startTypingIndicator(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Clear any existing interval
    this.stopTypingIndicator(chatId);

    // Send typing immediately
    ctx.replyWithChatAction("typing").catch(() => {});

    // Refresh typing every 4 seconds (Telegram clears it after 5s)
    const interval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {});
    }, 4000);

    this.typingIntervals.set(chatId, interval);
  }

  private stopTypingIndicator(chatId: number) {
    const interval = this.typingIntervals.get(chatId);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(chatId);
    }
  }

  private async handleStart(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    this.logMessage("←", ctx, "/start");

    if (this.config.startNewThread) {
      await this.config.startNewThread(chatId);
    }
    this.interactions.delete(chatId);
    this.config.bridge?.resetChannel(`telegram:${chatId}`);

    const reply = "Hello! I'm ready to chat. Send me a message or share media.\n\n" +
      "Commands:\n" +
      "/reset - Clear conversation history\n" +
      "/help - Show this help message";
    await ctx.reply(reply);
    this.logMessage("→", ctx, reply);
  }

  private async handleReset(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    this.logMessage("←", ctx, "/reset");

    if (this.config.startNewThread) {
      await this.config.startNewThread(chatId);
    }
    this.interactions.delete(chatId);
    this.config.bridge?.resetChannel(`telegram:${chatId}`);
    const reply = "Conversation cleared. Send a message to start a new conversation.";
    await ctx.reply(reply);
    this.logMessage("→", ctx, reply);
  }

  private async handleHelp(ctx: Context) {
    this.logMessage("←", ctx, "/help");

    const reply = "I'm an AI assistant. Here's what I can do:\n\n" +
      "- Send me text messages and I'll respond\n" +
      "- Share photos, documents, audio, or video for analysis\n" +
      "- Multi-turn conversations (I remember context)\n\n" +
      "Commands:\n" +
      "/start - Start a new conversation\n" +
      "/reset - Clear conversation history\n" +
      "/help - Show this help message";
    await ctx.reply(reply);
    this.logMessage("→", ctx, reply);
  }

  private async handleText(ctx: Context) {
    const chatId = ctx.chat?.id;
    const text = ctx.message?.text;
    if (!chatId || !text) return;

    this.logMessage("←", ctx, text);

    // Bridge commands (/agents, /switch, /status, /help, etc.)
    if (this.config.bridge && text.startsWith('/')) {
      const { processBridgeCommand } = await import('../bridge/commands.js');
      const result = await processBridgeCommand(this.config.bridge, `telegram:${chatId}`, text);
      if (result.handled) {
        if (result.text) await this.sendFormattedMessage(ctx, result.text);
        this.logMessage("→", ctx, result.text || "(command handled)");
        return;
      }
    }

    if (this.config.bridge) {
      return this.handleTextViaBridge(ctx, chatId, text);
    }

    const interaction = await this.getInteraction(chatId);
    this.startTypingIndicator(ctx);

    if (this.config.getSessionDir && this.config.writeTranscript) {
      const { sessionDir } = await this.config.getSessionDir(chatId);
      interaction.setOnTranscriptUpdate((messages) => {
        void this.config.writeTranscript!(sessionDir, messages);
      });
    }

    try {
      interaction.addMessage({ role: "user", content: text });
      
      // Use streamText() like the CLI does - it properly handles tool calls and continues
      const response = await interaction.streamText();
      const responseText = this.messageContentForTelegram(response.content as string);

      // If we have tool calls but no text, the model might need to continue after tool results
      if (!responseText && response.metadata && (response.metadata as any).toolCalls) {
        const toolCalls = (response.metadata as any).toolCalls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          try {
            const followUpResponse = await interaction.streamText();
            const followUpText = this.messageContentForTelegram(followUpResponse.content as string);
            if (followUpText) {
              await this.sendFormattedMessage(ctx, followUpText);
              this.logMessage("→", ctx, followUpText);
              if (this.config.getSessionDir && this.config.writeTranscript) {
                const { sessionDir } = await this.config.getSessionDir(chatId);
                const reasoning =
                  typeof followUpResponse.reasoning === "string"
                    ? followUpResponse.reasoning
                    : followUpResponse.reasoning != null
                      ? String(followUpResponse.reasoning)
                      : undefined;
                await this.config.writeTranscript(sessionDir, interaction.getMessages(), reasoning);
              }
              return;
            }
          } catch {
            // Fall through to fallback message
          }
        }
      }

      if (!responseText) {
        await ctx.reply(
          "I looked into that but don't have a clear result to show. Try rephrasing or use /reset to start over."
        );
        this.logMessage("→", ctx, "(no content – sent fallback)");
      } else {
        await this.sendFormattedMessage(ctx, responseText);
        this.logMessage("→", ctx, responseText);
      }

      if (this.config.getSessionDir && this.config.writeTranscript) {
        const { sessionDir } = await this.config.getSessionDir(chatId);
        const reasoning =
          typeof response.reasoning === "string"
            ? response.reasoning
            : response.reasoning != null
              ? String(response.reasoning)
              : undefined;
        await this.config.writeTranscript(sessionDir, interaction.getMessages(), reasoning);
      }
    } catch (error) {
      console.error("Error processing message:", error);
      const errorMsg = "Sorry, I encountered an error. Please try again or use /reset to start over.";
      await ctx.reply(errorMsg);
      this.logMessage("→", ctx, errorMsg);
      // Persist transcript even on error so the user message is not lost
      if (this.config.getSessionDir && this.config.writeTranscript) {
        try {
          const { sessionDir } = await this.config.getSessionDir(chatId);
          await this.config.writeTranscript(sessionDir, interaction.getMessages());
        } catch (writeErr) {
          console.error("Error writing transcript after failure:", writeErr);
        }
      }
    } finally {
      this.stopTypingIndicator(chatId);
    }
  }

  private async handleTextViaBridge(ctx: Context, chatId: number, text: string): Promise<void> {
    const bridge = this.config.bridge!;
    const channelKey = `telegram:${chatId}`;

    this.startTypingIndicator(ctx);

    try {
      await bridge.handleMessage(
        { channelKey, text, userId: ctx.from?.id?.toString() },
        {
          onDone: async (result) => {
            const formatted = this.messageContentForTelegram(result.content);
            if (!formatted) {
              await ctx.reply(
                "I looked into that but don't have a clear result to show. Try rephrasing or use /reset to start over."
              );
              this.logMessage("→", ctx, "(no content – sent fallback)");
            } else {
              await this.sendFormattedMessage(ctx, formatted);
              this.logMessage("→", ctx, formatted);
            }
          },
          onError: async (error) => {
            console.error("Error processing message:", error);
            const errorMsg = "Sorry, I encountered an error. Please try again or use /reset to start over.";
            await ctx.reply(errorMsg);
            this.logMessage("→", ctx, errorMsg);
          },
        },
      );
    } finally {
      this.stopTypingIndicator(chatId);
    }
  }

  private async handleMedia(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      console.error("[TELEGRAM] handleMedia called but no chatId");
      return;
    }

    const caption = (ctx.message as any)?.caption;
    const mediaType = ctx.message?.photo ? "photo" :
                      ctx.message?.document ? "document" :
                      ctx.message?.audio ? "audio" :
                      ctx.message?.voice ? "voice" :
                      ctx.message?.video ? "video" :
                      ctx.message?.video_note ? "video_note" : "media";
    
    console.log(`[TELEGRAM] handleMedia called for ${mediaType}, chatId: ${chatId}`);
    this.logMessage("←", ctx, `[${mediaType}]${caption ? ` ${caption}` : ""}`);

    const isVisual = mediaType === "photo" || mediaType === "video" || mediaType === "video_note";
    const { interaction, isVisionModel } = isVisual
      ? await this.getVisionInteraction(chatId)
      : { interaction: await this.getInteraction(chatId), isVisionModel: false };

    if (isVisionModel) {
      const vm = this.config.visionModelDetails!;
      console.log(`[TELEGRAM] Using vision model: ${vm.name} (${vm.provider})`);
    }

    this.startTypingIndicator(ctx);

    try {
      // Check file size for documents and videos (Telegram Bot API limit is 20MB for downloads)
      if (ctx.message?.document) {
        const doc = ctx.message.document;
        if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
          await ctx.reply(
            "File too large for processing (max 20MB). Please compress or split the file."
          );
          this.logMessage("→", ctx, "File too large");
          return;
        }
      }
      
      if (ctx.message?.video) {
        const video = ctx.message.video;
        if (video.file_size && video.file_size > 20 * 1024 * 1024) {
          await ctx.reply(
            "Video too large for processing (max 20MB). Please compress or use a shorter video."
          );
          this.logMessage("→", ctx, "Video too large");
          return;
        }
      }
      
      if (ctx.message?.video_note) {
        const videoNote = ctx.message.video_note;
        if (videoNote.file_size && videoNote.file_size > 20 * 1024 * 1024) {
          await ctx.reply(
            "Video note too large for processing (max 20MB)."
          );
          this.logMessage("→", ctx, "Video note too large");
          return;
        }
      }

      // Get file from message
      const file = await ctx.getFile() as any;
      
      // Determine file extension and unique ID
      let fileUniqueId: string;
      let extension: string;
      
      if (ctx.message?.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Highest resolution
        fileUniqueId = photo.file_unique_id;
        extension = "jpg";
      } else if (ctx.message?.document) {
        const doc = ctx.message.document;
        fileUniqueId = doc.file_unique_id;
        extension = path.extname(doc.file_name || "").slice(1) || "bin";
      } else if (ctx.message?.audio) {
        const audio = ctx.message.audio;
        fileUniqueId = audio.file_unique_id;
        extension = path.extname(audio.file_name || "").slice(1) || "mp3";
      } else if (ctx.message?.voice) {
        const voice = ctx.message.voice;
        fileUniqueId = voice.file_unique_id;
        extension = "ogg";
      } else if (ctx.message?.video) {
        const video = ctx.message.video;
        fileUniqueId = video.file_unique_id;
        // Try to get extension from mime_type if available, otherwise default to mp4
        if (video.mime_type) {
          const mimeExt = video.mime_type.split('/')[1]?.split(';')[0];
          extension = mimeExt || "mp4";
        } else {
          extension = "mp4";
        }
        console.log(`[TELEGRAM] Video detected: ${video.width}x${video.height}, duration: ${video.duration}s, size: ${video.file_size} bytes, mime: ${video.mime_type || 'unknown'}`);
      } else if (ctx.message?.video_note) {
        const videoNote = ctx.message.video_note;
        fileUniqueId = videoNote.file_unique_id;
        extension = "mp4"; // Video notes are always MP4
        console.log(`[TELEGRAM] Video note detected: ${videoNote.length}x${videoNote.length}, duration: ${videoNote.duration}s, size: ${videoNote.file_size} bytes`);
      } else {
        fileUniqueId = `file_${Date.now()}`;
        extension = "bin";
      }

      // Get session-specific media directory
      const mediaDir = this.config.getSessionMediaDir 
        ? await this.config.getSessionMediaDir(chatId)
        : (this.config.mediaDir || path.join(process.cwd(), 'telegram-media'));
      
      // Create media directory if it doesn't exist
      await fs.mkdir(mediaDir, { recursive: true });

      // Construct file path
      const fileName = `${fileUniqueId}.${extension}`;
      const filePath = path.join(mediaDir, fileName);

      // Download and save file to disk
      await (file as any).download(filePath);
      console.log(`[TELEGRAM] Saved ${mediaType} to: ${path.resolve(filePath)} (session mediaDir: ${path.resolve(mediaDir)})`);

      // Check if this is an audio file and if the provider supports it
      const isAudio = mediaType === "voice" || mediaType === "audio";
      const isVideo = mediaType === "video" || mediaType === "video_note";
      const provider = this.config.modelDetails.provider;
      const supportsAudio = provider === "google" || provider === "openai" || provider === "anthropic";
      const supportsVideo = provider === "google" || provider === "openai" || provider === "anthropic";
      
      if (isAudio && !supportsAudio) {
        // For unsupported audio, just send a text message instead of trying to process the file
        const audioType = mediaType === "voice" ? "voice message" : "audio file";
        const message = `I received your ${audioType}, but the current model (${provider}) doesn't support audio processing. Please send a text message or use a provider that supports audio (Google, OpenAI, or Anthropic).`;
        await ctx.reply(message);
        this.logMessage("→", ctx, message);
        return;
      }

      if (isVideo && !supportsVideo) {
        // For unsupported video, inform the user
        const message = `I received your video, but the current model (${provider}) doesn't support video processing. Please use a provider that supports video (Google, OpenAI, or Anthropic).`;
        await ctx.reply(message);
        this.logMessage("→", ctx, message);
        return;
      }

      // Check file size before processing (some providers have limits)
      const stats = await fs.stat(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      console.log(`[TELEGRAM] Processing ${mediaType} file: ${path.basename(filePath)} (${fileSizeMB.toFixed(2)} MB)`);
      
      // Warn if file is very large (some providers may have issues with large files)
      if (fileSizeMB > 10) {
        console.warn(`[TELEGRAM] Warning: Large ${mediaType} file (${fileSizeMB.toFixed(2)} MB) - processing may be slow or fail`);
      }

      // Get MIME type for video if available
      let mimeType: string | undefined;
      if (ctx.message?.video?.mime_type) {
        mimeType = ctx.message.video.mime_type;
      } else if (ctx.message?.video_note) {
        mimeType = "video/mp4"; // Video notes are always MP4
      } else if (ctx.message?.document?.mime_type) {
        mimeType = ctx.message.document.mime_type;
      } else if (ctx.message?.audio?.mime_type) {
        mimeType = ctx.message.audio.mime_type;
      }

      // Use existing attachment handling
      try {
        await interaction.addAttachmentFromPath(filePath, mimeType);
        console.log(`[TELEGRAM] Successfully attached ${mediaType} file to interaction${mimeType ? ` (${mimeType})` : ''}`);
      } catch (attachError: any) {
        console.error(`[TELEGRAM] Error attaching ${mediaType} file:`, attachError);
        const errorMsg = `Sorry, I couldn't process the ${mediaType} file. ${attachError.message || 'Unknown error'}`;
        await ctx.reply(errorMsg);
        this.logMessage("→", ctx, errorMsg);
        return;
      }

      // Add caption as additional context if provided
      if (caption) {
        interaction.addMessage({ role: "user", content: caption });
      }

      if (this.config.getSessionDir && this.config.writeTranscript) {
        const { sessionDir } = await this.config.getSessionDir(chatId);
        interaction.setOnTranscriptUpdate((messages) => {
          void this.config.writeTranscript!(sessionDir, messages);
        });
      }

      // Use streamText() like the CLI does - it properly handles tool calls and continues
      const response = await interaction.streamText();
      const responseText = this.messageContentForTelegram(response.content as string);

      if (!responseText) {
        await ctx.reply(
          "I looked into that but don't have a clear result to show. Try rephrasing or use /reset to start over."
        );
        this.logMessage("→", ctx, "(no content – sent fallback)");
      } else {
        await this.sendFormattedMessage(ctx, responseText);
        this.logMessage("→", ctx, responseText);
      }

      if (this.config.getSessionDir && this.config.writeTranscript) {
        const { sessionDir } = await this.config.getSessionDir(chatId);
        const reasoning =
          typeof response.reasoning === "string"
            ? response.reasoning
            : response.reasoning != null
              ? String(response.reasoning)
              : undefined;
        await this.config.writeTranscript(sessionDir, interaction.getMessages(), reasoning);
      }
    } catch (error: any) {
      console.error("Error processing media:", error);

      const errMsg = error?.message ?? '';
      const errBody = error?.responseBody ?? '';
      const isAudioUnsupported = errMsg.includes('audio') || error?.functionality?.includes('audio');
      const isImageUnsupported = errMsg.includes('image input') || errBody.includes('image input');

      let errorMsg: string;
      if (isImageUnsupported) {
        errorMsg = "I received your image, but the current model doesn't support image input. I'll note the caption if you included one. Try a model that supports vision (Google Gemini, GPT-4o, Claude).";
      } else if (isAudioUnsupported) {
        errorMsg = "I received your audio/voice message, but the current model doesn't support audio processing. Please send a text message or use a provider that supports audio (Google, OpenAI, or Anthropic).";
      } else {
        errorMsg = "Sorry, I couldn't process that file. Please try again or use /reset.";
      }
      await ctx.reply(errorMsg);
      this.logMessage("→", ctx, errorMsg);

      // Persist transcript even on error so the user message is not lost
      if (this.config.getSessionDir && this.config.writeTranscript) {
        try {
          const { sessionDir } = await this.config.getSessionDir(chatId);
          await this.config.writeTranscript(sessionDir, interaction.getMessages());
        } catch (writeErr) {
          console.error("Error writing transcript after media failure:", writeErr);
        }
      }
    } finally {
      this.stopTypingIndicator(chatId);
    }
  }

  /**
   * Extract user-facing message content for Telegram: no tools, no reasoning blocks,
   * no internal update announcements (memories.md, facts.md, private journal).
   * Returns trimmed string or empty if there's nothing to show.
   */
  private messageContentForTelegram(content: string): string {
    if (!content || typeof content !== "string") return "";
    let text = content.trim();
    if (!text) return "";
    // Strip reasoning/thinking blocks
    text = text
      .replace(/\s*<think>[\s\S]*?<\/think>\s*/gi, "")
      .replace(/\s*\[REASONING[^\]]*\][\s\S]*?(?=\n\n|$)/gi, "")
      .trim();
    // Remove lines that only announce internal file updates (memories, facts, journal)
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

  /**
   * Convert markdown to Telegram-compatible format.
   * Telegram Markdown uses *bold* (not **), _italic_, `code`, [link](url).
   * Headings and **bold** need conversion.
   */
  private normalizeForTelegram(content: string): string {
    return content
      .replace(/\*\*(.+?)\*\*/g, "*$1*") // **bold** -> *bold*
      .replace(/^#{1,6}\s+(.+)$/gm, "*$1*"); // headings -> bold
  }

  /**
   * Send a message with Markdown formatting, falling back to plain text if parsing fails.
   * Uses HTML as primary (handles **bold**, # headings, code blocks reliably).
   */
  private async sendFormattedMessage(ctx: Context, content: string): Promise<void> {
    if (!content || !content.trim()) return;

    // Convert to HTML first, then split the HTML (not the markdown).
    // This avoids the problem where markdown fits in 4096 but HTML expansion exceeds it.
    const fullHtml = this.markdownToHtml(content.trim());
    const htmlChunks = fullHtml.length > 4096 ? this.splitHtml(fullHtml, 4096) : [fullHtml];

    for (const chunk of htmlChunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      try {
        await ctx.reply(trimmed, { parse_mode: "HTML" });
      } catch (error: any) {
        const desc = error?.description || error?.message || "";
        if (desc.includes("too long")) {
          // Message still too long — force-split into smaller pieces
          const subChunks = this.splitHtml(trimmed, 2048);
          for (const sub of subChunks) {
            if (sub.trim()) await ctx.reply(sub.trim(), { parse_mode: "HTML" }).catch(() => ctx.reply(sub.trim()));
          }
        } else if (desc.includes("parse")) {
          // HTML parse error — fall back to Markdown then plain text
          try {
            const normalized = this.normalizeForTelegram(trimmed);
            await ctx.reply(normalized, { parse_mode: "Markdown" });
          } catch (markdownError: any) {
            if (markdownError?.description?.includes("parse") || markdownError?.message?.includes("parse")) {
              await ctx.reply(trimmed);
            } else {
              throw markdownError;
            }
          }
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Split HTML content at a max length, trying to break at paragraph/newline boundaries.
   * Closes any open HTML tags in each chunk and reopens them in the next.
   */
  private splitHtml(html: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = html;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to split at a double newline (paragraph break)
      let splitIndex = remaining.lastIndexOf("\n\n", maxLength);
      if (splitIndex === -1 || splitIndex < maxLength / 3) {
        // Try single newline
        splitIndex = remaining.lastIndexOf("\n", maxLength);
      }
      if (splitIndex === -1 || splitIndex < maxLength / 3) {
        // Try space
        splitIndex = remaining.lastIndexOf(" ", maxLength);
      }
      if (splitIndex === -1 || splitIndex < maxLength / 3) {
        // Force split — but avoid splitting inside an HTML tag
        splitIndex = maxLength;
        const lastOpenBracket = remaining.lastIndexOf("<", splitIndex);
        const lastCloseBracket = remaining.lastIndexOf(">", splitIndex);
        if (lastOpenBracket > lastCloseBracket) {
          // We're inside a tag — split before it
          splitIndex = lastOpenBracket;
        }
      }

      let chunk = remaining.substring(0, splitIndex);
      remaining = remaining.substring(splitIndex).trimStart();

      // Close any unclosed tags in this chunk, reopen them in the next
      const openTags = this.getUnclosedTags(chunk);
      if (openTags.length > 0) {
        chunk += openTags.map(t => `</${t}>`).reverse().join("");
        remaining = openTags.map(t => `<${t}>`).join("") + remaining;
      }

      chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * Find HTML tags that are opened but not closed in a string.
   * Only tracks simple tags like b, i, code, pre, a (no attributes matching needed for closing).
   */
  private getUnclosedTags(html: string): string[] {
    const tagStack: string[] = [];
    const tagRegex = /<\/?([a-zA-Z]+)[^>]*>/g;
    let match;

    while ((match = tagRegex.exec(html)) !== null) {
      const fullMatch = match[0];
      const tagName = match[1].toLowerCase();

      // Skip self-closing and void elements
      if (fullMatch.endsWith("/>") || ["br", "hr", "img"].includes(tagName)) continue;

      if (fullMatch.startsWith("</")) {
        // Closing tag — pop from stack if it matches
        const idx = tagStack.lastIndexOf(tagName);
        if (idx !== -1) tagStack.splice(idx, 1);
      } else {
        tagStack.push(tagName);
      }
    }

    return tagStack;
  }

  /**
   * Convert basic Markdown to HTML for Telegram. Escapes HTML entities in raw text.
   * Uses escapePlainText for final pass to avoid double-escaping (e.g. &amp; -> &amp;amp;).
   */
  /**
   * Convert a markdown table into a vertical card layout for Telegram.
   * Each data row becomes a block with "Header: value" lines.
   * Works well on narrow mobile screens where wide tables break.
   */
  private markdownTableToCards(tableLines: string[]): string {
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Parse rows, skip separator rows
    const rows: string[][] = [];
    for (const line of tableLines) {
      const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
      if (/^[\s\-:|]+$/.test(trimmed)) continue;
      rows.push(trimmed.split("|").map((c) => c.trim()));
    }
    if (rows.length === 0) return "";

    const headers = rows[0];
    const dataRows = rows.slice(1);

    // If only a header row (no data), just bold it
    if (dataRows.length === 0) {
      return headers.map((h) => `<b>${escape(h)}</b>`).join(" · ");
    }

    // Build vertical cards: each row is a block with "Header: value" lines
    const cards = dataRows.map((row) => {
      const lines = headers
        .map((h, i) => {
          const val = row[i] || "—";
          return `<b>${escape(h)}</b>: ${escape(val)}`;
        })
        .filter((l) => !l.endsWith(": —")); // skip empty columns
      return lines.join("\n");
    });

    return cards.join("\n\n");
  }

  private markdownToHtml(text: string): string {
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // For plain text: escape < > and raw & only (not &amp; &lt; etc.) to avoid double-escaping
    const escapePlainText = (s: string) =>
      s
        .replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[0-9a-fA-F]+;)/gi, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // First, extract markdown tables and replace with placeholders
    const tablePlaceholders: string[] = [];
    const tableRegex = /(?:^|\n)((?:\|.+\|[ \t]*\n){2,})/g;
    const withTablePlaceholders = text.replace(tableRegex, (match, tableBlock: string) => {
      const lines = tableBlock.trim().split("\n");
      const html = this.markdownTableToCards(lines);
      const idx = tablePlaceholders.length;
      tablePlaceholders.push(html);
      return `\n%%TABLE_${idx}%%\n`;
    });

    const out = withTablePlaceholders
      // Code blocks first (preserve content, escape it)
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => `<pre><code>${escape(code)}</code></pre>`)
      // Inline code
      .replace(/`([^`]+)`/g, (_, code) => `<code>${escape(code)}</code>`)
      // Bold (** and __)
      .replace(/\*\*(.+?)\*\*/g, (_, t) => `<b>${escape(t)}</b>`)
      .replace(/__(.+?)__/g, (_, t) => `<b>${escape(t)}</b>`)
      // Headings (use bold)
      .replace(/^#{1,6}\s+(.+)$/gm, (_, t) => `<b>${escape(t)}</b>`)
      // Italic - single * not part of **
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_, t) => `<i>${escape(t)}</i>`)
      .replace(/(?<![_*])_([^_\n]+)_(?![_*])/g, (_, t) => `<i>${escape(t)}</i>`)
      // Strikethrough
      .replace(/~~(.+?)~~/g, (_, t) => `<s>${escape(t)}</s>`)
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${escape(href)}">${escape(label)}</a>`);

    // Restore table placeholders
    const withTables = out.replace(/%%TABLE_(\d+)%%/g, (_, idx) => tablePlaceholders[parseInt(idx)]);

    // Escape plain text between/outside tags; use escapePlainText to avoid double-escaping &amp; etc.
    return withTables.split(/(<[^>]+>)/).map((part) => (part.startsWith("<") ? part : escapePlainText(part))).join("");
  }

  /**
   * Start long-polling. The bot appears "online" in Telegram while this process
   * is running; when stop() is called and the process exits, Telegram shows it
   * as offline. There is no Bot API to set status explicitly.
   */
  async start() {
    console.log("Starting Telegram bot...");
    console.log(`Model: ${this.config.modelDetails.name} (${this.config.modelDetails.provider})`);
    console.log(`Runner: ${this.config.stimulus.getRunnerType()}`);

    if (this.config.stimulus.hasTools()) {
      console.log(`Tools: ${Object.keys(this.config.stimulus.getTools()).join(", ")}`);
    }

    await this.bot.start();
  }

  /** Stop polling and exit; the bot will appear offline in Telegram. */
  async stop() {
    // Stop all typing indicators
    for (const [chatId] of this.typingIntervals) {
      this.stopTypingIndicator(chatId);
    }

    await this.bot.stop();
    console.log("Telegram bot stopped.");
  }
}
