# Model Evaluation CLI

A command-line interface for interacting with and evaluating various AI models across different providers.

## Features

- 🔍 Search and filter models by name, provider, and capabilities
- 💰 View and compare model costs
- 📊 Display detailed model information with clickable documentation links
- 📏 Human-readable context lengths and costs
- 🎨 Beautiful, color-coded output
- 🔄 Pipe-friendly output with proper error handling

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

### Chat with a Model

```bash
# Basic chat (requires --provider and --model)
pnpm cli chat --provider google --model gemini-pro "Hello, how are you?"

# Chat and include a file as context
pnpm cli chat --provider ollama --model llama3 --file ./examples/test_data/Home-Cooked\ Software\ and\ Barefoot\ Developers.pdf "Summarize the attached PDF."

# If you omit the message, you will be prompted to enter it interactively
pnpm cli chat --provider openrouter --model gpt-4-turbo
```

**Options:**
- `--provider <provider>`: Provider to use (e.g. `google`, `ollama`, `openrouter`) (required)
- `--model <model>`: Model name to use (e.g. `gemini-pro`, `llama3`, etc.) (required)
- `--file <filePath>`: File to include in the chat (optional)


## Output Format

The CLI provides several output formats:

### List View
```
ID                                                  Provider     Context    Cost/1K    Added
────────────────────────────────────────────────────────────────────────────────────────
google/gemini-2.5-pro-exp-03-25:free               openrouter   1M        Free       03/25/24
gemma3:4b                                          ollama       32K       Free       03/24/24
```

### Info View
```
Model Information
================
Name: Gemini Pro 2.5 Experimental
ID: google/gemini-2.5-pro-exp-03-25:free
Provider: openrouter
URL: https://openrouter.ai/google/gemini-2.5-pro-exp-03-25:free
Context Length: 1M tokens
Cost: Free
Details: architecture: text | tokenizer: bpe | instructType: prompt
```

### Costs View
```
Model Costs (per 1K tokens)
==========================
Model                                    Prompt         Completion     Total
────────────────────────────────────────────────────────────────────────────
gpt-4-turbo                             $0.0100        $0.0300        $0.0400
claude-3-opus                           $0.0150        $0.0750        $0.0900
```

## Environment Variables

- `OPENROUTER_API_KEY`: Your OpenRouter API key (required for OpenRouter models)
- `OLLAMA_HOST`: Ollama host URL (default: http://localhost:11434)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT 