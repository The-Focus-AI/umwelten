# Memory API

The Memory package provides conversation memory, fact extraction, and knowledge management capabilities. It implements persistent memory across interactions and enables models to learn and recall information from previous conversations.

## Overview

The Memory package provides:

- **Memory Store**: Persistent storage for conversation history and extracted facts
- **Fact Extraction**: Automatic extraction of key information from model responses
- **Memory Runner**: Enhanced model runner with memory capabilities
- **Operation Determination**: Intelligent analysis of what operations to perform
- **Knowledge Management**: Structured storage and retrieval of learned information

## Core Classes

### MemoryStore

Persistent storage for conversation memory and extracted facts.

```typescript
import { MemoryStore } from '../src/memory/memory_store.js';

const memoryStore = new MemoryStore();
```

#### Methods

##### `addFact(fact: ExtractedFact): Promise<void>`

Add a new fact to the memory store.

```typescript
import { ExtractedFact } from '../src/memory/types.js';

const fact: ExtractedFact = {
  id: 'fact-001',
  content: 'The user prefers detailed explanations',
  category: 'preference',
  confidence: 0.9,
  timestamp: new Date(),
  source: 'conversation-123'
};

await memoryStore.addFact(fact);
```

**Parameters**:
- `fact`: The extracted fact to store

##### `getFacts(category?: string): Promise<ExtractedFact[]>`

Retrieve facts from the memory store, optionally filtered by category.

```typescript
// Get all facts
const allFacts = await memoryStore.getFacts();

// Get facts by category
const preferences = await memoryStore.getFacts('preference');
const knowledge = await memoryStore.getFacts('knowledge');
```

**Parameters**:
- `category`: Optional category filter

**Returns**: Promise resolving to array of extracted facts

##### `searchFacts(query: string): Promise<ExtractedFact[]>`

Search facts by content using semantic similarity.

```typescript
const relevantFacts = await memoryStore.searchFacts('user preferences');
console.log('Found relevant facts:', relevantFacts.length);
```

**Parameters**:
- `query`: Search query string

**Returns**: Promise resolving to array of relevant facts

##### `clearFacts(): Promise<void>`

Clear all facts from the memory store.

```typescript
await memoryStore.clearFacts();
console.log('Memory store cleared');
```

### MemoryRunner

Enhanced model runner with memory capabilities and fact extraction.

```typescript
import { MemoryRunner } from '../src/memory/memory_runner.js';

const memoryRunner = new MemoryRunner();
```

#### Methods

##### `execute(interaction: Interaction): Promise<TextResponse>`

Execute an interaction with memory capabilities.

```typescript
import { Interaction } from '../src/interaction/interaction.js';
import { Stimulus } from '../src/interaction/stimulus.js';

const interaction = new Interaction(model, "You are a helpful assistant with memory.");
interaction.addStimulus(new Stimulus("Remember that I prefer detailed explanations."));

const response = await memoryRunner.execute(interaction);
console.log(response.content);
```

**Parameters**:
- `interaction`: The interaction to execute

**Returns**: Promise resolving to text response with memory integration

##### `extractFacts(response: string): Promise<ExtractedFact[]>`

Extract facts from a model response.

```typescript
const response = "The user's name is John and they work as a software engineer.";
const facts = await memoryRunner.extractFacts(response);

facts.forEach(fact => {
  console.log(`Extracted fact: ${fact.content} (${fact.category})`);
});
```

**Parameters**:
- `response`: The model response to analyze

**Returns**: Promise resolving to array of extracted facts

### FactExtractor

Specialized class for extracting structured facts from text.

```typescript
import { FactExtractor } from '../src/memory/extract_facts.js';

const extractor = new FactExtractor();
```

#### Methods

##### `extract(text: string): Promise<ExtractedFact[]>`

Extract facts from text using AI analysis.

```typescript
const text = "Alice is a 30-year-old data scientist who lives in San Francisco. She enjoys hiking and reading science fiction.";
const facts = await extractor.extract(text);

facts.forEach(fact => {
  console.log(`${fact.category}: ${fact.content}`);
});
```

**Parameters**:
- `text`: The text to analyze for facts

**Returns**: Promise resolving to array of extracted facts

##### `extractFromResponse(response: TextResponse): Promise<ExtractedFact[]>`

Extract facts from a model response.

```typescript
const response = await modelRunner.generateText(interaction);
const facts = await extractor.extractFromResponse(response);
```

**Parameters**:
- `response`: The model response to analyze

**Returns**: Promise resolving to array of extracted facts

### OperationDeterminer

Intelligent analysis of what operations to perform based on user input.

```typescript
import { OperationDeterminer } from '../src/memory/determine_operations.js';

const determiner = new OperationDeterminer();
```

#### Methods

##### `determine(text: string): Promise<Operation[]>`

Determine what operations should be performed based on text analysis.

```typescript
const text = "Remember that I prefer detailed explanations and I'm working on a React project.";
const operations = await determiner.determine(text);

operations.forEach(op => {
  console.log(`Operation: ${op.type} - ${op.description}`);
});
```

**Parameters**:
- `text`: The text to analyze for operations

**Returns**: Promise resolving to array of operations to perform

## Type Definitions

### ExtractedFact

Represents a fact extracted from conversation or text.

```typescript
interface ExtractedFact {
  id: string;              // Unique identifier
  content: string;         // The fact content
  category: string;        // Fact category (e.g., 'preference', 'knowledge', 'personal')
  confidence: number;      // Confidence score (0.0 to 1.0)
  timestamp: Date;         // When the fact was extracted
  source: string;          // Source of the fact (conversation ID, etc.)
  metadata?: Record<string, any>; // Additional metadata
}
```

### Operation

Represents an operation to be performed based on text analysis.

```typescript
interface Operation {
  type: 'store_fact' | 'retrieve_fact' | 'update_fact' | 'delete_fact' | 'search_fact';
  description: string;     // Human-readable description
  parameters: Record<string, any>; // Operation parameters
  priority: number;        // Priority score (0.0 to 1.0)
  confidence: number;      // Confidence in the operation (0.0 to 1.0)
}
```

### MemoryConfig

Configuration for memory operations.

```typescript
interface MemoryConfig {
  enableFactExtraction: boolean;    // Whether to extract facts automatically
  enableMemoryIntegration: boolean; // Whether to integrate memory in responses
  factExtractionThreshold: number;  // Minimum confidence for fact extraction
  maxFactsPerResponse: number;      // Maximum facts to extract per response
  memoryContextLength: number;      // How much memory context to include
}
```

## Usage Examples

### Basic Memory Integration

```typescript
import { MemoryRunner } from '../src/memory/memory_runner.js';
import { Interaction } from '../src/interaction/interaction.js';
import { Stimulus } from '../src/interaction/stimulus.js';

const memoryRunner = new MemoryRunner();

// First interaction - establish preferences
const interaction1 = new Interaction(model, "You are a helpful assistant.");
interaction1.addStimulus(new Stimulus("I prefer detailed explanations with examples."));

const response1 = await memoryRunner.execute(interaction1);
console.log('Response with memory:', response1.content);

// Second interaction - memory should influence response
const interaction2 = new Interaction(model, "You are a helpful assistant.");
interaction2.addStimulus(new Stimulus("Explain quantum computing."));

const response2 = await memoryRunner.execute(interaction2);
// Response should be detailed with examples based on previous preference
console.log('Response with memory context:', response2.content);
```

### Fact Extraction

```typescript
import { FactExtractor } from '../src/memory/extract_facts.js';

const extractor = new FactExtractor();

const text = `
The user's name is Sarah Johnson. She is a 28-year-old software engineer 
working at TechCorp. She specializes in React and TypeScript development. 
Sarah prefers detailed technical explanations and enjoys learning about 
new programming paradigms. She lives in Seattle and has a dog named Max.
`;

const facts = await extractor.extract(text);

console.log('Extracted facts:');
facts.forEach(fact => {
  console.log(`[${fact.category}] ${fact.content} (confidence: ${fact.confidence})`);
});
```

### Memory Store Operations

```typescript
import { MemoryStore } from '../src/memory/memory_store.js';
import { ExtractedFact } from '../src/memory/types.js';

const memoryStore = new MemoryStore();

// Add facts
const facts: ExtractedFact[] = [
  {
    id: 'fact-001',
    content: 'User prefers detailed explanations',
    category: 'preference',
    confidence: 0.9,
    timestamp: new Date(),
    source: 'conversation-1'
  },
  {
    id: 'fact-002',
    content: 'User is a software engineer',
    category: 'personal',
    confidence: 0.8,
    timestamp: new Date(),
    source: 'conversation-1'
  },
  {
    id: 'fact-003',
    content: 'User specializes in React development',
    category: 'knowledge',
    confidence: 0.7,
    timestamp: new Date(),
    source: 'conversation-1'
  }
];

for (const fact of facts) {
  await memoryStore.addFact(fact);
}

// Retrieve facts by category
const preferences = await memoryStore.getFacts('preference');
console.log('User preferences:', preferences.map(f => f.content));

// Search facts
const relevantFacts = await memoryStore.searchFacts('software development');
console.log('Relevant facts:', relevantFacts.map(f => f.content));
```

### Operation Determination

```typescript
import { OperationDeterminer } from '../src/memory/determine_operations.js';

const determiner = new OperationDeterminer();

const texts = [
  "Remember that I prefer detailed explanations",
  "What did I tell you about my preferences?",
  "Forget what I said about my job",
  "Search for information about React development"
];

for (const text of texts) {
  const operations = await determiner.determine(text);
  
  console.log(`\nText: "${text}"`);
  operations.forEach(op => {
    console.log(`  Operation: ${op.type} - ${op.description} (priority: ${op.priority})`);
  });
}
```

### Advanced Memory Integration

```typescript
import { MemoryRunner } from '../src/memory/memory_runner.js';
import { MemoryStore } from '../src/memory/memory_store.js';
import { Interaction } from '../src/interaction/interaction.js';

class AdvancedMemorySystem {
  private memoryRunner: MemoryRunner;
  private memoryStore: MemoryStore;

  constructor() {
    this.memoryRunner = new MemoryRunner();
    this.memoryStore = new MemoryStore();
  }

  async processInteraction(interaction: Interaction) {
    // Execute with memory
    const response = await this.memoryRunner.execute(interaction);
    
    // Extract facts from response
    const facts = await this.memoryRunner.extractFacts(response.content);
    
    // Store relevant facts
    for (const fact of facts) {
      if (fact.confidence > 0.7) {
        await this.memoryStore.addFact(fact);
      }
    }
    
    return response;
  }

  async getRelevantContext(query: string) {
    const relevantFacts = await this.memoryStore.searchFacts(query);
    return relevantFacts.map(f => f.content).join('; ');
  }
}

// Usage
const memorySystem = new AdvancedMemorySystem();

const interaction = new Interaction(model, "You are a helpful assistant.");
interaction.addStimulus(new Stimulus("I'm working on a React project and need help with state management."));

const response = await memorySystem.processInteraction(interaction);

// Later, get relevant context
const context = await memorySystem.getRelevantContext('React state management');
console.log('Relevant context:', context);
```

### Memory Configuration

```typescript
import { MemoryRunner } from '../src/memory/memory_runner.js';

// Configure memory behavior
const memoryRunner = new MemoryRunner({
  enableFactExtraction: true,
  enableMemoryIntegration: true,
  factExtractionThreshold: 0.8,
  maxFactsPerResponse: 5,
  memoryContextLength: 1000
});

const interaction = new Interaction(model, "You are a helpful assistant.");
interaction.addStimulus(new Stimulus("Remember my preferences and explain TypeScript generics."));

const response = await memoryRunner.execute(interaction);
```

## Best Practices

### 1. Fact Quality Management

Ensure high-quality fact extraction:

```typescript
async function extractHighQualityFacts(text: string, threshold: number = 0.8) {
  const extractor = new FactExtractor();
  const facts = await extractor.extract(text);
  
  // Filter by confidence
  const highQualityFacts = facts.filter(fact => fact.confidence >= threshold);
  
  // Validate fact content
  const validFacts = highQualityFacts.filter(fact => 
    fact.content.length > 10 && 
    fact.content.length < 500 &&
    !fact.content.includes('I don\'t know') &&
    !fact.content.includes('I cannot')
  );
  
  return validFacts;
}
```

### 2. Memory Context Management

Manage memory context size to avoid token limits:

```typescript
async function getOptimizedMemoryContext(query: string, maxTokens: number = 500) {
  const memoryStore = new MemoryStore();
  const relevantFacts = await memoryStore.searchFacts(query);
  
  // Sort by relevance and recency
  const sortedFacts = relevantFacts.sort((a, b) => {
    const recencyScore = b.timestamp.getTime() - a.timestamp.getTime();
    const relevanceScore = b.confidence - a.confidence;
    return relevanceScore * 0.7 + recencyScore * 0.3;
  });
  
  // Build context within token limit
  let context = '';
  for (const fact of sortedFacts) {
    const factText = `${fact.category}: ${fact.content}. `;
    if ((context + factText).length > maxTokens) break;
    context += factText;
  }
  
  return context;
}
```

### 3. Fact Categorization

Use consistent fact categories for better organization:

```typescript
const FACT_CATEGORIES = {
  PREFERENCE: 'preference',
  PERSONAL: 'personal',
  KNOWLEDGE: 'knowledge',
  SKILL: 'skill',
  CONTEXT: 'context',
  GOAL: 'goal',
  CONSTRAINT: 'constraint'
} as const;

async function categorizeFact(fact: ExtractedFact): Promise<ExtractedFact> {
  const content = fact.content.toLowerCase();
  
  if (content.includes('prefer') || content.includes('like') || content.includes('want')) {
    fact.category = FACT_CATEGORIES.PREFERENCE;
  } else if (content.includes('work') || content.includes('job') || content.includes('company')) {
    fact.category = FACT_CATEGORIES.PERSONAL;
  } else if (content.includes('know') || content.includes('understand') || content.includes('learn')) {
    fact.category = FACT_CATEGORIES.KNOWLEDGE;
  } else if (content.includes('can') || content.includes('able') || content.includes('skill')) {
    fact.category = FACT_CATEGORIES.SKILL;
  }
  
  return fact;
}
```

### 4. Memory Persistence

Implement proper memory persistence:

```typescript
import { writeFileSync, readFileSync, existsSync } from 'fs';

class PersistentMemoryStore extends MemoryStore {
  private filePath: string;

  constructor(filePath: string = './memory.json') {
    super();
    this.filePath = filePath;
    this.loadFromDisk();
  }

  private loadFromDisk() {
    if (existsSync(this.filePath)) {
      try {
        const data = readFileSync(this.filePath, 'utf-8');
        const facts = JSON.parse(data);
        // Restore facts to memory
        facts.forEach(fact => this.addFact(fact));
      } catch (error) {
        console.error('Failed to load memory from disk:', error);
      }
    }
  }

  async addFact(fact: ExtractedFact): Promise<void> {
    await super.addFact(fact);
    this.saveToDisk();
  }

  private saveToDisk() {
    try {
      const facts = this.getFacts();
      writeFileSync(this.filePath, JSON.stringify(facts, null, 2));
    } catch (error) {
      console.error('Failed to save memory to disk:', error);
    }
  }
}
```

### 5. Memory Privacy

Implement privacy controls for sensitive information:

```typescript
class PrivacyAwareMemoryStore extends MemoryStore {
  private sensitivePatterns = [
    /password/i,
    /api.?key/i,
    /token/i,
    /secret/i,
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN pattern
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/ // Credit card pattern
  ];

  async addFact(fact: ExtractedFact): Promise<void> {
    // Check for sensitive information
    if (this.containsSensitiveInfo(fact.content)) {
      console.warn('Skipping fact with potentially sensitive information');
      return;
    }
    
    await super.addFact(fact);
  }

  private containsSensitiveInfo(content: string): boolean {
    return this.sensitivePatterns.some(pattern => pattern.test(content));
  }
}
```

## Integration with Other Packages

### With Cognition Package

```typescript
import { MemoryRunner } from '../src/memory/memory_runner.js';
import { BaseModelRunner } from '../src/cognition/runner.js';

// MemoryRunner extends BaseModelRunner functionality
const memoryRunner = new MemoryRunner();
const baseRunner = new BaseModelRunner();

// MemoryRunner provides additional memory capabilities
const response = await memoryRunner.execute(interaction);
```

### With Interaction Package

```typescript
import { MemoryRunner } from '../src/memory/memory_runner.js';
import { Interaction } from '../src/interaction/interaction.js';

const memoryRunner = new MemoryRunner();

// Memory integrates with interactions
const interaction = new Interaction(model, "You are a helpful assistant with memory.");
interaction.addStimulus(new Stimulus("Remember my preferences and help me with this task."));

const response = await memoryRunner.execute(interaction);
```

### With Evaluation Package

```typescript
import { MemoryRunner } from '../src/memory/memory_runner.js';
import { EvaluationRunner } from '../src/evaluation/runner.js';

// Evaluate memory capabilities
const memoryRunner = new MemoryRunner();
const evaluator = new EvaluationRunner();

const interaction = new Interaction(model, "You are a helpful assistant.");
interaction.addStimulus(new Stimulus("Remember that I prefer detailed explanations."));

// Test memory retention
const evaluation = await evaluator.evaluate(interaction, {
  memoryRunner,
  testMemoryRetention: true
});
```
