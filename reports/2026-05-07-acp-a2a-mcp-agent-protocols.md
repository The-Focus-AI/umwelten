# Agent Protocols Compared: ACP vs A2A vs MCP

*Date: 2026-05-07 | Sources: 18*

---

## Overview

The AI agent ecosystem has converged on three complementary protocols that operate at different layers of the stack. Rather than competing standards, they form a vertical architecture:

- **MCP (Model Context Protocol)** — How an agent connects to **tools and data** [1]
- **A2A (Agent-to-Agent Protocol)** — How **agents talk to each other** across vendors [2]
- **ACP (Agent Client Protocol)** — How a **code editor drives a coding agent** [3]

A fourth protocol, IBM's Agent Communication Protocol (also abbreviated "ACP"), focused on multi-agent orchestration but has **merged into A2A** under the Linux Foundation as of early 2026 [4]. This report focuses on Zed's Agent Client Protocol.

### Why This Matters for Umwelten

Umwelten already implements MCP (server at `habitat/mcp-local-server.ts`) and A2A (client at `habitat/gaia/a2a-client.ts`). ACP represents a potential new integration surface: if umwelten habitats could speak ACP, they'd be usable directly from Zed, JetBrains, Neovim, and 10+ other editors — without custom plugins.

---

## Comparison Summary

| Criterion | MCP | A2A | ACP |
|-----------|-----|-----|-----|
| **Layer** | Agent ↔ Tools/Data | Agent ↔ Agent | Editor ↔ Agent |
| **Analogy** | "USB-C for AI" | "HTTP for agents" | "LSP for coding agents" |
| **Transport** | JSON-RPC over stdio or Streamable HTTP | JSON-RPC 2.0, gRPC, or HTTP+JSON | JSON-RPC 2.0 over stdio (HTTP planned) |
| **State Model** | Stateful connections, stateless tools | Task lifecycle (working → completed) | Sessions + Turns |
| **Discovery** | Host config files (`mcp.json`) | Agent Cards at `/.well-known/agent.json` | ACP Registry (centralized) |
| **Auth** | OAuth 2.1 PKCE (remote servers) | API keys, OAuth2, mTLS, OIDC | Capability negotiation at init |
| **Governance** | Linux Foundation (Agentic AI Foundation) | Linux Foundation | Apache 2.0, Zed + JetBrains led |
| **Adoption** | 97M+ monthly SDK downloads, 10K+ servers | 150+ orgs (Google, MS, AWS, SAP) | 40+ agents, 10+ editors |
| **Spec Maturity** | Stable (2025-11-25 spec) | Stable (v1.2, March 2026) | Early (protocol version 1) |

---

## Detailed Analysis

### MCP (Model Context Protocol)

**Created by:** Anthropic (Nov 2024), donated to Linux Foundation (Dec 2025) [1][5]

**Architecture:** Client-server model with three roles — Hosts (LLM apps), Clients (connectors), and Servers (capability providers). Servers expose three primitives: **Resources** (data/context), **Tools** (executable functions), and **Prompts** (templated workflows). Clients can offer **Sampling** (server-initiated LLM calls), **Roots** (filesystem boundaries), and **Elicitation** (user input requests) [6].

**Strengths:**
- Massive ecosystem — 10,000+ production servers, every major AI platform supports it [5]
- Simple mental model: one server = one integration (Slack, GitHub, database, etc.)
- Battle-tested specification with clear security model [6]
- Model-agnostic — works with Claude, GPT, Gemini, open-source models [5]

**Weaknesses:**
- Not designed for agent-to-agent communication — agents become "tools" losing peer status [7]
- No standardized discovery mechanism — relies on host configuration [7]
- Originally stateless at the tool level (individual servers can add state) [8]
- Authorization (OAuth 2.1) added later, still maturing for remote servers [6]

**Best For:** Connecting any AI agent or LLM to external tools, APIs, databases, and data sources. The universal integration layer.

---

### A2A (Agent-to-Agent Protocol)

**Created by:** Google (April 2025), donated to Linux Foundation (June 2025) [2][9]

**Architecture:** Peer-to-peer agent communication over HTTP. Agents publish **Agent Cards** (JSON capability documents) at well-known URIs. Work is organized into **Tasks** with a defined lifecycle: `working` → `input-required` → `completed`/`failed`/`canceled`. Supports three delivery modes: polling, streaming (SSE), and push notifications (webhooks) [10].

**Key JSON-RPC Methods:** `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask` [10].

**Strengths:**
- True peer-to-peer — agents collaborate without hierarchy [7]
- Rich task lifecycle with async support and streaming [10]
- Strong enterprise backing — 150+ organizations, native in ADK, LangGraph, CrewAI, Semantic Kernel [9]
- Agent Cards enable decentralized discovery [10]
- Comprehensive auth: API keys, OAuth2, mTLS, OIDC [10]

**Weaknesses:**
- Heavier specification — more complex to implement than MCP [8]
- Agents are opaque to each other by design — can limit debugging [10]
- Relatively young ecosystem compared to MCP's server count [9]
- Enterprise-focused; less relevant for single-user local agent workflows [8]

**Best For:** Multi-agent orchestration across vendors and organizations. When you need agents from different frameworks to discover each other, delegate tasks, and coordinate work.

---

### ACP (Agent Client Protocol)

**Created by:** Zed Industries (Aug 2025), with JetBrains joining shortly after [3][11]

**Architecture:** Editor-agent protocol modeled after LSP. The **client** (editor) owns the UI; the **agent** runs the LLM loop as a subprocess. Communication is JSON-RPC 2.0 over stdio (remote HTTP/WebSocket transport planned). Work is organized into **Sessions** (conversation context) and **Turns** (one prompt→response cycle) [12].

**Key JSON-RPC Methods:**

| Direction | Methods |
|-----------|---------|
| Client → Agent | `initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel`, `session/setMode`, `session/setModel` |
| Agent → Client | `fs/read_text_file`, `fs/write_text_file`, `session/requestPermission`, `terminal/create`, `session/update` |

**Critical MCP integration:** When creating a session (`session/new`), the editor passes its configured MCP servers to the agent via the `mcpServers` parameter. The agent then connects to those MCP servers to access tools. This means **ACP agents are typically MCP clients** [12][13].

**Streaming:** Agents stream responses via `session/update` notifications containing `AgentMessageChunk`, `AgentThoughtChunk`, and tool call lifecycle events [12].

**Strengths:**
- Direct editor integration — agents get file access, terminal, permission dialogs natively [12]
- Growing rapidly: 40+ agents (Claude, Gemini CLI, Copilot, Goose, Cline, etc.) [14]
- 10+ editors (Zed, JetBrains family, Neovim, Emacs, Obsidian, VS Code via plugins) [14]
- ACP Registry for agent discovery and one-click install [15]
- Seamless MCP passthrough — editor's MCP servers become the agent's tools [12]
- Lightweight — stdio transport is trivial to implement [13]

**Weaknesses:**
- Coding-focused — not a general agent communication protocol [3]
- Remote transport still in development [3]
- Very early specification (protocol version 1) [12]
- Agent runs as editor subprocess — limits deployment flexibility [3]
- No agent-to-agent capability — purely client-server [3]

**Best For:** Making coding agents available across multiple editors. The "LSP for AI coding agents."

---

## How They Layer Together

```
                    +------------------+
                    |   Code Editor    |  (Zed, JetBrains, Neovim...)
                    +--------+---------+
                             |
                         ACP | (editor ↔ agent)
                             |
                    +--------+---------+
                    |   Coding Agent   |  (Claude, Gemini CLI, Goose...)
                    +--+-----+------+--+
                       |     |      |
                  MCP  |     | A2A  |  MCP
                       |     |      |
                +------+  +--+--+  +------+
                | Tool |  |Agent|  | Tool |
                |Server|  |Peer |  |Server|
                +------+  +-----+  +------+
```

A coding agent in this stack:
1. **Receives work** from the editor via ACP (sessions, prompts, file context)
2. **Accesses tools** via MCP (the editor passes its MCP server configs at session creation)
3. **Delegates to peer agents** via A2A (when a task requires capabilities from another agent)

This is exactly the layering Google's developer guide recommends: "Add protocols as you need them," starting with MCP for data access, A2A for agent networks, and ACP for editor integration [16].

---

## Relevance to Umwelten

### What Umwelten Already Has

| Protocol | Status | Implementation |
|----------|--------|----------------|
| **MCP** | Implemented | `mcp-local-server.ts` — Streamable HTTP server exposing habitat tools |
| **A2A** | Implemented | `gaia/a2a-client.ts` — Agent Cards, `sendA2AMessage()`, `discoverHabitats()` |
| **ACP** | Not implemented | — |

### What ACP Would Enable

If a habitat could speak ACP, it would be usable as a coding agent from **any ACP-compatible editor** — Zed, IntelliJ, PyCharm, WebStorm, Neovim, Emacs — without building editor-specific plugins. The habitat would:

1. Accept `initialize` → advertise capabilities
2. Accept `session/new` → create a habitat session, connect to editor-provided MCP servers
3. Accept `session/prompt` → run through the habitat's interaction loop
4. Stream `session/update` → send back chunks, tool calls, thoughts
5. Handle `fs/*` and `terminal/*` → interact with the editor's filesystem and terminal

### Implementation Considerations

- **Transport:** ACP uses stdio today. Umwelten habitats currently use HTTP. An ACP adapter would need to bridge stdio ↔ habitat interaction.
- **MCP passthrough:** The editor sends its MCP servers at session creation. The habitat would need to connect to these dynamically, in addition to its own tool sets.
- **Session mapping:** ACP sessions map naturally to habitat sessions (both are conversation contexts with IDs).
- **Tool permissions:** ACP has `session/requestPermission` — this maps to habitat's existing tool authorization model.

### Recommendation

**Priority: Medium.** ACP adoption is accelerating fast (40+ agents, 10+ editors in <1 year), but the spec is still version 1 with remote transport incomplete. The most pragmatic path:

1. **Now:** Monitor ACP spec evolution, especially remote transport
2. **Near-term:** Build a thin ACP stdio adapter that wraps a habitat interaction — this is ~500 lines, mostly JSON-RPC message routing
3. **Later:** When remote ACP lands, expose habitats as remote ACP agents alongside the existing MCP server

The A2A investment is more strategic for umwelten's multi-habitat orchestration (Gaia). ACP is additive — it's about distribution (getting habitats into editors), not architecture.

---

## Sources

1. [Introducing the Model Context Protocol — Anthropic](https://www.anthropic.com/news/model-context-protocol)
2. [Announcing the Agent2Agent Protocol — Google Developers Blog](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
3. [Introduction — Agent Client Protocol](https://agentclientprotocol.com/get-started/introduction)
4. [ACP merging with A2A — GitHub Discussion](https://github.com/i-am-bee/acp/discussions/122)
5. [Model Context Protocol — Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)
6. [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
7. [MCP, ACP, A2A, Oh My! — WorkOS](https://workos.com/blog/mcp-acp-a2a-oh-my)
8. [Comparison of Agent Protocols MCP, ACP and A2A — Niklas Heidloff](https://heidloff.net/article/mcp-acp-a2a-agent-protocols/)
9. [A2A Protocol Grew to 150+ Organizations — Stellagent](https://stellagent.ai/insights/a2a-protocol-google-agent-to-agent)
10. [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
11. [ACP Brings JetBrains on Board — Zed Blog](https://zed.dev/blog/jetbrains-on-acp)
12. [Agent Client Protocol Overview — DeepWiki](https://deepwiki.com/agentclientprotocol/python-sdk/4.1-agent-client-protocol-overview)
13. [Agent Client Protocol — Zed](https://zed.dev/acp)
14. [Agents — Agent Client Protocol](https://agentclientprotocol.com/get-started/agents)
15. [ACP Agent Registry Is Live — JetBrains Blog](https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/)
16. [Developer's Guide to AI Agent Protocols — Google Developers Blog](https://developers.googleblog.com/developers-guide-to-ai-agent-protocols/)
17. [ACP vs MCP vs A2A: Agent Protocol Comparison — Morph](https://www.morphllm.com/comparisons/acp-vs-mcp-vs-a2a)
18. [IBM's Agent Communication Protocol — WorkOS](https://workos.com/blog/ibm-agent-communication-protocol-acp)
