# Umwelten - AI Model Evaluation Tool

## Overview

This command-line tool allows you to interact with and evaluate AI models across different providers (Google, Ollama, OpenRouter, LM Studio). It focuses on usability, cost transparency, and providing a flexible runner architecture with memory capabilities.

## Core Features

- **Model Interaction**: Run single prompts (`run`) or engage in interactive chat sessions (`chat`).
- **Model Evaluation**: Systematic evaluation across multiple models with the `eval` command.
- **Model Discovery**: Search and filter models (`models list`), view detailed information (`models info`), and compare costs (`models costs`).
- **Memory Augmentation**: Use the `--memory` flag with `chat` to enable fact extraction and memory updates during conversations.
- **Chat Commands**: Use commands like `/?`, `/reset`, `/mem`, `/history` within chat sessions.
- **Provider Support**: Integrates with Google, Ollama, OpenRouter, and LM Studio via the Vercel AI SDK and REST APIs.
- **Cost Tracking**: Calculates and displays estimated costs based on token usage.
- **Rate Limiting**: Basic rate limit handling with backoff.
- **Extensible Runner**: `SmartModelRunner` allows adding custom logic via hooks (before, during, after).

## Getting Started

### Prerequisites

- **Node.js** (v20+)
- **pnpm** for package management
- **API Keys**: Ensure you have the necessary API keys for the providers you intend to use. These should be stored in a `.env` file. (LM Studio does not require an API key for local usage.)

### Installation

#### Option 1: Install from npm (Recommended)
```bash
npm install -g umwelten
```

#### Option 2: Install from source
1. Clone the repository:
   ```bash
   git clone https://github.com/The-Focus-AI/umwelten.git
   cd umwelten
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Use the CLI:
   ```bash
   node dist/cli/cli.js --help
   ```

#### Environment Setup
Set up your environment variables with the required API keys:

**Option A: Environment variables**
```bash
export OPENROUTER_API_KEY=your_openrouter_api_key
export GOOGLE_GENERATIVE_AI_API_KEY=your_google_api_key
export OLLAMA_HOST=http://localhost:11434  # Optional, defaults to localhost:11434
export LMSTUDIO_BASE_URL=http://localhost:1234  # Optional, defaults to localhost:1234
```

**Option B: .env file (for development)**
```plaintext
OPENROUTER_API_KEY=your_openrouter_api_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_api_key
OLLAMA_HOST=http://localhost:11434
LMSTUDIO_BASE_URL=http://localhost:1234
# LM Studio does not require an API key
```

### Usage

#### Model Discovery

Explore available models across all providers:

```bash
# List all models
umwelten models list

# List models with JSON output
umwelten models list --json

# Filter by provider
umwelten models list --provider openrouter
umwelten models list --provider ollama

# Show only free models
umwelten models list --free

# Sort by different fields
umwelten models list --sort addedDate --desc
umwelten models list --sort contextLength
umwelten models list --sort cost

# Search models
umwelten models list --search "gpt-4"

# Get detailed information about a specific model
umwelten models info <model-id>

# View cost breakdown for all models
umwelten models costs

# Sort costs by different metrics
umwelten models costs --sort-by prompt
umwelten models costs --sort-by completion
umwelten models costs --sort-by total
```

#### Running a Single Prompt

Use the `run` command:

```bash
umwelten run --provider ollama --model gemma3:latest "Explain the concept of quantum entanglement."
```

> Note: The prompt is a required positional argument (not a --prompt option).

#### Interactive Chat

Use the `chat` command:

```bash
# Standard chat (no tools enabled by default)
umwelten chat --provider ollama --model gemma3:latest

# Enable specific tools (e.g., calculator, statistics)
umwelten chat --provider openrouter --model gpt-4o --tools calculator,statistics

# Chat with memory enabled
umwelten chat --provider ollama --model gemma3:latest --memory

# Chat with a file attachment
umwelten chat --provider google --model gemini-1.5-flash-latest --file ./examples/test_data/internet_archive_fffound.png

# Chat with a local LM Studio model (ensure LM Studio server is running and model is loaded)
umwelten chat --provider lmstudio --model mistralai/devstral-small-2505
```

> **Tool Usage in Chat:**
>
> - By default, **no tools are enabled** in chat sessions.
> - Use the `--tools` flag with a comma-separated list of tool names to enable specific tools (e.g., `--tools calculator,statistics`).
> - To see available tools, run `umwelten tools list`.
> - If a tool name is not found, it will be ignored with a warning.

Inside the chat session, you can use commands:
- `/?`: Show help.
- `/reset`: Clear conversation history.
- `/mem`: Show memory facts (requires `--memory`).
- `/history`: Show message history.
- `exit` or `quit`: End the session.

#### Model Evaluation

Use the `eval` command to systematically evaluate prompts across multiple models:

```bash
# Basic evaluation across multiple models
umwelten eval run \
  --prompt "Write a short poem about cats" \
  --models "ollama:gemma3:12b,google:gemini-2.0-flash" \
  --id "cat-poem-eval"

# With system prompt and temperature
umwelten eval run \
  --prompt "Explain quantum computing" \
  --models "ollama:gemma3:27b,openrouter:openai/gpt-4o-mini" \
  --id "quantum-explanation" \
  --system "You are a physics professor" \
  --temperature 0.3

# Resume a previous evaluation (re-run existing responses)
umwelten eval run \
  --prompt "Write a story" \
  --models "ollama:gemma3:12b" \
  --id "story-eval" \
  --resume

# With file attachments
umwelten eval run \
  --prompt "Describe this image" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "image-description" \
  --attach "./path/to/image.jpg"
```

**Evaluation Options:**
- `--prompt`: The prompt to evaluate (required)
- `--models`: Comma-separated models in `provider:model` format (required)
- `--id`: Unique evaluation identifier (required)
- `--system`: Optional system prompt
- `--temperature`: Temperature for generation (0.0-1.0)
- `--timeout`: Timeout in milliseconds
- `--resume`: Re-run existing responses (default: false)
- `--attach`: Comma-separated file paths to attach

Results are saved to `output/evaluations/{id}/responses/` with structured JSON output including metadata, token usage, and timing information.

### Advanced Features

- **Model Comparison**: Compare models based on cost, speed, and quality using evaluation results.
- **Batch Processing**: Run systematic evaluations across model matrices.
- **Resume Capability**: Skip completed evaluations unless explicitly resumed.
- **Error Handling**: Graceful handling of API failures and invalid configurations.

## Provider Support

- **Google**: Gemini models (text, vision)
- **Ollama**: Local LLMs
- **OpenRouter**: Hosted LLMs
- **LM Studio**: Local LLMs and embeddings via REST API (no API key required)
  - Uses `/api/v0/models` and `/api/v0/completions` endpoints
  - Robust error handling and dynamic model selection in tests
  - Supports both completions and embeddings (if model is available)

## Development

### Directory Structure

```
src/
  cli/             # CLI command implementations
  cognition/       # Model interfaces and runners (Base, Smart)
  conversation/    # Conversation management
  costs/           # Cost calculation
  evaluation/      # Evaluation system (runners, scorers, extractors)
  interaction/     # Model interaction and stimulus handling
  memory/          # Memory system (store, runner, hooks)
  providers/       # Provider implementations
  rate-limit/      # Rate limit handling
  test-utils/      # Shared test utilities
memory/            # Project planning/documentation files
output/            # Generated output (evaluations, reports)
scripts/           # Utility scripts (being migrated to CLI)
```
(Tests are colocated with source files, e.g., `*.test.ts`)

### Testing

- **Unit Tests**: Use Vitest for testing core functionalities.
- **Integration Tests**: Ensure end-to-end functionality of CLI commands.
- **Manual QA**: Run evaluations against known prompts and compare results.
- **LM Studio**: Tests dynamically select the first loaded model for text generation, ensuring robust and reliable test coverage.

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details. 