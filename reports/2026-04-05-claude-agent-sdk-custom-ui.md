# Claude Agent SDK: Building Custom UIs on Top of Claude Code

**Date:** 2026-04-05
**Author:** Research Report (Auto-generated)
**Sources Consulted:** 18

---

## Abstract

The Claude Agent SDK (formerly Claude Code SDK) provides a programmatic interface to the same agent loop, tools, and context management that power Claude Code. Released as both TypeScript (`@anthropic-ai/claude-agent-sdk`) and Python (`claude-agent-sdk`) packages, the SDK communicates with a bundled Claude Code CLI subprocess via a JSON-lines streaming protocol over stdin/stdout. This architecture enables developers to build arbitrary custom UIs -- web applications, Telegram bots, Discord bots, mobile interfaces -- on top of Claude's full agentic capabilities including file editing, command execution, web search, and MCP tool integration. This report covers the SDK's architecture, the subprocess communication protocol, message types for UI rendering, streaming patterns, the Channels system for messaging platform integration, official demo projects, hosting/deployment patterns, and alternative approaches using the Vercel AI SDK and raw Anthropic API. The ecosystem is rapidly maturing, with a V2 session-based API in preview, official Telegram/Discord/iMessage channel plugins, and a growing collection of open-source wrappers and custom frontends.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Claude Agent SDK Overview](#2-claude-agent-sdk-overview)
3. [Architecture: The Subprocess Protocol](#3-architecture-the-subprocess-protocol)
4. [Message Types and Streaming for Custom UIs](#4-message-types-and-streaming-for-custom-uis)
5. [Building Custom UIs: Patterns and Examples](#5-building-custom-uis-patterns-and-examples)
6. [Claude Code Channels: Telegram, Discord, and Custom Integrations](#6-claude-code-channels-telegram-discord-and-custom-integrations)
7. [MCP Integration for Custom Tools](#7-mcp-integration-for-custom-tools)
8. [Hosting and Deployment](#8-hosting-and-deployment)
9. [Alternative Approaches](#9-alternative-approaches)
10. [Open-Source Projects and Community](#10-open-source-projects-and-community)
11. [Conclusion](#11-conclusion)
12. [References](#12-references)

---

## 1. Introduction

Claude Code, Anthropic's agentic coding tool, has evolved from a terminal-only experience into a full platform for building autonomous AI agents. The key enabler is the **Claude Agent SDK** (renamed from "Claude Code SDK" in early 2026), which exposes Claude Code's internals as a library. According to the [official documentation](https://platform.claude.com/docs/en/agent-sdk/overview), "the Agent SDK gives you the same tools, agent loop, and context management that power Claude Code, programmable in Python and TypeScript."

This report investigates how to use the Claude Agent SDK to build custom user interfaces -- replacing Claude Code's terminal UI with web apps, chat bots, mobile interfaces, or any other frontend -- while retaining the full power of Claude's agentic capabilities: file reading/editing, command execution, code generation, web search, and extensibility via MCP.

### Scope

This report covers:
- The SDK's architecture and subprocess communication protocol
- Message types and streaming patterns relevant to UI rendering
- Official and community approaches to custom UI building
- The Channels system for messaging platform integration
- MCP (Model Context Protocol) as an extension mechanism
- Hosting and deployment patterns for production
- Alternative approaches (Vercel AI SDK, raw Anthropic API)
- Open-source projects wrapping Claude Code

### Methodology

Research was conducted via web search across official Anthropic documentation, engineering blog posts, npm package pages, GitHub repositories, third-party tutorials, and community projects. 18 sources were consulted spanning official documentation, architectural deep-dives, community tutorials, and open-source repositories.

---

## 2. Claude Agent SDK Overview

### What It Is

The Claude Agent SDK is a library that wraps Claude Code's agent loop, providing programmatic access to the same capabilities available in the terminal CLI. As described in [Anthropic's engineering blog](https://claude.com/blog/building-agents-with-the-claude-agent-sdk) (published January 28, 2026), the core design principle is "to give your agents a computer, allowing them to work like humans do."

The SDK is available in two languages:

| Package | Language | Install |
|---------|----------|---------|
| `@anthropic-ai/claude-agent-sdk` | TypeScript | `npm install @anthropic-ai/claude-agent-sdk` |
| `claude-agent-sdk` | Python | `pip install claude-agent-sdk` |

### Key Capabilities

According to the [SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview), built-in tools include:

| Tool | Purpose |
|------|---------|
| **Read** | Read any file in the working directory |
| **Write** | Create new files |
| **Edit** | Make precise edits to existing files |
| **Bash** | Run terminal commands, scripts, git operations |
| **Glob** | Find files by pattern |
| **Grep** | Search file contents with regex |
| **WebSearch** | Search the web for current information |
| **WebFetch** | Fetch and parse web page content |
| **AskUserQuestion** | Ask users clarifying questions with multiple choice options |

Beyond built-in tools, the SDK supports:
- **Hooks**: Run custom code at key lifecycle points (PreToolUse, PostToolUse, Stop, etc.)
- **Subagents**: Spawn specialized agents for focused subtasks
- **MCP servers**: Connect to external tools (databases, APIs, browsers)
- **Sessions**: Maintain context across multiple exchanges
- **Custom tools**: Define in-process MCP tools with the `tool()` helper
- **Permissions**: Fine-grained control over what agents can do

### SDK vs. Client SDK vs. CLI

The [official documentation](https://platform.claude.com/docs/en/agent-sdk/overview) clarifies the distinction:

- **Client SDK** (`@anthropic-ai/sdk`): Direct API access where *you* implement the tool loop
- **Agent SDK** (`@anthropic-ai/claude-agent-sdk`): Claude handles tools autonomously
- **CLI** (`claude`): Interactive terminal interface, same capabilities as SDK

The key difference: with the Client SDK you implement `while (response.stop_reason === "tool_use") { ... }` yourself. With the Agent SDK, Claude executes tools directly.

---

## 3. Architecture: The Subprocess Protocol

### Process Model

The SDK implements a **subprocess-based architecture** where the SDK acts as a library wrapper around a bundled Claude Code CLI executable. According to the [architectural deep-dive by Build with AWS](https://buildwithaws.substack.com/p/inside-the-claude-agent-sdk-from):

> "Claude Agent SDK is Claude Code, but as a library that you can embed into your applications."

The communication model is:

```
Your Application (Python/TypeScript)
    |
    | stdin: JSON messages from SDK
    | stdout: JSON responses from CLI
    |
Claude Code CLI (Node.js subprocess)
    |
    | HTTPS
    |
Claude API (api.anthropic.com)
```

### JSON-Lines Streaming Protocol

The SDK communicates with the CLI subprocess using a **JSON-lines stream** (one complete JSON object per line). The CLI is invoked with `--output-format stream-json`, mirroring the behavior documented across [all SDK implementations](https://buildwithaws.substack.com/p/inside-the-claude-agent-sdk-from).

**User message example:**
```json
{"type": "user", "message": {"role": "user", "content": "What files are in /home?"}}
```

**CLI invocation:**
```bash
claude code --output-format stream-json --verbose --print -- "What files are in /home?"
```

### Control Request/Response Pattern

When Claude attempts tool use, the CLI initiates control requests. The SDK processes these and responds:

**Control request (tool permission):**
```json
{
  "type": "control_request",
  "request_id": "req_1_abc123",
  "request": {
    "subtype": "can_use_tool",
    "tool_name": "Bash",
    "input": {"command": "ls /home"}
  }
}
```

**Control response:**
```json
{
  "type": "control_response",
  "request_id": "req_1_abc123",
  "response": {
    "subtype": "success",
    "response": {"behavior": "allow"}
  }
}
```

The `request_id` field enables multiplexing, allowing simultaneous control requests to be matched with responses. This is critical for building custom UIs that need to surface permission prompts to users.

### Transport Layer

The non-public transport layer (`SubprocessCLITransport` in Python, similar in TypeScript) manages:
- Process lifecycle (spawn, terminate, kill)
- Stream buffering (1MB default for JSON parsing)
- Write locking (prevents concurrent writes from async tasks)
- Error handling (exit codes, stream errors, JSON parsing failures)
- Timeout management (configurable control request timeouts)

### Multi-Language SDK Implementations

The subprocess architecture has been implemented in multiple languages beyond the official Python and TypeScript SDKs:

- **Go**: [claude-code-sdk-go](https://pkg.go.dev/github.com/f-pisani/claude-code-sdk-go) and [claude-agent-sdk-go](https://pkg.go.dev/github.com/shaharia-lab/claude-agent-sdk-go/claude) -- using channels instead of async generators, context-based cancellation
- **Elixir**: [claude_code_sdk](https://hexdocs.pm/claude_code_sdk/claude_code_sdk.epub) -- process management via erlexec, Elixir Streams
- **Swift**: [ClaudeCodeSDK](https://github.com/jamesrochabrun/ClaudeCodeSDK)

---

## 4. Message Types and Streaming for Custom UIs

Understanding the message types is essential for building custom UIs. The SDK yields different message types that your UI must handle appropriately.

### Core Message Types

According to the [TypeScript SDK reference](https://platform.claude.com/docs/en/agent-sdk/typescript):

| Message Type | `type` field | Purpose |
|-------------|-------------|---------|
| `SystemMessage` | `"system"` | Session initialization (subtype `"init"`), compact boundary |
| `AssistantMessage` | `"assistant"` | Complete Claude response with content blocks |
| `ResultMessage` | `"result"` | Final result when agent completes |
| `StreamEvent` / `SDKPartialAssistantMessage` | `"stream_event"` | Real-time streaming deltas (when enabled) |

### Processing Messages for a UI

The [quickstart guide](https://platform.claude.com/docs/en/agent-sdk/quickstart) shows the basic pattern:

```typescript
for await (const message of query({
  prompt: "Review utils.py for bugs",
  options: { allowedTools: ["Read", "Edit", "Glob"] }
})) {
  if (message.type === "assistant" && message.message?.content) {
    for (const block of message.message.content) {
      if ("text" in block) {
        // Render Claude's reasoning text in your UI
        console.log(block.text);
      } else if ("name" in block) {
        // Show tool usage indicator (e.g., "Reading file...")
        console.log(`Tool: ${block.name}`);
      }
    }
  } else if (message.type === "result") {
    // Show completion state
    console.log(`Done: ${message.subtype}`);
  }
}
```

### Streaming Output for Real-Time UIs

For chat-like UIs that need real-time token streaming, enable `includePartialMessages`. According to the [streaming documentation](https://platform.claude.com/docs/en/agent-sdk/streaming-output):

```typescript
for await (const message of query({
  prompt: "Explain how databases work",
  options: { includePartialMessages: true }
})) {
  if (message.type === "stream_event") {
    const event = message.event;
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      // Send this delta to your UI for real-time rendering
      process.stdout.write(event.delta.text);
    }
  }
}
```

### Stream Event Types

When partial messages are enabled, the message flow is:

```
StreamEvent (message_start)
StreamEvent (content_block_start) - text block
StreamEvent (content_block_delta) - text chunks...
StreamEvent (content_block_stop)
StreamEvent (content_block_start) - tool_use block
StreamEvent (content_block_delta) - tool input chunks...
StreamEvent (content_block_stop)
StreamEvent (message_delta)
StreamEvent (message_stop)
AssistantMessage - complete message with all content
... tool executes ...
ResultMessage - final result
```

### Building a Streaming UI

The [official documentation](https://platform.claude.com/docs/en/agent-sdk/streaming-output) provides a complete streaming UI pattern that tracks tool execution state:

```typescript
let inTool = false;

for await (const message of query({
  prompt: "Find all TODO comments in the codebase",
  options: {
    includePartialMessages: true,
    allowedTools: ["Read", "Bash", "Grep"]
  }
})) {
  if (message.type === "stream_event") {
    const event = message.event;
    if (event.type === "content_block_start") {
      if (event.content_block.type === "tool_use") {
        // Show tool status indicator in UI
        process.stdout.write(`\n[Using ${event.content_block.name}...]`);
        inTool = true;
      }
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta" && !inTool) {
        // Stream text to UI
        process.stdout.write(event.delta.text);
      }
    } else if (event.type === "content_block_stop") {
      if (inTool) {
        console.log(" done");
        inTool = false;
      }
    }
  } else if (message.type === "result") {
    console.log("\n\n--- Complete ---");
  }
}
```

### V2 Session API (Preview)

The [V2 TypeScript API](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) simplifies multi-turn conversations for custom UIs by separating input and output:

```typescript
import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";

await using session = unstable_v2_createSession({
  model: "claude-opus-4-6"
});

// Turn 1
await session.send("What is 5 + 3?");
for await (const msg of session.stream()) {
  if (msg.type === "assistant") {
    const text = msg.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    renderInUI(text);
  }
}

// Turn 2
await session.send("Multiply that by 2");
for await (const msg of session.stream()) {
  // ... same pattern
}
```

The V2 API provides:
- `createSession()` / `resumeSession()` -- start or continue conversations
- `session.send()` -- dispatch a message
- `session.stream()` -- stream back the response
- Automatic resource cleanup with `await using`

### Handling User Input and Approvals

For interactive UIs, the `canUseTool` callback is essential. According to the [user input documentation](https://platform.claude.com/docs/en/agent-sdk/user-input):

```typescript
for await (const message of query({
  prompt: "Create and delete a test file",
  options: {
    canUseTool: async (toolName, input) => {
      // Surface this to your UI -- show a dialog, send a Telegram message, etc.
      const approved = await showApprovalDialogInUI(toolName, input);

      if (approved) {
        return { behavior: "allow", updatedInput: input };
      } else {
        return { behavior: "deny", message: "User denied this action" };
      }
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

The `AskUserQuestion` tool enables Claude to ask clarifying questions with multiple-choice options, including optional HTML preview cards for visual UI elements:

```typescript
options: {
  toolConfig: {
    askUserQuestion: { previewFormat: "html" }
  },
  canUseTool: async (toolName, input) => {
    if (toolName === "AskUserQuestion") {
      // input.questions[].options[].preview contains styled HTML
      const answers = await showQuestionUIInBrowser(input.questions);
      return { behavior: "allow", updatedInput: { ...input, answers } };
    }
    return { behavior: "allow", updatedInput: input };
  }
}
```

---

## 5. Building Custom UIs: Patterns and Examples

### Official Demo Projects

The [claude-agent-sdk-demos](https://github.com/anthropics/claude-agent-sdk-demos) repository contains 8 demonstration projects:

1. **Simple Chat App** -- React + Express chat interface with WebSocket streaming. This is the most directly relevant example for custom UI building.
2. **AskUserQuestion Previews** -- Branding assistant with HTML preview cards, WebSocket round-trip from SDK's `canUseTool` callback to browser.
3. **Research Agent** -- Multi-agent orchestration with parallel subagent spawning.
4. **Email Agent** -- IMAP email assistant with multi-turn interactions.
5. **Hello World V2** -- V2 Session API examples with `send()`/`stream()` patterns.
6. **Excel Demo** -- Spreadsheet manipulation.
7. **Resume Generator** -- Web search + document generation.
8. **Hello World** -- Basic getting-started example.

### Simple Chat App Architecture

The **Simple Chat App** demo uses:
- **Frontend**: React with WebSocket-based communication
- **Backend**: Express server running the Agent SDK
- **Communication**: WebSocket for real-time streaming responses
- **Pattern**: Full conversation loop with streaming

### AskUserQuestion with HTML Previews

The **AskUserQuestion Previews** demo shows advanced UI patterns:
- Uses `previewFormat: "html"` for styled option cards
- WebSocket round-trip from SDK's `canUseTool` callback to browser UI
- Plan mode steering toward clarifying questions before execution
- Human-in-the-loop decision making

### Architectural Pattern for Web UIs

Based on the demos and documentation, the recommended architecture is:

```
Browser (React/Vue/etc.)
    |
    | WebSocket / SSE
    |
Express/Fastify Server
    |
    | query() / session.send() + session.stream()
    |
Claude Agent SDK
    |
    | stdin/stdout (JSON-lines)
    |
Claude Code CLI subprocess
    |
    | HTTPS
    |
Claude API
```

Key considerations:
- Use WebSocket or SSE for real-time streaming from server to browser
- The SDK's `canUseTool` callback enables interactive approval flows
- Session management (`resume` option or V2 `resumeSession()`) enables persistent conversations
- The `includePartialMessages` option enables token-level streaming

---

## 6. Claude Code Channels: Telegram, Discord, and Custom Integrations

### What Are Channels?

Launched March 20, 2026, [Channels](https://code.claude.com/docs/en/channels) are a research preview feature that lets external messaging platforms push messages into a running Claude Code session. According to the [official documentation](https://code.claude.com/docs/en/channels):

> "A channel is an MCP server that pushes events into your running Claude Code session, so Claude can react to things that happen while you're not at the terminal."

### Supported Channels

| Channel | Setup | Two-Way |
|---------|-------|---------|
| **Telegram** | BotFather token + plugin install | Yes |
| **Discord** | Developer Portal bot + plugin install | Yes |
| **iMessage** | macOS only, reads Messages database | Yes |
| **fakechat** | Localhost demo, no auth needed | Yes |

### Architecture

Each channel is an MCP server plugin that:
1. Runs on the same machine as Claude Code as a subprocess
2. Communicates with Claude Code over stdio
3. Declares the `claude/channel` capability
4. Emits `notifications/claude/channel` events
5. Optionally exposes a `reply` tool for two-way communication

Messages arrive as `<channel>` tags in Claude's context:
```xml
<channel source="telegram" chat_id="12345" sender="user123">
What files are in this project?
</channel>
```

### Setting Up Telegram

From the [channels documentation](https://code.claude.com/docs/en/channels):

```bash
# In Claude Code:
/plugin install telegram@claude-plugins-official
/telegram:configure <bot-token>

# Restart with channels:
claude --channels plugin:telegram@claude-plugins-official

# Pair your account (in Telegram, DM the bot, get code):
/telegram:access pair <code>
/telegram:access policy allowlist
```

### Building Custom Channels

The [Channels reference](https://code.claude.com/docs/en/channels-reference) provides a complete guide for building custom channels. A minimal webhook receiver:

```typescript
#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const mcp = new Server(
  { name: 'webhook', version: '0.0.1' },
  {
    capabilities: { experimental: { 'claude/channel': {} } },
    instructions: 'Events arrive as <channel source="webhook">. Read and act.',
  },
)

await mcp.connect(new StdioServerTransport())

Bun.serve({
  port: 8788,
  hostname: '127.0.0.1',
  async fetch(req) {
    const body = await req.text()
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: body,
        meta: { path: new URL(req.url).pathname, method: req.method },
      },
    })
    return new Response('ok')
  },
})
```

For two-way channels, add a reply tool:
```typescript
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'reply',
    description: 'Send a message back over this channel',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['chat_id', 'text'],
    },
  }],
}))
```

### Permission Relay

Two-way channels can opt into **permission relay** -- forwarding tool approval prompts to the remote user. When Claude wants to run a command, the prompt appears both in the local terminal and on the remote platform (Telegram, Discord, etc.). The first response wins.

```typescript
capabilities: {
  experimental: {
    'claude/channel': {},
    'claude/channel/permission': {},  // opt in to permission relay
  },
}
```

### Channels vs. Agent SDK

Channels and the Agent SDK serve different use cases:

| Feature | Channels | Agent SDK |
|---------|----------|-----------|
| **Architecture** | Plugin to running Claude Code session | Standalone library |
| **Session** | Requires active Claude Code session | Creates its own sessions |
| **Auth** | Requires claude.ai login | API key based |
| **Use case** | Push events into existing sessions | Build custom applications |
| **Customization** | Limited to channel protocol | Full programmatic control |
| **Production** | Personal/dev use | Production deployment |

For building a production custom UI, the Agent SDK is the right choice. Channels are better for personal workflows where you want to interact with an already-running Claude Code session from your phone.

---

## 7. MCP Integration for Custom Tools

### In-Process MCP Servers

The Agent SDK supports creating custom tools that run in-process via MCP servers. According to the [custom tools documentation](https://platform.claude.com/docs/en/agent-sdk/custom-tools):

```typescript
import { tool, createSdkMcpServer, query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const getTemperature = tool(
  "get_temperature",
  "Get the current temperature at a location",
  { latitude: z.number(), longitude: z.number() },
  async (args) => {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?...`);
    const data = await response.json();
    return {
      content: [{ type: "text", text: `Temperature: ${data.current.temperature_2m}` }]
    };
  }
);

const weatherServer = createSdkMcpServer({
  name: "weather",
  tools: [getTemperature]
});

for await (const message of query({
  prompt: "What's the temperature in San Francisco?",
  options: {
    mcpServers: { weather: weatherServer },
    allowedTools: ["mcp__weather__get_temperature"]
  }
})) {
  // handle messages
}
```

### External MCP Servers

The SDK can connect to external MCP servers for databases, APIs, and more:

```typescript
options: {
  mcpServers: {
    github: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
    },
    postgres: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres", connectionString]
    }
  },
  allowedTools: ["mcp__github__*", "mcp__postgres__query"]
}
```

### MCP for Custom UI Tools

A powerful pattern for custom UIs is creating MCP tools that interact with your UI. For example, a custom tool could:
- Display rich content in a web UI
- Open a modal dialog for user input
- Show a preview panel with rendered HTML
- Stream data to a dashboard

This is exactly the pattern used by the AskUserQuestion Previews demo, which uses WebSocket round-trips between the SDK and a browser-based UI.

---

## 8. Hosting and Deployment

### Deployment Patterns

The [hosting documentation](https://platform.claude.com/docs/en/agent-sdk/hosting) describes four production patterns:

**Pattern 1: Ephemeral Sessions**
Create a new container per task, destroy when complete. Best for one-off tasks like bug fixing, invoice processing, or translation.

**Pattern 2: Long-Running Sessions**
Persistent containers for proactive agents. Best for email monitoring agents, site builders, or high-frequency chat bots.

**Pattern 3: Hybrid Sessions**
Ephemeral containers hydrated with history from a database or session resumption. Best for intermittent interactions like project management or deep research.

**Pattern 4: Single Containers**
Multiple Claude Agent SDK processes in one container. Best for agent simulations or collaborative agents.

### Sandbox Providers

The documentation lists several container providers:
- [Modal Sandbox](https://modal.com/docs/guide/sandbox)
- [Cloudflare Sandboxes](https://github.com/cloudflare/sandbox-sdk)
- [Daytona](https://www.daytona.io/)
- [E2B](https://e2b.dev/)
- [Fly Machines](https://fly.io/docs/machines/)
- [Vercel Sandbox](https://vercel.com/docs/functions/sandbox)

### System Requirements

Per SDK instance:
- **Runtime**: Python 3.10+ or Node.js 18+
- **Resources**: ~1GiB RAM, 5GiB disk, 1 CPU (recommended)
- **Network**: Outbound HTTPS to api.anthropic.com

### Cloud Provider Support

The SDK supports multiple API backends:
- **Direct Anthropic API**: `ANTHROPIC_API_KEY`
- **Amazon Bedrock**: `CLAUDE_CODE_USE_BEDROCK=1`
- **Google Vertex AI**: `CLAUDE_CODE_USE_VERTEX=1`
- **Microsoft Azure**: `CLAUDE_CODE_USE_FOUNDRY=1`

### Cost Considerations

From the [hosting docs](https://platform.claude.com/docs/en/agent-sdk/hosting): "The dominant cost of serving agents is the tokens; containers vary based on what you provision, but a minimum cost is roughly 5 cents per hour running."

Cost optimization strategies from the [AWS deep-dive](https://buildwithaws.substack.com/p/inside-the-claude-agent-sdk-from):
- **Prompt caching**: Tool definitions remain stable, ideal for caching
- **Model selection**: Haiku for classification, Sonnet for agents, Opus for complex reasoning
- **Hook-based monitoring**: Track per-conversation costs
- **Provisioned throughput** (Bedrock): Predictable monthly costs

---

## 9. Alternative Approaches

### Vercel AI SDK

The [Vercel AI SDK](https://ai-sdk.dev/docs/introduction) provides an alternative approach for building custom UIs with AI agents. Key features:

- **Provider agnostic**: Swap between Anthropic, OpenAI, Google with a single line
- **Streaming-first**: Real-time token streaming built in
- **React hooks**: `useChat` and `useCompletion` for frontend integration
- **AI RSC**: Server Components that stream AI-generated UI
- **Full MCP support**: Connect to MCP servers
- **Tool execution approval**: Built-in approval flows

The AI SDK is better suited when you want:
- Provider flexibility (not locked to Anthropic)
- React/Next.js-native integration
- Full control over the tool loop
- Simpler architecture (no subprocess)

However, the AI SDK does **not** provide Claude Code's built-in tools (Read, Edit, Bash, etc.) -- you must implement or connect those yourself.

### Raw Anthropic API

Using the [Anthropic Client SDK](https://www.npmjs.com/package/@anthropic-ai/sdk) directly gives maximum control but requires implementing the agent loop yourself:

```typescript
let response = await client.messages.create({ ...params });
while (response.stop_reason === "tool_use") {
  const result = yourToolExecutor(response.tool_use);
  response = await client.messages.create({ tool_result: result, ...params });
}
```

This approach is appropriate when:
- You need fine-grained control over every API call
- You have existing tool implementations
- You don't need Claude Code's built-in tools
- You want to minimize dependencies

### Comparison Matrix

| Feature | Agent SDK | Vercel AI SDK | Raw API |
|---------|-----------|---------------|---------|
| Built-in file tools | Yes | No | No |
| Built-in Bash | Yes | No | No |
| Agent loop | Automatic | Manual with helpers | Manual |
| Streaming | Yes | Yes | Yes |
| React hooks | No | Yes | No |
| Provider agnostic | No (Anthropic only) | Yes | No |
| MCP support | Yes | Yes | Manual |
| Subprocess required | Yes | No | No |
| Session management | Yes | Manual | Manual |

---

## 10. Open-Source Projects and Community

### Official Resources

- [claude-agent-sdk-demos](https://github.com/anthropics/claude-agent-sdk-demos) -- 8 demo projects including chat app, research agent, email agent
- [claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python) -- Official Python SDK
- [claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript) -- Official TypeScript SDK (inferred from npm)
- [claude-plugins-official](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins) -- Official channel plugins (Telegram, Discord, iMessage, fakechat)

### Community Projects

1. **[claude-code-telegram](https://github.com/RichardAtCT/claude-code-telegram)** -- A full-featured Telegram bot that provides remote access to Claude Code. Features include SDK and CLI mode, session persistence via SQLite, rate limiting, webhook authentication, and configurable verbosity levels.

2. **[OpenClaude](https://hindsight.vectorize.io/blog/2026/03/23/claude-code-telegram)** -- Combines Claude Code with Telegram and Hindsight memory for persistent AI assistance. Three-layer stack: Claude Code + Telegram Channel + Hindsight memory engine with semantic recall across sessions.

3. **[claude-code-openai-wrapper](https://github.com/RichardAtCT/claude-code-openai-wrapper)** -- OpenAI API-compatible wrapper for Claude Code, enabling use with existing OpenAI-compatible clients.

4. **[open-claude-code](https://github.com/ruvnet/open-claude-code)** -- Ground-up open source rebuild of Claude Code CLI architecture with 25 tools, 4 MCP transports, 6 permission modes, hooks, and sessions.

5. **[awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)** -- Curated list of skills, hooks, slash-commands, agent orchestrators, applications, and plugins for Claude Code.

6. **[collection-claude-code-source-code](https://github.com/chauncygu/collection-claude-code-source-code)** -- Collection of Claude Code open source implementations.

7. **[claude-code-sdk multi-language](https://github.com/SeifBenayed/claude-code-sdk)** -- Single-file CLI implementations in Node.js, Python, Go, and Rust.

### Ecosystem Maturity

The ecosystem is rapidly expanding. The [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) repository catalogs skills, hooks, and integrations. The official demos repository shows a clear path from "hello world" to production-ready agents with custom UIs. The community has built wrappers in Go, Elixir, Swift, and Rust, demonstrating the subprocess protocol's language-agnostic nature.

---

## 11. Conclusion

### Key Takeaways

1. **The Claude Agent SDK is the primary path for custom UIs.** It provides programmatic access to Claude Code's full capabilities -- file editing, command execution, web search, MCP tools -- through a clean async generator API in TypeScript and Python.

2. **The subprocess architecture is a feature, not a limitation.** By communicating with a bundled CLI via JSON-lines over stdin/stdout, the SDK benefits from automatic updates to the agent execution engine without requiring application changes.

3. **Multiple integration patterns exist for different use cases:**
   - **Agent SDK** for production custom applications (web UIs, bots, APIs)
   - **Channels** for personal messaging integration (Telegram, Discord, iMessage)
   - **Vercel AI SDK** for provider-agnostic React/Next.js applications
   - **Raw API** for maximum control with custom tool implementations

4. **The V2 session API simplifies multi-turn UIs.** The preview `send()`/`stream()` pattern eliminates async generator coordination, making chat interfaces more natural to implement.

5. **Streaming is essential for good UX.** The `includePartialMessages` option enables token-level streaming with distinct event types for text and tool calls, allowing UIs to show progress during multi-step agent tasks.

6. **The Channel system provides a blueprint for messaging integrations.** Even if you use the Agent SDK directly, the official Telegram/Discord plugins demonstrate patterns for authentication, sender gating, permission relay, and two-way communication that are applicable to any messaging integration.

7. **The ecosystem is maturing rapidly.** With official demo projects, community wrappers in 6+ languages, and a growing collection of open-source integrations, there is substantial prior art to draw from when building custom UIs.

### Recommendations for Implementation

For the umwelten project's Telegram/Discord bot integration:

- **Use the Claude Agent SDK directly** rather than Channels, since you need API key authentication and production deployment
- **Implement the V1 `query()` API** with `includePartialMessages: true` for streaming
- **Use `canUseTool` callback** to route approval requests back to the messaging platform
- **Leverage sessions** (`resume` option) for multi-turn conversations
- **Consider custom MCP tools** for domain-specific operations
- **Evaluate the V2 API** when it stabilizes for simpler multi-turn patterns

---

## 12. References

1. [Agent SDK Overview - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/overview) -- Official SDK documentation with capabilities, installation, and comparison to other Claude tools.

2. [Building Agents with the Claude Agent SDK - Anthropic Engineering](https://claude.com/blog/building-agents-with-the-claude-agent-sdk) -- Published January 28, 2026. Design principles, agent loop framework, context management, and use case examples.

3. [Inside the Claude Agent SDK: From stdin/stdout Communication to Production on AWS AgentCore](https://buildwithaws.substack.com/p/inside-the-claude-agent-sdk-from) -- Detailed architectural analysis of the subprocess protocol, JSON message format, transport layer, and production deployment patterns.

4. [Agent SDK Quickstart - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/quickstart) -- Step-by-step guide to building a bug-fixing agent with code examples in TypeScript and Python.

5. [Agent SDK Reference - TypeScript - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/typescript) -- Complete TypeScript API reference including query(), tool(), message types, options, and session management.

6. [TypeScript SDK V2 Interface (Preview) - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) -- V2 session-based send/stream patterns for simplified multi-turn conversations.

7. [Stream Responses in Real-Time - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/streaming-output) -- StreamEvent reference, message flow, text streaming, tool call streaming, and building streaming UIs.

8. [Handle Approvals and User Input - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/user-input) -- canUseTool callback, AskUserQuestion tool, HTML previews, and interactive approval flows.

9. [Hosting the Agent SDK - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/hosting) -- Deployment patterns (ephemeral, long-running, hybrid), sandbox providers, system requirements, and production considerations.

10. [Connect to External Tools with MCP - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/mcp) -- MCP server configuration, transport types, tool naming, authentication, and error handling.

11. [Give Claude Custom Tools - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/custom-tools) -- In-process MCP server creation, tool definitions, annotations, error handling, and image/resource returns.

12. [Push Events into a Running Session with Channels - Claude Code Docs](https://code.claude.com/docs/en/channels) -- Telegram, Discord, iMessage channel setup, security model, enterprise controls, and comparison to other features.

13. [Channels Reference - Claude Code Docs](https://code.claude.com/docs/en/channels-reference) -- Complete technical reference for building custom channels: capability declaration, notification format, reply tools, sender gating, permission relay, and webhook receiver example.

14. [Claude Agent SDK Demos - GitHub](https://github.com/anthropics/claude-agent-sdk-demos) -- 8 demo projects: simple chat app, research agent, email agent, AskUserQuestion previews, and more.

15. [Claude Code Telegram Bot - GitHub](https://github.com/RichardAtCT/claude-code-telegram) -- Community Telegram bot with SDK/CLI modes, session persistence, rate limiting, and webhook support.

16. [OpenClaude: Build a Claude Code Agent with Long-Term Memory - Hindsight](https://hindsight.vectorize.io/blog/2026/03/23/claude-code-telegram) -- Claude Code + Telegram + Hindsight memory integration for persistent AI assistance.

17. [Claude Code SDK Python Architecture - DeepWiki](https://deepwiki.com/anthropics/claude-code-sdk-python/1-overview) -- Architectural analysis of the Python SDK: three-tier design, subprocess management, message types, and configuration.

18. [Vercel AI SDK Documentation](https://ai-sdk.dev/docs/introduction) -- Alternative framework for building AI applications with provider-agnostic design, React hooks, and streaming support.
