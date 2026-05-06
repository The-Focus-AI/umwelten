---
title: "Implementing A2A: How A2A, MCP, Tools, and Skills Compose"
date: 2026-05-04
topic: a2a-mcp-skills-implementation
recommendation: A2A v1.0 (outer agent-to-agent protocol) layered with MCP (inner tool/resource protocol)
version_researched: A2A v1.0 (March 2026), JS SDK 0.3.13, MCP (current production)
use_when:
  - Building agents that other agents (or external orchestrators) need to call as opaque services
  - You need persistent task state, contexts, artifacts, and streaming across multi-turn delegations
  - You want a public storefront for agent capabilities (skills) discoverable via a well-known URL
  - You're integrating with Google ADK, LangGraph, CrewAI, Semantic Kernel, AutoGen, Azure AI Foundry, or Bedrock AgentCore [1][2]
avoid_when:
  - You only need to expose tools to a single agent runtime (Claude Desktop, Cursor, ChatGPT) — use MCP alone [3]
  - The "multi-agent system" lives entirely in-process inside one orchestrator (LangGraph, CrewAI) — protocol overhead has no payoff
  - You need consumer-side adoption — only Google's own tooling speaks A2A natively today; everything else uses MCP [3][4]
  - Sub-second, high-throughput, low-overhead RPC — A2A's task/event model adds latency vs. plain gRPC
project_context:
  language: TypeScript / Python / Java / Go / .NET (five official SDKs)
  relevant_dependencies: "@a2a-js/sdk, express, @modelcontextprotocol/sdk, genkit, google-adk, langgraph, crewai"
---

## Summary

The Agent2Agent (A2A) protocol is an open standard, governed by the Linux Foundation's Agentic AI Foundation since mid-2025, that defines how autonomous agents discover, delegate work to, and stream results from each other over HTTP — with persistent task state, conversational contexts, and typed artifacts as first-class concepts [1][2][5]. As of April 9, 2026, A2A v1.0 has 150+ supporting organizations (AWS, Cisco, Google, IBM, Microsoft, Salesforce, SAP, ServiceNow), 22,000+ GitHub stars on the core repo (23.6k on the spec repo as of this writing), and five production-ready SDKs covering Python, JavaScript, Java, Go, and .NET [1][2][5]. Native A2A integrations now exist in Google ADK, LangGraph, CrewAI, LlamaIndex Agents, Semantic Kernel, AutoGen, Azure AI Foundry, Copilot Studio, and Amazon Bedrock AgentCore Runtime [2].

A2A is **not** a replacement for Anthropic's Model Context Protocol (MCP) — the two are explicitly complementary and most production multi-agent systems use both. Per the A2A project's own guidance: "MCP defines how an AI agent interacts with and utilizes individual tools and resources… The Agent2Agent Protocol focuses on enabling different agents to collaborate with one another to achieve a common goal" [6]. MCP itself crossed 97 million monthly SDK downloads, 81,000+ GitHub stars, and is supported by Anthropic, OpenAI, Google, Microsoft, and AWS as of March 2026 [4]. Google adopted MCP across its services in December 2025, including managed MCP servers for Maps, BigQuery, Compute Engine, and GKE [4]. A joint MCP/A2A interoperability spec is on the Q3 2026 roadmap [4].

This report walks through implementation: the four-layer mental model (Doctrine → Agent → Skills → MCP), how to build an A2A server that delegates tool calls to MCP servers, how skills, agent cards, and tools relate, how authentication and user identity flow through both protocols, and where deployment-level metadata belongs (hint: not in the agent card).

## Philosophy & Mental Model

The core insight: **A2A and MCP solve different problems at different layers of the stack**, so a real system needs both.

```
┌─────────────────────────────────────────────────────────┐
│  Caller (human, agent, or orchestrator)                 │
│            │                                            │
│            ▼  A2A: discovery + task delegation          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  A2A Agent  ("Movie Recommender")                │   │
│  │  AgentCard.skills = [general_movie_chat, ...]    │   │
│  │  ┌────────────────────────────────────────────┐  │   │
│  │  │  LLM + Reasoning  (Genkit / ADK / etc.)    │  │   │
│  │  │      │                                     │  │   │
│  │  │      ▼  MCP: function calls                │  │   │
│  │  │  ┌──────────────────────────────────────┐  │  │   │
│  │  │  │  MCP Servers / Tools                 │  │  │   │
│  │  │  │  searchMovies(), searchPeople(), ... │  │  │   │
│  │  │  └──────────────────────────────────────┘  │  │   │
│  │  └────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

Several independent sources converge on the same composition pattern. The A2A project itself states: *"An agentic application might primarily use A2A to communicate with other agents. Each individual agent internally uses MCP to interact with its specific tools and resources"* [6]. AWS frames it as a microservices model where *"agents function as decoupled, service-like components"* with specialized agents wrapped as MCP servers and orchestrating agents using MCP clients to invoke remote agents as tools [7]. A four-layer architecture model independently proposes: Doctrine (judgment criteria) → Agent (orchestration: what should be done) → Skills (knowledge: how it should be done) → MCP (connectivity: how to reach external resources) [8].

The shorthand: **MCP = using hands (tools); A2A = collaborating with others (agents)** [8]. Or, more precisely:

| Concept | Granularity | Audience | Schema | Stateful? | Protocol |
|---|---|---|---|---|---|
| **Skill** | Coarse (a domain) | Humans, orchestrators | Optional (v1.0 added inputSchema) | No | A2A AgentCard |
| **Task** | Medium (a job) | Other agents | Loose (parts: text/file/data) | Yes (taskId, contextId, history) | A2A messages |
| **Tool** | Fine (one operation) | The LLM inside the agent | Strict JSON Schema | No | MCP |

Skills define *what kind of work* an agent does. Tasks are *units of delegated work*. Tools are *operations the agent uses internally* to fulfill tasks. The caller never sees tools; the LLM never sees A2A; each layer hides the one below.

A practical consequence: a single agent is typically an **A2A server** (receives delegations from other agents) and an **MCP client** (invokes tools to do its work). It can also be an **MCP server** if you want its skills callable as tools by a higher-level agent. AWS's recommended pattern explicitly does this — wrap specialized agents as MCP servers, then have orchestrators consume them [7].

## Setup

This guide uses the JavaScript SDK [(`@a2a-js/sdk`)](https://github.com/a2aproject/a2a-js); the Python SDK [(`a2a-sdk`)](https://github.com/a2aproject/a2a-python) follows the same conceptual model.

### Install

```bash
# A2A server SDK + Express (peer dep)
npm install @a2a-js/sdk express

# Optional gRPC transport
npm install @grpc/grpc-js @bufbuild/protobuf

# MCP client SDK (for consuming MCP tools inside the agent)
npm install @modelcontextprotocol/sdk

# LLM/orchestration layer (optional — pick your framework)
npm install genkit @genkit-ai/googleai
```

### Minimal A2A server (no MCP yet)

```typescript
// server.ts
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AgentCard, AGENT_CARD_PATH, Message } from '@a2a-js/sdk';
import {
  AgentExecutor, RequestContext, ExecutionEventBus,
  DefaultRequestHandler, InMemoryTaskStore,
} from '@a2a-js/sdk/server';
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express';

const card: AgentCard = {
  name: 'Hello Agent',
  description: 'A minimal A2A agent.',
  protocolVersion: '0.3.0',
  version: '0.1.0',
  url: 'http://localhost:4000/',
  capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [{
    id: 'chat',
    name: 'Chat',
    description: 'Have a conversation',
    tags: ['chat'],
    examples: ['hello', 'how are you'],
  }],
};

class HelloExecutor implements AgentExecutor {
  async execute(ctx: RequestContext, bus: ExecutionEventBus) {
    const reply: Message = {
      kind: 'message',
      messageId: uuidv4(),
      role: 'agent',
      parts: [{ kind: 'text', text: 'Hello, world!' }],
      contextId: ctx.contextId,
    };
    bus.publish(reply);
    bus.finished();
  }
  cancelTask = async () => {};
}

const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), new HelloExecutor());
const app = express();
app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: handler }));
app.use(jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
app.listen(4000);
```

That gives you a discoverable agent at `http://localhost:4000/.well-known/agent-card.json` with a JSON-RPC endpoint. To add MCP-backed tools, wire an MCP client inside the executor (Pattern 3 below).

## Core Usage Patterns

### Pattern 1: Define a richer Agent Card (the public storefront)

The agent card is the contract — `skills`, `capabilities`, `securitySchemes`, transports, and metadata. Per the v1.0 spec, an `AgentSkill` may now carry `inputSchema` / `outputSchema` for stricter typing alongside the older `examples` field [9].

```typescript
const card: AgentCard = {
  name: 'Movie Concierge',
  description: 'Recommends and explains films using TMDB.',
  protocolVersion: '0.3.0',
  version: '1.0.0',
  url: 'https://movies.example.com/a2a/jsonrpc',
  provider: { organization: 'Example Co', url: 'https://example.com' },
  documentationUrl: 'https://movies.example.com/docs',

  capabilities: {
    streaming: true,
    pushNotifications: true,
    stateTransitionHistory: true,
    extensions: [
      { uri: 'https://example.com/ext/dependencies/v1' }, // custom dep declaration
    ],
  },

  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'application/json'],

  skills: [
    {
      id: 'recommend_movies',
      name: 'Recommend Movies',
      description: 'Suggest films based on mood, genre, or reference titles.',
      tags: ['movies', 'recommendations'],
      examples: ['recommend a sci-fi like Blade Runner', 'something for a kid'],
      inputModes: ['text'],
      outputModes: ['text', 'application/json'],
    },
    {
      id: 'lookup_credits',
      name: 'Lookup Credits',
      description: 'Find cast/crew for a film.',
      tags: ['movies', 'credits'],
      examples: ['who directed Arrival?'],
    },
  ],

  additionalInterfaces: [
    { url: 'https://movies.example.com/a2a/jsonrpc', transport: 'JSONRPC' },
    { url: 'https://movies.example.com/a2a/rest',    transport: 'HTTP+JSON' },
    { url: 'movies.example.com:4001',                transport: 'GRPC' },
  ],

  securitySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  },
  security: [{ bearerAuth: [] }],

  supportsAuthenticatedExtendedCard: true,
};
```

### Pattern 2: Skills define *what*; the executor decides *how*

Unlike MCP tools, A2A skills are **not directly callable**. The client sends a `Message`; the executor inspects content and routes internally. Skills exist for discovery and trust, not invocation [6][9].

```typescript
class MovieExecutor implements AgentExecutor {
  async execute(ctx: RequestContext, bus: ExecutionEventBus) {
    const text = ctx.userMessage.parts.find(p => p.kind === 'text')?.text ?? '';

    // The agent — not the protocol — decides which skill applies.
    if (/director|cast|who.+(directed|starred)/i.test(text)) {
      return this.runLookupCredits(ctx, bus, text);
    }
    return this.runRecommendMovies(ctx, bus, text);
  }
  cancelTask = async () => {};
}
```

### Pattern 3: Compose A2A outside, MCP inside

This is the canonical production pattern [6][7]. The A2A executor opens MCP client connections at startup; per request, the LLM picks tools, the executor invokes them via MCP, the LLM composes a response, the executor publishes it as an artifact.

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { genkit } from 'genkit';
import { gemini15Flash } from '@genkit-ai/googleai';

// 1. Connect to MCP servers — these are the agent's "tools."
const tmdbMcp = new Client({ name: 'movie-agent', version: '1.0.0' });
await tmdbMcp.connect(new StdioClientTransport({ command: 'tmdb-mcp-server' }));
const mcpTools = await tmdbMcp.listTools();

// 2. Wire those tool definitions into your LLM framework.
const ai = genkit({ plugins: [/* gemini provider */] });
const llmTools = mcpTools.tools.map(t => ai.defineTool(
  { name: t.name, description: t.description, inputSchema: t.inputSchema },
  async (args) => (await tmdbMcp.callTool({ name: t.name, arguments: args })).content,
));

// 3. The A2A executor uses the LLM, which uses MCP tools.
class MovieExecutor implements AgentExecutor {
  async execute(ctx: RequestContext, bus: ExecutionEventBus) {
    const { taskId, contextId, userMessage, task } = ctx;

    if (!task) bus.publish({
      kind: 'task', id: taskId, contextId,
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [userMessage],
    });

    bus.publish({
      kind: 'status-update', taskId, contextId,
      status: { state: 'working', timestamp: new Date().toISOString() }, final: false,
    });

    const result = await ai.generate({
      model: gemini15Flash,
      prompt: userMessage.parts.find(p => p.kind === 'text')?.text ?? '',
      tools: llmTools,
      messages: task?.history ?? [],
    });

    bus.publish({
      kind: 'artifact-update', taskId, contextId,
      artifact: {
        artifactId: uuidv4(),
        name: 'recommendation',
        parts: [{ kind: 'text', text: result.text }],
      },
      lastChunk: true,
    });

    bus.publish({
      kind: 'status-update', taskId, contextId,
      status: { state: 'completed', timestamp: new Date().toISOString() }, final: true,
    });
    bus.finished();
  }
  cancelTask = async () => {};
}
```

### Pattern 4: Stream events instead of buffering

The same executor produces events; the transport decides whether to buffer (`message/send`) or flush (`message/stream`). Long-running tasks should stream.

```typescript
// On the client side:
const stream = client.sendMessageStream({ message: { ... } });
for await (const event of stream) {
  if (event.kind === 'task')           console.log('task started:', event.id);
  else if (event.kind === 'status-update')   console.log('status:', event.status.state);
  else if (event.kind === 'artifact-update') console.log('artifact:', event.artifact.parts);
}
```

### Pattern 5: Push notifications for very long-running tasks

When a client can't hold a connection (mobile, serverless), declare `pushNotifications: true` in the card. The client passes a webhook URL + token; the server POSTs task updates as they happen.

```typescript
// Client request
await client.sendMessage({
  message: { ... },
  configuration: {
    pushNotificationConfig: {
      url: 'https://my-app.example.com/hooks/task-updates',
      token: signedToken,
    },
  },
});

// Webhook
app.post('/hooks/task-updates', (req, res) => {
  if (req.headers['x-a2a-notification-token'] !== expectedToken) return res.sendStatus(401);
  const task = req.body;
  // ... process task.status, task.artifacts
  res.sendStatus(200);
});
```

## Anti-Patterns & Pitfalls

### Don't: Make the A2A skill list a literal list of tool calls

```typescript
// BAD — leaks implementation details
skills: [
  { id: 'searchMovies', name: 'searchMovies(query)', description: 'TMDB /search/movie' },
  { id: 'getMovieDetails', name: 'getMovieDetails(id)', description: 'TMDB /movie/{id}' },
],
```

**Why it's wrong:** Skills are coarse capability advertisements for *humans/orchestrators choosing which agent to engage*. Mirroring MCP tool names breaks the encapsulation — callers shouldn't need to know that the agent uses TMDB, that it has two tools, or in what order to call them. You also lose the freedom to swap the underlying tools or LLM later [6][9].

### Instead: Describe outcomes

```typescript
skills: [{
  id: 'movie_concierge',
  name: 'Movie concierge',
  description: 'Answer movie questions, recommend films, and explain credits.',
  examples: ['recommend a sci-fi for someone who liked Arrival',
             'who directed The Matrix?'],
}]
```

### Don't: Stuff conversational memory in `task.history` only

```typescript
// BAD — every reply ends with final: true, so the next prompt creates a new task
bus.publish({ kind: 'status-update', /*...*/, final: true });
```

**Why it's wrong:** A2A's `DefaultRequestHandler` only loads a prior `Task` if the incoming message carries a `taskId` — and once a task is terminal (`completed`/`failed`/`canceled`), it can't be resumed. Reusing the `contextId` alone does **not** automatically pull cross-task history into `requestContext.task` [9]. Many sample executors ship this way and feel amnesic in real chat sessions.

### Instead: Maintain context-keyed memory in the executor

```typescript
class MovieExecutor implements AgentExecutor {
  private memory = new Map<string, Message[]>();
  async execute(ctx: RequestContext, bus: ExecutionEventBus) {
    const prior = this.memory.get(ctx.contextId) ?? [];
    const reply = await this.llmCall([...prior, ctx.userMessage]);
    this.memory.set(ctx.contextId, [...prior, ctx.userMessage, reply]);
    // ... publish events
  }
}
```

Or implement a custom `TaskStore` that indexes by `contextId` and merges histories. Genkit / ADK / LangGraph do this for you.

### Don't: Treat A2A as a synchronous RPC

```typescript
// BAD — assumes immediate, single-shot result
const reply = await client.sendMessage({ message });
console.log(reply.parts[0].text);  // may not exist; reply could be a Task
```

**Why it's wrong:** A2A `sendMessage` may return either a `Message` (immediate) or a `Task` (in-progress, possibly with `input-required` status awaiting user input). Treating every response as a `Message` will crash on long-running or multi-turn skills.

### Instead: Branch on `kind`

```typescript
const result = await client.sendMessage({ message });
if (result.kind === 'message') { /* immediate reply */ }
else if (result.kind === 'task') {
  if (result.status.state === 'input-required') { /* prompt user */ }
  else { /* read artifacts, possibly poll tasks/get */ }
}
```

### Don't: Put deployment configuration in the agent card

```typescript
// BAD
const card = {
  // ...
  metadata: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    requiredCpu: '2 cores',
    secrets: ['TMDB_API_KEY', 'GEMINI_API_KEY'],
  },
};
```

**Why it's wrong:** The agent card is the **public contract**. Anything in it is fetched by any client doing discovery. Deployment metadata (infra deps, secrets, CPU/memory, scaling policies) belongs in your deployment manifest (Helm chart, Terraform, ECS task def, Vercel config) — not on the wire.

### Instead: Two-manifest model

- **Deployment manifest** (private, controls what the agent needs to *run*): infra deps, secrets, MCP servers to launch, env vars, scaling.
- **Agent card** (public, declares what the agent *does*): skills, capabilities, transports, security schemes, and — via a custom extension if needed — references to *other A2A agents/MCP services* it consumes at runtime.

(Expanded in §"Deployment Metadata vs. Agent Card" below.)

## Why This Choice

### Decision Criteria

| Criterion | Weight | How A2A+MCP Scored |
|---|---|---|
| Agent-to-agent interop across vendors | High | Excellent — 150+ orgs, Linux Foundation governance, native support in major clouds and frameworks [1][2] |
| Tool integration into the agent | High | Excellent via MCP — 97M monthly downloads, every major AI vendor supports it [4] |
| Statefulness (tasks, contexts, artifacts) | High | First-class in A2A — taskId, contextId, history, artifacts are spec-level concepts [9] |
| Streaming & long-running tasks | High | Native (SSE, push notifications); same executor handles blocking and streaming [9] |
| Multi-language SDKs | Medium | Five official SDKs (Python, JS, Java, Go, .NET) [5] |
| Authentication standards | Medium | OpenAPI-style `securitySchemes`; signed agent cards in v1.0 [9] |
| Consumer/IDE adoption | Low (for A2A) | Weak — only Google's own tools speak A2A; everyone else is MCP-only [3][4] |
| Operational overhead | Low | Higher than plain REST; justified for stateful, opaque-agent use cases |

### Key Factors

- **Layer separation:** Skills (advertisement), tasks (delegation), tools (operation) live at three different layers and shouldn't be conflated. Conflating them produces brittle, leaky abstractions.
- **Stateful delegation:** Multi-turn conversations and long-running work need persistence beyond a single HTTP exchange. A2A's `taskId`/`contextId`/artifact model gives you that without inventing your own.
- **Vendor neutrality:** A2A is Linux Foundation-governed [1]; MCP is open-spec; both are framework-agnostic. Avoids the lock-in problem AWS warns about: *"without standardized communication, we're just building a new type of data silo"* [10].
- **Composability:** A single agent can be an A2A server, an A2A client (calling other agents), an MCP client (using tools), and an MCP server (exposing skills as tools to a higher-level agent). The protocols don't conflict.

## Alternatives Considered

### MCP alone (skip A2A)

- **What it is:** Use MCP for everything — agents expose themselves as MCP servers; orchestrators call them as if they were tools. AWS demonstrates this pattern [7].
- **Why not chosen (for our scope):** Loses A2A's stateful task model, structured task lifecycle, and skill-level discovery. MCP is stateless function calling; A2A explicitly handles long-running, multi-turn delegations with cancellation, push notifications, and history.
- **Choose this instead when:**
  - Your agents truly are stateless and can be modeled as functions
  - You want maximum consumer/IDE reach (Claude Desktop, Cursor, etc.)
  - You don't need streaming task updates or webhooks
- **Key tradeoff:** Lose A2A's stateful semantics and skill-level abstraction; gain massive ecosystem adoption.

### ACP (IBM's Agent Communication Protocol)

- **What it is:** IBM's BeeAI-ecosystem A2A-equivalent, optimized for natural language interaction and human-agent messaging [3].
- **Why not chosen:** Smaller ecosystem; primarily relevant inside the BeeAI platform; not yet broadly adopted outside IBM stacks.
- **Choose this instead when:** Building inside BeeAI, or you specifically need ACP's multimodal human-in-the-loop messaging primitives.
- **Key tradeoff:** Tighter integration with BeeAI; weaker cross-vendor adoption than A2A.

### LangGraph / CrewAI / AutoGen in-process orchestration

- **What it is:** Multi-agent systems modeled as a graph or crew within one Python/JS process. No wire protocol — agents are objects.
- **Why not chosen:** Doesn't address cross-org or cross-process delegation. Once you cross a service boundary, you need a wire protocol — and these frameworks themselves now expose A2A on the boundary [2].
- **Choose this instead when:** All your agents live in one process and there is no boundary to cross.
- **Key tradeoff:** Simpler in-process; no interoperability story across services.

### Custom REST + OpenAPI

- **What it is:** Just expose REST endpoints and document them with OpenAPI. Many "multi-agent" systems are this.
- **Why not chosen:** No standard for streaming, no standard for tasks/contexts/artifacts, no agent-discovery convention, no shared SDKs. You'd reinvent A2A poorly.
- **Choose this instead when:** Your service isn't really an agent — it's a normal API and you don't want any of A2A's semantics.
- **Key tradeoff:** Maximum control and minimum dependencies; lose the entire ecosystem.

## User Identity & Authentication Model

This is one of the most important — and most under-documented — parts of running A2A in production. Three concerns to keep separate:

### 1. How the agent authenticates incoming callers

A2A's agent card uses OpenAPI-shape **`securitySchemes`** to declare what's required. Common schemes [9]:

```typescript
securitySchemes: {
  bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  oauth2:     { type: 'oauth2', flows: { /* authorizationCode, clientCredentials, etc. */ } },
  apiKey:     { type: 'apiKey', in: 'header', name: 'X-API-Key' },
  mtls:       { type: 'mutualTLS' },
},
security: [{ bearerAuth: [] }],
```

The card itself is **typically served unauthenticated** so discovery works. Sensitive details (extra skills, internal endpoints) hide behind `supportsAuthenticatedExtendedCard: true` — fetch the basic card anonymously, authenticate, then fetch a richer card.

### 2. How the server validates and propagates the user

In the JS SDK, validation is **transport-level middleware**, not protocol-level. Pattern from the bundled `authentication` sample:

```typescript
// 1. Express middleware validates the token before A2A sees the request
app.use(passport.authenticate('jwt', { session: false }));

// 2. UserBuilder converts req.user into a typed CustomUser for the executor
const myUserBuilder: UserBuilder = (req) => new CustomUser({
  email:    req.user.email,
  userName: req.user.userName,
  role:     req.user.role,
});

// 3. Wire it into the JSON-RPC handler
app.use(jsonRpcHandler({ requestHandler, userBuilder: myUserBuilder }));

// 4. Executor reads requestContext.context.user
class AuthAwareExecutor implements AgentExecutor {
  async execute(ctx: RequestContext, bus: ExecutionEventBus) {
    const user = ctx.context?.user;          // CustomUser | UnauthenticatedUser
    if (!user?.isAuthenticated) {
      return bus.publish({ kind: 'message', role: 'agent',
        parts: [{ kind: 'text', text: 'Unauthorized' }],
        contextId: ctx.contextId, messageId: uuidv4() });
    }
    // ... use user.role, user.email for authorization decisions
  }
}
```

The protocol gives you the *slot* (`requestContext.context.user`); your code decides what authorization means. JWT is the common case; OAuth2, mTLS, and Google ADC (`ADCHandler` in the JS CLI) are also supported.

### 3. How the agent passes user identity to MCP / sub-agents

This is where things get architecturally interesting. Three patterns, in increasing sophistication:

**(a) Service-to-service identity (no end-user passthrough)** — the simplest. The agent has its own service account / token; MCP servers and downstream A2A agents authenticate the **agent itself**, not the original user. Quotas and audit logs are at the agent level.

```typescript
const tmdbMcp = new Client({ name: 'movie-agent', version: '1.0.0' });
await tmdbMcp.connect(new StdioClientTransport({
  command: 'tmdb-mcp-server',
  env: { TMDB_API_KEY: process.env.TMDB_API_KEY },  // service-level secret
}));
```

**(b) On-behalf-of (OBO) token exchange** — the agent receives a user token and exchanges it for a downstream token (RFC 8693 token exchange, OAuth2 OBO flow). The MCP server / downstream agent sees the *user*, not the calling agent. Required for any user-data tooling (Gmail, Drive, etc.).

```typescript
// Pseudo-code — implementation varies by IdP
const downstreamToken = await idp.exchangeToken({
  subject_token: ctx.context.user.rawToken,
  audience: 'tmdb-mcp-server',
});
// Pass downstreamToken to the MCP transport's auth header
```

**(c) Federated identity / signed agent cards** — A2A v1.0 introduces signed agent cards [2][5]. An agent presenting a token can be cryptographically verified as the agent it claims to be. Combined with OBO, you get end-to-end provenance: "this request to MCP is on behalf of user Alice, mediated by agent Movie Concierge, signed by domain example.com."

For now, most implementations do (a). (b) is needed as soon as user-scoped data is involved. (c) is roadmap territory and where the joint MCP/A2A interoperability spec (planned Q3 2026 [4]) will likely formalize things.

### 4. Push-notification webhook auth (the reverse direction)

When the **server** calls back to a **client-provided webhook**, direction reverses:

```typescript
configuration: {
  pushNotificationConfig: {
    url: 'https://my-app.example.com/hooks/task-updates',
    token: signedToken,        // client → agent → webhook
  },
},
```

The agent includes the token in `X-A2A-Notification-Token` (configurable) when POSTing the update. The webhook validates. The protocol stays out of *how* you mint or validate the token — that's between client and webhook owner.

## Deployment Metadata vs. Agent Card

Two-manifest model. **The agent card is the public contract; the deployment manifest is private infrastructure metadata.** Confusing them is the most common modeling mistake teams make.

### What belongs in the agent card (public, on-the-wire)

| Field | Purpose |
|---|---|
| `name`, `description`, `version`, `protocolVersion` | Identity |
| `provider` | Operator info |
| `documentationUrl`, `iconUrl` | Branding |
| `url`, `additionalInterfaces`, `preferredTransport` | Endpoints |
| `capabilities` (streaming, push, history, extensions) | Protocol-level features |
| `skills` | Coarse capability advertisements |
| `defaultInputModes` / `defaultOutputModes` | Content-type negotiation |
| `securitySchemes`, `security` | Auth requirements |
| `signature` | Cryptographic provenance (v1.0+) [2] |
| `supportsAuthenticatedExtendedCard` | "Auth me, then I'll show more" |

### What belongs in the deployment manifest (private)

| Field | Purpose |
|---|---|
| Container image / runtime version | What to run |
| CPU / memory / GPU / scaling policy | How to size it |
| Required env vars / secrets | Secret injection |
| MCP servers to launch + their config | Tool-layer dependencies |
| Other A2A agents this depends on (URLs, expected versions) | Agent-graph dependencies |
| Database / cache / queue connection strings | Infra dependencies |
| Health-check / liveness probes | Lifecycle |
| Observability config (metrics, tracing endpoints) | Ops |
| Region / network policies | Placement |
| Identity / IAM bindings | Service identity |

A `deployment.yaml` (or Helm `values.yaml`, Terraform module, ECS task def, Vercel config — whatever fits your stack) sits next to the source. CI deploys the agent using that manifest. The manifest is **never served**; it's not part of the protocol.

### Bridging the two: dependency declarations *some* clients want to see

There's a real need to publish: *"this agent calls these other A2A agents and these MCP servers"* — for orchestrators doing capacity planning, security review, or auto-wiring. A2A v1.0 has no first-class `dependsOn` field, but there are three workable patterns:

**(1) Agent Card extension (recommended for cross-agent/cross-tool dependencies that callers need to know about)**

```typescript
// In the card
capabilities: {
  extensions: [{
    uri: 'https://your-org.example.com/ext/dependencies/v1',
    description: 'Declares downstream A2A agents and MCP servers consumed at runtime',
  }],
},

// And for dependency *data*, attach it via an extension-defined metadata block.
// Define the schema once and document it at the URI above.
```

The card stays spec-compliant; clients aware of your extension URI get a structured answer. This is the right home for "if you call me, I'll call these other agents on your behalf — here are their public URLs."

**(2) Open `metadata` blob (for ad-hoc or org-internal use)**

Every spec object has a `metadata: Record<string, any>` field. Drop a JSON blob there for orchestrators that know your conventions. Less discoverable, trivially supported.

**(3) Out-of-band manifest (for true infra dependencies)**

For "what infra/secrets/databases does this need to *run*," keep it out of the card entirely. The deployment manifest is the source of truth. Platforms like Vertex AI Agent Engine, Bedrock AgentCore Runtime, and Azure AI Foundry already define their own deployment-config schemas [2] — emit those alongside the card.

### Recommended workflow

```
        (build time)                          (runtime)

┌─────────────────────────┐    ┌──────────────────────────────┐
│  agent.deployment.yaml  │    │   .well-known/agent-card.json │
│  - image: foo:1.2       │    │   - name, version             │
│  - cpu: 2               │    │   - skills                    │
│  - secrets:             │    │   - capabilities              │
│      TMDB_API_KEY       │    │   - securitySchemes           │
│      GEMINI_API_KEY     │    │   - additionalInterfaces      │
│  - mcp:                 │    │   - extensions:               │
│      tmdb-mcp:          │    │       dependencies/v1 →       │
│        image: ...       │───▶│         lists *public* URLs   │
│  - dependsOn:           │    │         of downstream agents  │
│      reviews-agent.url  │    │                               │
└─────────────────────────┘    └──────────────────────────────┘
   private, build-time            public, runtime, on the wire
```

The private deployment manifest produces the running agent and supplies the secrets. The public agent card describes what the running agent does and (optionally, via your extension) what other agents/services it transitively depends on. Callers see only what's necessary to call the agent successfully.

## Caveats & Limitations

- **CLI/IDE adoption is weak.** As of mid-2026, only Google's own tooling natively speaks A2A. Claude Desktop, Cursor, Windsurf, ChatGPT, JetBrains AI all speak MCP and *not* A2A [3][4]. If your goal is "I want my code accessible from an IDE chat," build an MCP server, not an A2A agent. (Or build both.)
- **No formal `dependsOn` field in v1.0.** Use the extension pattern above. The Q3 2026 joint MCP/A2A interop spec may formalize this [4].
- **Cross-task conversation memory is the executor's problem.** A2A persists `task.history`; it does not automatically thread history across multiple tasks in the same `contextId`. If your sample feels amnesic across turns, that's why — see Pattern 3 / Anti-Pattern 2.
- **Default `TaskStore` is in-memory.** `InMemoryTaskStore` ships with the SDK and is fine for samples. Production deployments need a durable store (Postgres, Redis, DynamoDB) implementing the `TaskStore` interface.
- **gRPC and REST adapters are real but less battle-tested than JSON-RPC.** All three transports share the same `DefaultRequestHandler`, but most published examples and ecosystem tooling target JSON-RPC over HTTP.
- **Authentication is your problem.** A2A declares schemes; it doesn't issue or validate tokens. You bring the IdP, the middleware, and the user model. The protocol slot is `requestContext.context.user`.
- **Federated identity for cross-agent OBO is not standardized.** Signed agent cards (v1.0) help with *agent provenance* but not yet with *user provenance through a chain of agents*. Build it explicitly with token exchange (RFC 8693) until the joint interop spec lands.
- **Multi-agent orchestration in-process is often simpler.** If all agents live in one runtime, LangGraph / CrewAI / AutoGen keep things simple. Reach for A2A when you cross a process or organizational boundary.
- **A2A does not specify cost/quota/SLA semantics.** Out of scope. Pair the card with whatever billing/metering infrastructure your platform provides (Vertex AI Agent Engine, Bedrock AgentCore Runtime, etc.) [2].

## References

[1] [A2A Protocol Surpasses 150 Organizations, Lands in Major Cloud Platforms, and Sees Enterprise Production Use in First Year](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year) — Linux Foundation press release, April 9, 2026. Authoritative source for adoption metrics, SDK languages, and v1.0 release.

[2] [Linux Foundation's A2A Protocol Gains Rapid Enterprise Adoption Across Cloud Giants](https://www.thefastmode.com/technology-solutions/48034-linux-foundation-s-a2a-protocol-gains-rapid-enterprise-adoption-across-cloud-giants) — Industry coverage of cloud-platform integrations (Azure AI Foundry, Bedrock AgentCore, Google Cloud) and framework support (LangGraph, CrewAI, LlamaIndex, Semantic Kernel, AutoGen).

[3] [A developer's guide to AI protocols: MCP, A2A, and ACP](https://www.infoworld.com/article/4007686/a-developers-guide-to-ai-protocols-mcp-a2a-and-acp.html) — InfoWorld developer-facing comparison covering when to use each protocol and integration patterns.

[4] [Complete Guide to MCP (Model Context Protocol) in 2026 — Architecture, Implementation, and Enterprise Roadmap](https://dev.to/x4nent/complete-guide-to-mcp-model-context-protocol-in-2026-architecture-implementation-and-4a11) — MCP adoption metrics (97M monthly downloads, 81k stars), Google's December 2025 MCP rollout, joint MCP/A2A interop roadmap.

[5] [a2aproject/A2A on GitHub](https://github.com/a2aproject/A2A) — Official spec repository with SDK links (Python, JavaScript, Java, Go, .NET) and v1.0.0 release notes (March 12, 2026).

[6] [A2A and MCP — Official A2A Protocol guidance](https://a2a-protocol.org/latest/topics/a2a-and-mcp/) — Authoritative source for the recommended composition pattern: A2A on the outside (agent-to-agent), MCP on the inside (agent-to-tools).

[7] [Open Protocols for Agent Interoperability Part 1: Inter-Agent Communication on MCP](https://aws.amazon.com/blogs/opensource/open-protocols-for-agent-interoperability-part-1-inter-agent-communication-on-mcp/) — AWS Open Source Blog. Microservices framing for inter-agent communication; pattern of wrapping specialized agents as MCP servers.

[8] [MCP/A2A/Skill/Agent Architecture](https://shuji-bonji.github.io/ai-agent-architecture/concepts/03-architecture) — Four-layer architecture model (Doctrine / Agent / Skills / MCP) and the "MCP = hands, A2A = collaboration" mental shorthand.

[9] [Agent2Agent (A2A) Protocol Specification](https://a2a-protocol.org/latest/specification/) — Authoritative spec for AgentCard, AgentSkill, transports (JSON-RPC, REST, gRPC), task lifecycle, and core operations (SendMessage, SendStreamingMessage, GetTask, CancelTask, SubscribeToTask).

[10] [Agent-to-Agent Protocols: How MCP and A2A Are Redefining Multi-Agent Interoperability](https://www.xcapit.com/en/blog/agent-to-agent-protocols-mcp-a2a-2026) — Industry analysis emphasizing protocol complementarity ("a production system needs both").

[11] [Google Cloud donates A2A to Linux Foundation](https://developers.googleblog.com/en/google-cloud-donates-a2a-to-linux-foundation/) — Original announcement of A2A's transition to Linux Foundation governance.

[12] [Agent Skills & Agent Card — A2A Protocol tutorial](https://a2a-protocol.org/latest/tutorials/python/3-agent-skills-and-card/) — Tutorial-level walkthrough of AgentSkill and AgentCard fields with examples.

[13] [Spring AI Agentic Patterns (Part 5): Building Interoperable Agents with the A2A Protocol](https://spring.io/blog/2026/01/29/spring-ai-agentic-patterns-a2a-integration/) — Java-ecosystem perspective on integrating A2A into Spring AI applications (January 2026).

[14] [a2aproject/a2a-js on GitHub](https://github.com/a2aproject/a2a-js) — Official JavaScript SDK source, sample agents (sample-agent, movie-agent, authentication, extensions), and the bundled `cli.ts` reference client.
