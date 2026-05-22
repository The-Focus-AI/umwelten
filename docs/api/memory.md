# Memory API

The memory module currently provides conversation fact-extraction helpers. It does **not** provide an automatic chat memory runner or built-in fact store.

## Overview

- **Fact Extraction**: LLM-powered extraction of structured facts from conversation messages
- **Memory Operations**: LLM-assisted ADD/UPDATE/NONE decisions for an external memory store

Call these helpers explicitly from application/reflection workflows. Public `Interaction` construction always uses the base model runner.

## Types

### Fact

```typescript
import type { Fact } from './core/memory/types.js';

const fact: Fact = {
  type: "preference",
  text: "Prefers detailed explanations with examples"
};
```

### MemoryFact

```typescript
import type { MemoryFact } from './core/memory/types.js';

const memoryFact: MemoryFact = {
  id: "fact-001",
  type: "professional",
  text: "Works as a software engineer"
};
```

### MemoryOperation

```typescript
import type { MemoryOperation } from './core/memory/types.js';

const operation: MemoryOperation = {
  id: "fact-001",
  fact: { type: "professional", text: "Works as a senior software engineer" },
  event: "UPDATE",
  old_memory: "Works as a software engineer"
};
```

## extractFacts()

Extract structured facts from a conversation using an LLM.

```typescript
import { extractFacts } from './core/memory/extract_facts.js';

const facts = await extractFacts(interaction, modelDetails);
```

## determineOperations()

Given new facts and existing memories, determine what memory operations (ADD, UPDATE, NONE) to perform.

```typescript
import { determineOperations } from './core/memory/determine_operations.js';

const result = await determineOperations(modelDetails, newFacts, existingMemories);
```
