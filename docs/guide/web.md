---
title: Building with web
---

```bash
npx assistant-ui@latest create .
```

lib/web

```typescript
import { Stimulus } from "umwelten/dist/stimulus/stimulus.js";
import { locationTool, weatherTool } from "./tools.js";

export const weatherBot = new Stimulus({
  role: "Weather Assistant",
  objective: "Help users get weather information",
  instructions: [
    "You are a helpful weather assistant",
    "Provide accurate and friendly weather information",
    "Ask for clarification if the location is unclear"
  ],
  tools: { locationTool, weatherTool},
  maxToolSteps: 5
});
```

And then the route.ts
```typescript
import { UIMessage, convertToModelMessages} from "ai";
import { weatherBot } from "@/lib/weatherBot";

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  
  const stimulus = weatherBot;
  const model = {provider: "ollama", name: "qwen3:latest"};

  const interaction = new WebInteraction(model, stimulus, convertToModelMessages(messages));
  return interaction.toUIMessageStreamResponse();
}

```