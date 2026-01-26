---
title: "Telegram Bot: grammY Framework"
date: 2026-01-26
topic: telegram-bot
recommendation: grammY
version_researched: 1.39.2
use_when:
  - Building TypeScript-first Telegram bots with excellent type safety
  - Integrating with AI/LLM agents for conversational interfaces
  - Needing to handle media files (photos, videos, audio, documents)
  - Deploying to serverless/edge environments (Cloudflare Workers, Vercel)
  - Requiring stateful multi-turn conversations
avoid_when:
  - Team already has deep Telegraf expertise and codebase
  - Minimizing dependencies is critical (Telegraf has fewer deps)
  - Building a very simple bot with minimal features
project_context:
  language: TypeScript
  relevant_dependencies:
    - ai (Vercel AI SDK)
    - zod
    - readline
---

## Summary

**grammY** is the recommended framework for building a Telegram bot that integrates with your existing agent architecture. With 136,866 weekly npm downloads and 3,238 GitHub stars[1], grammY has emerged as the modern TypeScript-first alternative to Telegraf, offering superior type safety, excellent documentation, and a robust plugin ecosystem.

The framework provides native support for handling all media types (photos, videos, audio, voice messages, documents), conversation state management via the conversations plugin, and session persistence with multiple storage adapters[2]. Its middleware architecture mirrors patterns already present in your codebase, making integration with the existing `Interaction` and `Stimulus` classes straightforward.

For your use case—building a Telegram interface for an AI agent with media handling—grammY's combination of TypeScript support, file handling plugins, and conversation management makes it the optimal choice[3].

## Philosophy & Mental Model

grammY operates on a **middleware-based request/response model** similar to Express.js or Koa[4]. Every incoming Telegram update flows through a middleware stack, where each middleware can:

1. Process the update
2. Pass control downstream via `next()`
3. Modify the context object
4. Terminate the chain by not calling `next()`

**Key Abstractions:**

- **Bot**: The main entry point that receives updates and dispatches them to middleware
- **Context (ctx)**: Rich object containing the update, convenience methods, and any data added by middleware
- **Middleware**: Functions that process updates, composable and stackable
- **Sessions**: Per-chat persistent storage attached to context
- **Conversations**: Multi-turn stateful interactions that survive across updates

**Mental Model for Agent Integration:**
Think of grammY as a "transport layer" that translates Telegram updates into your existing `Interaction` format. Messages from Telegram become user inputs to your agent; agent responses become Telegram messages. The grammY bot acts as an adapter between Telegram's update-driven model and your agent's conversation-based model.

```
Telegram Update → grammY Context → Interaction.addMessage() → Agent Response → ctx.reply()
```

## Setup

### Installation

```bash
pnpm add grammy @grammyjs/files @grammyjs/conversations @grammyjs/storage-free
```

### Bot Token Setup

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow prompts
3. Save the token (format: `123456789:AbCdefGhIJKlmNoPQRsTUVwxyZ`)

### Basic Configuration

```typescript
// src/telegram/bot.ts
import { Bot, Context, session, SessionFlavor } from "grammy";
import { hydrateFiles, FileFlavor } from "@grammyjs/files";
import {
  type Conversation,
  type ConversationFlavor,
  conversations,
  createConversation,
} from "@grammyjs/conversations";
import { freeStorage } from "@grammyjs/storage-free";

// Define session data structure
interface SessionData {
  conversationHistory: Array<{ role: string; content: string }>;
  agentState: Record<string, unknown>;
}

// Compose context types
type MyContext = FileFlavor<Context> &
  SessionFlavor<SessionData> &
  ConversationFlavor;

// Create bot instance
const bot = new Bot<MyContext>(process.env.TELEGRAM_BOT_TOKEN!);

// Enable file downloads
bot.api.config.use(hydrateFiles(bot.token));

// Configure sessions with persistent storage
bot.use(session({
  initial: (): SessionData => ({
    conversationHistory: [],
    agentState: {},
  }),
  storage: freeStorage<SessionData>(bot.token),
}));

// Enable conversations plugin
bot.use(conversations());

export { bot, MyContext, SessionData };
```

### Environment Configuration

```bash
# .env
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

## Core Usage Patterns

### Pattern 1: Receiving and Processing Text Messages

Handle incoming text messages and route them to your agent:

```typescript
import { Interaction } from "../interaction/interaction";
import { createStimulus } from "../stimulus/stimulus";

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userMessage = ctx.message.text;

  // Show typing indicator while processing
  await ctx.replyWithChatAction("typing");

  // Create or retrieve interaction for this chat
  const stimulus = createStimulus({
    role: "helpful AI assistant",
    objective: "Assist the user via Telegram",
  });

  const interaction = new Interaction(modelDetails, stimulus);

  // Add conversation history from session
  for (const msg of ctx.session.conversationHistory) {
    interaction.addMessage(msg.role as "user" | "assistant", msg.content);
  }

  // Add current message
  interaction.addMessage("user", userMessage);

  // Get agent response
  const response = await runner.generateText(interaction);

  // Update session history
  ctx.session.conversationHistory.push(
    { role: "user", content: userMessage },
    { role: "assistant", content: response.content }
  );

  // Send response
  await ctx.reply(response.content, { parse_mode: "Markdown" });
});
```

### Pattern 2: Handling Media Files (Photos, Videos, Audio)

Download and process media files sent by users:

```typescript
import { writeFile } from "fs/promises";
import path from "path";

// Handle photos
bot.on("message:photo", async (ctx) => {
  await ctx.replyWithChatAction("typing");

  // Get highest resolution photo
  const photo = ctx.message.photo.at(-1)!;
  const file = await ctx.getFile();

  // Download to local path
  const filePath = path.join("./media", `${photo.file_unique_id}.jpg`);
  await file.download(filePath);

  // Or get URL for direct access (valid 60 min)
  const fileUrl = await file.getUrl();

  // Add to interaction as attachment
  await interaction.addAttachmentFromPath(filePath);

  const caption = ctx.message.caption || "User sent a photo";
  await ctx.reply(`Received photo: ${caption}`);
});

// Handle videos
bot.on("message:video", async (ctx) => {
  await ctx.replyWithChatAction("upload_video");

  const video = ctx.message.video;
  const file = await ctx.getFile();
  const filePath = path.join("./media", `${video.file_unique_id}.mp4`);
  await file.download(filePath);

  await ctx.reply(`Received video (${video.duration}s, ${video.width}x${video.height})`);
});

// Handle audio/voice messages
bot.on(["message:audio", "message:voice"], async (ctx) => {
  await ctx.replyWithChatAction("typing");

  const audio = ctx.message.audio || ctx.message.voice;
  const file = await ctx.getFile();

  const ext = ctx.message.voice ? "ogg" : "mp3";
  const filePath = path.join("./media", `${audio!.file_unique_id}.${ext}`);
  await file.download(filePath);

  await ctx.reply(`Received audio (${audio!.duration}s)`);
});

// Handle documents
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;

  // Check file size (max 20MB for download)
  if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
    await ctx.reply("File too large (max 20MB)");
    return;
  }

  const file = await ctx.getFile();
  const filePath = path.join("./media", doc.file_name || doc.file_unique_id);
  await file.download(filePath);

  await ctx.reply(`Received document: ${doc.file_name}`);
});
```

### Pattern 3: Sending Media to Users

Send various media types back to users:

```typescript
import { InputFile } from "grammy";

// Send photo
await ctx.replyWithPhoto(new InputFile("./output/image.png"), {
  caption: "Here's the generated image",
});

// Send video
await ctx.replyWithVideo(new InputFile("./output/video.mp4"), {
  caption: "Generated video",
  supports_streaming: true,
});

// Send audio
await ctx.replyWithAudio(new InputFile("./output/audio.mp3"), {
  title: "Generated Audio",
  performer: "AI Agent",
});

// Send document
await ctx.replyWithDocument(new InputFile("./output/report.pdf"), {
  caption: "Your report is ready",
});

// Send voice note (must be OGG/OPUS or MP3/M4A)
await ctx.replyWithVoice(new InputFile("./output/voice.ogg"));
```

### Pattern 4: Multi-Turn Conversations with State

Use the conversations plugin for complex multi-step interactions:

```typescript
import { Conversation } from "@grammyjs/conversations";

async function agentConversation(
  conversation: Conversation<MyContext>,
  ctx: MyContext
) {
  // Initialize agent interaction
  const interaction = new Interaction(modelDetails, agentStimulus);

  await ctx.reply("I'm ready to help! What would you like to discuss?");

  while (true) {
    // Wait for user message
    const response = await conversation.waitFor("message", {
      maxMilliseconds: 30 * 60 * 1000, // 30 min timeout
      otherwise: (ctx) => ctx.reply("Session timed out. Send /start to begin again."),
    });

    const userInput = response.message.text;

    // Check for exit commands
    if (userInput === "/exit" || userInput === "/stop") {
      await ctx.reply("Goodbye! Send /start to chat again.");
      return;
    }

    // Process with agent
    await ctx.replyWithChatAction("typing");

    // Use external() for side effects that shouldn't replay
    const agentResponse = await conversation.external(async () => {
      interaction.addMessage("user", userInput);
      return await runner.generateText(interaction);
    });

    interaction.addMessage("assistant", agentResponse.content);

    await ctx.reply(agentResponse.content, { parse_mode: "Markdown" });
  }
}

// Register conversation
bot.use(createConversation(agentConversation));

// Entry point
bot.command("start", async (ctx) => {
  await ctx.conversation.enter("agentConversation");
});
```

### Pattern 5: Error Handling and Graceful Degradation

Implement robust error handling:

```typescript
import { GrammyError, HttpError } from "grammy";

// Global error handler for long polling
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);

  const e = err.error;

  if (e instanceof GrammyError) {
    console.error("Error in request:", e.description);
    // Handle specific Telegram API errors
    if (e.error_code === 403) {
      console.log("Bot was blocked by user");
    }
  } else if (e instanceof HttpError) {
    console.error("Network error:", e);
  } else {
    console.error("Unknown error:", e);
  }

  // Attempt to notify user
  try {
    ctx.reply("Sorry, something went wrong. Please try again.").catch(() => {});
  } catch {
    // User might have blocked bot
  }
});

// Error boundary for specific middleware
import { ErrorBoundary } from "grammy";

const agentBoundary = new ErrorBoundary<MyContext>(async (err) => {
  console.error("Agent error:", err.error);
  await err.ctx.reply("The agent encountered an error. Resetting conversation...");
  err.ctx.session.conversationHistory = [];
});

bot.use(agentBoundary.wrap(agentMiddleware));
```

## Anti-Patterns & Pitfalls

### Don't: Store Large Data in Sessions

```typescript
// BAD - storing base64 media in session
bot.on("message:photo", async (ctx) => {
  const file = await ctx.getFile();
  const buffer = await fetch(await file.getUrl()).then(r => r.arrayBuffer());
  ctx.session.lastPhoto = Buffer.from(buffer).toString("base64"); // Don't do this!
});
```

**Why it's wrong:** Session data is serialized and stored on every update. Large data causes performance issues and may exceed storage limits.

### Instead: Store References

```typescript
// GOOD - store file_id for later retrieval
bot.on("message:photo", async (ctx) => {
  const photo = ctx.message.photo.at(-1)!;
  ctx.session.lastPhotoId = photo.file_id;
  ctx.session.lastPhotoPath = `./media/${photo.file_unique_id}.jpg`;
});
```

---

### Don't: Block the Event Loop During AI Processing

```typescript
// BAD - no typing indicator, user sees nothing
bot.on("message:text", async (ctx) => {
  const response = await runner.generateText(interaction); // Takes 10+ seconds
  await ctx.reply(response.content);
});
```

**Why it's wrong:** Users see no feedback during long AI processing, leading to confusion and repeated messages.

### Instead: Use Typing Indicators and Periodic Updates

```typescript
// GOOD - show typing indicator, refresh every 4 seconds
bot.on("message:text", async (ctx) => {
  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction("typing").catch(() => {});
  }, 4000);

  try {
    await ctx.replyWithChatAction("typing");
    const response = await runner.generateText(interaction);
    await ctx.reply(response.content);
  } finally {
    clearInterval(typingInterval);
  }
});
```

---

### Don't: Ignore File Size Limits

```typescript
// BAD - will fail silently for large files
bot.on("message:document", async (ctx) => {
  const file = await ctx.getFile();
  await file.download("./media/file"); // Fails if > 20MB
});
```

**Why it's wrong:** Telegram Bot API limits downloads to 20MB and uploads to 50MB[5].

### Instead: Check Sizes and Handle Limits

```typescript
// GOOD - validate and handle gracefully
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;

  if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
    await ctx.reply(
      "File too large for processing (max 20MB). " +
      "Please compress or split the file."
    );
    return;
  }

  const file = await ctx.getFile();
  await file.download(`./media/${doc.file_unique_id}`);
});
```

---

### Don't: Use file_id Across Different Bots

```typescript
// BAD - file_id from another bot won't work
const fileId = "AgACAgIAAxk..."; // From different bot
await ctx.replyWithPhoto(fileId); // Will fail
```

**Why it's wrong:** File identifiers are bot-specific and cannot be shared between bots[5].

### Instead: Use file_unique_id for Cross-Bot References

```typescript
// GOOD - use file_unique_id for consistent identification
// Then re-download or use your own storage URL
const uniqueId = ctx.message.photo.at(-1)!.file_unique_id;
const storedPath = await mediaStorage.getByUniqueId(uniqueId);
```

---

### Don't: Perform Side Effects Without external() in Conversations

```typescript
// BAD - database call executes on every replay
async function myConversation(conversation, ctx) {
  const data = await db.fetch(); // Called multiple times!
  await ctx.reply(`Data: ${data}`);
  await conversation.wait();
}
```

**Why it's wrong:** Conversations replay from the start on each update. Side effects execute repeatedly, causing duplicate database writes, API calls, etc.[6]

### Instead: Wrap Side Effects in external()

```typescript
// GOOD - executes once, result reused on replay
async function myConversation(conversation, ctx) {
  const data = await conversation.external(() => db.fetch());
  await ctx.reply(`Data: ${data}`);
  await conversation.wait();
}
```

## Why This Choice

### Decision Criteria

| Criterion | Weight | How grammY Scored |
|-----------|--------|-------------------|
| TypeScript support | High | Excellent - written in TS, types "just work"[7] |
| Documentation quality | High | Best in class - comprehensive guides + API ref[7] |
| Media file handling | High | Full support via @grammyjs/files plugin[5] |
| Conversation state | High | Robust @grammyjs/conversations plugin[6] |
| Active maintenance | Medium | Very active, frequent releases |
| Bundle size | Medium | Larger than Telegraf due to features |
| Community size | Medium | Growing, ~137k weekly downloads[1] |

### Key Factors

- **TypeScript-first Design:** grammY was designed for TypeScript from the ground up. Types follow your code through middleware, sessions, and conversations, providing excellent IDE support and catching errors at compile time[7].

- **Plugin Ecosystem:** The official plugins for files, conversations, sessions, menus, and more are well-maintained and work together seamlessly.

- **Architecture Alignment:** grammY's middleware pattern mirrors your existing codebase structure. The `Context` object maps naturally to your `Interaction` class; middleware maps to your hook system.

- **Documentation:** grammY has the most comprehensive documentation of any TypeScript Telegram framework, with explanations, examples, and guides for every feature[7].

## Alternatives Considered

### Telegraf

- **What it is:** The original modern Telegram bot framework for Node.js, grammY's ancestor
- **Why not chosen:** TypeScript types are more complex and harder to understand; documentation replaced by sparse API reference[7]
- **Choose this instead when:**
  - Team has existing Telegraf codebase
  - Need slightly smaller bundle size
  - Prefer more established library (longer track record)
- **Key tradeoff:** Less TypeScript polish for slightly fewer dependencies

### node-telegram-bot-api

- **What it is:** Simple, straightforward Telegram Bot API wrapper with 157k weekly downloads[1]
- **Why not chosen:** Minimal abstraction, no built-in conversation/session management, less TypeScript support
- **Choose this instead when:**
  - Building a very simple bot with basic features
  - Want direct Bot API access without framework overhead
  - Team prefers explicit API calls over middleware patterns
- **Key tradeoff:** More control but more boilerplate code

### GramIO

- **What it is:** Newer TypeScript Telegram framework with similar goals to grammY
- **Why not chosen:** Much smaller community, less mature plugin ecosystem
- **Choose this instead when:**
  - Want to experiment with newer approach
  - Need specific GramIO features
- **Key tradeoff:** Less battle-tested for smaller bundle

## Caveats & Limitations

- **File Size Limits:** Telegram Bot API limits downloads to 20MB and uploads to 50MB. For larger files, use a local Bot API server (supports up to 2000MB)[5].

- **Typing Indicator Duration:** The typing action only displays for 5 seconds. For long AI processing, you must refresh it periodically[8].

- **No True Streaming:** Telegram doesn't support true streaming responses like web SSE. You can edit messages progressively, but this has rate limits and may cause parsing errors with incomplete Markdown[9].

- **Conversation Replay Overhead:** The conversations plugin replays from the start on each update. Long conversations with many steps accumulate replay time. Structure conversations to minimize steps[6].

- **Webhook SSL Requirement:** Webhooks require valid SSL certificates. For development, use long polling; for production, deploy behind a reverse proxy with SSL or use a platform that provides it[10].

- **Session Storage Selection:** The free storage adapter is convenient but has no SLA. For production, use Redis, PostgreSQL, or another reliable storage adapter.

## Integration with Current Codebase

Based on the codebase analysis, here's how grammY integrates with your existing architecture:

### Mapping to Existing Patterns

| grammY Concept | Your Codebase Equivalent |
|----------------|--------------------------|
| `Context` | `Interaction` |
| `Middleware` | Runner hooks (`beforeHooks`, `afterHooks`) |
| `Session` | Session store / Memory runner |
| `Bot.on()` handlers | CLI command handlers |
| `ctx.message` | `CoreMessage` from Vercel AI SDK |

### Proposed Architecture

```
src/
├── telegram/
│   ├── bot.ts              # Bot setup, middleware registration
│   ├── handlers/
│   │   ├── message.ts      # Text message → Interaction
│   │   ├── media.ts        # Photos/videos/audio handling
│   │   └── commands.ts     # /start, /help, /reset
│   ├── conversations/
│   │   └── agent.ts        # Multi-turn agent conversation
│   └── adapters/
│       └── interaction.ts  # Telegram ↔ Interaction adapter
```

### Key Integration Points

1. **Message Adapter:** Convert `ctx.message` to your `CoreMessage` format
2. **Media Handling:** Use `Interaction.addAttachmentFromPath()` for received media
3. **Response Streaming:** Use typing indicators while `runner.generateText()` executes
4. **Session Sync:** Map grammY session to your session store format

## References

[1] [npm trends: grammy vs telegraf vs node-telegram-bot-api](https://npmtrends.com/grammy-vs-node-telegram-bot-api-vs-telegraf-vs-telegram-bot-api) - Weekly download statistics and GitHub stars comparison

[2] [grammY Official Website](https://grammy.dev/) - Framework overview and feature list

[3] [grammY Comparison Guide](https://grammy.dev/resources/comparison) - Detailed comparison with Telegraf and other frameworks

[4] [grammY Guide Overview](https://grammy.dev/guide/) - Core concepts, middleware system, and architecture

[5] [grammY File Handling Guide](https://grammy.dev/guide/files) - Receiving, downloading, and sending files with size limits

[6] [grammY Conversations Plugin](https://grammy.dev/plugins/conversations) - Multi-turn conversation state management with replay engine

[7] [GitHub Discussion: grammY vs Telegraf](https://github.com/telegraf/telegraf/discussions/386) - Community comparison of TypeScript support and documentation quality

[8] [Telegram Bot API - sendChatAction](https://core.telegram.org/bots/api#sendchataction) - Typing indicator behavior and duration

[9] [Latenode: Streaming AI Responses in Telegram](https://community.latenode.com/t/how-to-handle-streaming-responses-from-google-ai-in-telegram-bot-without-markdown-parsing-errors/21646) - Challenges with progressive message editing

[10] [grammY Deployment Types](https://grammy.dev/guide/deployment-types) - Webhooks vs long polling comparison and SSL requirements

[11] [grammY Session Storage Adapters](https://github.com/grammyjs/storages) - Available storage adapters for session persistence

[12] [grammY Error Handling](https://grammy.dev/guide/errors) - Error types, boundaries, and production best practices

[13] [LogRocket: Building a Telegram bot with grammY](https://blog.logrocket.com/building-telegram-bot-grammy/) - Step-by-step tutorial (February 2025)

[14] [Telegram Bot API Official Documentation](https://core.telegram.org/bots/api) - Complete API reference for message types and methods
