# Model Evaluation CLI

A command-line interface for interacting with and evaluating various AI models across different providers (Google, Ollama, OpenRouter).

## Features

- **Model Interaction**: Run single prompts (`run`) or engage in interactive chat sessions (`chat`).
- **Memory Augmentation**: Use the `--memory` flag with `chat` to enable fact extraction and memory updates during conversations.
- **Chat Commands**: Use commands like `/?`, `/reset`, `/mem`, `/history` within chat sessions.
- **Provider Support**: Integrates with Google, Ollama, and OpenRouter via the Vercel AI SDK.
- **Cost Tracking**: Calculates and displays estimated costs based on token usage.
- **Rate Limiting**: Basic rate limit handling with backoff.
- **Model Discovery**: Search and filter models (`models list`), view detailed information (`models info`), and compare costs (`models costs`).
- **User Experience**: Color-coded output, human-readable formatting.

## Installation

```bash
# From the root of the monorepo
pnpm install
cd packages/cli
pnpm link --global  # Optional: to use globally
```

## Usage

### List Available Models

```bash
# List all models
pnpm cli models

# List models with JSON output
pnpm cli models --json

# Filter by provider
pnpm cli models --provider openrouter
pnpm cli models --provider ollama

# Show only free models
pnpm cli models --free

# Sort by different fields
pnpm cli models --sort addedDate --desc
pnpm cli models --sort contextLength
pnpm cli models --sort cost

# Search models
pnpm cli models --search "gpt-4"
```

### View Model Details

```bash
# Get detailed information about a specific model
pnpm cli models info <model-id>

# Alternative using --view flag
pnpm cli models --view info --id <model-id>
```

### View Model Costs

```bash
# View cost breakdown for all models
pnpm cli models costs

# Sort by different cost metrics
pnpm cli models costs --sort-by prompt
pnpm cli models costs --sort-by completion
pnpm cli models costs --sort-by total
```

### Run a Single Prompt

```bash
pnpm cli run --provider ollama --model gemma3:latest --prompt "Explain quantum entanglement."
```

### Interactive Chat

```bash
# Standard chat (no tools enabled by default)
pnpm cli chat --provider ollama --model gemma3:latest

# Enable specific tools (e.g., calculator, statistics)
pnpm cli chat --provider openrouter --model gpt-4o --tools calculator,statistics
```

> **Tool Usage in Chat:**
>
> - By default, **no tools are enabled** in chat sessions.
> - Use the `--tools` flag with a comma-separated list of tool names to enable specific tools (e.g., `--tools calculator,statistics`).
> - To see available tools, run `pnpm cli tools list`.
> - If a tool name is not found, it will be ignored with a warning.

**Options:**
- `--provider <provider>`: Provider to use (e.g. `google`, `ollama`, `openrouter`) (required)
- `--model <model>`: Model name to use (e.g. `gemini-pro`, `llama3`, etc.) (required)
- `--file <filePath>`: File to include in the chat (optional)
- `--memory`: Enable memory-augmented chat (uses MemoryRunner) (optional)


### Chat Commands

Inside an interactive chat session (`pnpm cli chat ...`), you can use the following commands:

- `/?`: Show help message listing available commands.
- `/reset`: Clear the current conversation history.
- `/mem`: Display the facts currently stored in memory (only works if chat was started with `--memory`).
- `/history`: Show the full message history for the current session.
- `exit` or `quit`: End the chat session.

## Environment Variables

- `OPENROUTER_API_KEY`: Your OpenRouter API key (required for OpenRouter provider).
- `GOOGLE_GENERATIVE_AI_API_KEY`: Your Google AI API key (required for Google provider).
- `OLLAMA_HOST`: Ollama host URL (default: `http://localhost:11434`).

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT 