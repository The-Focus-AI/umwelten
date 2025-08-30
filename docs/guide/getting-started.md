# Getting Started

Umwelten is a command-line tool that allows you to interact with and evaluate AI models across different providers (Google, Ollama, OpenRouter, LM Studio, GitHub Models). It focuses on usability, cost transparency, and providing a flexible runner architecture with memory capabilities.

## Prerequisites

- **Node.js** (v20+)
- **pnpm** for package management (recommended) or npm
- **API Keys**: Ensure you have the necessary API keys for the providers you intend to use

## Installation

### Option 1: Install from npm (Recommended)

```bash
npm install -g umwelten
```

### Option 2: Install from source

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

## Environment Setup

Set up your environment variables with the required API keys:

### Option A: Environment variables
```bash
export OPENROUTER_API_KEY=your_openrouter_api_key
export GOOGLE_GENERATIVE_AI_API_KEY=your_google_api_key
export GITHUB_TOKEN=your_github_personal_access_token
export OLLAMA_HOST=http://localhost:11434  # Optional, defaults to localhost:11434
export LMSTUDIO_BASE_URL=http://localhost:1234  # Optional, defaults to localhost:1234
```

### Option B: .env file (for development)
```plaintext
OPENROUTER_API_KEY=your_openrouter_api_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_api_key
GITHUB_TOKEN=your_github_personal_access_token
OLLAMA_HOST=http://localhost:11434
LMSTUDIO_BASE_URL=http://localhost:1234
# LM Studio does not require an API key
```

::: tip
LM Studio and Ollama do not require an API key for local usage, but you'll need to have the LM Studio server running and a model loaded.

GitHub Models requires a GitHub Personal Access Token with the `models` scope. During the preview period, GitHub Models is free to use.
:::

## Verify Installation

Once installed, verify that Umwelten is working correctly:

```bash
# Check version
umwelten --version

# See all available commands
umwelten --help

# List available models (requires API keys to be set)
umwelten models
```

## Next Steps

Now that you have Umwelten installed, you can:

- 🔍 [Discover models](/guide/model-discovery) across all providers
- 💬 [Run basic prompts](/guide/running-prompts) to test functionality
- 🗣️ [Start interactive chat](/guide/interactive-chat) for extended conversations
- 🎯 [Start evaluating models](/guide/model-evaluation) systematically
- 📊 [Use structured output](/guide/structured-output) for data extraction

## Getting Help

If you encounter any issues:

- Check the [troubleshooting section](/guide/troubleshooting)
- Review the [API documentation](/api/overview)
- Visit our [GitHub repository](https://github.com/The-Focus-AI/umwelten) for issues and discussions