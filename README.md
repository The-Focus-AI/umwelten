# Umwelten - AI Model Evaluation Tool

A command-line tool for systematic AI model evaluation across providers (Google, Ollama, OpenRouter, LM Studio) with structured output validation, batch processing, and comprehensive cost analysis.

## 🚀 Quick Start

```bash
# Install globally
npm install -g umwelten

# Discover available models
umwelten models list

# Run a simple evaluation
umwelten eval run \
  --prompt "Write a short poem about cats" \
  --models "ollama:gemma3:12b,google:gemini-2.0-flash" \
  --id "cat-poem-eval"

# Generate a report
umwelten eval report --id cat-poem-eval --format markdown
```

## ✨ Key Features

- **🌐 Multi-Provider Support**: Google, Ollama, OpenRouter, LM Studio
- **📊 Structured Output**: DSL, JSON Schema, Zod validation with type coercion
- **⚡ Batch Processing**: Concurrent file processing with intelligent error handling
- **💰 Cost Transparency**: Real-time cost calculations with accurate pricing
- **🎯 Interactive UI**: Real-time progress with streaming responses
- **🧠 Memory & Tools**: Chat with memory and specialized tools
- **📈 Comprehensive Reports**: Multiple formats (MD, HTML, JSON, CSV)

## 📚 Documentation

**Complete documentation is available at [umwelten.dev](https://the-focus-ai.github.io/umwelten/)**

### Quick Links

- 📖 [Getting Started](https://the-focus-ai.github.io/umwelten/guide/getting-started) - Installation and setup
- 🔍 [Model Discovery](https://the-focus-ai.github.io/umwelten/guide/model-discovery) - Find and compare models
- 🎯 [Model Evaluation](https://the-focus-ai.github.io/umwelten/guide/model-evaluation) - Systematic testing
- 📊 [Structured Output](https://the-focus-ai.github.io/umwelten/guide/structured-output) - Schema validation
- ⚡ [Batch Processing](https://the-focus-ai.github.io/umwelten/guide/batch-processing) - Multi-file workflows

### Examples & Migration

- 💡 [Examples Gallery](https://the-focus-ai.github.io/umwelten/examples/) - Complete usage examples
- 🔄 [Script Migration](https://the-focus-ai.github.io/umwelten/migration/) - Migrate from scripts to CLI
- 📋 [API Reference](https://the-focus-ai.github.io/umwelten/api/overview) - Complete command reference

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

**[📖 View Full Documentation](https://the-focus-ai.github.io/umwelten/)** | **[🚀 Examples](https://the-focus-ai.github.io/umwelten/examples/)** | **[🔄 Migration Guide](https://the-focus-ai.github.io/umwelten/migration/)** 