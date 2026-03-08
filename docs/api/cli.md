# CLI Reference

The CLI provides the command-line interface for Umwelten, built with Commander.js.

## Overview

```bash
# CLI commands automatically load the nearest `.env` file
pnpm run cli -- <command> [options]
```

Available commands: `models`, `run`, `chat`, `eval`, `sessions`, `telegram`, `habitat`, `tools`.

## Commands

### `models`

List available models across providers.

```bash
# List all models from a provider
pnpm run cli -- models --provider google
pnpm run cli -- models --provider openrouter
pnpm run cli -- models --provider ollama
pnpm run cli -- models --provider minimax
pnpm run cli -- models --provider fireworks

# JSON output
pnpm run cli -- models --provider google --json
```

**Options**:

- `--provider <provider>`: Filter by provider (`google`, `openrouter`, `ollama`, `lmstudio`, `github-models`, `fireworks`, `minimax`)
- `--json`: Output in JSON format

### `run`

Execute a single prompt with a model.

```bash
# Basic usage
pnpm run cli -- run --provider google --model gemini-3-flash-preview "Explain quantum computing"

# With file attachment
pnpm run cli -- run --provider google --model gemini-3-flash-preview --file image.jpg "Describe this image"
```

**Options**:

- `--provider <provider>`: AI provider (required)
- `--model <model>`: Model to use (required)
- `--file <file>`: File to attach
- `--temperature <number>`: Model temperature (0.0-2.0)
- `--max-tokens <number>`: Maximum tokens to generate

### `chat`

Interactive chat mode with AI models.

```bash
# Start interactive chat
pnpm run cli -- chat --provider google --model gemini-3-flash-preview

# Chat with memory enabled
pnpm run cli -- chat --provider google --model gemini-3-flash-preview --memory
```

**Options**:

- `--provider <provider>`: AI provider (required)
- `--model <model>`: Model to use (required)
- `--memory`: Enable conversation memory (automatic fact extraction)
- `--temperature <number>`: Model temperature

### `eval`

Run model evaluations.

```bash
# Run an evaluation script
pnpm run cli -- eval --script scripts/google-pricing.ts
```

**Options**:

- `--script <file>`: Evaluation script to run

### `sessions`

Manage conversation sessions.

```bash
# List sessions
pnpm run cli -- sessions list

# Show a specific session
pnpm run cli -- sessions show <session-id>
```

### `telegram`

Start a Telegram bot for interactive AI conversations.

```bash
# Start Telegram bot (requires TELEGRAM_BOT_TOKEN env var)
pnpm run cli -- telegram --provider google --model gemini-3-flash-preview

# With memory enabled
pnpm run cli -- telegram --provider google --model gemini-3-flash-preview --memory
```

**Options**:

- `--provider <provider>`: AI provider (required)
- `--model <model>`: Model to use (required)
- `--token <token>`: Telegram bot token (or set `TELEGRAM_BOT_TOKEN`)
- `--memory`: Enable memory-augmented conversations

**Telegram Commands**:

- `/start` - Start a new conversation
- `/reset` - Clear conversation history
- `/help` - Show help message

**Features**:

- Multi-turn conversations with context
- Media support (photos, documents, audio, video)
- Markdown formatting in responses
- Typing indicators during AI processing

### `habitat`

Managed agent environment with tools, sessions, and persistence.

```bash
# Start habitat REPL
pnpm run cli -- habitat

# Start habitat as Telegram bot
pnpm run cli -- habitat telegram

# Initialize a new habitat in a directory
pnpm run cli -- habitat --work-dir ./my-agent
```

**Options**:

- `--work-dir <dir>`: Working directory for the habitat (default: current directory)

The habitat provides a full agent environment with:

- Agent management (list, add, update, remove sub-agents)
- Session management (persistent conversations)
- Tool sets (file operations, search, secrets, agent runner)
- Skills sharing between agents
- Onboarding for new habitats

### `tools`

List and demo available tools.

```bash
# List all tools
pnpm run cli -- tools list

# Run interactive tool demo
pnpm run cli -- tools demo

# Demo with custom prompt
pnpm run cli -- tools demo --prompt "Calculate 25 * 4"
```

**Options**:

- `--prompt <prompt>`: Custom prompt for demo
- `--max-steps <steps>`: Maximum tool execution steps (default: 5)

## Source Structure

The CLI is implemented in `src/cli/`:

```
src/cli/
├── cli.ts          # Main entry point — registers all commands
├── models.ts       # models command
├── run.ts          # run command
├── chat.ts         # chat command
├── eval.ts         # eval command
├── sessions.ts     # sessions command
├── telegram.ts     # telegram command
├── habitat.ts      # habitat command
└── tools.ts        # tools command
```

Each command module exports a Commander.js `Command` that is registered in `cli.ts`.

## Environment Variables

```bash
# Required for Google provider
GOOGLE_GENERATIVE_AI_API_KEY=your_key

# Required for OpenRouter provider
OPENROUTER_API_KEY=your_key

# Required for GitHub Models provider
GITHUB_TOKEN=your_token

# Required for Fireworks provider
FIREWORKS_API_KEY=your_key

# Required for MiniMax provider
MINIMAX_API_KEY=your_key

# Required for Telegram bot
TELEGRAM_BOT_TOKEN=your_token

# Optional: external Markify service
MARKIFY_URL=https://your-markify-service

# Optional: Tavily search (for habitat search tool)
TAVILY_API_KEY=your_key
```

## Usage Notes

- CLI commands load `.env` automatically; keep your API keys in a local `.env` file
- Use `pnpm run cli --` to run during development (no build needed)
- Local providers (Ollama, LM Studio) require their servers to be running
