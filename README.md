# Umwelten - AI Model Evaluation Tool

A command-line tool for systematic AI model evaluation across providers (Google, Ollama, OpenRouter, LM Studio, GitHub Models) with structured output validation, batch processing, and comprehensive cost analysis.

## 🚀 Quick Start

### New Interaction + Interface Pattern

```bash
# Install globally
npm install -g umwelten

# Interactive chat with tools (new pattern)
pnpm tsx src/cli/cli.ts chat-new -p ollama -m llama3.2:latest

# Tools demonstration with weather, calculator, file analysis
pnpm tsx scripts/tools.ts -p ollama -m llama3.2:latest --prompt "What's the weather in New York?"

# Traditional evaluation workflow
umwelten eval run \
  --prompt "Write a short poem about cats" \
  --models "ollama:gemma3:12b,google:gemini-2.0-flash" \
  --id "cat-poem-eval"
```

### Programmatic Usage

```typescript
import { ChatInteraction, CLIInterface, EvaluationInteraction } from 'umwelten';

// Chat with memory and tools
const chatInteraction = new ChatInteraction({
  name: "llama3.2:latest",
  provider: "ollama"
});

const cliInterface = new CLIInterface();
await cliInterface.startChat(chatInteraction);

// Evaluation with structured output
const evalInteraction = new EvaluationInteraction(
  { name: "gpt-4", provider: "openrouter" },
  "Analyze this code and provide a score from 1-10"
);

const response = await evalInteraction.evaluateWithSchema(scoreSchema);
```

## ✨ Key Features

### 🆕 New Interaction + Interface Pattern
- **🎯 Pre-configured Interactions**: `ChatInteraction`, `EvaluationInteraction`, `AgentInteraction`
- **🖥️ Multiple Interfaces**: CLI, Web, Agent interfaces for different environments
- **🔧 Built-in Tools**: Weather, calculator, file analysis, and more
- **🧠 Memory Integration**: Automatic memory management for learning
- **⚡ Simplified API**: Same interaction works across CLI, web, and agent contexts

### 🔧 Core Capabilities
- **🌐 Multi-Provider Support**: Google, Ollama, OpenRouter, LM Studio, GitHub Models
- **📊 Structured Output**: DSL, JSON Schema, Zod validation with type coercion
- **⚡ Batch Processing**: Concurrent file processing with intelligent error handling
- **💰 Cost Transparency**: Real-time cost calculations with accurate pricing
- **🎯 Interactive UI**: Real-time progress with streaming responses
- **🔄 Real-Time Streaming**: Object and text streaming with partial updates
- **📈 Comprehensive Reports**: Multiple formats (MD, HTML, JSON, CSV)

## 📚 Documentation

**Complete documentation is available at [umwelten.thefocus.ai](https://umwelten.thefocus.ai/)**

### Quick Links

- 📖 [Getting Started](https://umwelten.thefocus.ai/guide/getting-started) - Installation and setup
- 🔍 [Model Discovery](https://umwelten.thefocus.ai/guide/model-discovery) - Find and compare models
- 💬 [Running Prompts](https://umwelten.thefocus.ai/guide/running-prompts) - Single prompt execution
- 🗣️ [Interactive Chat](https://umwelten.thefocus.ai/guide/interactive-chat) - Extended conversations
- 🎯 [Model Evaluation](https://umwelten.thefocus.ai/guide/model-evaluation) - Systematic testing
- 📊 [Structured Output](https://umwelten.thefocus.ai/guide/structured-output) - Schema validation
- ⚡ [Batch Processing](https://umwelten.thefocus.ai/guide/batch-processing) - Multi-file workflows

### Examples & Migration

- 💡 [Examples Gallery](https://umwelten.thefocus.ai/examples/) - Complete usage examples
- 🔄 [Script Migration](https://umwelten.thefocus.ai/migration/) - Migrate from scripts to CLI
- 📋 [API Reference](https://umwelten.thefocus.ai/api/overview) - Complete command reference

## 🛠️ Installation

### Option 1: NPM (Recommended)
```bash
npm install -g umwelten
```

### Option 2: From Source
```bash
git clone https://github.com/The-Focus-AI/umwelten.git
cd umwelten
pnpm install
npm run build
```

## ⚙️ Environment Setup

```bash
# Required API keys
export GOOGLE_GENERATIVE_AI_API_KEY=your_google_api_key
export OPENROUTER_API_KEY=your_openrouter_api_key
export GITHUB_TOKEN=your_github_personal_access_token

# Optional (for local models)
export OLLAMA_HOST=http://localhost:11434
export LMSTUDIO_BASE_URL=http://localhost:1234
```

## 🎯 Common Use Cases

### Model Comparison
```bash
umwelten eval run \
  --prompt "Explain quantum computing in simple terms" \
  --models "ollama:gemma3:12b,google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini" \
  --id "quantum-comparison" \
  --concurrent
```

### Image Analysis
```bash
umwelten eval run \
  --prompt "Describe this image in detail" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "image-analysis" \
  --attach "./image.jpg"
```

### Real-Time Streaming
```bash
# Stream structured objects with real-time updates
umwelten eval run \
  --prompt "Generate a recipe for lasagna" \
  --models "ollama:gemma3:12b" \
  --id "recipe-streaming" \
  --stream \
  --schema '{"recipe": {"name": "string", "ingredients": ["string"], "steps": ["string"]}}'
```

### Structured Data Extraction
```bash
umwelten eval run \
  --prompt "Extract person info: John is 25 and works as a developer" \
  --models "google:gemini-2.0-flash" \
  --id "person-extraction" \
  --schema "name, age int, job"
```

### Batch Processing
```bash
umwelten eval batch \
  --prompt "Analyze this document" \
  --models "google:gemini-2.0-flash" \
  --id "doc-batch" \
  --directory "./documents" \
  --file-pattern "*.pdf" \
  --concurrent
```

## 📊 Provider Support

| Provider | Models | Features | Cost |
|----------|--------|----------|------|
| **Google** | Gemini 2.0/2.5, Flash | Vision, Large Context (2M tokens) | Low cost |
| **Ollama** | Gemma, Llama, Qwen, etc. | Local processing, Privacy | Free |
| **OpenRouter** | GPT-4, Claude, etc. | Wide model selection | Pay-per-use |
| **LM Studio** | Any local model | Full privacy, No API key | Free |
| **GitHub Models** | OpenAI, Meta, DeepSeek, etc. | Free during preview | Free |

## 🏗️ Architecture

```
src/
├── cli/           # CLI command implementations
├── evaluation/    # Evaluation system with concurrent processing
├── providers/     # Multi-provider integrations
├── cognition/     # Model runners and interfaces
├── costs/         # Accurate cost calculation
└── ui/            # Interactive terminal components
```

## 🤝 Contributing

Contributions welcome! Check our [Contributing Guide](CONTRIBUTING.md) and [open issues](https://github.com/The-Focus-AI/umwelten/issues).

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**[📖 View Full Documentation](https://umwelten.thefocus.ai/)** | **[🚀 Examples](https://umwelten.thefocus.ai/examples/)** | **[🔄 Migration Guide](https://umwelten.thefocus.ai/migration/)** 