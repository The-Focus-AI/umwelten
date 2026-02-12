# Telegram Bot

Run an AI assistant as a Telegram bot, enabling mobile conversations with full support for text, images, documents, and tool calling.

::: tip Habitat Telegram
For a full-featured Telegram bot with tools, skills, sub-agents, and persistent sessions, use the [Habitat](./habitat.md) telegram subcommand:

```bash
umwelten habitat telegram -p google -m gemini-3-flash-preview
```

The standalone `umwelten telegram` command (documented below) is a simpler option for basic conversations without the full habitat environment.
:::

## Overview

The Telegram adapter provides a complete chat interface through Telegram, featuring:
- **Mobile-first chat**: Interact with AI models from any device via Telegram
- **Media support**: Send and receive images, documents, audio, and video
- **Markdown formatting**: Rich text responses with code blocks, bold, italic, and links
- **Multi-turn conversations**: Maintains context per chat for coherent discussions
- **Tool integration**: Access calculator, statistics, and custom tools
- **Memory mode**: Persistent fact extraction across conversations

## Getting Started

### Prerequisites

1. **Create a Telegram Bot**:
   - Open Telegram and message [@BotFather](https://t.me/BotFather)
   - Send `/newbot` and follow the prompts
   - Save the bot token (format: `123456789:AbCdefGhIJKlmNoPQRsTUVwxyZ`)

2. **Configure the Token**:
   ```bash
   # Option 1: Environment variable (recommended)
   export TELEGRAM_BOT_TOKEN="your_token_here"

   # Option 2: Pass as command-line argument
   npx umwelten telegram --token "your_token_here" ...
   ```

### Basic Usage

```bash
# Start with Google Gemini
npx umwelten telegram -p google -m gemini-2.5-flash-preview-05-20

# Start with local Ollama model
npx umwelten telegram -p ollama -m gemma3:12b

# Start with OpenRouter
npx umwelten telegram -p openrouter -m anthropic/claude-3.5-sonnet
```

### Provider-Specific Examples

#### Google Models
```bash
# Fast and cost-effective
npx umwelten telegram -p google -m gemini-2.5-flash-preview-05-20

# High-quality analytical
npx umwelten telegram -p google -m gemini-2.5-pro-preview-05-06
```

#### Ollama (Local)
```bash
# General conversation
npx umwelten telegram -p ollama -m gemma3:12b

# Code-focused
npx umwelten telegram -p ollama -m codestral:latest

# Vision-capable
npx umwelten telegram -p ollama -m qwen2.5vl:latest
```

#### OpenRouter
```bash
# Claude
npx umwelten telegram -p openrouter -m anthropic/claude-3.5-sonnet

# GPT-4o
npx umwelten telegram -p openrouter -m openai/gpt-4o
```

## Bot Commands

Users can send these commands to your bot in Telegram:

| Command | Description |
|---------|-------------|
| `/start` | Start a new conversation |
| `/reset` | Clear conversation history |
| `/help` | Show available commands |

### Online / offline status

The bot shows as **online** in Telegram while the process is running (long-polling is active) and **offline** after you stop it (Ctrl+C or process exit). Telegram infers this from the connection; there is no Bot API to set status explicitly. For a quick offline transition, use a clean shutdown (SIGINT/SIGTERM) so the adapter can stop polling and exit.

## Features

### Markdown Formatting

The bot automatically formats responses with Markdown support:

- **Bold text** using `**bold**`
- *Italic text* using `*italic*`
- `Inline code` using backticks
- Code blocks with syntax highlighting
- [Hyperlinks](https://example.com) using `[text](url)`
- ~~Strikethrough~~ using `~~text~~`

::: tip Tables in Telegram
Telegram doesn't support Markdown tables natively. The AI will format tables as preformatted code blocks for proper alignment.
:::

### Media Handling

Users can send various media types to the bot:

| Media Type | Support | Use Case |
|------------|---------|----------|
| Photos | Analyze, describe, OCR | Image analysis, screenshots |
| Documents | PDF, text, code files | Document analysis, code review |
| Audio | Transcription-ready | Voice notes, audio analysis |
| Video | Frame analysis | Video content description |
| Voice | Same as audio | Voice message processing |

#### Media Storage

Media files are stored on disk in session-specific directories:

- **Jeeves Bot**: `{JEEVES_SESSIONS_DIR}/telegram-{chatId}/media/` (configurable via `JEEVES_SESSIONS_DIR` env var)
- **CLI**: `./telegram-media/` (relative to current working directory) or use `--media-dir <path>`

```bash
# Use custom media directory (CLI only)
npx umwelten telegram -p google -m gemini-2.5-flash-preview-05-20 --media-dir /path/to/media
```

Files are named using Telegram's `file_unique_id` with appropriate extensions (`.jpg`, `.mp4`, `.ogg`, etc.). The directory is created automatically when the first media file is received.

**Note**: 
- Files larger than 20MB are rejected (Telegram Bot API limit)
- Videos and video notes are supported (provider must support video processing: Google, OpenAI, or Anthropic)
- Audio/voice messages require a provider that supports audio (Google, OpenAI, or Anthropic)

#### Example Interactions

```
User: [Sends a photo of a receipt]
Bot: I can see this is a receipt from Acme Store dated January 26, 2026.
     Items purchased:
     - Coffee ($4.50)
     - Sandwich ($8.99)
     Total: $13.49
```

```
User: [Sends a PDF document]
       "Summarize the key points"
Bot: Here are the main points from the document:
     1. **Executive Summary**: The report covers Q4 performance...
     2. **Key Metrics**: Revenue increased by 15%...
```

### Tool Integration

Enable tools for enhanced capabilities:

```bash
# Calculator tool for math
npx umwelten telegram -p google -m gemini-2.5-flash-preview-05-20 --tools calculator

# Statistics tool for data analysis
npx umwelten telegram -p google -m gemini-2.5-flash-preview-05-20 --tools statistics

# Multiple tools
npx umwelten telegram -p google -m gemini-2.5-flash-preview-05-20 --tools calculator,statistics,randomNumber
```

#### Available Tools

| Tool | Description |
|------|-------------|
| `calculator` | Mathematical calculations and formulas |
| `statistics` | Statistical analysis (mean, median, std dev) |
| `randomNumber` | Generate random numbers in ranges |

### Memory Mode

Enable persistent memory to maintain context across conversations:

```bash
npx umwelten telegram -p google -m gemini-2.5-flash-preview-05-20 --memory
```

With memory enabled, the bot will:
- Extract important facts from conversations
- Remember user preferences
- Maintain context across sessions
- Build knowledge over time

## Advanced Configuration

### Full Command Reference

```bash
npx umwelten telegram [options]

Options:
  --token <token>            Bot token (or TELEGRAM_BOT_TOKEN env)
  --memory                   Enable memory-augmented conversations
  --tools <tools>            Comma-separated tools (calculator,statistics,randomNumber)
  --media-dir <dir>          Directory for storing media files (default: ./telegram-media)
  -p, --provider <provider>  Model provider (google, ollama, openrouter, etc.)
  -m, --model <model>        Model name
  -h, --help                 Show help
```

### Environment Variables

```bash
# Required
export TELEGRAM_BOT_TOKEN="your_bot_token"

# Optional: Provider API keys
export GOOGLE_GENERATIVE_AI_API_KEY="your_key"
export OPENROUTER_API_KEY="your_key"
export GITHUB_TOKEN="your_token"
```

### Running as a Service

For production deployment, use a process manager:

```bash
# Using pm2
pm2 start "npx umwelten telegram -p google -m gemini-2.5-flash-preview-05-20" --name telegram-bot

# Using systemd (create /etc/systemd/system/telegram-bot.service)
[Unit]
Description=Umwelten Telegram Bot
After=network.target

[Service]
Type=simple
User=your-user
Environment=TELEGRAM_BOT_TOKEN=your_token
Environment=GOOGLE_GENERATIVE_AI_API_KEY=your_key
ExecStart=/usr/local/bin/npx umwelten telegram -p google -m gemini-2.5-flash-preview-05-20
Restart=always

[Install]
WantedBy=multi-user.target
```

## Architecture

The Telegram adapter is a thin transport layer that reuses the existing umwelten architecture:

```
Telegram Message
    ↓
TelegramAdapter (grammY bot)
    ↓
Interaction + Stimulus (reused)
    ↓
ModelRunner (reused)
    ↓
Provider (Google/Ollama/OpenRouter)
    ↓
Response → Telegram
```

### Key Components Reused

| Component | Purpose |
|-----------|---------|
| `Interaction` | Message handling, tool execution |
| `Stimulus` | Role, objective, tool configuration |
| `BaseModelRunner` | Model API calls via Vercel AI SDK |
| `MemoryRunner` | Fact extraction and persistence |
| `addAttachmentFromPath()` | Media handling with MIME detection |

## Best Practices

### Security

- **Never commit your bot token** to version control
- **Use environment variables** for sensitive configuration
- **Consider user whitelisting** for private bots (future feature)

### Performance

- **Use fast models** for quick responses (Gemini Flash, GPT-4o-mini)
- **Enable typing indicators** (automatically handled)
- **Choose appropriate timeout values**

### User Experience

- **Provide clear `/help` responses**
- **Handle errors gracefully**
- **Use Markdown formatting** for readable responses
- **Keep responses concise** for mobile reading

## Troubleshooting

### Common Issues

1. **Bot not responding**
   - Check that the bot token is correct
   - Ensure the bot is running (`Ctrl+C` to stop, restart)
   - Verify internet connectivity

2. **"TELEGRAM_BOT_TOKEN required" error**
   ```bash
   export TELEGRAM_BOT_TOKEN="your_token_here"
   ```

3. **Media processing fails**
   - Check file size (max 20MB download)
   - Ensure the model supports the media type
   - Verify the media directory is writable (check `--media-dir` path)
   - Try with a different file

4. **Slow responses**
   - Try a faster model (Gemini Flash)
   - Check provider API status
   - Increase timeout if needed

### Debug Mode

```bash
# Run with debug logging
DEBUG=1 npx umwelten telegram -p google -m gemini-2.5-flash-preview-05-20
```

## Next Steps

- Learn about [Interactive Chat](/guide/interactive-chat) for CLI-based conversations
- Explore [Tool Calling](/guide/tool-calling) for advanced capabilities
- See [Memory & Tools](/guide/memory-tools) for persistent context
- Try [Web Interface](/guide/web) for browser-based chat
