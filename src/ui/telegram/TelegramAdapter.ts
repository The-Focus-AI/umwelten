import { Bot, Context } from "grammy";
import { hydrateFiles, FileFlavor } from "@grammyjs/files";
import { Interaction } from "../../interaction/interaction.js";
import { Stimulus } from "../../stimulus/stimulus.js";
import { ModelDetails } from "../../cognition/types.js";
import path from "path";
import fs from "fs/promises";

type MyContext = FileFlavor<Context>;

export interface TelegramAdapterConfig {
  token: string;
  modelDetails: ModelDetails;
  stimulus: Stimulus;
  mediaDir?: string; // Deprecated: Directory where media files will be stored (use getSessionMediaDir instead)
  getSessionMediaDir?: (chatId: number) => Promise<string>; // Function to get session-specific media directory
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

  private getInteraction(chatId: number): Interaction {
    if (!this.interactions.has(chatId)) {
      // Clone stimulus for each chat - need to copy tools separately since they're not in options
      const stimulus = new Stimulus(this.config.stimulus.options);
      // Copy tools from the original stimulus (tools are stored separately, not in options)
      const originalTools = this.config.stimulus.getTools();
      for (const [name, tool] of Object.entries(originalTools)) {
        stimulus.addTool(name, tool);
      }
      this.interactions.set(chatId, new Interaction(this.config.modelDetails, stimulus));
    }
    return this.interactions.get(chatId)!;
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

    // Delete existing interaction to start fresh
    this.interactions.delete(chatId);

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

    // Delete the interaction to reset (recreated on next message)
    this.interactions.delete(chatId);
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

    const interaction = this.getInteraction(chatId);
    this.startTypingIndicator(ctx);

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
    } catch (error) {
      console.error("Error processing message:", error);
      const errorMsg = "Sorry, I encountered an error. Please try again or use /reset to start over.";
      await ctx.reply(errorMsg);
      this.logMessage("→", ctx, errorMsg);
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

    const interaction = this.getInteraction(chatId);
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
    } catch (error: any) {
      console.error("Error processing media:", error);
      
      // Check if it's an unsupported functionality error for audio
      if (error?.functionality?.includes('audio') || error?.message?.includes('audio')) {
        const errorMsg = "I received your audio/voice message, but the current model doesn't support audio processing. Please send a text message or use a provider that supports audio (Google, OpenAI, or Anthropic).";
        await ctx.reply(errorMsg);
        this.logMessage("→", ctx, errorMsg);
      } else {
        const errorMsg = "Sorry, I couldn't process that file. Please try again or use /reset.";
        await ctx.reply(errorMsg);
        this.logMessage("→", ctx, errorMsg);
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
   * Convert markdown that Telegram doesn't support (e.g. # headings) into supported formatting.
   * Telegram Markdown only supports *bold*, _italic_, `code`, [link](url) — not # headings.
   */
  private normalizeForTelegram(content: string): string {
    return content
      .replace(/^#{1,6}\s+(.+)$/gm, "*$1*"); // headings -> bold
  }

  /**
   * Send a message with Markdown formatting, falling back to plain text if parsing fails
   */
  private async sendFormattedMessage(ctx: Context, content: string): Promise<void> {
    if (!content || !content.trim()) return;

    content = this.normalizeForTelegram(content);

    // Split long messages (Telegram max is 4096 chars)
    const chunks = content.length > 4096 ? this.splitMessage(content, 4096) : [content];

    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      try {
        // Try sending with Markdown formatting
        await ctx.reply(trimmed, { parse_mode: "Markdown" });
      } catch (error: any) {
        // If Markdown parsing fails, try HTML
        if (error?.description?.includes("parse")) {
          try {
            const htmlContent = this.markdownToHtml(trimmed);
            await ctx.reply(htmlContent, { parse_mode: "HTML" });
          } catch {
            // Fall back to plain text
            await ctx.reply(trimmed);
          }
        } else {
          // Re-throw non-parsing errors
          throw error;
        }
      }
    }
  }

  /**
   * Convert basic Markdown to HTML for Telegram
   */
  private markdownToHtml(text: string): string {
    return text
      // Headings (Telegram has no <h1>, use bold)
      .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
      // Code blocks (must be before inline code)
      .replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
      // Inline code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/__(.+?)__/g, "<b>$1</b>")
      // Italic
      .replace(/\*(.+?)\*/g, "<i>$1</i>")
      .replace(/_(.+?)_/g, "<i>$1</i>")
      // Strikethrough
      .replace(/~~(.+?)~~/g, "<s>$1</s>")
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  }

  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to split at a newline
      let splitIndex = remaining.lastIndexOf("\n", maxLength);
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // Try to split at a space
        splitIndex = remaining.lastIndexOf(" ", maxLength);
      }
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // Force split
        splitIndex = maxLength;
      }

      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).trimStart();
    }

    return chunks;
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
