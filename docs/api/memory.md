# Memory API

The memory module provides conversation fact extraction and persistent knowledge storage. It uses LLM-based analysis to extract structured facts from conversations and manage them over time.

## Overview

- **Fact Extraction**: LLM-powered extraction of structured facts from conversation messages
- **Memory Operations**: Intelligent ADD/UPDATE/NONE decisions for memory management
- **Memory Runner**: A `SmartModelRunner` that automatically extracts and stores facts as hooks
- **Memory Store**: Interface for persisting user facts (with an in-memory implementation)

## Types

### Fact

A single extracted fact with a category type.

```typescript
import { Fact } from '../src/memory/types.js';

// Fact is { type, text }
// type is one of: "preference" | "memory" | "plan" | "activity" | "health" | "professional" | "miscellaneous"
const fact: Fact = {
  type: "preference",
  text: "Prefers detailed explanations with examples"
};
```

### MemoryFact

A `Fact` with an `id` field, used for storage.

```typescript
import { MemoryFact } from '../src/memory/types.js';

const memoryFact: MemoryFact = {
  id: "fact-001",
  type: "professional",
  text: "Works as a software engineer"
};
```

### MemoryOperation

Describes how to update the memory store.

```typescript
import { MemoryOperation } from '../src/memory/types.js';

const operation: MemoryOperation = {
  id: "fact-001",
  fact: { type: "professional", text: "Works as a senior software engineer" },
  event: "UPDATE",              // "ADD" | "UPDATE" | "NONE"
  old_memory: "Works as a software engineer"  // optional, for UPDATE
};
```

## MemoryStore

Interface for persisting user facts. The built-in `InMemoryMemoryStore` keeps facts in a `Map`.

```typescript
import { InMemoryMemoryStore } from '../src/memory/memory_store.js';
import type { MemoryStore } from '../src/memory/memory_store.js';

const store: MemoryStore = new InMemoryMemoryStore();
```

### Methods

```typescript
interface MemoryStore {
  getFacts(userId: string): Promise<MemoryFact[]>;
  addFact(userId: string, fact: MemoryFact): Promise<MemoryFact>;
  updateFact(userId: string, factId: string, fact: MemoryFact): Promise<MemoryFact | undefined>;
  deleteFact(userId: string, factId: string): Promise<boolean>;
  setFacts(userId: string, facts: MemoryFact[]): Promise<void>;
}
```

All methods are keyed by `userId` — each user has their own fact store.

```typescript
const store = new InMemoryMemoryStore();

// Add a fact
await store.addFact("user-1", {
  id: "fact-001",
  type: "preference",
  text: "Prefers concise answers"
});

// Get all facts for a user
const facts = await store.getFacts("user-1");

// Update a fact
await store.updateFact("user-1", "fact-001", {
  id: "fact-001",
  type: "preference",
  text: "Prefers detailed answers with examples"
});

// Delete a fact
await store.deleteFact("user-1", "fact-001");

// Bulk-set all facts
await store.setFacts("user-1", [
  { id: "f1", type: "memory", text: "Name is John" },
  { id: "f2", type: "professional", text: "Software engineer at TechCorp" }
]);
```

## extractFacts()

Extract structured facts from a conversation using an LLM.

```typescript
import { extractFacts } from '../src/memory/extract_facts.js';

const facts = await extractFacts(interaction, modelDetails);
// Returns: { facts: Fact[] }
```

**Parameters**:
- `conversation`: An `Interaction` instance with messages
- `model`: `ModelDetails` for the LLM to use for extraction

The function takes the last user message from the conversation, feeds it through a fact-extraction prompt, and returns categorized facts. It uses `generateObject` with a Zod schema to get structured output.

```typescript
import { Interaction } from '../src/interaction/core/interaction.js';
import { Stimulus } from '../src/stimulus/stimulus.js';
import { extractFacts } from '../src/memory/extract_facts.js';

const stimulus = new Stimulus({ role: "helpful assistant" });
const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);
interaction.addMessage({
  role: "user",
  content: "Hi, my name is Sarah. I'm a data scientist who loves hiking."
});

const result = await extractFacts(interaction, { name: "gemini-3-flash-preview", provider: "google" });
// result.facts might be:
// [
//   { type: "professional", text: "Name is Sarah" },
//   { type: "professional", text: "Is a data scientist" },
//   { type: "activity", text: "Loves hiking" }
// ]
```

## determineOperations()

Given new facts and existing memories, determine what memory operations (ADD, UPDATE, NONE) to perform.

```typescript
import { determineOperations } from '../src/memory/determine_operations.js';

const result = await determineOperations(modelDetails, newFacts, existingMemories);
// Returns: { memory: MemoryOperation[] }
```

**Parameters**:
- `model`: `ModelDetails` for the LLM
- `facts`: `Fact[]` — newly extracted facts
- `existingMemories`: `MemoryFact[]` — current stored memories (optional, defaults to `[]`)

```typescript
import { determineOperations } from '../src/memory/determine_operations.js';

const newFacts = [
  { type: "professional", text: "Name is Sarah Smith" }
];

const existing = [
  { id: "f1", type: "professional", text: "Name is Sarah" }
];

const ops = await determineOperations(
  { name: "gemini-3-flash-preview", provider: "google" },
  newFacts,
  existing
);
// ops.memory might be:
// [{ id: "f1", fact: { type: "professional", text: "Name is Sarah Smith" }, event: "UPDATE", old_memory: "Name is Sarah" }]
```

## MemoryRunner

A `SmartModelRunner` that automatically extracts facts and updates memory after each model call. It uses `duringHooks` (fact extraction) and `afterHooks` (memory update).

```typescript
import { MemoryRunner, createMemoryRunner } from '../src/memory/memory_runner.js';
import { InMemoryMemoryStore } from '../src/memory/memory_store.js';
import { BaseModelRunner } from '../src/cognition/runner.js';

const memoryRunner = createMemoryRunner({
  baseRunner: new BaseModelRunner(),
  llmModel: "gemma3:12b",         // model used for fact extraction (hardcoded to ollama internally)
  memoryStore: new InMemoryMemoryStore()
});

// Use it like any ModelRunner — facts are extracted automatically
const response = await memoryRunner.generateText(interaction);

// Access the memory store
const store = memoryRunner.getMemoryStore();
const facts = await store.getFacts("default");
```

### Automatic Memory via Stimulus

Set `runnerType: 'memory'` on a Stimulus to automatically use a `MemoryRunner`:

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';
import { Interaction } from '../src/interaction/core/interaction.js';

const stimulus = new Stimulus({
  role: "helpful assistant with memory",
  runnerType: 'memory'  // Interaction will create a MemoryRunner automatically
});

const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);

// Facts are extracted automatically after each exchange
const response = await interaction.generateText();
```

## Custom MemoryStore Implementations

Implement the `MemoryStore` interface for persistent storage:

```typescript
import type { MemoryStore } from '../src/memory/memory_store.js';
import type { MemoryFact } from '../src/memory/types.js';
import fs from 'fs/promises';

class FileMemoryStore implements MemoryStore {
  constructor(private filePath: string) {}

  async getFacts(userId: string): Promise<MemoryFact[]> {
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf-8'));
      return data[userId] || [];
    } catch {
      return [];
    }
  }

  async addFact(userId: string, fact: MemoryFact): Promise<MemoryFact> {
    const data = await this.loadAll();
    if (!data[userId]) data[userId] = [];
    data[userId].push(fact);
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    return fact;
  }

  async updateFact(userId: string, factId: string, fact: MemoryFact): Promise<MemoryFact | undefined> {
    const data = await this.loadAll();
    const facts = data[userId] || [];
    const idx = facts.findIndex((f: MemoryFact) => f.id === factId);
    if (idx === -1) return undefined;
    facts[idx] = fact;
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    return fact;
  }

  async deleteFact(userId: string, factId: string): Promise<boolean> {
    const data = await this.loadAll();
    const facts = data[userId] || [];
    const idx = facts.findIndex((f: MemoryFact) => f.id === factId);
    if (idx === -1) return false;
    facts.splice(idx, 1);
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    return true;
  }

  async setFacts(userId: string, facts: MemoryFact[]): Promise<void> {
    const data = await this.loadAll();
    data[userId] = facts;
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
  }

  private async loadAll(): Promise<Record<string, MemoryFact[]>> {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf-8'));
    } catch {
      return {};
    }
  }
}
```
