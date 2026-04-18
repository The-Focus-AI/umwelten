# Providers API

The providers module gives unified access to multiple LLM backends through a common `BaseProvider` abstract class. Each provider implements model listing and language model creation via the Vercel AI SDK.

## Supported Providers

| Provider | Key | Env Variable | Local? | User Tracking |
|----------|-----|-------------|--------|---------------|
| Google Gemini | `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | No | No |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | No | Yes (`user`) |
| Ollama | `ollama` | (none) | Yes | No |
| LM Studio | `lmstudio` | (none) | Yes | No |
| LlamaBarn | `llamabarn` | (none) | Yes | No |
| llama-swap | `llamaswap` | (none) | Yes | No |
| GitHub Models | `github-models` | `GITHUB_TOKEN` | No | No |
| Fireworks | `fireworks` | `FIREWORKS_API_KEY` | No | No |
| MiniMax | `minimax` | `MINIMAX_API_KEY` | No | No |

> **User tracking**: When `interaction.userId` is set, the runner automatically sends it to providers that support per-user analytics. OpenRouter uses it for sub-user cost attribution; Anthropic uses it for abuse detection. See [Cognition API — Per-User Cost Tracking](/api/cognition#per-user-cost-tracking) for details.

## BaseProvider

All providers extend this abstract class:

```typescript
import { BaseProvider } from '../src/providers/base.js';

abstract class BaseProvider {
  protected constructor(apiKey?: string, baseUrl?: string);

  /** List all available models from this provider */
  abstract listModels(): Promise<ModelDetails[]>;

  /** Get a Vercel AI SDK LanguageModel instance */
  abstract getLanguageModel(route: ModelRoute): LanguageModel;

  /** Validate required config (API key) */
  protected validateConfig(): void;

  /** Whether this provider requires an API key (default: true) */
  protected get requiresApiKey(): boolean;
}
```

## Creating Providers

Use the factory functions — don't instantiate classes directly:

```typescript
import { createGoogleProvider } from '../src/providers/google.js';
import { createOpenRouterProvider } from '../src/providers/openrouter.js';
import { createOllamaProvider } from '../src/providers/ollama.js';
import { createLMStudioProvider } from '../src/providers/lmstudio.js';
import { createLlamaBarnProvider } from '../src/providers/llamabarn.js';
import { createLlamaSwapProvider } from '../src/providers/llamaswap.js';
import { createGitHubModelsProvider } from '../src/providers/github-models.js';
import { createFireworksProvider } from '../src/providers/fireworks.js';
import { createMiniMaxProvider } from '../src/providers/minimax.js';

// Cloud providers (require API keys)
const google = createGoogleProvider(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);
const openrouter = createOpenRouterProvider(process.env.OPENROUTER_API_KEY!);
const github = createGitHubModelsProvider(process.env.GITHUB_TOKEN!);
const fireworks = createFireworksProvider(process.env.FIREWORKS_API_KEY!);
const minimax = createMiniMaxProvider(process.env.MINIMAX_API_KEY!);

// Local providers (no API key)
const ollama = createOllamaProvider();
const lmstudio = createLMStudioProvider();
const llamabarn = createLlamaBarnProvider();
const llamaswap = createLlamaSwapProvider(); // default: http://localhost:8080/v1
```

### Listing Models

```typescript
const google = createGoogleProvider(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);
const models = await google.listModels();

for (const model of models) {
  console.log(`${model.name} - context: ${model.contextLength}, cost: ${JSON.stringify(model.costs)}`);
}
```

### Getting a Language Model

```typescript
const google = createGoogleProvider(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);
const languageModel = google.getLanguageModel({
  name: "gemini-3-flash-preview",
  provider: "google"
});
// Returns a Vercel AI SDK LanguageModel for use with generateText(), streamText(), etc.
```

## Provider Index Functions

The `src/providers/index.ts` module provides high-level functions that automatically resolve providers:

```typescript
import {
  getModel,
  getModelProvider,
  validateModel,
  getModelUrl,
  getModelDetails
} from '../src/providers/index.js';
```

### `getModel(modelDetails): Promise<LanguageModel | undefined>`

Get a Vercel AI SDK `LanguageModel` from model details. This is the primary way to get a model instance.

```typescript
const model = await getModel({
  name: "gemini-3-flash-preview",
  provider: "google"
});
// Returns LanguageModel ready for use with Vercel AI SDK
```

### `getModelProvider(modelDetails): Promise<BaseProvider | undefined>`

Get the provider instance for a given model. Automatically reads API keys from environment variables.

```typescript
const provider = await getModelProvider({
  name: "gemini-3-flash-preview",
  provider: "google"
});
const models = await provider?.listModels();
```

### `validateModel(modelDetails): Promise<ModelDetails | undefined>`

Check if a model actually exists on its provider. Returns the full `ModelDetails` if found, `undefined` otherwise.

```typescript
const validated = await validateModel({
  name: "gemini-3-flash-preview",
  provider: "google"
});
if (validated) {
  console.log("Model exists:", validated.name);
} else {
  console.log("Model not found");
}
```

### `getModelUrl(model): string | undefined`

Get a web URL for a model's information page.

```typescript
const url = getModelUrl({ name: "gemini-3-flash-preview", provider: "google" });
// Returns something like "https://ai.google.dev/models/gemini-3-flash-preview"
```

## Model Discovery

The `src/cognition/models.ts` module provides cross-provider model search:

```typescript
import { getAllModels, searchModels } from '../src/cognition/models.js';

// Get models from all configured providers
const allModels = await getAllModels();
console.log(`Found ${allModels.length} models across all providers`);

// Search by name/description
const flashModels = await searchModels("flash", allModels);
```

## Type Definitions

### ModelRoute

Base model identifier:

```typescript
interface ModelRoute {
  name: string;        // Model identifier (e.g. "gemini-3-flash-preview")
  provider: string;    // Provider key (e.g. "google")
  variant?: string;    // Optional variant (e.g. "free")
  temperature?: number;
  topP?: number;
  topK?: number;
  numCtx?: number;     // Context token count (Ollama)
}
```

### ModelDetails

Extended model info returned by `listModels()`:

```typescript
interface ModelDetails extends ModelRoute {
  description?: string;
  contextLength?: number;
  costs?: {
    promptTokens: number;       // Cost per million prompt tokens
    completionTokens: number;   // Cost per million completion tokens
  };
  addedDate?: Date;
  lastUpdated?: Date;
  details?: Record<string, unknown>;
  originalProvider?: string;    // For OpenRouter: the actual provider (e.g. "openai")
}
```

## Environment Variables

```bash
# Google Gemini (REQUIRED for google provider)
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here

# OpenRouter (REQUIRED for openrouter provider)
OPENROUTER_API_KEY=your_key_here

# GitHub Models (REQUIRED for github-models provider)
GITHUB_TOKEN=your_token_here

# Fireworks (REQUIRED for fireworks provider)
FIREWORKS_API_KEY=your_key_here

# MiniMax (REQUIRED for minimax provider)
MINIMAX_API_KEY=your_key_here

# Optional MiniMax override
MINIMAX_BASE_URL=https://api.minimax.io/v1

# Local providers need no env vars — they connect to localhost by default
# Ollama: http://localhost:11434
# LM Studio: http://localhost:1234
# LlamaBarn: http://localhost:2276/v1 (override with LLAMABARN_HOST)
# llama-swap: http://localhost:8080/v1 (override with LLAMASWAP_HOST)
```

### Generating a llama-swap config

`llama-swap` is a proxy that launches `llama-server` on demand per model and unloads idle models. The `llamaswap` provider only needs the proxy's URL — to produce the YAML config that tells the proxy which GGUF files to serve, use:

```bash
pnpm run cli -- models llamaswap-config --output llama-swap.yaml
llama-swap --config llama-swap.yaml --listen :8080
```

See [CLI — `models llamaswap-config`](/api/cli#models-llamaswap-config) for flags. Programmatic access is available through `src/providers/llamaswap-config.ts`:

```typescript
import { generateLlamaSwapConfig } from '../src/providers/llamaswap-config.js';

const { yaml, models } = generateLlamaSwapConfig({
  ttlSeconds: 300,
  ctxSize: 0,
  extraCachePaths: ['/custom/gguf/location'],
});
```


## Usage with Interaction

You typically don't use providers directly. Pass `ModelDetails` to `Interaction`:

```typescript
import { Interaction } from '../src/interaction/core/interaction.js';
import { Stimulus } from '../src/stimulus/stimulus.js';

const stimulus = new Stimulus({ role: "helpful assistant" });
const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);

const response = await interaction.chat("Hello!");
console.log(response.content);
```

The `Interaction` internally calls `getModel()` to resolve the provider and create the language model.
