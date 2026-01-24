# Model Integration

Comprehensive guide to working with different AI model providers programmatically. Learn how to configure, authenticate, and optimize for each provider's specific capabilities and limitations.

## Provider Overview

Umwelten supports four major AI model providers, each with different characteristics:

| Provider | Type | Cost | Best For | Authentication |
|----------|------|------|----------|----------------|
| **Google** | API | Pay-per-token | General use, vision | API Key |
| **Ollama** | Local | Free | Development, privacy | Local server |
| **OpenRouter** | API | Pay-per-token | Premium models | API Key |
| **LM Studio** | Local | Free | Custom models | Local server |

## Google Gemini Models

Google provides the most comprehensive model selection with excellent vision capabilities and competitive pricing.

### Authentication

```typescript
// Set environment variable
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "your-api-key-here";

// Or use .env file
// GOOGLE_GENERATIVE_AI_API_KEY=your-api-key-here
```

### Available Models

```typescript
import { ModelDetails } from '../src/cognition/types.js';

// Fast and cost-effective
const flashModel: ModelDetails = {
  name: 'gemini-2.0-flash',
  provider: 'google',
  temperature: 0.7
};

// Highest quality reasoning
const proModel: ModelDetails = {
  name: 'gemini-2.5-pro-exp-03-25',
  provider: 'google',
  temperature: 0.3 // Lower temperature for reasoning tasks
};

// Ultra-fast for simple tasks
const flash8bModel: ModelDetails = {
  name: 'gemini-1.5-flash-8b',
  provider: 'google',
  temperature: 1.0
};
```

### Vision Capabilities

Google models excel at image and document analysis:

```typescript
import { Interaction } from '../src/interaction/interaction.js';
import { BaseModelRunner } from '../src/cognition/runner.js';

// Image analysis
const visionAnalysis = new Interaction(
  { name: 'gemini-2.0-flash', provider: 'google' },
  'You are an expert image analyst.'
);

await visionAnalysis.addAttachmentFromPath('./image.jpg');
visionAnalysis.addMessage({
  role: 'user',
  content: 'Describe this image in detail, including objects, colors, and composition.'
});

const runner = new BaseModelRunner();
const response = await runner.generateText(visionAnalysis);
```

### Long Context Handling

Google models support very long contexts (up to 2M tokens):

```typescript
// Process large documents
const longContext = new Interaction(
  { name: 'gemini-2.0-flash', provider: 'google' },
  'Analyze this entire document comprehensively.'
);

await longContext.addAttachmentFromPath('./large-report.pdf');
longContext.addMessage({
  role: 'user',
  content: 'Extract key themes, recommendations, and action items from this document.'
});

const response = await runner.generateText(longContext);
```

### Cost Optimization

```typescript
// Use Flash for cost-sensitive applications
const costEffective: ModelDetails = {
  name: 'gemini-2.0-flash',
  provider: 'google',
  maxTokens: 500,  // Limit output length to control costs
  temperature: 0.1 // Lower temperature for consistent, focused responses
};

// Use Pro only for complex reasoning
const premiumReasoning: ModelDetails = {
  name: 'gemini-2.5-pro-exp-03-25',
  provider: 'google',
  temperature: 0.2
};
```

## Ollama Local Models

Ollama provides free local model execution with privacy benefits but requires local setup.

### Setup

```bash
# Install Ollama (one-time setup)
curl -fsSL https://ollama.ai/install.sh | sh

# Start Ollama server
ollama serve

# Pull models
ollama pull gemma3:12b
ollama pull codestral:latest
ollama pull qwen2.5vl:latest  # Vision model
```

### Configuration

```typescript
// Default local configuration
const ollamaModel: ModelDetails = {
  name: 'gemma3:12b',
  provider: 'ollama'
  // Uses default OLLAMA_HOST=http://localhost:11434
};

// Custom Ollama server
process.env.OLLAMA_HOST = "http://custom-server:11434";
const customOllama: ModelDetails = {
  name: 'gemma3:27b',
  provider: 'ollama'
};
```

### Available Models

```typescript
// General purpose models
const gemma12b: ModelDetails = {
  name: 'gemma3:12b',
  provider: 'ollama',
  temperature: 0.8
};

const gemma27b: ModelDetails = {
  name: 'gemma3:27b',
  provider: 'ollama',
  temperature: 0.7 // Larger model, can use slightly lower temperature
};

// Code-specialized models
const codestral: ModelDetails = {
  name: 'codestral:latest',
  provider: 'ollama',
  temperature: 0.1 // Low temperature for precise code generation
};

// Vision models
const qwenVision: ModelDetails = {
  name: 'qwen2.5vl:latest',
  provider: 'ollama',
  temperature: 0.5
};
```

### Local Model Advantages

```typescript
// No API costs
async function freeAnalysis(texts: string[]): Promise<void> {
  const model: ModelDetails = {
    name: 'gemma3:12b',
    provider: 'ollama'
  };
  
  const runner = new BaseModelRunner();
  
  // Process unlimited texts without cost concerns
  for (const text of texts) {
    const conversation = new Interaction(model, 'Analyze this text');
    conversation.addMessage({ role: 'user', content: text });
    
    const response = await runner.generateText(conversation);
    console.log(`Analysis: ${response.content}`);
  }
}

// Privacy-focused processing
async function privateDocumentAnalysis(documentPath: string): Promise<void> {
  const model: ModelDetails = {
    name: 'gemma3:27b',
    provider: 'ollama'
  };
  
  const conversation = new Interaction(model, 'Analyze this sensitive document.');
  await conversation.addAttachmentFromPath(documentPath); // Never leaves your machine
  
  const runner = new BaseModelRunner();
  const response = await runner.generateText(conversation);
  // Document content and analysis stay completely local
}
```

### Performance Considerations

```typescript
// Optimize for local hardware
const lightweightModel: ModelDetails = {
  name: 'gemma3:12b',    // Smaller model for faster responses
  provider: 'ollama',
  maxTokens: 500,        // Limit output for speed
  temperature: 0.5
};

// High-quality model for important tasks
const qualityModel: ModelDetails = {
  name: 'gemma3:27b',    // Larger model for better quality
  provider: 'ollama',
  maxTokens: 2000,
  temperature: 0.7
};
```

## OpenRouter Hosted Models

OpenRouter provides access to the latest models from multiple providers through a single API.

### Authentication

```typescript
// Set environment variable
process.env.OPENROUTER_API_KEY = "your-api-key-here";
```

### Premium Models

```typescript
// GPT-4o (highest quality)
const gpt4o: ModelDetails = {
  name: 'openai/gpt-4o',
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 2000
};

// GPT-4o Mini (balanced cost/quality)
const gpt4oMini: ModelDetails = {
  name: 'openai/gpt-4o-mini',
  provider: 'openrouter',
  temperature: 0.8,
  maxTokens: 1500
};

// Claude Sonnet (excellent for analysis)
const claudeSonnet: ModelDetails = {
  name: 'anthropic/claude-3.7-sonnet:thinking',
  provider: 'openrouter',
  temperature: 0.3, // Lower temperature for analytical tasks
  maxTokens: 3000
};
```

### Model Selection Strategy

```typescript
// Choose models based on task complexity
async function smartModelSelection(task: string, complexity: 'simple' | 'medium' | 'complex') {
  let model: ModelDetails;
  
  switch (complexity) {
    case 'simple':
      model = {
        name: 'openai/gpt-4o-mini',
        provider: 'openrouter',
        temperature: 0.5
      };
      break;
      
    case 'medium':
      model = {
        name: 'anthropic/claude-3.7-sonnet:thinking',
        provider: 'openrouter',
        temperature: 0.3
      };
      break;
      
    case 'complex':
      model = {
        name: 'openai/gpt-4o',
        provider: 'openrouter',
        temperature: 0.2
      };
      break;
  }
  
  const conversation = new Interaction(model, 'You are an expert analyst.');
  conversation.addMessage({ role: 'user', content: task });
  
  const runner = new BaseModelRunner();
  return runner.generateText(conversation);
}
```

### Cost Management

```typescript
// Track costs across OpenRouter models
async function costAwareProcessing(tasks: string[]): Promise<void> {
  let totalCost = 0;
  const maxBudget = 5.00; // $5 budget
  
  const model: ModelDetails = {
    name: 'openai/gpt-4o-mini',
    provider: 'openrouter'
  };
  
  const runner = new BaseModelRunner();
  
  for (const task of tasks) {
    if (totalCost >= maxBudget) {
      console.log(`Budget limit reached: $${totalCost}`);
      break;
    }
    
    const conversation = new Interaction(model, 'Process this task efficiently.');
    conversation.addMessage({ role: 'user', content: task });
    
    const response = await runner.generateText(conversation);
    
    if (response.metadata?.cost) {
      totalCost += response.metadata.cost.totalCost;
      console.log(`Task cost: $${response.metadata.cost.totalCost}, Total: $${totalCost}`);
    }
  }
}
```

## LM Studio Local Models

LM Studio provides a user-friendly way to run local models with a GUI interface.

### Setup

1. Download and install LM Studio
2. Load a model through the GUI
3. Start the local server
4. Configure Umwelten to use the server

### Configuration

```typescript
// Default LM Studio configuration
const lmStudioModel: ModelDetails = {
  name: 'local-model-name', // Use the model name as shown in LM Studio
  provider: 'lmstudio'
  // Uses default LMSTUDIO_BASE_URL=http://localhost:1234
};

// Custom LM Studio server
process.env.LMSTUDIO_BASE_URL = "http://custom-host:1234";
const customLMStudio: ModelDetails = {
  name: 'custom-model',
  provider: 'lmstudio'
};
```

### Model Management

```typescript
// Check available models in LM Studio
async function listLMStudioModels(): Promise<void> {
  try {
    const response = await fetch('http://localhost:1234/v1/models');
    const models = await response.json();
    
    console.log('Available LM Studio models:');
    models.data.forEach(model => {
      console.log(`- ${model.id}`);
    });
  } catch (error) {
    console.error('LM Studio server not running or not accessible');
  }
}
```

### Specialized Model Usage

```typescript
// Use code-specialized models in LM Studio
const codeModel: ModelDetails = {
  name: 'CodeLlama-13B-Instruct', // Example model name in LM Studio
  provider: 'lmstudio',
  temperature: 0.1,
  maxTokens: 2000
};

async function codeGeneration(prompt: string): Promise<string> {
  const conversation = new Interaction(codeModel, 'You are an expert programmer.');
  conversation.addMessage({ role: 'user', content: prompt });
  
  const runner = new BaseModelRunner();
  const response = await runner.generateText(conversation);
  
  return response.content;
}
```

## Cross-Provider Strategies

### Model Cascading

Use cheaper models for initial screening, expensive models for detailed analysis:

```typescript
async function cascadedAnalysis(content: string): Promise<{ screening: string, detailed: string }> {
  // First pass: Quick screening with cost-effective model
  const screeningModel: ModelDetails = {
    name: 'gemma3:12b',
    provider: 'ollama'
  };
  
  const screening = new Interaction(screeningModel, 'Quick content screening');
  screening.addMessage({
    role: 'user',
    content: `Is this content worth detailed analysis? Respond briefly: ${content}`
  });
  
  const runner = new BaseModelRunner();
  const screeningResult = await runner.generateText(screening);
  
  // Second pass: Detailed analysis only if warranted
  let detailedResult = { content: 'Analysis not needed' };
  
  if (screeningResult.content.toLowerCase().includes('yes') || 
      screeningResult.content.toLowerCase().includes('worth')) {
    
    const detailedModel: ModelDetails = {
      name: 'openai/gpt-4o',
      provider: 'openrouter'
    };
    
    const detailed = new Interaction(detailedModel, 'Comprehensive content analysis');
    detailed.addMessage({
      role: 'user',
      content: `Provide detailed analysis: ${content}`
    });
    
    detailedResult = await runner.generateText(detailed);
  }
  
  return {
    screening: screeningResult.content,
    detailed: detailedResult.content
  };
}
```

### Fallback Strategies

Implement robust fallback between providers:

```typescript
async function robustGeneration(prompt: string): Promise<ModelResponse> {
  const fallbackChain: ModelDetails[] = [
    { name: 'gemini-2.0-flash', provider: 'google' },      // Try Google first
    { name: 'openai/gpt-4o-mini', provider: 'openrouter' }, // Fallback to OpenRouter
    { name: 'gemma3:12b', provider: 'ollama' }              // Final fallback to local
  ];
  
  const runner = new BaseModelRunner();
  
  for (const model of fallbackChain) {
    try {
      const conversation = new Interaction(model, 'Generate response');
      conversation.addMessage({ role: 'user', content: prompt });
      
      const response = await runner.generateText(conversation);
      console.log(`Success with ${model.provider}:${model.name}`);
      return response;
      
    } catch (error) {
      console.warn(`Failed with ${model.provider}:${model.name}:`, error.message);
      // Continue to next model in chain
    }
  }
  
  throw new Error('All providers failed');
}
```

### Performance Comparison

```typescript
async function benchmarkProviders(prompt: string): Promise<void> {
  const models: ModelDetails[] = [
    { name: 'gemini-2.0-flash', provider: 'google' },
    { name: 'gemma3:12b', provider: 'ollama' },
    { name: 'openai/gpt-4o-mini', provider: 'openrouter' }
  ];
  
  const results = [];
  const runner = new BaseModelRunner();
  
  for (const model of models) {
    const startTime = Date.now();
    
    try {
      const conversation = new Interaction(model, 'Respond to this prompt');
      conversation.addMessage({ role: 'user', content: prompt });
      
      const response = await runner.generateText(conversation);
      const duration = Date.now() - startTime;
      
      results.push({
        provider: `${model.provider}:${model.name}`,
        duration,
        tokens: response.metadata?.tokenUsage?.total || 0,
        cost: response.metadata?.cost?.totalCost || 0,
        content: response.content.substring(0, 100) + '...'
      });
      
    } catch (error) {
      results.push({
        provider: `${model.provider}:${model.name}`,
        error: error.message
      });
    }
  }
  
  // Display performance comparison
  console.table(results);
}
```

## Provider-Specific Best Practices

### Google Optimization

```typescript
// Optimize for Google's strengths
const googleBestPractices: ModelDetails = {
  name: 'gemini-2.0-flash',
  provider: 'google',
  temperature: 0.7,
  // Google handles long contexts well - don't artificially limit
  // Google excels at vision tasks - use for image/document analysis
  // Google pricing is token-based - optimize prompt length
};
```

### Ollama Optimization

```typescript
// Optimize for local resources
const ollamaBestPractices: ModelDetails = {
  name: 'gemma3:12b',
  provider: 'ollama',
  temperature: 0.8,
  maxTokens: 1000, // Limit for faster local generation
  // Use for privacy-sensitive data
  // Great for development and testing
  // Consider hardware limitations
};
```

### OpenRouter Optimization

```typescript
// Optimize for premium model access
const openRouterBestPractices: ModelDetails = {
  name: 'openai/gpt-4o-mini',
  provider: 'openrouter',
  temperature: 0.6,
  // Monitor costs carefully
  // Use for complex reasoning tasks
  // Leverage latest model access
};
```

## Error Handling by Provider

### Provider-Specific Error Patterns

```typescript
async function handleProviderErrors(model: ModelDetails, conversation: Interaction): Promise<ModelResponse | null> {
  const runner = new BaseModelRunner();
  
  try {
    return await runner.generateText(conversation);
  } catch (error) {
    switch (model.provider) {
      case 'google':
        if (error.message.includes('quota exceeded')) {
          console.error('Google API quota exceeded - try again later');
        } else if (error.message.includes('safety')) {
          console.error('Content triggered safety filters - adjust prompt');
        }
        break;
        
      case 'ollama':
        if (error.message.includes('connection refused')) {
          console.error('Ollama server not running - start with `ollama serve`');
        } else if (error.message.includes('model not found')) {
          console.error('Model not pulled - run `ollama pull model-name`');
        }
        break;
        
      case 'openrouter':
        if (error.message.includes('insufficient credits')) {
          console.error('OpenRouter credits exhausted - add more credits');
        } else if (error.message.includes('model not found')) {
          console.error('Model not available on OpenRouter - check model list');
        }
        break;
        
      case 'lmstudio':
        if (error.message.includes('connection refused')) {
          console.error('LM Studio server not running - start server in LM Studio');
        }
        break;
    }
    
    return null;
  }
}
```

## Next Steps

- Explore [Evaluation Framework](/api/evaluation-framework) for advanced multi-provider evaluation patterns
- See [Schema Validation](/api/schemas) for structured output across different providers
- Check [Core Classes](/api/core-classes) for detailed API documentation