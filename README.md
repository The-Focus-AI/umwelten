# AI Model Evaluation Tool

## Overview

This command-line tool allows you to interact with and evaluate AI models across different providers (Google, Ollama, OpenRouter, LM Studio). It focuses on usability, cost transparency, and providing a flexible runner architecture with memory capabilities.

## Core Features

- **Model Interaction**: Run single prompts (`run`) or engage in interactive chat sessions (`chat`).
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

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/model-eval.git
   cd model-eval
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up your `.env` file with the required API keys:
   ```plaintext
   OPENROUTER_API_KEY=your_openrouter_api_key
   OLAMA_API_KEY=your_olama_api_key
   VERCEL_AI_KEY=your_vercel_ai_key
   # LM Studio does not require an API key
   ```

### Usage

#### Running a Single Prompt

Use the `run` command:

```bash
pnpm cli run --provider ollama --model gemma3:latest "Explain the concept of quantum entanglement."
```

> Note: The prompt is a required positional argument (not a --prompt option).

#### Interactive Chat

Use the `chat` command:

```bash
# Standard chat
pnpm cli chat --provider ollama --model gemma3:latest

# Chat with memory enabled
pnpm cli chat --provider ollama --model gemma3:latest --memory

# Chat with a file attachment
pnpm cli chat --provider google --model gemini-1.5-flash-latest --file ./examples/test_data/internet_archive_fffound.png

# Chat with a local LM Studio model (ensure LM Studio server is running and model is loaded)
pnpm cli chat --provider lmstudio --model mistralai/devstral-small-2505
```

Inside the chat session, you can use commands:
- `/?`: Show help.
- `/reset`: Clear conversation history.
- `/mem`: Show memory facts (requires `--memory`).
- `/history`: Show message history.
- `exit` or `quit`: End the session.

### Advanced Features

- **Model Comparison**: Compare models based on cost, speed, and quality.
- **Batch Processing**: Run evaluations in batch mode for multiple prompts.
- **Web Dashboard**: Visualize results using a local web dashboard built with React and Vite.

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
  conversation/    # Conversation management
  costs/           # Cost calculation
  memory/          # Memory system (store, runner, hooks)
  models/          # Model interfaces and runners (Base, Smart)
  providers/       # Provider implementations
  rate-limit/      # Rate limit handling
  test-utils/      # Shared test utilities
memory/            # Project planning/documentation files
examples/          # Example usage files
output/            # Generated output
scripts/           # Utility scripts
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