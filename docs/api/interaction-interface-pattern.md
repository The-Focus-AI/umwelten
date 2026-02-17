# Stimulus-Driven Interaction Pattern

The core pattern in umwelten: a **Stimulus** defines what the AI should do, an **Interaction** manages the conversation, and a **UI** (CLI, Telegram, TUI, web) handles input/output.

## Architecture

```
Stimulus              Interaction              UI
(config)              (conversation)           (I/O)
 role, objective  -->  messages, runner  -->    CLI / Telegram / TUI / Web
 tools, options       model, stimulus
 instructions         generateText / chat
```

## Stimulus

A `Stimulus` is a configuration object — it defines the personality, tools, and model options but doesn't run anything.

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';

const stimulus = new Stimulus({
  role: "helpful AI assistant",
  objective: "be conversational and helpful",
  instructions: [
    "Always respond with text content first",
    "Only use tools when you need specific information"
  ],
  tools: { calculator: calculatorTool },
  runnerType: 'base',       // 'base' (default) or 'memory' (auto fact extraction)
  temperature: 0.7,
  maxTokens: 2048,
  maxToolSteps: 5
});
```

### StimulusOptions

```typescript
interface StimulusOptions {
  id?: string;
  name?: string;
  description?: string;
  role?: string;                    // System role
  objective?: string;               // What the AI should accomplish
  instructions?: string[];          // Specific behavioral instructions
  reasoning?: string;               // Reasoning style guidance
  output?: string[];                // Output format instructions
  examples?: (string | { input: string; output: string })[];

  // Tools
  tools?: Record<string, Tool>;     // Vercel AI SDK tools
  toolInstructions?: string[];      // Tool usage guidance
  maxToolSteps?: number;            // Max tool call rounds

  // Model options
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;

  // Runner
  runnerType?: 'base' | 'memory';   // 'memory' enables automatic fact extraction

  // Context
  systemContext?: string;            // Additional system context

  // Skills
  skills?: SkillDefinition[];       // Direct skill definitions
  skillsDirs?: string[];            // Load skills from directories
  skillsFromGit?: string[];         // Load skills from git repos
  skillsCacheRoot?: string;         // Root dir for cloning skill repos
}
```

## Interaction

The `Interaction` class holds the conversation state: messages, model, stimulus, and runner. Create one per conversation.

```typescript
import { Interaction } from '../src/interaction/core/interaction.js';

const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);
```

### Core Methods

```typescript
// Add a message and get a response
const response = await interaction.chat("What's the weather like?");
console.log(response.content);                    // The text response
console.log(response.metadata.tokenUsage);         // { promptTokens, completionTokens, total }
console.log(response.metadata.cost?.totalCost);    // Cost in dollars

// Lower-level methods
const response = await interaction.generateText();  // Generate without adding a user message
const response = await interaction.streamText();     // Stream (returns full ModelResponse when done)
const response = await interaction.generateObject(zodSchema);  // Structured output
const response = await interaction.streamObject(zodSchema);    // Stream structured output

// Message management
interaction.addMessage({ role: "user", content: "Hello" });
interaction.getMessages();                          // CoreMessage[]

// Attachments
await interaction.addAttachmentFromPath("/path/to/file.pdf");

// Context management
await interaction.compactContext();                 // Compact long conversations

// Output format
interaction.setOutputFormat(zodSchema);
interaction.setMaxSteps(10);
```

### ModelResponse

Every generation method returns:

```typescript
interface ModelResponse {
  content: string;                    // The text response
  metadata: {
    startTime: Date;
    endTime: Date;
    tokenUsage: {
      promptTokens: number;
      completionTokens: number;
      total?: number;
    };
    provider: string;
    model: string;
    cost: {
      promptCost: number;
      completionCost: number;
      totalCost: number;
      usage: TokenUsage;
    };
  };
  reasoning?: string;                 // Chain-of-thought (if supported)
  reasoningDetails?: Array<{
    type: 'text' | 'redacted';
    text?: string;
    data?: string;
    signature?: string;
  }>;
}
```

## Common Patterns

### Chat Assistant

```typescript
const stimulus = new Stimulus({
  role: "helpful AI assistant",
  objective: "be conversational, engaging, and helpful",
  instructions: ["Be concise", "Use tools when needed"],
  tools: { calculator: calculatorTool },
  runnerType: 'memory',    // Remember facts across messages
  maxToolSteps: 5
});

const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);

const r1 = await interaction.chat("Hi, I'm Sarah. I'm a data scientist.");
const r2 = await interaction.chat("What do you remember about me?");
// Memory runner will have extracted facts from the first message
```

### Evaluation

```typescript
const stimulus = new Stimulus({
  role: "evaluation system",
  objective: "provide precise, structured responses",
  runnerType: 'base',
  temperature: 0.1,
  maxTokens: 1000
});

const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);

interaction.addMessage({ role: "user", content: "Analyze this code..." });
const response = await interaction.generateObject(analysisSchema);
```

### Autonomous Agent

```typescript
const stimulus = new Stimulus({
  role: "autonomous research agent",
  objective: "analyze data and generate comprehensive reports",
  instructions: [
    "Think step by step",
    "Use all available tools effectively",
    "Provide actionable recommendations"
  ],
  tools: {
    wget: wgetTool,
    markify: markifyTool,
    calculator: calculatorTool
  },
  runnerType: 'memory',
  maxToolSteps: 10,
  temperature: 0.7
});

const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);

const response = await interaction.chat("Research the latest trends in AI safety");
```

## Using with Habitat

For managed agent environments, use `Habitat` instead of creating interactions directly:

```typescript
import { Habitat } from '../src/habitat/index.js';

const habitat = await Habitat.create({ workDir: './my-agent' });
const interaction = await habitat.createInteraction(sessionId);
const response = await interaction.chat("Hello!");
```

Habitat automatically registers tools (file operations, search, agent management, etc.) and loads stimulus configuration from the work directory.

## Defining Tools

Tools use the Vercel AI SDK `tool()` function:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const calculatorTool = tool({
  description: "Performs basic arithmetic operations",
  parameters: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number(),
    b: z.number()
  }),
  execute: async ({ operation, a, b }) => {
    switch (operation) {
      case 'add': return { result: a + b };
      case 'subtract': return { result: a - b };
      case 'multiply': return { result: a * b };
      case 'divide': return { result: a / b };
    }
  }
});

// Pass tools via Stimulus
const stimulus = new Stimulus({
  role: "math tutor",
  tools: { calculator: calculatorTool },
  toolInstructions: ["Use the calculator for arithmetic"]
});
```

## UI Integration

The `Interaction` is UI-agnostic. Different UIs consume it:

- **CLI**: `src/ui/cli/CLIInterface.ts` — readline-based REPL
- **Telegram**: `src/ui/telegram/TelegramAdapter.ts` — Telegram bot
- **TUI**: `src/ui/tui/` — React Ink terminal UI
- **Web**: `src/ui/WebInterface.ts` — web interface

The CLI habitat command provides the standard entry point:

```bash
# Start habitat REPL
dotenvx run -- pnpm run cli -- habitat

# Start habitat as Telegram bot
dotenvx run -- pnpm run cli -- habitat telegram
```
