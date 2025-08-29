# Providers API

The Providers package provides a unified interface for interacting with different AI model providers. It implements provider-specific logic while maintaining a consistent API across all supported services.

## Overview

The Providers package abstracts the complexity of different AI model APIs and provides:

- **Unified Interface**: Consistent API across all providers
- **Provider Management**: Easy switching between different AI services
- **Model Discovery**: Automatic discovery of available models
- **Cost Calculation**: Provider-specific pricing and cost estimation
- **Rate Limiting**: Built-in rate limiting and error handling

## Supported Providers

- **Google**: Gemini models via Google AI Studio
- **OpenRouter**: Access to multiple providers (OpenAI, Anthropic, etc.)
- **Ollama**: Local model execution
- **LM Studio**: Local model execution with REST API
- **GitHub Models**: Free access to AI models during preview period

## Core Classes

### Provider Interface

All providers implement the base `Provider` interface:

```typescript
interface Provider {
  getModelUrls(): Promise<Record<string, string>>;
  getAvailableModels(): Promise<ModelDetails[]>;
  calculateCosts(model: string, promptTokens: number, completionTokens: number): ModelCosts;
}
```

### GoogleProvider

Provider for Google's Gemini models.

```typescript
import { GoogleProvider } from '../src/providers/google.js';

const provider = new GoogleProvider();
```

#### Methods

##### `getAvailableModels(): Promise<ModelDetails[]>`

Get all available Google Gemini models.

```typescript
const models = await provider.getAvailableModels();
console.log('Available Google models:', models.map(m => m.name));
```

**Returns**: Promise resolving to array of available model details

##### `calculateCosts(model: string, promptTokens: number, completionTokens: number): ModelCosts`

Calculate costs for a specific model and token usage.

```typescript
const costs = provider.calculateCosts('gemini-2.0-flash', 1000, 500);
console.log(`Cost: $${costs.totalCost.toFixed(4)}`);
```

**Parameters**:
- `model`: Model identifier (e.g., 'gemini-2.0-flash')
- `promptTokens`: Number of prompt tokens
- `completionTokens`: Number of completion tokens

**Returns**: ModelCosts object with pricing information

### OpenRouterProvider

Provider for OpenRouter, which provides access to multiple AI services.

```typescript
import { OpenRouterProvider } from '../src/providers/openrouter.js';

const provider = new OpenRouterProvider();
```

#### Methods

##### `getAvailableModels(): Promise<ModelDetails[]>`

Get all available models through OpenRouter.

```typescript
const models = await provider.getAvailableModels();
console.log('Available OpenRouter models:', models.map(m => `${m.name} (${m.provider})`));
```

**Returns**: Promise resolving to array of available model details

##### `calculateCosts(model: string, promptTokens: number, completionTokens: number): ModelCosts`

Calculate costs for OpenRouter models.

```typescript
const costs = provider.calculateCosts('gpt-4', 1000, 500);
console.log(`GPT-4 cost: $${costs.totalCost.toFixed(4)}`);
```

### OllamaProvider

Provider for local Ollama models.

```typescript
import { OllamaProvider } from '../src/providers/ollama.js';

const provider = new OllamaProvider();
```

#### Constructor

```typescript
constructor(baseUrl?: string)
```

**Parameters**:
- `baseUrl`: Optional base URL for Ollama server (defaults to 'http://localhost:11434')

#### Methods

##### `getAvailableModels(): Promise<ModelDetails[]>`

Get all available local Ollama models.

```typescript
const models = await provider.getAvailableModels();
console.log('Available Ollama models:', models.map(m => m.name));
```

**Returns**: Promise resolving to array of available model details

##### `calculateCosts(model: string, promptTokens: number, completionTokens: number): ModelCosts`

Calculate costs for Ollama models (typically free for local models).

```typescript
const costs = provider.calculateCosts('llama2', 1000, 500);
console.log(`Ollama cost: $${costs.totalCost.toFixed(4)}`); // Usually $0.00
```

### LMStudioProvider

Provider for LM Studio local models.

```typescript
import { LMStudioProvider } from '../src/providers/lmstudio.js';

const provider = new LMStudioProvider();
```

#### Constructor

```typescript
constructor(baseUrl?: string)
```

**Parameters**:
- `baseUrl`: Optional base URL for LM Studio server (defaults to 'http://localhost:1234')

#### Methods

##### `getAvailableModels(): Promise<ModelDetails[]>`

Get all available LM Studio models.

```typescript
const models = await provider.getAvailableModels();
console.log('Available LM Studio models:', models.map(m => m.name));
```

**Returns**: Promise resolving to array of available model details

### GitHubModelsProvider

Provider for GitHub Models, offering free access to AI models during the preview period.

```typescript
import { GitHubModelsProvider } from '../src/providers/github-models.js';

const provider = new GitHubModelsProvider();
```

#### Constructor

```typescript
constructor(apiKey?: string, baseUrl?: string)
```

**Parameters**:
- `apiKey`: GitHub Personal Access Token with `models` scope
- `baseUrl`: Optional base URL (defaults to 'https://models.github.ai/inference')

#### Methods

##### `getAvailableModels(): Promise<ModelDetails[]>`

Get all available GitHub Models.

```typescript
const models = await provider.getAvailableModels();
console.log('Available GitHub Models:', models.map(m => m.name));
```

**Returns**: Promise resolving to array of available model details

##### `calculateCosts(model: string, promptTokens: number, completionTokens: number): ModelCosts`

Calculate costs for GitHub Models (free during preview period).

```typescript
const costs = provider.calculateCosts('openai/gpt-4o-mini', 1000, 500);
console.log(`GitHub Models cost: $${costs.totalCost.toFixed(4)}`); // $0.00 during preview
```

**Parameters**:
- `model`: Model identifier (e.g., 'openai/gpt-4o-mini')
- `promptTokens`: Number of prompt tokens
- `completionTokens`: Number of completion tokens

**Returns**: ModelCosts object with pricing information (currently free)

::: tip
GitHub Models is currently free during the preview period. The provider supports models from OpenAI, Meta, DeepSeek, and other providers through the GitHub Models platform.
:::

## Provider Management

### Provider Registry

The provider registry manages all available providers and provides unified access.

```typescript
import { getProvider, getAllProviders } from '../src/providers/index.js';
```

#### `getProvider(name: string): Provider`

Get a specific provider by name.

```typescript
const googleProvider = getProvider('google');
const openRouterProvider = getProvider('openrouter');
const ollamaProvider = getProvider('ollama');
const lmStudioProvider = getProvider('lmstudio');
const githubModelsProvider = getProvider('github-models');
```

**Parameters**:
- `name`: Provider name ('google', 'openrouter', 'ollama', 'lmstudio', 'github-models')

**Returns**: Provider instance

**Throws**: Error if provider not found

#### `getAllProviders(): Record<string, Provider>`

Get all available providers.

```typescript
const providers = getAllProviders();
console.log('Available providers:', Object.keys(providers));
```

**Returns**: Object mapping provider names to provider instances

## Type Definitions

### ModelDetails

Core interface for model information across all providers.

```typescript
interface ModelDetails {
  id: string;              // Unique model identifier
  name: string;            // Human-readable model name
  provider: string;        // Provider name
  contextLength?: number;  // Maximum context length
  costs?: ModelCosts;      // Cost information
  description?: string;    // Model description
  tags?: string[];         // Model tags/categories
}
```

### ModelCosts

Cost information for model usage.

```typescript
interface ModelCosts {
  promptTokens: number;     // Cost per million prompt tokens
  completionTokens: number; // Cost per million completion tokens
  totalCost: number;        // Calculated total cost
}
```

### ProviderError

Error thrown by providers.

```typescript
class ProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
```

## Usage Examples

### Basic Provider Usage

```typescript
import { getProvider } from '../src/providers/index.js';

// Get a specific provider
const googleProvider = getProvider('google');

// Get available models
const models = await googleProvider.getAvailableModels();
console.log('Google models:', models.map(m => m.name));

// Calculate costs
const costs = googleProvider.calculateCosts('gemini-2.0-flash', 1000, 500);
console.log(`Cost: $${costs.totalCost.toFixed(4)}`);
```

### Multi-Provider Comparison

```typescript
import { getAllProviders } from '../src/providers/index.js';

const providers = getAllProviders();

// Compare models across providers
for (const [providerName, provider] of Object.entries(providers)) {
  try {
    const models = await provider.getAvailableModels();
    console.log(`${providerName}: ${models.length} models available`);
    
    // Show first few models
    models.slice(0, 3).forEach(model => {
      console.log(`  - ${model.name}`);
    });
  } catch (error) {
    console.error(`Error getting ${providerName} models:`, error.message);
  }
}
```

### Cost Analysis

```typescript
import { getProvider } from '../src/providers/index.js';

const providers = ['google', 'openrouter', 'ollama'];
const promptTokens = 1000;
const completionTokens = 500;

for (const providerName of providers) {
  try {
    const provider = getProvider(providerName);
    const models = await provider.getAvailableModels();
    
    console.log(`\n${providerName.toUpperCase()} COSTS:`);
    
    // Show costs for first few models
    models.slice(0, 3).forEach(model => {
      const costs = provider.calculateCosts(model.name, promptTokens, completionTokens);
      console.log(`  ${model.name}: $${costs.totalCost.toFixed(6)}`);
    });
  } catch (error) {
    console.error(`Error with ${providerName}:`, error.message);
  }
}
```

### Local Provider Setup

```typescript
import { OllamaProvider } from '../src/providers/ollama.js';
import { LMStudioProvider } from '../src/providers/lmstudio.js';

// Custom Ollama server
const ollamaProvider = new OllamaProvider('http://192.168.1.100:11434');

// Custom LM Studio server
const lmStudioProvider = new LMStudioProvider('http://192.168.1.101:1234');

// Check if local providers are available
try {
  const ollamaModels = await ollamaProvider.getAvailableModels();
  console.log('Ollama models:', ollamaModels.map(m => m.name));
} catch (error) {
  console.log('Ollama not available:', error.message);
}

try {
  const lmStudioModels = await lmStudioProvider.getAvailableModels();
  console.log('LM Studio models:', lmStudioModels.map(m => m.name));
} catch (error) {
  console.log('LM Studio not available:', error.message);
}
```

### Error Handling

```typescript
import { getProvider } from '../src/providers/index.js';

async function getModelsSafely(providerName: string) {
  try {
    const provider = getProvider(providerName);
    const models = await provider.getAvailableModels();
    return models;
  } catch (error) {
    if (error instanceof ProviderError) {
      console.error(`${providerName} error (${error.statusCode}):`, error.message);
    } else {
      console.error(`Unexpected error with ${providerName}:`, error.message);
    }
    return [];
  }
}

// Safe provider usage
const googleModels = await getModelsSafely('google');
const openRouterModels = await getModelsSafely('openrouter');
```

### Model Discovery and Filtering

```typescript
import { getAllProviders } from '../src/providers/index.js';

async function findModelsByCapability(capability: string) {
  const providers = getAllProviders();
  const matchingModels: ModelDetails[] = [];
  
  for (const [providerName, provider] of Object.entries(providers)) {
    try {
      const models = await provider.getAvailableModels();
      
      // Filter models by capability (e.g., vision, coding, etc.)
      const filtered = models.filter(model => 
        model.tags?.includes(capability) || 
        model.description?.toLowerCase().includes(capability)
      );
      
      matchingModels.push(...filtered.map(model => ({
        ...model,
        provider: providerName
      })));
    } catch (error) {
      console.error(`Error with ${providerName}:`, error.message);
    }
  }
  
  return matchingModels;
}

// Find vision-capable models
const visionModels = await findModelsByCapability('vision');
console.log('Vision models:', visionModels.map(m => `${m.name} (${m.provider})`));

// Find coding models
const codingModels = await findModelsByCapability('coding');
console.log('Coding models:', codingModels.map(m => `${m.name} (${m.provider})`));
```

## Configuration

### Environment Variables

Providers require specific environment variables for authentication:

```bash
# Google AI Studio
GOOGLE_API_KEY=your_google_api_key

# OpenRouter
OPENROUTER_API_KEY=your_openrouter_api_key

# Ollama (optional - defaults to localhost)
OLLAMA_BASE_URL=http://localhost:11434

# LM Studio (optional - defaults to localhost)
LMSTUDIO_BASE_URL=http://localhost:1234
```

### Provider-Specific Configuration

```typescript
import { GoogleProvider } from '../src/providers/google.js';
import { OpenRouterProvider } from '../src/providers/openrouter.js';

// Google provider with custom configuration
const googleProvider = new GoogleProvider();

// OpenRouter provider with custom configuration
const openRouterProvider = new OpenRouterProvider();

// Local providers with custom URLs
const ollamaProvider = new OllamaProvider('http://192.168.1.100:11434');
const lmStudioProvider = new LMStudioProvider('http://192.168.1.101:1234');
```

## Best Practices

### 1. Provider Selection

Choose the right provider for your use case:

```typescript
// For production applications
const productionProvider = getProvider('google'); // Reliable, well-supported

// For cost-sensitive applications
const costProvider = getProvider('openrouter'); // Access to cheaper models

// For local development
const localProvider = getProvider('ollama'); // No API costs, privacy

// For specific model access
const specificProvider = getProvider('openrouter'); // Access to Claude, GPT-4, etc.
```

### 2. Error Handling

Always handle provider errors gracefully:

```typescript
async function executeWithFallback(primaryProvider: string, fallbackProvider: string) {
  try {
    const provider = getProvider(primaryProvider);
    return await provider.getAvailableModels();
  } catch (error) {
    console.warn(`${primaryProvider} failed, trying ${fallbackProvider}`);
    const fallback = getProvider(fallbackProvider);
    return await fallback.getAvailableModels();
  }
}
```

### 3. Cost Management

Monitor and manage costs across providers:

```typescript
function compareCosts(providers: string[], promptTokens: number, completionTokens: number) {
  const costs: Record<string, ModelCosts> = {};
  
  for (const providerName of providers) {
    try {
      const provider = getProvider(providerName);
      const models = await provider.getAvailableModels();
      
      // Calculate costs for first model
      if (models.length > 0) {
        costs[providerName] = provider.calculateCosts(
          models[0].name, 
          promptTokens, 
          completionTokens
        );
      }
    } catch (error) {
      console.error(`Error calculating costs for ${providerName}:`, error.message);
    }
  }
  
  return costs;
}
```

### 4. Model Caching

Cache model information to avoid repeated API calls:

```typescript
class ModelCache {
  private cache = new Map<string, { models: ModelDetails[]; timestamp: number }>();
  private readonly TTL = 5 * 60 * 1000; // 5 minutes
  
  async getModels(providerName: string): Promise<ModelDetails[]> {
    const cached = this.cache.get(providerName);
    
    if (cached && Date.now() - cached.timestamp < this.TTL) {
      return cached.models;
    }
    
    const provider = getProvider(providerName);
    const models = await provider.getAvailableModels();
    
    this.cache.set(providerName, {
      models,
      timestamp: Date.now()
    });
    
    return models;
  }
}
```

### 5. Rate Limiting

Implement rate limiting for API-heavy operations:

```typescript
import { RateLimiter } from '../src/rate-limit/rate-limiter.js';

const rateLimiter = new RateLimiter({
  maxRequests: 10,
  windowMs: 60000 // 1 minute
});

async function getModelsWithRateLimit(providerName: string) {
  await rateLimiter.waitForToken();
  const provider = getProvider(providerName);
  return await provider.getAvailableModels();
}
```

## Integration with Other Packages

### With Cognition Package

```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';
import { getProvider } from '../src/providers/index.js';

const provider = getProvider('google');
const models = await provider.getAvailableModels();
const model = models[0]; // Use first available model

const runner = new BaseModelRunner();
// runner uses the provider internally for model execution
```

### With CLI Package

```typescript
import { listModels } from '../src/cli/models.js';
import { getProvider } from '../src/providers/index.js';

// CLI command implementation
async function listProviderModels(providerName: string) {
  const provider = getProvider(providerName);
  const models = await provider.getAvailableModels();
  
  console.log(`${providerName.toUpperCase()} MODELS:`);
  models.forEach(model => {
    console.log(`  ${model.name} - ${model.description || 'No description'}`);
  });
}
```

### With Evaluation Package

```typescript
import { EvaluationRunner } from '../src/evaluation/runner.js';
import { getProvider } from '../src/providers/index.js';

async function evaluateProvider(providerName: string) {
  const provider = getProvider(providerName);
  const models = await provider.getAvailableModels();
  
  const evaluator = new EvaluationRunner();
  
  for (const model of models.slice(0, 3)) { // Test first 3 models
    const evaluation = await evaluator.evaluate(model);
    console.log(`${model.name}: ${evaluation.score}`);
  }
}
```
