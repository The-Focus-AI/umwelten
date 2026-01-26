import { Bot, Context } from "grammy";
import { hydrateFiles, FileFlavor } from "@grammyjs/files";
import { Interaction } from "../../interaction/interaction.js";
import { Stimulus } from "../../stimulus/stimulus.js";
import { ModelDetails } from "../../cognition/types.js";

type MyContext = FileFlavor<Context>;

export interface TelegramAdapterConfig {
  token: string;
  modelDetails: ModelDetails;
  stimulus: Stimulus;
}

export class TelegramAdapter {
  private bot: Bot<MyContext>;
  private interactions: Map<number, Interaction> = new Map();
  private config: TelegramAdapterConfig;
  private typingIntervals: Map<number, NodeJS.Timeout> = new Map();

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

    // Error handling
    this.bot.catch((err) => {
      console.error("Bot error:", err);
    });
  }

  private getInteraction(chatId: number): Interaction {
    if (!this.interactions.has(chatId)) {
      // Clone stimulus for each chat
      const stimulus = new Stimulus(this.config.stimulus.options);
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

    // Delete existing interaction to start fresh
    this.interactions.delete(chatId);

    await ctx.reply(
      "Hello! I'm ready to chat. Send me a message or share media.\n\n" +
      "Commands:\n" +
      "/reset - Clear conversation history\n" +
      "/help - Show this help message"
    );
  }

  private async handleReset(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Delete the interaction to reset (recreated on next message)
    this.interactions.delete(chatId);
    await ctx.reply("Conversation cleared. Send a message to start a new conversation.");
  }

  private async handleHelp(ctx: Context) {
    await ctx.reply(
      "I'm an AI assistant. Here's what I can do:\n\n" +
      "- Send me text messages and I'll respond\n" +
      "- Share photos, documents, audio, or video for analysis\n" +
      "- Multi-turn conversations (I remember context)\n\n" +
      "Commands:\n" +
      "/start - Start a new conversation\n" +
      "/reset - Clear conversation history\n" +
      "/help - Show this help message"
    );
  }

  private async handleText(ctx: Context) {
    const chatId = ctx.chat?.id;
    const text = ctx.message?.text;
    if (!chatId || !text) return;

    const interaction = this.getInteraction(chatId);
    this.startTypingIndicator(ctx);

    try {
      interaction.addMessage({ role: "user", content: text });
      const response = await interaction.generateText();

      await this.sendFormattedMessage(ctx, response.content as string);
    } catch (error) {
      console.error("Error processing message:", error);
      await ctx.reply("Sorry, I encountered an error. Please try again or use /reset to start over.");
    } finally {
      this.stopTypingIndicator(chatId);
    }
  }

  private async handleMedia(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const interaction = this.getInteraction(chatId);
    this.startTypingIndicator(ctx);

    try {
      // Get file from message
      const file = await ctx.getFile();
      const filePath = await file.download();

      // Use existing attachment handling
      await interaction.addAttachmentFromPath(filePath);

      // Add caption as additional context if provided
      const caption = (ctx.message as any)?.caption;
      if (caption) {
        interaction.addMessage({ role: "user", content: caption });
      }

      const response = await interaction.generateText();

      await this.sendFormattedMessage(ctx, response.content as string);
    } catch (error) {
      console.error("Error processing media:", error);
      await ctx.reply("Sorry, I couldn't process that file. Please try again or use /reset.");
    } finally {
      this.stopTypingIndicator(chatId);
    }
  }

  /**
   * Send a message with Markdown formatting, falling back to plain text if parsing fails
   */
  private async sendFormattedMessage(ctx: Context, content: string): Promise<void> {
    // Split long messages (Telegram max is 4096 chars)
    const chunks = content.length > 4096 ? this.splitMessage(content, 4096) : [content];

    for (const chunk of chunks) {
      try {
        // Try sending with Markdown formatting
        await ctx.reply(chunk, { parse_mode: "Markdown" });
      } catch (error: any) {
        // If Markdown parsing fails, try HTML
        if (error?.description?.includes("parse")) {
          try {
            const htmlContent = this.markdownToHtml(chunk);
            await ctx.reply(htmlContent, { parse_mode: "HTML" });
          } catch {
            // Fall back to plain text
            await ctx.reply(chunk);
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
      // Code blocks (must be first)
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

  async start() {
    console.log("Starting Telegram bot...");
    console.log(`Model: ${this.config.modelDetails.name} (${this.config.modelDetails.provider})`);
    console.log(`Runner: ${this.config.stimulus.getRunnerType()}`);

    if (this.config.stimulus.hasTools()) {
      console.log(`Tools: ${Object.keys(this.config.stimulus.getTools()).join(", ")}`);
    }

    await this.bot.start();
  }

  async stop() {
    // Stop all typing indicators
    for (const [chatId] of this.typingIntervals) {
      this.stopTypingIndicator(chatId);
    }

    await this.bot.stop();
    console.log("Telegram bot stopped.");
  }
}
