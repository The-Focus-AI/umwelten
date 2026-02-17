# Tools API Reference

Tools in umwelten use the Vercel AI SDK `tool()` function. There are two categories: **Stimulus tools** (for content processing) and **Habitat tool sets** (for agent infrastructure).

## Defining Tools

Tools are defined with `tool()` from the `ai` package:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const myTool = tool({
  description: "Human-readable description for the model",
  parameters: z.object({
    param1: z.string().describe("What this parameter is for"),
    param2: z.number().optional().describe("Optional numeric parameter")
  }),
  execute: async ({ param1, param2 }) => {
    // Tool logic here — return value is sent back to the model
    return { result: `Processed ${param1}` };
  }
});
```

### Adding Tools to a Stimulus

Pass tools when creating a Stimulus:

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';

const stimulus = new Stimulus({
  role: "helpful assistant",
  tools: {
    calculator: calculatorTool,
    weather: weatherTool
  },
  toolInstructions: ["Use calculator for math", "Use weather for forecasts"],
  maxToolSteps: 5  // Max rounds of tool calls per interaction
});
```

The `Interaction` class automatically picks up tools from its Stimulus.

## Stimulus Tools (`src/stimulus/tools/`)

Content processing tools meant for use in any Stimulus.

### URL Tools

```typescript
import { wgetTool, markifyTool, parseFeedTool } from '../src/stimulus/tools/url-tools.js';
```

#### `wget`

Fetch a URL and return raw response (status, content-type, body).

```typescript
// Parameters: { url: string }
// Returns: { url, statusCode, contentType, content } for small responses
//          { url, statusCode, contentType, filePath, lineCount, sizeBytes } for large responses
```

Features: 20s timeout, 2MB max, auto-saves large content to session directory.

#### `markify`

Fetch a URL and convert HTML to readable markdown using Turndown.

```typescript
// Parameters: { url: string }
// Returns: { url, markdown } or { url, filePath, lineCount, sizeBytes } for large content
```

Set `MARKIFY_URL` env var to use an external Markify service instead of built-in conversion.

#### `parse_feed`

Parse RSS, Atom, or XML feeds.

```typescript
// Parameters: { url: string, limit?: number }
// Returns: { url, format, feed, items, itemCount }
```

### Media Tools

Type definitions for media processing (used by analysis stimuli):

```typescript
import * from '../src/stimulus/tools/pdf-tools.js';    // PDFMetadata, DocumentStructure
import * from '../src/stimulus/tools/audio-tools.js';   // AudioQuality, TranscriptionResult
import * from '../src/stimulus/tools/image-tools.js';   // ImageAnalysis interfaces
```

### Math Tools

```typescript
import { calculatorTool } from '../src/stimulus/tools/examples/math.js';
```

### Loading Custom Tools

Load tools from a directory containing `TOOL.md` + optional `handler.ts` files:

```typescript
import { loadToolsFromDirectory } from '../src/stimulus/tools/loader.js';

const tools = await loadToolsFromDirectory('./my-tools');
// Each subdirectory with a TOOL.md becomes a tool
```

## Habitat Tool Sets (`src/habitat/tool-sets.ts`)

Named collections of tools registered on a Habitat. These provide agent infrastructure capabilities.

```typescript
import type { ToolSet } from '../src/habitat/tool-sets.js';

interface ToolSet {
  name: string;
  description: string;
  createTools(habitat: Habitat): Record<string, Tool>;
}
```

### Available Tool Sets

#### Standard Tool Sets (in `standardToolSets`)

These are registered by default on every Habitat:

| Tool Set | Name | Tools |
|----------|------|-------|
| `agentToolSet` | `agent-management` | list, add, update, remove agents |
| `sessionToolSet` | `session-management` | list, show, inspect sessions |
| `externalInteractionToolSet` | `external-interactions` | Read Claude Code/Cursor conversation history |
| `agentRunnerToolSet` | `agent-runner` | `agent_clone`, `agent_logs`, `agent_status`, `agent_ask` |
| `runProjectToolSet` | `run-project` | `run_project` (Dagger smart containers) |
| `secretsToolSet` | `secrets` | set, remove, list secrets |
| `searchToolSet` | `search` | Web search via Tavily (`TAVILY_API_KEY`) |

#### Additional Tool Sets (registered manually)

These must be registered explicitly via `habitat.registerCustomTools()`:

| Tool Set | Name | Tools |
|----------|------|-------|
| `fileToolSet` | `file-operations` | `read_file`, `write_file`, `list_directory`, `ripgrep` |
| `timeToolSet` | `time` | `current_time` |
| `urlToolSet` | `url-operations` | `wget`, `markify`, `parse_feed` |

File/time/URL tools are typically given to sub-agents, not the top-level habitat.

### Habitat Tool Details

#### File Tools (`src/habitat/tools/file-tools.ts`)

Sandboxed file operations restricted to the habitat's allowed roots:

- **`read_file`** — Read file contents (with optional agentId for sub-agent scoping)
- **`write_file`** — Write file contents
- **`list_directory`** — List directory contents
- **`ripgrep`** — Search file contents with regex patterns

#### Agent Runner Tools (`src/habitat/tools/agent-runner-tools.ts`)

- **`agent_clone`** — Clone a git repo as a managed agent
- **`agent_logs`** — Read log files for an agent project
- **`agent_status`** — Check project status (git, running processes)
- **`agent_ask`** — Delegate a question to a sub-agent

#### Search Tools (`src/habitat/tools/search-tools.ts`)

- **`search`** — Web search via Tavily API. Requires `TAVILY_API_KEY` in env or habitat secrets.

#### Secrets Tools (`src/habitat/tools/secrets-tools.ts`)

- **`set_secret`** — Store a secret in the habitat's encrypted store
- **`remove_secret`** — Remove a secret
- **`list_secrets`** — List secret names (not values)

#### Run Project (`src/habitat/tools/run-project/`)

- **`run_project`** — Execute commands in auto-provisioned Dagger containers. Auto-detects project type, installs dependencies, injects API keys.

#### Time Tools (`src/habitat/tools/time-tools.ts`)

- **`current_time`** — Get current date/time with timezone support

## Creating Custom Tools

### Simple Tool

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export const greetTool = tool({
  description: "Generate a personalized greeting",
  parameters: z.object({
    name: z.string().describe("Person's name"),
    style: z.enum(["formal", "casual"]).default("casual")
  }),
  execute: async ({ name, style }) => {
    if (style === "formal") {
      return { greeting: `Good day, ${name}. How may I assist you?` };
    }
    return { greeting: `Hey ${name}! What's up?` };
  }
});
```

### Using in a Stimulus

```typescript
const stimulus = new Stimulus({
  role: "friendly greeter",
  tools: { greet: greetTool },
  toolInstructions: ["Use the greet tool when asked to say hello"]
});
```

### Creating a Custom ToolSet

```typescript
import type { ToolSet } from '../src/habitat/tool-sets.js';
import type { Habitat } from '../src/habitat/habitat.js';
import type { Tool } from 'ai';

export const myToolSet: ToolSet = {
  name: 'my-tools',
  description: 'Custom tools for my use case',
  createTools: (habitat: Habitat): Record<string, Tool> => ({
    my_tool: tool({
      description: "My custom tool",
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => {
        // Can access habitat.workDir, habitat config, etc.
        return { result: `Processed: ${input}` };
      }
    })
  })
};
```

## CLI Integration

```bash
# List available tools
dotenvx run -- pnpm run cli -- tools list

# Use tools in chat
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview
```
