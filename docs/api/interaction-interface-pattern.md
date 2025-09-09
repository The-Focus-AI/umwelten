# Interaction + Interface Pattern

The new Interaction + Interface pattern provides a unified way to work with AI models across different environments (CLI, web, agents) with pre-configured interactions and clean separation of concerns.

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Interaction   │    │    Interface    │    │   Environment   │
│                 │    │                 │    │                 │
│ • ChatInteraction│◄──►│ • CLIInterface  │◄──►│ • Command Line  │
│ • EvaluationInteraction│ │ • WebInterface │ │ • Web Browser   │
│ • AgentInteraction│    │ • AgentInterface│    │ • Autonomous Agent│
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🎯 Interaction Types

### ChatInteraction

Pre-configured for conversational AI with memory and common tools.

```typescript
import { ChatInteraction } from 'umwelten';

const chatInteraction = new ChatInteraction({
  name: "llama3.2:latest",
  provider: "ollama"
});

// Features:
// ✅ Conversational system prompt
// ✅ Memory-enabled runner
// ✅ Common chat tools (calculator, weather, etc.)
// ✅ Multi-step tool calling (max 5 steps)
```

### EvaluationInteraction

Optimized for model evaluation with structured output support.

```typescript
import { EvaluationInteraction } from 'umwelten';

const evalInteraction = new EvaluationInteraction(
  { name: "gpt-4", provider: "openrouter" },
  "Analyze this code and provide a score from 1-10"
);

// Features:
// ✅ Evaluation-focused system prompt
// ✅ Base runner (no memory needed)
// ✅ Evaluation-specific tools
// ✅ Structured output support
```

### AgentInteraction

Designed for autonomous agents with comprehensive tool sets.

```typescript
import { AgentInteraction } from 'umwelten';

const agentInteraction = new AgentInteraction(
  { name: "claude-3-sonnet", provider: "openrouter" },
  "Data Analysis Agent",
  ["Analyze data", "Generate reports", "Make recommendations"]
);

// Features:
// ✅ Agent-focused system prompt
// ✅ Memory-enabled runner for learning
// ✅ Comprehensive tool set
// ✅ Extended multi-step capabilities (max 10 steps)
```

## 🖥️ Interface Types

### CLIInterface

Readline-based command-line interface with special commands.

```typescript
import { CLIInterface } from 'umwelten';

const cliInterface = new CLIInterface();

// Start interactive chat
await cliInterface.startChat(chatInteraction);

// Start agent session
await cliInterface.startAgent(agentInteraction);

// Start evaluation
await cliInterface.startEvaluation(evalInteraction);
```

**Special Commands:**
- `/?` - Show help
- `/reset` - Clear conversation history
- `/history` - Show chat history
- `exit` or `quit` - End session

### WebInterface

React-compatible interface with hooks and state management.

```typescript
import { WebInterface, useWebInterface } from 'umwelten';

// Direct usage
const webInterface = new WebInterface(chatInteraction);
const response = await webInterface.sendMessage("Hello!");

// React hook usage
function ChatComponent() {
  const { sendMessage, messages, isLoading } = useWebInterface(chatInteraction);
  
  return (
    <div>
      {messages.map(msg => (
        <div key={msg.timestamp}>{msg.role}: {msg.content}</div>
      ))}
      <button onClick={() => sendMessage("Hello!")}>
        Send Message
      </button>
    </div>
  );
}
```

### AgentInterface

Event-driven interface for autonomous agents.

```typescript
import { AgentInterface } from 'umwelten';

const agentInterface = new AgentInterface(
  { name: "claude-3-sonnet", provider: "openrouter" },
  "File Watcher Agent",
  ["Monitor files", "Analyze changes", "Send notifications"]
);

// Start with triggers
await agentInterface.startAgent({
  'file-change': async (filePath) => {
    await agentInterface.executeTask(`Analyze changes in ${filePath}`);
  },
  'schedule': async (time) => {
    await agentInterface.executeTask(`Generate daily report at ${time}`);
  }
});

// Event handling
agentInterface.on('task-completed', (data) => {
  console.log('Task completed:', data.task);
});
```

## 🔧 Built-in Tools

### Chat Tools (ChatInteraction)
- **Calculator** - Mathematical expressions
- **Weather** - Real-time weather data
- **Statistics** - Statistical analysis
- **Random Number** - Generate random numbers

### Evaluation Tools (EvaluationInteraction)
- **Calculator** - For mathematical evaluations
- **Statistics** - For data analysis evaluations

### Agent Tools (AgentInteraction)
- **All Chat Tools** - Comprehensive tool set
- **File Analysis** - File content and metadata
- **Custom Tools** - Extensible tool system

## 📝 Usage Examples

### CLI Chat with Tools

```bash
# Interactive chat
pnpm tsx src/cli/cli.ts chat-new -p ollama -m llama3.2:latest

# Tools demonstration
pnpm tsx scripts/tools.ts -p ollama -m llama3.2:latest --prompt "What's the weather in New York?"
```

### Programmatic Usage

```typescript
// Simple chat
const chatInteraction = new ChatInteraction(modelDetails);
const response = await chatInteraction.chat("Hello!");

// With CLI interface
const cliInterface = new CLIInterface();
await cliInterface.startChat(chatInteraction);

// Evaluation with schema
const evalInteraction = new EvaluationInteraction(modelDetails, "Rate this code");
const score = await evalInteraction.evaluateWithSchema(scoreSchema);

// Agent with triggers
const agentInterface = new AgentInterface(modelDetails, "Data Analyst");
await agentInterface.startAgent({
  'data-update': async (data) => {
    await agentInterface.executeTask(`Analyze new data: ${data}`);
  }
});
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
const interaction = new Interaction(modelDetails, prompt);
const runner = new BaseModelRunner();
const response = await runner.streamText(interaction);
```

### After (New Pattern)
```typescript
const chatInteraction = new ChatInteraction(modelDetails);
const response = await chatInteraction.chat("Hello!");
```

The new pattern is much simpler and more powerful! 🎉
