# Connecting LLMs to the Real World with MCP

A walkthrough of building an AI chat interface that talks to your electric vehicle — using the Model Context Protocol to give an LLM access to live charging data, trip history, and battery health, without writing a single API integration by hand.

**Time Required:** 20 minutes to build, 2 minutes to connect
**Prerequisites:** Node.js 20+, pnpm, a Google or OpenRouter API key
**Optional:** A TezLab account (free) for the EV data example
**Cost:** ~$0.01 per conversation

## The Problem

You want an LLM to answer questions about your electric vehicle: *"How much did I spend on charging last month?"* or *"What's my battery health trend?"* The data lives behind an OAuth-protected API with 20+ endpoints, each returning different JSON structures.

The traditional approach: read the API docs, write fetch calls for each endpoint, handle auth tokens, parse responses, build tool definitions, wire everything together. For 20 tools, that's a weekend of work.

The MCP approach: connect to a server that already exposes those tools, and the LLM gets access to all of them in one line of code. The protocol handles tool discovery, schema validation, and data formatting. You write the chat loop.

## What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard that lets AI applications discover and call external tools through a single connection. Think of it as USB for LLM tools — plug in a server, and the model can see what's available and use it.

An MCP server exposes three things:

| Capability | What It Does | Example |
|------------|-------------|---------|
| **Tools** | Functions the model can call | `get_charges`, `get_battery_health` |
| **Resources** | Data the model can read | Config files, database records |
| **Prompts** | Reusable prompt templates | Analysis patterns, report formats |

Umwelten implements both sides: a **client** for consuming external MCP servers, and a **server framework** for building your own.

## Step 1: Connect to an MCP Server

The example connects to TezLab's MCP server, which exposes EV data tools. The connection handles OAuth automatically — on first run, it opens your browser for sign-in and stores the token for future sessions.

```typescript
import { TezLabMCPManager } from './tezlab-mcp.js';

const tezlab = new TezLabMCPManager({
  serverUrl: 'https://mcp.tezlabapp.com',
  scope: 'mcp',                    // Read-only by default
  allowCommands: false,             // No vehicle commands
});

await tezlab.connect();

// That's it. You now have 20+ EV data tools.
console.log(tezlab.getToolNames());
// → ['get_charges', 'get_drives', 'get_battery_health', 'get_efficiency', ...]
```

On first run, your browser opens to TezLab's sign-in page. After you authorize, the OAuth token is stored at `~/.umwelten/mcp-chat/tezlab-oauth.json` — outside the project directory so the LLM can't read it through file tools.

## Step 2: Filter Tools by Safety

Not all tools should be available to the model. The TezLab server exposes `send_vehicle_command` (honk horn, flash lights, unlock doors) alongside read-only data tools. We filter based on MCP annotations:

```typescript
function shouldIncludeTool(toolDef: MCPToolDescriptor, allowCommands: boolean): boolean {
  if (allowCommands) return true;

  // Explicitly block vehicle commands
  if (toolDef.name === 'send_vehicle_command') return false;

  // Respect MCP safety annotations
  if (toolDef.annotations?.destructiveHint) return false;
  if (toolDef.annotations?.readOnlyHint === false) return false;

  return true;
}
```

This is annotation-based filtering — it works with any MCP server, not just TezLab. If a server marks a tool as destructive, it gets filtered automatically. You opt in to danger, not out.

## Step 3: Convert MCP Tools to Vercel AI SDK Format

MCP tools use JSON Schema. The Vercel AI SDK (which Umwelten uses under the hood) expects Zod schemas. The conversion happens automatically:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

// MCP tool definition (JSON Schema) → Vercel AI SDK tool (Zod)
function toAiTool(toolDef: MCPToolDescriptor): Tool {
  return tool({
    description: toolDef.description || `TezLab MCP tool: ${toolDef.name}`,
    inputSchema: jsonSchemaToZod(toolDef.inputSchema),
    execute: async (params) => {
      const result = await client.callTool({
        name: toolDef.name,
        arguments: params,
      });
      return { tool: toolDef.name, success: !result.isError, data: result.content };
    },
  });
}
```

The `jsonSchemaToZod()` function handles strings, numbers, booleans, arrays, objects, enums, and constraints like `minLength` and `maximum`. Once converted, MCP tools are indistinguishable from locally defined tools — the model uses them the same way.

## Step 4: Wire Tools into a Habitat

A Habitat is Umwelten's agent container. It manages the work directory, sessions, and tool registration. Here's the full wiring:

```typescript
import { Habitat } from '../../src/habitat/index.js';
import { currentTimeTool } from '../../src/habitat/tools/time-tools.js';

const habitat = await Habitat.create({
  envPrefix: 'MCP_CHAT',
  stimulusTemplatePath: join(__dirname, 'MCP_CHAT_PROMPT.md'),
  skipBuiltinTools: true,           // No file/shell tools — just MCP
  skipWorkDirTools: true,
  registerCustomTools: async (instance) => {
    instance.addTool('current_time', currentTimeTool);
    await tezlab.connect();          // Connect and discover tools
    instance.addTools(tezlab.getTools());  // Register all MCP tools
  },
});
```

Three design decisions here:

1. **No file or shell tools.** The model can only use MCP tools and a clock. It can't read the filesystem, run commands, or access anything outside the MCP server.
2. **Custom prompt template.** `MCP_CHAT_PROMPT.md` tells the model what tools it has and how to use them — loaded from a file, not hardcoded.
3. **Late tool registration.** Tools are discovered at connect time, not compile time. If the MCP server adds new tools, they appear automatically.

## Step 5: Chat

Create an interaction and start talking:

```typescript
const session = habitat.sessionManager.createSession();
const interaction = await habitat.createAgentInteraction(session.id);

// The model now has access to all TezLab tools
const response = await interaction.chat(
  'How much did I spend on charging last month?'
);
// Model calls get_charges tool → gets real data → formats answer
```

The model sees tool descriptions like "Get a list of charging sessions with cost, energy, and location data" and decides which tools to call. It might call `get_charges` with a date range, then `get_aggregations` for summary stats, and compose a natural language answer from the results.

## How the Transport Layer Works

MCP supports multiple ways to connect client to server. Umwelten implements four transports:

| Transport | Use Case | How It Works |
|-----------|----------|-------------|
| **stdio** | Local servers | Launches a child process, pipes JSON-RPC over stdin/stdout |
| **SSE** | Remote HTTP servers | Server-Sent Events for streaming responses |
| **WebSocket** | Full-duplex remote | Bidirectional WebSocket connection |
| **TCP** | Container communication | Direct TCP socket for Dagger containers |

The TezLab example uses `StreamableHTTPClientTransport` (SSE). A local MCP server would use stdio:

```typescript
// Remote server (SSE with OAuth)
const remote = new StreamableHTTPClientTransport(
  new URL('https://mcp.tezlabapp.com'),
  { authProvider: oauthProvider }
);

// Local server (stdio)
const local = createStdioConfig('node', ['my-local-mcp-server.js']);
```

Same client API, different transport. Your code doesn't change.

## Building Your Own MCP Server

The server framework uses a builder pattern. Here's a server that exposes Umwelten's evaluation capabilities:

```typescript
import { createMCPServer } from '../../src/mcp/server/server.js';

const server = createMCPServer()
  .withName('umwelten-evaluation-server')
  .withVersion('1.0.0')
  .addTool('run-evaluation', {
    description: 'Run a prompt against multiple LLMs and compare results',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The prompt to evaluate' },
        models: {
          type: 'array',
          items: { type: 'string' },
          description: 'Model IDs to test (e.g. "google:gemini-3-flash-preview")',
        },
      },
      required: ['prompt'],
    },
  }, async (params) => {
    const results = await runEvaluation(params);
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  })
  .addResource('latest-results', {
    uri: 'eval://latest',
    name: 'Latest evaluation results',
    description: 'Results from the most recent evaluation run',
  }, async () => {
    return { contents: [{ uri: 'eval://latest', text: loadLatestResults() }] };
  })
  .build();

await server.start(transport);
```

The server automatically handles JSON-RPC 2.0, capability negotiation, and tool/resource listing. When you add or remove tools at runtime, it sends `notifications/tools/list_changed` to connected clients.

You can also register existing Umwelten tools directly:

```typescript
import { wgetTool } from '../../src/stimulus/tools/url-tools.js';

// Converts Zod schema → JSON Schema automatically
server.registerToolFromDefinition('wget', wgetTool);
```

## The Integration Bridge

The `MCPStimulusManager` ties everything together — it manages the connection lifecycle and converts between MCP and Umwelten's internal tool format:

```typescript
import { createMCPStimulusManager } from '../../src/mcp/integration/stimulus.js';

const manager = createMCPStimulusManager({
  name: 'my-client',
  version: '1.0.0',
  transport: {
    type: 'sse',
    url: 'https://example.com/mcp/sse',
    headers: { Authorization: `Bearer ${token}` },
  },
});

await manager.connect();

// MCP tools converted to Umwelten ToolDefinitions
const tools = manager.getAvailableTools();

// MCP resources injected as prompt context
const context = await createMCPResourceContext(manager);
```

This is the key abstraction: MCP tools become regular Umwelten tools. They work in evaluations, chat sessions, and habitat agents without any special handling.

## Security Model

The implementation enforces several safety boundaries:

| Boundary | How |
|----------|-----|
| **OAuth tokens stored outside work dir** | LLM can't read `~/.umwelten/mcp-chat/` through file tools |
| **Read-only by default** | Vehicle commands require explicit `allowCommands: true` |
| **Annotation-based filtering** | Respects `readOnlyHint` and `destructiveHint` from any MCP server |
| **No file/shell tools in MCP chat** | `skipBuiltinTools: true` prevents filesystem access |
| **Scope-limited OAuth** | `mcp` scope vs `mcp_commands` scope controls what the server exposes |
| **Private file permissions** | Auth state written with `0o600` (owner-only read/write) |

## Architecture

```
src/mcp/
├── types/
│   ├── protocol.ts        # Zod schemas for JSON-RPC 2.0 + MCP protocol
│   ├── transport.ts        # Abstract transport + Stdio/SSE/WebSocket
│   └── transport-tcp.ts    # TCP transport for container communication
├── client/
│   └── client.ts           # MCP client: connect, discover, call tools
├── server/
│   └── server.ts           # MCP server framework with builder pattern
└── integration/
    └── stimulus.ts         # Bridge: MCP tools ↔ Umwelten ToolDefinitions
```

## Patterns You Can Reuse

### Pattern 1: External Tool Integration via MCP

Connect to any MCP server and use its tools in your LLM interactions. No API-specific code needed — just point at the server URL.

```
MCP Server → Client connects → Tools discovered → Registered in Habitat → Model uses them
```

### Pattern 2: Annotation-Based Safety

Instead of maintaining a blocklist of dangerous tool names, read the MCP annotations. Works with any server without special cases.

### Pattern 3: Transport-Agnostic Clients

Write your client code once. Swap between local (stdio), remote (SSE/WebSocket), and container (TCP) transports by changing config, not code.

### Pattern 4: Bidirectional Schema Conversion

Convert JSON Schema → Zod (for consuming MCP tools) and Zod → JSON Schema (for exposing tools as MCP). This bridges the gap between MCP's schema format and the Vercel AI SDK's expectations.

### Pattern 5: Late Tool Discovery

Don't hardcode tool lists. Connect at runtime, discover what's available, and register dynamically. If the server adds tools, your client picks them up automatically.

## Running the Example

```bash
# Start the MCP chat with TezLab (opens browser for OAuth on first run)
dotenvx run -- pnpm tsx examples/mcp-chat/cli.ts

# Allow vehicle commands (honk, flash, unlock)
MCP_CHAT_ALLOW_COMMANDS=true dotenvx run -- pnpm tsx examples/mcp-chat/cli.ts

# Use a different model
MCP_CHAT_PROVIDER=openrouter MCP_CHAT_MODEL=anthropic/claude-haiku-4.5 \
  dotenvx run -- pnpm tsx examples/mcp-chat/cli.ts
```

Once connected, try:

- *"How much did I spend on charging this month?"*
- *"Show me my last 5 drives with efficiency data"*
- *"What's my battery health trend?"*
- *"Find chargers near my current location"*

The model calls the appropriate TezLab MCP tools, gets real data back, and composes a natural language answer.

## Full Source

See [`examples/mcp-chat/`](../examples/mcp-chat/) for the complete implementation:

- `tezlab-mcp.ts` — OAuth provider, MCP client, tool filtering and conversion
- `habitat.ts` — Habitat wiring with MCP tools
- `cli.ts` — Interactive chat REPL with `/tools`, `/context`, `/logout` commands

For the core MCP library, see [`src/mcp/`](../src/mcp/).
