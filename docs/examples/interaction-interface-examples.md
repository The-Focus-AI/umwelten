# Interaction + Interface Examples

This guide provides comprehensive examples of using the new Interaction + Interface pattern across different scenarios.

## 🚀 Quick Start Examples

### Basic Chat Interaction

```typescript
import { ChatInteraction, CLIInterface } from 'umwelten';

// Create a chat interaction
const chatInteraction = new ChatInteraction({
  name: "llama3.2:latest",
  provider: "ollama"
});

// Use with CLI interface
const cliInterface = new CLIInterface();
await cliInterface.startChat(chatInteraction);
```

### Programmatic Chat

```typescript
import { ChatInteraction } from 'umwelten';

const chatInteraction = new ChatInteraction({
  name: "gpt-4",
  provider: "openrouter"
});

// Send a message and get response
const response = await chatInteraction.chat("What's the weather like today?");
console.log(response);
```

## 🔧 Tool Integration Examples

### Weather Tool Usage

```typescript
import { ChatInteraction } from 'umwelten';

const chatInteraction = new ChatInteraction({
  name: "llama3.2:latest",
  provider: "ollama"
});

// The weather tool is automatically available
const response = await chatInteraction.chat("What's the weather in Cornwall CT?");
// Model will automatically call the weather tool and provide a summary
```

### Calculator Tool Usage

```typescript
const response = await chatInteraction.chat("Calculate 15 + 27 and then multiply by 3");
// Model will use calculator tool for the math operations
```

### File Analysis Tool

```typescript
const response = await chatInteraction.chat("Analyze the size of package.json");
// Model will use file analysis tool to get file information
```

## 🎯 Evaluation Examples

### Code Quality Evaluation

```typescript
import { EvaluationInteraction } from 'umwelten';

const evalInteraction = new EvaluationInteraction(
  { name: "gpt-4", provider: "openrouter" },
  "Analyze this code for quality, readability, and best practices. Provide a score from 1-10."
);

const code = `
function add(a, b) {
  return a + b;
}
`;

const response = await evalInteraction.evaluate(code);
console.log(response);
```

### Structured Evaluation with Schema

```typescript
import { z } from 'zod';

const scoreSchema = z.object({
  overallScore: z.number().min(1).max(10),
  readability: z.number().min(1).max(10),
  performance: z.number().min(1).max(10),
  bestPractices: z.number().min(1).max(10),
  comments: z.string()
});

const response = await evalInteraction.evaluateWithSchema(scoreSchema);
console.log(response); // Typed response with scoreSchema structure
```

## 🤖 Agent Examples

### File Watcher Agent

```typescript
import { AgentInterface } from 'umwelten';

const agentInterface = new AgentInterface(
  { name: "claude-3-sonnet", provider: "openrouter" },
  "File System Monitor",
  ["Monitor file changes", "Analyze file content", "Generate reports"]
);

// Start with file change trigger
await agentInterface.startAgent({
  'file-change': async (filePath) => {
    const task = `Analyze the changes in ${filePath} and provide a summary`;
    await agentInterface.executeTask(task);
  }
});

// Event handling
agentInterface.on('task-completed', (data) => {
  console.log(`Task completed: ${data.task}`);
  console.log(`Response: ${data.response}`);
});
```

### API Integration Agent

```typescript
const apiAgent = new AgentInterface(
  { name: "gpt-4", provider: "openrouter" },
  "API Integration Agent",
  ["Make API calls", "Process responses", "Handle errors"]
);

await apiAgent.startAgent({
  'api-call': async (endpoint) => {
    const task = `Call the API endpoint ${endpoint} and process the response`;
    await apiAgent.executeTask(task);
  }
});
```

### Scheduled Task Agent

```typescript
const scheduledAgent = new AgentInterface(
  { name: "claude-3-sonnet", provider: "openrouter" },
  "Scheduled Task Agent",
  ["Execute scheduled tasks", "Generate reports", "Send notifications"]
);

await scheduledAgent.startAgent({
  'schedule': async (schedule) => {
    const task = `Execute scheduled task: ${schedule}`;
    await scheduledAgent.executeTask(task);
  }
});
```

## 🌐 Web Integration Examples

### Next.js API Route

```typescript
// app/api/chat/route.ts
import { ChatInteraction } from 'umwelten';

export async function POST(request: Request) {
  const { message, model } = await request.json();
  
  const chatInteraction = new ChatInteraction({
    name: model || "gpt-4",
    provider: "openrouter"
  });
  
  try {
    const response = await chatInteraction.chat(message);
    return Response.json({ response });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
```

### React Chat Component

```typescript
// components/ChatComponent.tsx
import { useState } from 'react';
import { ChatInteraction, useWebInterface } from 'umwelten';

export function ChatComponent() {
  const [model, setModel] = useState("gpt-4");
  
  const chatInteraction = new ChatInteraction({
    name: model,
    provider: "openrouter"
  });
  
  const { sendMessage, messages, isLoading, clearHistory } = useWebInterface(chatInteraction);
  
  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.role}`}>
            <strong>{msg.role}:</strong> {msg.content}
          </div>
        ))}
      </div>
      
      <div className="input-area">
        <input
          type="text"
          placeholder="Type your message..."
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              sendMessage(e.target.value);
              e.target.value = '';
            }
          }}
          disabled={isLoading}
        />
        <button onClick={clearHistory}>Clear History</button>
      </div>
      
      {isLoading && <div>Loading...</div>}
    </div>
  );
}
```

### Vue.js Chat Component

```vue
<!-- components/ChatComponent.vue -->
<template>
  <div class="chat-container">
    <div class="messages">
      <div 
        v-for="(message, index) in messages" 
        :key="index" 
        :class="`message ${message.role}`"
      >
        <strong>{{ message.role }}:</strong> {{ message.content }}
      </div>
    </div>
    
    <div class="input-area">
      <input
        v-model="inputMessage"
        @keyup.enter="sendMessage"
        placeholder="Type your message..."
        :disabled="isLoading"
      />
      <button @click="sendMessage" :disabled="isLoading">Send</button>
      <button @click="clearHistory">Clear</button>
    </div>
    
    <div v-if="isLoading">Loading...</div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ChatInteraction, useWebInterface } from 'umwelten';

const inputMessage = ref('');
const chatInteraction = new ChatInteraction({
  name: "gpt-4",
  provider: "openrouter"
});

const { sendMessage: sendMsg, messages, isLoading, clearHistory } = useWebInterface(chatInteraction);

const sendMessage = async () => {
  if (inputMessage.value.trim()) {
    await sendMsg(inputMessage.value);
    inputMessage.value = '';
  }
};
</script>
```

## 📊 Evaluation Framework Examples

### Batch Model Evaluation

```typescript
import { EvaluationInteraction } from 'umwelten';

const models = [
  { name: "gpt-4", provider: "openrouter" },
  { name: "claude-3-sonnet", provider: "openrouter" },
  { name: "llama3.2:latest", provider: "ollama" }
];

const evaluationPrompt = "Write a haiku about programming";

const results = await Promise.all(
  models.map(async (model) => {
    const evalInteraction = new EvaluationInteraction(model, evaluationPrompt);
    const response = await evalInteraction.evaluate();
    
    return {
      model: model.name,
      provider: model.provider,
      response,
      metrics: evalInteraction.getEvaluationMetrics()
    };
  })
);

console.log("Evaluation Results:", results);
```

### Structured Evaluation with Multiple Criteria

```typescript
import { z } from 'zod';

const evaluationSchema = z.object({
  creativity: z.number().min(1).max(10),
  technicalAccuracy: z.number().min(1).max(10),
  clarity: z.number().min(1).max(10),
  overallScore: z.number().min(1).max(10),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  recommendations: z.string()
});

const evalInteraction = new EvaluationInteraction(
  { name: "gpt-4", provider: "openrouter" },
  "Evaluate this code for creativity, technical accuracy, and clarity"
);

const response = await evalInteraction.evaluateWithSchema(evaluationSchema);
console.log("Structured Evaluation:", response);
```

## 🔧 Custom Tool Examples

### Creating Custom Tools

```typescript
import { registerTool } from 'umwelten';
import { z } from 'zod';

// Custom database query tool
const databaseTool = {
  description: "Query a database and return results",
  parameters: z.object({
    query: z.string().describe("SQL query to execute"),
    database: z.string().describe("Database name")
  }),
  execute: async (params: { query: string; database: string }) => {
    console.log(`[DATABASE] Executing query on ${params.database}: ${params.query}`);
    
    // Simulate database query
    const results = [
      { id: 1, name: "John Doe", email: "john@example.com" },
      { id: 2, name: "Jane Smith", email: "jane@example.com" }
    ];
    
    return {
      query: params.query,
      database: params.database,
      results,
      rowCount: results.length,
      timestamp: new Date().toISOString()
    };
  }
};

// Register the tool
registerTool('database', databaseTool);

// Use with chat interaction
const chatInteraction = new ChatInteraction({
  name: "gpt-4",
  provider: "openrouter"
});

// Add custom tools
chatInteraction.setTools({
  ...chatInteraction.getVercelTools(),
  database: databaseTool
});

const response = await chatInteraction.chat("Query the users table for all active users");
```

## 🎯 Advanced Usage Patterns

### Multi-Step Agent Workflow

```typescript
import { AgentInteraction } from 'umwelten';

const workflowAgent = new AgentInteraction(
  { name: "claude-3-sonnet", provider: "openrouter" },
  "Workflow Orchestrator",
  ["Plan tasks", "Execute steps", "Monitor progress", "Handle errors"]
);

// Plan a complex task
const plan = await workflowAgent.planTask("Analyze user data, generate insights, and create a report");

// Execute the planned task
const result = await workflowAgent.executeTask(plan);

console.log("Workflow completed:", result);
```

### Memory-Enhanced Chat

```typescript
import { ChatInteraction } from 'umwelten';

const chatInteraction = new ChatInteraction({
  name: "gpt-4",
  provider: "openrouter"
});

// First conversation - establishes context
await chatInteraction.chat("My name is John and I'm a software engineer");

// Later conversation - uses memory
const response = await chatInteraction.chat("What's my profession?");
// Model will remember that John is a software engineer
```

### Error Handling and Retry Logic

```typescript
import { ChatInteraction } from 'umwelten';

const chatInteraction = new ChatInteraction({
  name: "gpt-4",
  provider: "openrouter"
});

async function robustChat(message: string, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await chatInteraction.chat(message);
      return response;
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);
      
      if (attempt === maxRetries) {
        throw new Error(`Failed after ${maxRetries} attempts: ${error.message}`);
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

const response = await robustChat("Hello, how are you?");
```

## 🚀 CLI Script Examples

### Custom CLI Tool

```typescript
#!/usr/bin/env tsx
import { Command } from 'commander';
import { ChatInteraction, CLIInterface } from 'umwelten';

const program = new Command();

program
  .name('my-ai-tool')
  .description('Custom AI tool using umwelten')
  .version('1.0.0');

program
  .command('chat')
  .description('Start interactive chat')
  .option('-m, --model <model>', 'Model to use', 'gpt-4')
  .option('-p, --provider <provider>', 'Provider to use', 'openrouter')
  .action(async (options) => {
    const chatInteraction = new ChatInteraction({
      name: options.model,
      provider: options.provider
    });
    
    const cliInterface = new CLIInterface();
    await cliInterface.startChat(chatInteraction);
  });

program
  .command('eval')
  .description('Run evaluation')
  .argument('<prompt>', 'Evaluation prompt')
  .option('-m, --model <model>', 'Model to use', 'gpt-4')
  .action(async (prompt, options) => {
    const evalInteraction = new EvaluationInteraction(
      { name: options.model, provider: 'openrouter' },
      prompt
    );
    
    const response = await evalInteraction.evaluate();
    console.log(response);
  });

program.parse();
```

These examples demonstrate the power and flexibility of the new Interaction + Interface pattern! 🎉
