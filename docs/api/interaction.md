# Interaction API

The Interaction package provides the core framework for managing model-environment interactions. It implements the semantic concept of "interaction" - the dynamic exchange between models and their environment using the new Stimulus-driven architecture.

## Overview

The Interaction package manages the complete lifecycle of model interactions, including:

- **Interaction Management**: Core class for managing model conversations with Stimulus-driven context
- **Stimulus Processing**: Self-contained environmental context with tools, instructions, and model options
- **Message Flow**: Managing the exchange of messages between user and model
- **Attachment Support**: Handling file attachments and multi-modal content

## Core Classes

### Interaction

The primary class for managing model-environment interactions and conversations. Now requires both `modelDetails` and a `Stimulus` object.

```typescript
import { Interaction } from '../src/interaction/interaction.js';
import { Stimulus } from '../src/stimulus/stimulus.js';
import { ModelDetails } from '../src/cognition/types.js';

const model: ModelDetails = {
  name: 'gemini-2.0-flash',
  provider: 'google'
};

const stimulus = new Stimulus({
  role: "helpful assistant",
  objective: "provide accurate and helpful responses",
  instructions: ["Be clear and concise", "Provide examples when helpful"]
});

const interaction = new Interaction(model, stimulus);
```

#### Constructor

```typescript
constructor(modelDetails: ModelDetails, stimulus: Stimulus)
```

**Parameters**:
- `modelDetails`: The model details for this interaction
- `stimulus`: The environmental context and configuration for this interaction

#### Methods

##### `setStimulus(stimulus: Stimulus): void`

Update the stimulus (environmental context) for the interaction.

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';

const newStimulus = new Stimulus({
  role: "math tutor",
  objective: "help with calculations",
  tools: { calculator: calculatorTool }
});
interaction.setStimulus(newStimulus);
```

**Parameters**:
- `stimulus`: The new stimulus to set for the interaction

##### `getStimulus(): Stimulus`

Get the current stimulus for the interaction.

```typescript
const currentStimulus = interaction.getStimulus();
console.log('Current role:', currentStimulus.options.role);
```

**Returns**: The current stimulus object

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

##### `streamText(): Promise<ModelResponse>`

Generate a text response from the model.

```typescript
const response = await interaction.streamText();
console.log('Response:', response.content);
```

**Returns**: Promise resolving to ModelResponse with generated content

##### `streamObject<T>(schema: z.ZodSchema<T>): Promise<ModelResponse>`

Generate structured output with real-time streaming, validated against a Zod schema.

```typescript
import { z } from 'zod';

const TaskSchema = z.object({
  title: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  completed: z.boolean().default(false)
});

const response = await interaction.streamObject(TaskSchema);
const task = JSON.parse(response.content);
```

**Returns**: Promise resolving to ModelResponse with structured content

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

##### `getRunner(): ModelRunner`

Get the underlying model runner for this interaction.

```typescript
const runner = interaction.getRunner();
console.log('Runner type:', runner.constructor.name);
```

**Returns**: The model runner instance

##### `clearContext(): void`

Clear all messages from the interaction (resets conversation history).

```typescript
interaction.clearContext();
console.log('Context cleared');
```

##### `setCheckpoint(): void`

Set a checkpoint at the current message count. Used with `compactContext()` to mark where a "thread" starts.

```typescript
interaction.setCheckpoint();
// Later, compactContext will condense from this point
```

##### `getCheckpoint(): number | undefined`

Get the current checkpoint index (message index after which the "current thread" starts).

```typescript
const checkpoint = interaction.getCheckpoint();
if (checkpoint) {
  console.log(`Checkpoint at message ${checkpoint}`);
}
```

**Returns**: Checkpoint index (1 = first message after system), or undefined if not set

##### `compactContext(strategyId: string, options?: { fromCheckpoint?: boolean; strategyOptions?: Record<string, unknown> }): Promise<{ segmentStart: number; segmentEnd: number; replacementCount: number } | null>`

Compact the conversation context by replacing a segment with a condensed summary. Uses pluggable compaction strategies (e.g., `through-line-and-facts` to summarize to main narrative + key facts).

```typescript
// Set checkpoint before a long conversation
interaction.setCheckpoint();

// ... have conversation ...

// Compact from checkpoint to end of last flow
const result = await interaction.compactContext('through-line-and-facts', {
  fromCheckpoint: true
});

if (result) {
  console.log(`Compacted segment [${result.segmentStart}..${result.segmentEnd}] into ${result.replacementCount} message(s)`);
}
```

**Parameters**:
- `strategyId`: Compaction strategy to use (e.g., `'through-line-and-facts'`, `'truncate'`)
- `options.fromCheckpoint`: If true, start segment at checkpoint (default: true)
- `options.strategyOptions`: Strategy-specific options

**Returns**: Promise resolving to segment bounds and replacement count, or null if no segment or strategy not found

**Available strategies**:
- `through-line-and-facts`: LLM-based; summarizes segment to through-line and key facts, omits in-call details
- `truncate`: Non-LLM; replaces segment with a placeholder message

##### `clone(): Interaction`

Create a deep copy of the interaction.

```typescript
const clonedInteraction = interaction.clone();
// clonedInteraction is independent of the original
```

**Returns**: A new Interaction instance with copied data

### Stimulus

Represents environmental context that triggers cognitive response. The Stimulus class is now a self-contained unit containing all environmental context, tools, instructions, and model options.

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';
import { tool } from 'ai';
import { z } from 'zod';

const calculatorTool = tool({
  description: "Performs basic arithmetic operations",
  inputSchema: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number(),
    b: z.number()
  }),
  execute: async ({ operation, a, b }) => {
    // Tool implementation
  }
});

const stimulus = new Stimulus({
  role: "math tutor",
  objective: "help students with mathematical problems",
  instructions: [
    "Always show your work step by step",
    "Use the calculator tool for complex calculations",
    "Explain mathematical concepts clearly"
  ],
  tools: { calculator: calculatorTool },
  temperature: 0.7,
  maxTokens: 1000,
  runnerType: 'base'
});
```

#### Constructor

```typescript
constructor(options?: StimulusOptions)
```

**Parameters**:
- `options`: Configuration for the stimulus including role, objective, instructions, tools, and model options

#### Methods

##### `getPrompt(): string`

Get the complete system prompt generated from the stimulus configuration.

```typescript
const prompt = stimulus.getPrompt();
console.log('Generated prompt:', prompt);
```

**Returns**: The complete system prompt string

##### `addTool(name: string, tool: Tool): void`

Add a tool to the stimulus.

```typescript
stimulus.addTool('calculator', calculatorTool);
```

**Parameters**:
- `name`: The name of the tool
- `tool`: The tool object from Vercel AI SDK

##### `getTools(): Record<string, Tool>`

Get all tools in the stimulus.

```typescript
const tools = stimulus.getTools();
console.log('Available tools:', Object.keys(tools));
```

**Returns**: Object containing all tools

##### `hasTools(): boolean`

Check if the stimulus has any tools.

```typescript
if (stimulus.hasTools()) {
  console.log('Stimulus has tools available');
}
```

**Returns**: True if stimulus has tools, false otherwise

##### `getModelOptions(): ModelOptions`

Get the model options from the stimulus.

```typescript
const options = stimulus.getModelOptions();
console.log('Model options:', options);
```

**Returns**: Model options object with temperature, maxTokens, etc.

##### `getRunnerType(): 'base' | 'memory'`

Get the runner type for this stimulus.

```typescript
const runnerType = stimulus.getRunnerType();
console.log('Runner type:', runnerType);
```

**Returns**: The runner type ('base' or 'memory')

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
  role?: string;                    // The role of the AI assistant
  objective?: string;               // The objective or goal
  instructions?: string[];          // Array of specific instructions
  reasoning?: string;               // Reasoning approach
  output?: string[];                // Output format requirements
  examples?: string[];              // Example responses
  tools?: Record<string, Tool>;     // Available tools
  toolInstructions?: string[];      // Instructions for tool usage
  maxToolSteps?: number;            // Maximum tool execution steps
  temperature?: number;             // Model temperature (0.0 to 2.0)
  maxTokens?: number;               // Maximum tokens to generate
  topP?: number;                    // Top-p sampling parameter
  frequencyPenalty?: number;        // Frequency penalty
  presencePenalty?: number;         // Presence penalty
  runnerType?: 'base' | 'memory';   // Type of model runner
  systemContext?: string;           // Additional system context
}
```

## Usage Examples

### Basic Interaction

```typescript
import { Interaction } from '../src/interaction/interaction.js';
import { Stimulus } from '../src/stimulus/stimulus.js';
import { ModelDetails } from '../src/cognition/types.js';

const model: ModelDetails = {
  name: 'gemini-2.0-flash',
  provider: 'google'
};

// Create stimulus with role and instructions
const stimulus = new Stimulus({
  role: "helpful coding assistant",
  objective: "provide clear, well-documented code examples",
  instructions: [
    "Always include comments in code",
    "Explain complex concepts step by step",
    "Provide test examples when appropriate"
  ],
  temperature: 0.7,
  maxTokens: 1000
});

// Create interaction with stimulus
const interaction = new Interaction(model, stimulus);

// Add user message
interaction.addMessage({
  role: 'user',
  content: 'Write a function to calculate fibonacci numbers and explain how it works.'
});

// Generate response
const response = await interaction.streamText();
console.log('Response:', response.content);
```

### File Attachments

```typescript
import { Interaction } from '../src/interaction/interaction.js';
import { Stimulus } from '../src/stimulus/stimulus.js';

const model = { name: 'gemini-2.0-flash', provider: 'google' };

// Create stimulus for file analysis
const stimulus = new Stimulus({
  role: "document analyst",
  objective: "analyze files and extract key information",
  instructions: [
    "Provide detailed analysis of attached files",
    "Extract key information and insights",
    "Summarize findings clearly"
  ]
});

const interaction = new Interaction(model, stimulus);

// Add file attachments
await interaction.addAttachmentFromPath('./image.jpg');
await interaction.addAttachmentFromPath('./document.pdf');

// Add user message for analysis
interaction.addMessage({
  role: 'user',
  content: 'Analyze the attached image and document. Extract key information and provide insights.'
});

// Generate analysis
const response = await interaction.streamText();
console.log('Analysis:', response.content);
```

### Stimulus with Tools

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';
import { tool } from 'ai';
import { z } from 'zod';

// Define tools
const calculatorTool = tool({
  description: "Performs basic arithmetic operations",
  inputSchema: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number(),
    b: z.number()
  }),
  execute: async ({ operation, a, b }) => {
    let result: number;
    switch (operation) {
      case "add": result = a + b; break;
      case "subtract": result = a - b; break;
      case "multiply": result = a * b; break;
      case "divide": result = a / b; break;
    }
    return { result, expression: `${a} ${operation} ${b} = ${result}` };
  }
});

// Create stimulus with tools
const mathStimulus = new Stimulus({
  role: "math tutor",
  objective: "help with mathematical problems",
  instructions: [
    "Use the calculator tool for complex calculations",
    "Show your work step by step",
    "Explain mathematical concepts clearly"
  ],
  tools: { calculator: calculatorTool },
  toolInstructions: ["Use calculator for arithmetic operations"],
  maxToolSteps: 5,
  temperature: 0.7,
  maxTokens: 1000
});

const interaction = new Interaction(model, mathStimulus);
interaction.addMessage({
  role: 'user',
  content: 'Calculate 15 + 27 and then multiply the result by 3'
});

const response = await interaction.streamText();
console.log('Math response:', response.content);
```

### Message History Management

```typescript
const stimulus = new Stimulus({
  role: "helpful assistant",
  objective: "provide clear and accurate information"
});

const interaction = new Interaction(model, stimulus);

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

### Dynamic Stimulus Updates

```typescript
// Create initial stimulus
const initialStimulus = new Stimulus({
  role: "helpful assistant",
  objective: "provide general assistance"
});

const interaction = new Interaction(model, initialStimulus);
interaction.addMessage({
  role: 'user',
  content: 'What are qubits?'
});

// Update stimulus for specialized task
const quantumStimulus = new Stimulus({
  role: "quantum physics expert",
  objective: "explain quantum computing concepts",
  instructions: [
    "Use precise scientific terminology",
    "Provide analogies for complex concepts",
    "Include practical applications"
  ],
  temperature: 0.3,
  maxTokens: 1500
});

interaction.setStimulus(quantumStimulus);
interaction.addMessage({
  role: 'user',
  content: 'Now explain quantum entanglement.'
});

const response = await interaction.streamText();
console.log('Quantum explanation:', response.content);
```

### Error Handling

```typescript
try {
  const stimulus = new Stimulus({
    role: "file analyzer",
    objective: "analyze attached files"
  });
  
  const interaction = new Interaction(model, stimulus);
  
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

// Handle model generation errors
try {
  const response = await interaction.streamText();
  if (response.finishReason === 'error') {
    console.error('Model generation failed');
  }
} catch (error) {
  console.error('Generation error:', error.message);
}
```

## Best Practices

### 1. Use Semantic Naming

Follow the semantic architecture by using clear, meaningful names:

```typescript
// Good: Clear semantic meaning
const dataAnalysisStimulus = new Stimulus({
  role: "data analyst",
  objective: "analyze datasets and identify trends",
  instructions: ["Use statistical methods", "Provide visual insights"]
});
const interaction = new Interaction(model, dataAnalysisStimulus);

// Avoid: Generic names
const stimulus = new Stimulus({ role: "assistant" });
const conv = new Interaction(model, stimulus);
```

### 2. Manage Interaction State

Keep interactions focused and manageable:

```typescript
// Good: Clear, focused interaction
const codeReviewStimulus = new Stimulus({
  role: "code reviewer",
  objective: "review TypeScript code for best practices",
  instructions: [
    "Check for TypeScript best practices",
    "Identify potential bugs",
    "Suggest improvements"
  ]
});
const interaction = new Interaction(model, codeReviewStimulus);

// Avoid: Overly complex stimuli with too many instructions
const stimulus = new Stimulus({
  role: "everything",
  instructions: [
    "Do this", "Do that", "Also this", "And that", // ... 20+ instructions
  ]
});
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
const creativeStimulus = new Stimulus({
  role: "creative writer",
  objective: "write engaging creative content",
  temperature: 0.9,
  maxTokens: 200
});

// Analytical tasks
const analyticalStimulus = new Stimulus({
  role: "data analyst",
  objective: "analyze data and provide insights",
  temperature: 0.1,
  maxTokens: 1000
});

// Code generation
const codeStimulus = new Stimulus({
  role: "software engineer",
  objective: "write clean, efficient code",
  temperature: 0.3,
  maxTokens: 500
});
```

### 5. Maintain Conversation Context

Use message history to maintain context across interactions:

```typescript
const stimulus = new Stimulus({
  role: "helpful assistant",
  objective: "provide assistance with development projects"
});

const interaction = new Interaction(model, stimulus);

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
interaction.addMessage({
  role: 'user',
  content: 'How do I implement state management in React?'
});

const response = await interaction.streamText();
console.log('Response:', response.content);
```

### 6. Use Dynamic Stimulus Updates

Use dynamic stimulus updates to experiment with different approaches:

```typescript
const baseStimulus = new Stimulus({
  role: "helpful assistant",
  objective: "explain complex concepts"
});

const interaction = new Interaction(model, baseStimulus);
interaction.addMessage({
  role: 'user',
  content: 'Explain the concept of recursion.'
});

// Update stimulus for simple explanation
const simpleStimulus = new Stimulus({
  role: "helpful assistant",
  objective: "explain concepts simply and clearly",
  instructions: ["Use simple language", "Avoid jargon", "Provide basic examples"]
});

interaction.setStimulus(simpleStimulus);
const simpleResponse = await interaction.streamText();

// Update stimulus for detailed explanation
const detailedStimulus = new Stimulus({
  role: "technical expert",
  objective: "provide detailed technical explanations",
  instructions: ["Use precise terminology", "Include advanced examples", "Explain implementation details"]
});

interaction.setStimulus(detailedStimulus);
const detailedResponse = await interaction.streamText();
```

## Integration with Other Packages

### With Cognition Package

The Interaction class now manages its own model runner internally:

```typescript
import { Interaction } from '../src/interaction/interaction.js';
import { Stimulus } from '../src/stimulus/stimulus.js';

const stimulus = new Stimulus({
  role: "helpful assistant",
  objective: "explain complex concepts clearly"
});

const interaction = new Interaction(model, stimulus);
interaction.addMessage({
  role: 'user',
  content: 'Explain quantum computing.'
});

// The interaction manages its own runner internally
const response = await interaction.streamText();
```

### With Memory Package

Use memory-enabled stimuli for persistent context:

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';

const memoryStimulus = new Stimulus({
  role: "helpful assistant with memory",
  objective: "remember user preferences and context",
  runnerType: 'memory'  // Uses MemoryRunner internally
});

const interaction = new Interaction(model, memoryStimulus);
interaction.addMessage({
  role: 'user',
  content: 'Remember that I prefer detailed explanations.'
});

const response = await interaction.streamText();
```

### With Evaluation Package

Create evaluation-specific stimuli:

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';

const evaluationStimulus = new Stimulus({
  role: "evaluation system",
  objective: "provide accurate responses for evaluation",
  instructions: [
    "Be precise and factual",
    "Follow evaluation criteria exactly",
    "Provide structured responses when requested"
  ],
  runnerType: 'base'  // Evaluations typically don't need memory
});

const interaction = new Interaction(model, evaluationStimulus);
interaction.addMessage({
  role: 'user',
  content: 'Answer this question accurately.'
});

const response = await interaction.streamText();
```
