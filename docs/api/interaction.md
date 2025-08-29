# Interaction API

The Interaction package provides the core framework for managing model-environment interactions. It implements the semantic concept of "interaction" - the dynamic exchange between models and their environment.

## Overview

The Interaction package manages the complete lifecycle of model interactions, including:

- **Interaction Management**: Core class for managing model conversations
- **Stimulus Processing**: Handling environmental inputs that trigger cognitive responses
- **Message Flow**: Managing the exchange of messages between user and model
- **Attachment Support**: Handling file attachments and multi-modal content

## Core Classes

### Interaction

The primary class for managing model-environment interactions and conversations.

```typescript
import { Interaction } from '../src/interaction/interaction.js';
import { ModelDetails } from '../src/cognition/types.js';

const model: ModelDetails = {
  name: 'gemini-2.0-flash',
  provider: 'google'
};

const interaction = new Interaction(model, "You are a helpful assistant.");
```

#### Constructor

```typescript
constructor(model: ModelDetails, systemPrompt?: string)
```

**Parameters**:
- `model`: The model details for this interaction
- `systemPrompt`: Optional system prompt to set the model's behavior

#### Methods

##### `addStimulus(stimulus: Stimulus): void`

Add a stimulus (environmental input) to the interaction.

```typescript
import { Stimulus } from '../src/interaction/stimulus.js';

const stimulus = new Stimulus("What is the capital of France?");
interaction.addStimulus(stimulus);
```

**Parameters**:
- `stimulus`: The stimulus to add to the interaction

##### `addMessage(message: Message): void`

Add a message to the interaction history.

```typescript
interaction.addMessage({
  role: 'user',
  content: 'Hello, how are you?'
});

interaction.addMessage({
  role: 'assistant',
  content: 'I am doing well, thank you for asking!'
});
```

**Parameters**:
- `message`: The message to add with role and content

##### `addAttachmentFromPath(filePath: string): Promise<void>`

Add a file attachment to the interaction from a file path.

```typescript
await interaction.addAttachmentFromPath('./image.jpg');
await interaction.addAttachmentFromPath('./document.pdf');
```

**Parameters**:
- `filePath`: Path to the file to attach

**Throws**: Error if file cannot be read or is not supported

##### `addAttachmentFromBuffer(buffer: Buffer, mimeType: string, filename?: string): void`

Add a file attachment to the interaction from a buffer.

```typescript
import { readFileSync } from 'fs';

const imageBuffer = readFileSync('./image.jpg');
interaction.addAttachmentFromBuffer(imageBuffer, 'image/jpeg', 'image.jpg');
```

**Parameters**:
- `buffer`: The file content as a buffer
- `mimeType`: The MIME type of the file
- `filename`: Optional filename for the attachment

##### `getStimuli(): Stimulus[]`

Get all stimuli in the interaction.

```typescript
const stimuli = interaction.getStimuli();
console.log(`Interaction has ${stimuli.length} stimuli`);
```

**Returns**: Array of all stimuli in the interaction

##### `getMessages(): Message[]`

Get all messages in the interaction history.

```typescript
const messages = interaction.getMessages();
messages.forEach(msg => {
  console.log(`${msg.role}: ${msg.content}`);
});
```

**Returns**: Array of all messages in the interaction

##### `getAttachments(): Attachment[]`

Get all file attachments in the interaction.

```typescript
const attachments = interaction.getAttachments();
attachments.forEach(attachment => {
  console.log(`Attachment: ${attachment.filename} (${attachment.mimeType})`);
});
```

**Returns**: Array of all attachments in the interaction

##### `getSystemPrompt(): string | undefined`

Get the system prompt for this interaction.

```typescript
const systemPrompt = interaction.getSystemPrompt();
console.log('System prompt:', systemPrompt);
```

**Returns**: The system prompt or undefined if not set

##### `setSystemPrompt(prompt: string): void`

Set or update the system prompt for this interaction.

```typescript
interaction.setSystemPrompt("You are a helpful coding assistant. Always provide clear, well-documented code examples.");
```

**Parameters**:
- `prompt`: The new system prompt

##### `clear(): void`

Clear all stimuli, messages, and attachments from the interaction.

```typescript
interaction.clear();
console.log('Interaction cleared');
```

##### `clone(): Interaction`

Create a deep copy of the interaction.

```typescript
const clonedInteraction = interaction.clone();
// clonedInteraction is independent of the original
```

**Returns**: A new Interaction instance with copied data

### Stimulus

Represents environmental input that triggers cognitive response.

```typescript
import { Stimulus } from '../src/interaction/stimulus.js';

const stimulus = new Stimulus("Analyze this text and extract key insights.");
```

#### Constructor

```typescript
constructor(content: string, options?: StimulusOptions)
```

**Parameters**:
- `content`: The stimulus content (text, prompt, etc.)
- `options`: Optional configuration for the stimulus

#### Methods

##### `getContent(): string`

Get the stimulus content.

```typescript
const content = stimulus.getContent();
console.log('Stimulus content:', content);
```

**Returns**: The stimulus content string

##### `getOptions(): StimulusOptions`

Get the stimulus options.

```typescript
const options = stimulus.getOptions();
console.log('Stimulus options:', options);
```

**Returns**: The stimulus options object

##### `withOptions(options: Partial<StimulusOptions>): Stimulus`

Create a new stimulus with updated options.

```typescript
const newStimulus = stimulus.withOptions({
  temperature: 0.7,
  maxTokens: 1000
});
```

**Parameters**:
- `options`: Partial options to merge with existing options

**Returns**: New Stimulus instance with updated options

## Type Definitions

### Message

Represents a message in the interaction history.

```typescript
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
}
```

### Attachment

Represents a file attachment in the interaction.

```typescript
interface Attachment {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  size: number;
}
```

### StimulusOptions

Configuration options for stimuli.

```typescript
interface StimulusOptions {
  temperature?: number;      // Model temperature (0.0 to 2.0)
  maxTokens?: number;        // Maximum tokens to generate
  topP?: number;            // Top-p sampling parameter
  frequencyPenalty?: number; // Frequency penalty
  presencePenalty?: number;  // Presence penalty
  stopSequences?: string[];  // Stop sequences
}
```

## Usage Examples

### Basic Interaction

```typescript
import { Interaction } from '../src/interaction/interaction.js';
import { Stimulus } from '../src/interaction/stimulus.js';
import { ModelDetails } from '../src/cognition/types.js';

const model: ModelDetails = {
  name: 'gemini-2.0-flash',
  provider: 'google'
};

// Create interaction with system prompt
const interaction = new Interaction(model, "You are a helpful coding assistant.");

// Add stimuli
interaction.addStimulus(new Stimulus("Write a function to calculate fibonacci numbers."));
interaction.addStimulus(new Stimulus("Explain how the function works."));

// Add user message
interaction.addMessage({
  role: 'user',
  content: 'Can you also show me how to test this function?'
});

console.log(`Interaction has ${interaction.getStimuli().length} stimuli`);
console.log(`Interaction has ${interaction.getMessages().length} messages`);
```

### File Attachments

```typescript
import { Interaction } from '../src/interaction/interaction.js';
import { Stimulus } from '../src/interaction/stimulus.js';

const model = { name: 'gemini-2.0-flash', provider: 'google' };
const interaction = new Interaction(model, "Analyze the attached files.");

// Add file attachments
await interaction.addAttachmentFromPath('./image.jpg');
await interaction.addAttachmentFromPath('./document.pdf');

// Add stimulus for analysis
interaction.addStimulus(new Stimulus("Analyze the attached image and document. Extract key information and provide insights."));

const attachments = interaction.getAttachments();
console.log(`Interaction has ${attachments.length} attachments`);
```

### Stimulus with Options

```typescript
import { Stimulus } from '../src/interaction/stimulus.js';

// Create stimulus with specific options
const creativeStimulus = new Stimulus("Write a creative story about a robot learning to paint.", {
  temperature: 0.9,
  maxTokens: 500,
  topP: 0.9
});

// Create stimulus with different options
const analyticalStimulus = new Stimulus("Analyze the following data and provide insights.", {
  temperature: 0.1,
  maxTokens: 1000,
  topP: 0.5
});

const interaction = new Interaction(model, "You are a versatile AI assistant.");
interaction.addStimulus(creativeStimulus);
interaction.addStimulus(analyticalStimulus);
```

### Message History Management

```typescript
const interaction = new Interaction(model, "You are a helpful assistant.");

// Add conversation history
interaction.addMessage({
  role: 'user',
  content: 'What is machine learning?'
});

interaction.addMessage({
  role: 'assistant',
  content: 'Machine learning is a subset of artificial intelligence that enables computers to learn and improve from experience without being explicitly programmed.'
});

interaction.addMessage({
  role: 'user',
  content: 'Can you give me an example?'
});

// Get conversation history
const messages = interaction.getMessages();
messages.forEach((message, index) => {
  console.log(`${index + 1}. ${message.role}: ${message.content}`);
});
```

### Interaction Cloning

```typescript
const originalInteraction = new Interaction(model, "You are a helpful assistant.");
originalInteraction.addStimulus(new Stimulus("Explain quantum computing."));
originalInteraction.addMessage({
  role: 'user',
  content: 'What are qubits?'
});

// Clone the interaction
const clonedInteraction = originalInteraction.clone();

// Modify the clone
clonedInteraction.addStimulus(new Stimulus("Now explain quantum entanglement."));

// Original remains unchanged
console.log(`Original stimuli: ${originalInteraction.getStimuli().length}`);
console.log(`Cloned stimuli: ${clonedInteraction.getStimuli().length}`);
```

### Error Handling

```typescript
try {
  const interaction = new Interaction(model, "Analyze the attached file.");
  
  // Try to add a non-existent file
  await interaction.addAttachmentFromPath('./nonexistent.jpg');
} catch (error) {
  console.error('Failed to add attachment:', error.message);
}

try {
  // Try to add an unsupported file type
  await interaction.addAttachmentFromPath('./unsupported.xyz');
} catch (error) {
  console.error('Unsupported file type:', error.message);
}
```

## Best Practices

### 1. Use Semantic Naming

Follow the semantic architecture by using clear, meaningful names:

```typescript
// Good: Clear semantic meaning
const interaction = new Interaction(model, "You are a data analyst.");
const stimulus = new Stimulus("Analyze this dataset and identify trends.");

// Avoid: Generic names
const conv = new Interaction(model);
const prompt = new Stimulus("do stuff");
```

### 2. Manage Interaction State

Keep interactions focused and manageable:

```typescript
// Good: Clear, focused interaction
const interaction = new Interaction(model, "You are a code reviewer.");
interaction.addStimulus(new Stimulus("Review this TypeScript code for best practices."));

// Avoid: Overly complex interactions with too many stimuli
const interaction = new Interaction(model, "You are everything.");
// ... adding 20+ stimuli
```

### 3. Handle File Attachments Properly

Always validate file attachments and handle errors:

```typescript
async function addFileSafely(interaction: Interaction, filePath: string) {
  try {
    await interaction.addAttachmentFromPath(filePath);
    console.log(`Successfully added: ${filePath}`);
  } catch (error) {
    console.error(`Failed to add ${filePath}:`, error.message);
    // Handle gracefully - maybe skip or use alternative
  }
}
```

### 4. Use Appropriate Stimulus Options

Configure stimulus options based on the task:

```typescript
// Creative tasks
const creativeStimulus = new Stimulus("Write a poem about AI.", {
  temperature: 0.9,
  maxTokens: 200
});

// Analytical tasks
const analyticalStimulus = new Stimulus("Analyze this data.", {
  temperature: 0.1,
  maxTokens: 1000
});

// Code generation
const codeStimulus = new Stimulus("Write a function to sort an array.", {
  temperature: 0.3,
  maxTokens: 500
});
```

### 5. Maintain Conversation Context

Use message history to maintain context across interactions:

```typescript
const interaction = new Interaction(model, "You are a helpful assistant.");

// Add context
interaction.addMessage({
  role: 'user',
  content: 'I am working on a React project.'
});

interaction.addMessage({
  role: 'assistant',
  content: 'Great! React is a popular JavaScript library for building user interfaces. How can I help you with your project?'
});

// Continue with context
interaction.addStimulus(new Stimulus("How do I implement state management in React?"));
```

### 6. Clone for Experimentation

Use cloning to experiment with different approaches:

```typescript
const baseInteraction = new Interaction(model, "You are a helpful assistant.");
baseInteraction.addStimulus(new Stimulus("Explain the concept of recursion."));

// Clone for different approaches
const simpleInteraction = baseInteraction.clone();
simpleInteraction.setSystemPrompt("You are a helpful assistant. Explain concepts simply.");

const detailedInteraction = baseInteraction.clone();
detailedInteraction.setSystemPrompt("You are a helpful assistant. Provide detailed explanations with examples.");
```

## Integration with Other Packages

### With Cognition Package

```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Interaction } from '../src/interaction/interaction.js';

const interaction = new Interaction(model, "You are a helpful assistant.");
interaction.addStimulus(new Stimulus("Explain quantum computing."));

const runner = new BaseModelRunner();
const response = await runner.generateText(interaction);
```

### With Memory Package

```typescript
import { MemoryRunner } from '../src/memory/memory_runner.js';
import { Interaction } from '../src/interaction/interaction.js';

const interaction = new Interaction(model, "You are a helpful assistant with memory.");
interaction.addStimulus(new Stimulus("Remember that I prefer detailed explanations."));

const memoryRunner = new MemoryRunner();
const response = await memoryRunner.execute(interaction);
```

### With Evaluation Package

```typescript
import { EvaluationRunner } from '../src/evaluation/runner.js';
import { Interaction } from '../src/interaction/interaction.js';

const interaction = new Interaction(model, "You are a helpful assistant.");
interaction.addStimulus(new Stimulus("Answer this question accurately."));

const evaluator = new EvaluationRunner();
const evaluation = await evaluator.evaluate(interaction);
```
