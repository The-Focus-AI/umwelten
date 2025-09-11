# Stimulus-Driven Interaction Pattern

The new Stimulus-driven Interaction pattern provides a unified way to work with AI models across different environments using self-contained environmental context. This pattern eliminates the need for specialized interaction classes by using configurable `Stimulus` objects.

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Stimulus      │    │   Interaction   │    │   Environment   │
│                 │    │                 │    │                 │
│ • Role & Context│◄──►│ • Single Class  │◄──►│ • Command Line  │
│ • Tools & Config│    │ • Stimulus-Driven│    │ • Web Browser   │
│ • Instructions  │    │ • Self-Managing │    │ • Autonomous Agent│
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🎯 Stimulus Types

### Chat Stimulus

Pre-configured for conversational AI with memory and common tools.

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';
import { Interaction } from '../src/interaction/interaction.js';

const chatStimulus = new Stimulus({
  role: "helpful AI assistant",
  objective: "be conversational, engaging, and helpful",
  instructions: [
    "Always respond with text content first",
    "Only use tools when you need specific information",
    "Be conversational and engaging"
  ],
  tools: { calculator: calculatorTool, weather: weatherTool },
  runnerType: 'memory',
  maxToolSteps: 5
});

const interaction = new Interaction(model, chatStimulus);

// Features:
// ✅ Conversational system prompt
// ✅ Memory-enabled runner
// ✅ Common chat tools (calculator, weather, etc.)
// ✅ Multi-step tool calling (max 5 steps)
```

### Evaluation Stimulus

Optimized for model evaluation with structured output support.

```typescript
const evaluationStimulus = new Stimulus({
  role: "evaluation system",
  objective: "provide accurate responses for evaluation",
  instructions: [
    "Be precise and factual",
    "Follow evaluation criteria exactly",
    "Provide structured responses when requested"
  ],
  tools: { calculator: calculatorTool },
  runnerType: 'base',  // No memory needed for evaluations
  temperature: 0.1,    // Low temperature for consistency
  maxTokens: 1000
});

const interaction = new Interaction(model, evaluationStimulus);

// Features:
// ✅ Evaluation-focused system prompt
// ✅ Base runner (no memory needed)
// ✅ Evaluation-specific tools
// ✅ Structured output support
```

### Agent Stimulus

Designed for autonomous agents with comprehensive tool sets.

```typescript
const agentStimulus = new Stimulus({
  role: "autonomous agent",
  objective: "analyze data, generate reports, and make recommendations",
  instructions: [
    "Think step by step",
    "Use all available tools effectively",
    "Provide comprehensive analysis",
    "Make actionable recommendations"
  ],
  tools: { 
    calculator: calculatorTool, 
    statistics: statisticsTool,
    fileAnalysis: fileAnalysisTool 
  },
  runnerType: 'memory',  // Memory for learning
  maxToolSteps: 10,      // Extended capabilities
  temperature: 0.7
});

const interaction = new Interaction(model, agentStimulus);

// Features:
// ✅ Agent-focused system prompt
// ✅ Memory-enabled runner for learning
// ✅ Comprehensive tool set
// ✅ Extended multi-step capabilities (max 10 steps)
```

## 🖥️ Interface Types

### CLIInterface

Readline-based command-line interface that works with any Interaction.

```typescript
import { CLIInterface } from '../src/ui/cli/CLIInterface.js';

const cliInterface = new CLIInterface();

// Start interactive chat with any interaction
await cliInterface.startChat(interaction);

// Start agent session with any interaction
await cliInterface.startAgent(interaction);
```

**Special Commands:**
- `/?` - Show help
- `/reset` - Clear conversation history
- `/history` - Show chat history
- `exit` or `quit` - End session

### WebInterface

React-compatible interface with hooks and state management.

```typescript
import { WebInterface } from '../src/ui/cli/CLIInterface.js';

// Direct usage with any interaction
const webInterface = new WebInterface(interaction);
const response = await webInterface.sendMessage("Hello!");

// React component usage
function ChatComponent() {
  const [interaction] = useState(() => {
    const stimulus = new Stimulus({
      role: "helpful assistant",
      objective: "provide helpful responses"
    });
    return new Interaction(model, stimulus);
  });
  
  const handleSendMessage = async (message: string) => {
    interaction.addMessage({ role: 'user', content: message });
    const response = await interaction.streamText();
    console.log('Response:', response.content);
  };
  
  return (
    <div>
      <button onClick={() => handleSendMessage("Hello!")}>
        Send Message
      </button>
    </div>
  );
}
```

## 🔧 Built-in Tools

### Common Tools
- **Calculator** - Mathematical expressions
- **Weather** - Real-time weather data
- **Statistics** - Statistical analysis
- **Random Number** - Generate random numbers
- **File Analysis** - File content and metadata

### Tool Integration

Tools are defined using the Vercel AI SDK `tool` function and added to stimuli:

```typescript
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
  tools: { calculator: calculatorTool },
  toolInstructions: ["Use calculator for arithmetic operations"]
});
```

## 📝 Usage Examples

### CLI Chat with Tools

```bash
# Interactive chat
pnpm cli chat --provider ollama --model llama3.2:latest

# Tools demonstration
pnpm cli tools demo --provider ollama --model llama3.2:latest
```

### Programmatic Usage

```typescript
// Create stimulus for chat
const chatStimulus = new Stimulus({
  role: "helpful assistant",
  objective: "be conversational and helpful",
  tools: { calculator: calculatorTool, weather: weatherTool },
  runnerType: 'memory'
});

const interaction = new Interaction(model, chatStimulus);
interaction.addMessage({ role: 'user', content: "Hello!" });
const response = await interaction.streamText();

// With CLI interface
const cliInterface = new CLIInterface();
await cliInterface.startChat(interaction);

// Evaluation with structured output
const evaluationStimulus = new Stimulus({
  role: "evaluation system",
  objective: "provide accurate evaluations",
  runnerType: 'base',
  temperature: 0.1
});

const evalInteraction = new Interaction(model, evaluationStimulus);
const score = await evalInteraction.streamObject(scoreSchema);
```

### Web Integration

```typescript
// Next.js API route
export async function POST(request: Request) {
  const { message } = await request.json();
  
  const chatInteraction = new ChatInteraction({
    name: "gpt-4",
    provider: "openrouter"
  });
  
  const response = await chatInteraction.chat(message);
  return Response.json({ response });
}

// React component
function ChatPage() {
  const chatInteraction = new ChatInteraction(modelDetails);
  const { sendMessage, messages, isLoading } = useWebInterface(chatInteraction);
  
  return (
    <div>
      {messages.map(msg => (
        <Message key={msg.timestamp} message={msg} />
      ))}
      <MessageInput onSend={sendMessage} disabled={isLoading} />
    </div>
  );
}
```

## 🎯 Benefits

### 1. **Unified API**
Same interaction works across CLI, web, and agent contexts.

### 2. **Pre-configured**
Each interaction type comes with appropriate tools, prompts, and settings.

### 3. **Clean Separation**
Interaction handles AI logic, Interface handles I/O.

### 4. **Easy Extension**
Simple to create new interaction types or interfaces.

### 5. **Type Safety**
Full TypeScript support with clear interfaces.

### 6. **Memory Integration**
Automatic memory management for learning and context.

## 🔄 Migration from Old Pattern

### Before (Old Pattern)
```typescript
const interaction = new Interaction(modelDetails, "You are a helpful assistant.");
const runner = new BaseModelRunner();
const response = await runner.streamText(interaction);
```

### After (New Stimulus-Driven Pattern)
```typescript
const stimulus = new Stimulus({
  role: "helpful assistant",
  objective: "provide helpful responses",
  instructions: ["Be clear and concise", "Provide examples when helpful"]
});

const interaction = new Interaction(modelDetails, stimulus);
interaction.addMessage({ role: 'user', content: "Hello!" });
const response = await interaction.streamText();
```

The new pattern provides better semantic organization and eliminates the need for specialized interaction classes! 🎉
