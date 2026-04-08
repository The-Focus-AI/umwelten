---
title: Web interface
description: Gaia (Habitat web), plus patterns for building your own app with Stimulus + Interaction
---

# Habitat web (Gaia)

Umwelten’s first-party browser experience is **`umwelten habitat web`**. It starts the Habitat-backed **Gaia** HTTP server ([`src/habitat/gaia-server.ts`](../../src/habitat/gaia-server.ts)) and serves the web UI from [`src/ui/WebInterface.ts`](../../src/ui/WebInterface.ts) and related modules under `src/ui/`. Use the same `--work-dir` / `--sessions-dir` / model flags as other `habitat` subcommands so CLI, Telegram, Discord, and web see one workspace.

**Today:** session/agent data and chat flows exposed through Gaia for interactive use.

**Roadmap / gaps:** richer **native session browser** (list habitat sessions, open `transcript.jsonl`, optional beats timeline) in the SPA; optional dashboards for **eval run** outputs. Until then, use `umwelten sessions habitat …` in the terminal for transcript introspection.

See [Habitat interfaces](habitat-interfaces.md) for how web fits next to REPL, Telegram, and Discord.

---

## Building your own web app

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