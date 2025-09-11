# Getting Started with the New Stimulus-Driven Pattern

This guide will help you get started with Umwelten's new Stimulus-driven Interaction pattern, which provides a unified way to work with AI models using self-contained environmental context.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and pnpm
- API keys for your chosen providers (see [Configuration](#configuration))

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/umwelten.git
cd umwelten

# Install dependencies
pnpm install

# Set up environment variables
cp env.template .env
# Edit .env with your API keys
```

### Your First Chat

```bash
# Start an interactive chat with tools
pnpm cli chat --provider ollama --model llama3.2:latest
```

Try these commands in the chat:
- `What's the weather in New York?` (uses weather tool)
- `Calculate 15 + 27` (uses calculator tool)
- `Analyze the size of package.json` (uses file analysis tool)
- `/?` (show help)
- `exit` (end chat)

## 🎯 Stimulus Types

### Chat Stimulus

Perfect for conversational AI with memory and tools:

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
interaction.addMessage({ role: 'user', content: "Hello!" });
const response = await interaction.streamText();
console.log(response.content);
```

**Features:**
- ✅ Conversational system prompt
- ✅ Memory-enabled runner
- ✅ Common chat tools (calculator, weather, etc.)
- ✅ Multi-step tool calling (max 5 steps)

### EvaluationInteraction

Optimized for model evaluation with structured output:

```typescript
import { EvaluationInteraction } from 'umwelten';

const evalInteraction = new EvaluationInteraction(
  { name: "gpt-4", provider: "openrouter" },
  "Analyze this code and provide a score from 1-10"
);

const response = await evalInteraction.evaluate("function add(a, b) { return a + b; }");
console.log(response);
```

**Features:**
- ✅ Evaluation-focused system prompt
- ✅ Base runner (no memory needed)
- ✅ Evaluation-specific tools
- ✅ Structured output support

### AgentInteraction

Designed for autonomous agents with comprehensive tools:

```typescript
import { AgentInteraction } from 'umwelten';

const agentInteraction = new AgentInteraction(
  { name: "claude-3-sonnet", provider: "openrouter" },
  "Data Analysis Agent",
  ["Analyze data", "Generate reports", "Make recommendations"]
);

const response = await agentInteraction.executeTask("Analyze the sales data");
console.log(response);
```

**Features:**
- ✅ Agent-focused system prompt
- ✅ Memory-enabled runner for learning
- ✅ Comprehensive tool set
- ✅ Extended multi-step capabilities (max 10 steps)

## 🖥️ Interface Types

### CLIInterface

Readline-based command-line interface:

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

React-compatible interface with hooks:

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

Event-driven interface for autonomous agents:

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
  }
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

## 📝 Common Usage Patterns

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
```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file with your API keys:

```bash
# OpenRouter API key
OPENROUTER_API_KEY=your_openrouter_key

# Google API key
GOOGLE_API_KEY=your_google_key

# Ollama base URL (optional)
OLLAMA_BASE_URL=http://localhost:11434

# LM Studio base URL (optional)
LMSTUDIO_BASE_URL=http://localhost:1234
```

### Model Configuration

```typescript
// Google Gemini models
const googleModel = {
  name: "gemini-2.0-flash",
  provider: "google"
};

// Ollama local models
const ollamaModel = {
  name: "llama3.2:latest",
  provider: "ollama"
};

// OpenRouter hosted models
const openRouterModel = {
  name: "openai/gpt-4o-mini",
  provider: "openrouter"
};
```

## 🎯 Advanced Features

### Custom Tools

```typescript
import { z } from 'zod';

const customTool = {
  description: "Query a database and return results",
  inputSchema: z.object({
    query: z.string().describe("SQL query to execute"),
    database: z.string().describe("Database name")
  }),
  execute: async (params) => {
    // Your custom logic here
    return { results: [], rowCount: 0 };
  }
};

// Add to chat interaction
chatInteraction.setTools({
  ...chatInteraction.getVercelTools(),
  database: customTool
});
```

### Structured Output

```typescript
import { z } from 'zod';

const scoreSchema = z.object({
  overallScore: z.number().min(1).max(10),
  readability: z.number().min(1).max(10),
  performance: z.number().min(1).max(10),
  comments: z.string()
});

const response = await evalInteraction.evaluateWithSchema(scoreSchema);
console.log(response); // Typed response with scoreSchema structure
```

### Memory Integration

```typescript
// Chat interactions automatically use memory
const chatInteraction = new ChatInteraction(modelDetails);

// First conversation - establishes context
await chatInteraction.chat("My name is John and I'm a software engineer");

// Later conversation - uses memory
const response = await chatInteraction.chat("What's my profession?");
// Model will remember that John is a software engineer
```

## 🚀 Next Steps

1. **Explore Examples**: Check out [Interaction + Interface Examples](/examples/interaction-interface-examples)
2. **Build Custom Tools**: Create tools specific to your use case
3. **Web Integration**: Integrate with React, Vue.js, or Next.js
4. **Agent Development**: Build autonomous agents with triggers and events
5. **Advanced Patterns**: Explore multi-step workflows and error handling

## 🆘 Troubleshooting

### Common Issues

**Model not responding with text:**
- Some models prefer tool calls over text responses
- Try a different model or adjust the system prompt

**Tool calls not working:**
- Ensure tools are properly registered
- Check tool input schemas and parameters

**Memory not persisting:**
- Memory is stored in memory for the session
- Use `MemoryRunner` for persistent memory across sessions

**API key errors:**
- Verify your API keys are set in `.env`
- Check provider-specific requirements

### Getting Help

- Check the [API Reference](/api/interaction-interface-pattern)
- Review [Examples](/examples/interaction-interface-examples)
- Join our community discussions
- Open an issue on GitHub

## 🎉 You're Ready!

You now have everything you need to start using the new Interaction + Interface pattern. The pattern provides a clean, unified way to work with AI models across different environments, with built-in tools, memory, and type safety.

Happy coding! 🚀
