# Features — What Works, What's Partial, What's Missing

Status key: ✅ Implemented · 🔶 Partial / local-dev only · ❌ Missing

---

## Table of Contents

### Part I — Foundation
1. [Providers — LLM Backends](#1-providers--llm-backends)
2. [Cognition — Model Runners](#2-cognition--model-runners)
3. [Schema — Structured Output](#3-schema--structured-output)

### Part II — Core Abstractions
4. [Stimulus — Prompt Configuration](#4-stimulus--prompt-configuration)
5. [Interaction — Conversations](#5-interaction--conversations)
6. [Built-in Tools & Tool Loading](#6-built-in-tools--tool-loading)
7. [Evaluation](#7-evaluation)

### Part III — Intelligence
8. [Memory — Fact Extraction](#8-memory--fact-extraction)
9. [Session Understanding & Knowledge Extraction](#9-session-understanding--knowledge-extraction)
10. [Context Management](#10-context-management)

### Part IV — The Agent Platform
11. [Habitat — Agent Container](#11-habitat--agent-container)
12. [MCP — Model Context Protocol](#12-mcp-model-context-protocol)
13. [Multi-Platform Interfaces](#13-multi-platform-interfaces)
14. [Identity & Access Control](#14-identity--access-control)
15. [Background & Automation](#15-background--automation)

### Part V — Developer Experience
16. [URL & HTML Utilities](#16-url--html-utilities)
17. [Reporting](#17-reporting)
18. [CLI](#18-cli)
19. [Developer Experience](#19-developer-experience)
20. [Examples](#20-examples)

### [Priority Gaps for the Vision](#priority-gaps-for-the-vision)

---

# Part I — Foundation

## 1. Providers — LLM Backends

Unified access to 10 providers via `BaseProvider` (abstract class with `listModels()` and `getLanguageModel()`).

| Feature | Status | Notes |
|---------|--------|-------|
| Google (Gemini) | ✅ | Native thinking support |
| OpenRouter | ✅ | Access to OpenAI, Anthropic, Meta, etc. |
| Ollama (local) | ✅ | No API key needed |
| LM Studio (local) | ✅ | REST API, no key needed |
| GitHub Models | ✅ | Via GITHUB_TOKEN |
| DeepInfra | ✅ | |
| Together AI | ✅ | |
| Fireworks | ✅ | |
| MiniMax | ✅ | |
| Nvidia | ✅ | |
| Base provider abstraction | ✅ | `BaseProvider` with `listModels()` and `getLanguageModel()` |
| Provider registry | ✅ | `getModel()`, `validateModel()`, `getModelProvider()` |
| Model discovery and search | ✅ | `getAllModels()`, `searchModels()`, `findModelByIdAndProvider()` |
| **Model fallback / retry across providers** | ❌ | If a provider is down, no automatic fallback to another |
| **Spend caps / budget limits** | ❌ | Can track costs but can't enforce limits |

## 2. Cognition — Model Runners

How to call LLMs. Wraps Vercel AI SDK with rate limiting, cost tracking, retries.

| Feature | Status | Notes |
|---------|--------|-------|
| BaseModelRunner | ✅ | `generateText`, `streamText`, `generateObject`, `streamObject` — wraps Vercel AI SDK |
| SmartModelRunner (hooks) | ✅ | Before/during/after hooks for intercepting model calls |
| MemoryRunner | ✅ | SmartModelRunner that auto-extracts facts after each response |
| Rate limiting (per-model) | ✅ | Built into BaseModelRunner |
| Cost tracking (per-call) | ✅ | Automatic cost calculation with `TokenUsage` and `CostBreakdown` |
| Usage extraction | ✅ | Normalize input/output/total tokens across providers |
| Step assembler | ✅ | Multi-step tool calling orchestration |
| Message normalization | ✅ | Normalize messages across provider formats |
| Per-user tracking (forwarded to OpenRouter/Anthropic) | ✅ | `interaction.userId` → provider-specific user analytics |
| Reasoning effort control | ✅ | `none`, `low`, `medium`, `high` for thinking models |

## 3. Schema — Structured Output

Parse DSL strings into Zod schemas, validate and coerce model output.

| Feature | Status | Notes |
|---------|--------|-------|
| DSL-to-Zod parser | ✅ | `parseDSLSchema()` — parse string DSL into Zod schemas |
| Zod schema loader | ✅ | `loadZodSchema()`, `convertZodToSchema()` |
| JSON Schema conversion | ✅ | `toJSONSchema()` |
| Schema validator | ✅ | `validateSchema()`, `createValidator()`, `coerceData()` |
| Schema manager (singleton) | ✅ | `SchemaManager` for managing schema lifecycle |

---

# Part II — Core Abstractions

## 4. Stimulus — Prompt Configuration

The Stimulus defines *what* to say: persona, instructions, tools, model parameters. Pure config — doesn't run anything.

| Feature | Status | Notes |
|---------|--------|-------|
| Stimulus class (role, objective, instructions, reasoning, output format) | ✅ | `new Stimulus({ role: '...' })` |
| Model parameter config (temperature, maxTokens, topP, penalties) | ✅ | Set on Stimulus, applied at runtime |
| Tool management on Stimulus (addTool, getTools) | ✅ | Tools are part of the prompt config |
| Tool instructions | ✅ | Natural language instructions for tool usage |
| Skills registry (load from directory, Git, or inline) | ✅ | `SkillsRegistry`, `loadSkillsFromDirectory`, `loadSkillsFromGit` |
| Skill tool (LLM selects + loads a skill at runtime) | ✅ | `createSkillTool()` |
| Runner type selection (`base` or `memory`) | ✅ | `memory` enables auto fact extraction |
| System prompt generation from options | ✅ | Assembles system message from role + objective + instructions + context |
| Pre-built analysis stimuli | ✅ | PDF parsing, image analysis, transcription analysis |
| Pre-built creative stimuli | ✅ | Cat poems, Frankenstein, temperature tests |
| Pre-built coding stimuli | ✅ | TypeScript debugging, Python |
| **Stimulus export / import** | ❌ | No serialization format. Can't export a Stimulus config and import it in another habitat or share it. |
| **Stimulus templates / inheritance** | ❌ | Can't extend a base Stimulus. No "this agent is like that agent but with extra tools." |

## 5. Interaction — Conversations

Holds messages, model, stimulus, and runner. This is where the actual conversation lives.

| Feature | Status | Notes |
|---------|--------|-------|
| Interaction class | ✅ | Messages + model + stimulus → `chat()`, `generateText()`, `streamText()`, `generateObject()` |
| Multi-step tool calling | ✅ | `maxSteps` for iterative tool use |
| Context compaction | ✅ | `compactContext()` with pluggable strategies |
| Attachment handling | ✅ | Images, files → multimodal messages |
| Normalized session format | ✅ | `NormalizedSession`, `NormalizedMessage` for cross-source compatibility |
| Session adapters | ✅ | `ClaudeCodeAdapter`, `CursorAdapter` — read external IDE sessions |
| Transcript persistence | ✅ | `onTranscriptUpdate` callback for JSONL writing |
| Checkpoint / resume | ✅ | `checkpointMessageIndex` for compaction boundaries |

## 6. Built-in Tools & Tool Loading

Tools that agents can invoke during conversations, plus a convention-based loading system.

| Feature | Status | Notes |
|---------|--------|-------|
| URL tools (wget, markify, parse_feed) | ✅ | Fetch URLs, HTML→markdown (Turndown or Markify service), RSS/Atom parsing |
| PDF tools | ✅ | PDF content extraction |
| Image tools | ✅ | Image analysis via LLM |
| Audio tools | ✅ | Audio transcription |
| TOOL.md + handler loader | ✅ | Work-dir tools: each subdir with TOOL.md becomes a Tool; supports handler.ts, handler.js, or script execution |
| Factory-pattern tool handlers | ✅ | Handler can export a factory function receiving context |
| Script tools | ✅ | `type: script` in TOOL.md → runs external script with args |
| Math example tools | ✅ | Reference implementation |

## 7. Evaluation

Systematic model assessment, comparison, and reporting.

| Feature | Status | Notes |
|---------|--------|-------|
| EvalSuite (declarative eval runner) | ✅ | VerifyTask (deterministic) + JudgeTask (LLM judge with Zod schema) |
| PairwiseRanker (Elo via LLM judge) | ✅ | Swiss tournament + round-robin, position bias mitigation, comparison caching |
| Suite combine (multi-dimension leaderboard) | ✅ | Aggregate independent evals into unified report |
| Lower-level strategies | ✅ | `SimpleEvaluation`, `MatrixEvaluation` (placeholder cartesian product), `BatchEvaluation` (N items × N models) |
| Result caching (two layers) | ✅ | Response cache (raw LLM output) + result cache (scored output) |
| Multiple report formats | ✅ | Console, markdown, JSON, narrative (full prose) |
| Dagger-based code execution | ✅ | TypeScript, Python, Ruby, Rust, Go in isolated containers |
| Codebase evaluation | ✅ | `ContextProvider`, `ChangeExtractor`, `ChangeApplicator` for code-aware evals |
| CLI commands | ✅ | `eval run`, `eval report`, `eval list`, `eval combine` |
| Concurrency control | ✅ | `--concurrent` flag, configurable concurrency |
| **Tool/skill contract tests** | ❌ | Evaluations test LLM responses, but no first-class framework for testing tool implementations, MCP server endpoints, or OAuth flows. |

---

# Part III — Intelligence

## 8. Memory — Fact Extraction

Extract and store facts from conversations automatically.

| Feature | Status | Notes |
|---------|--------|-------|
| Fact extraction from conversations | ✅ | LLM-powered, categorized (preference, plan, professional) |
| Memory operations (ADD, UPDATE, DELETE) | ✅ | |
| MemoryRunner (auto-extract during chat) | ✅ | `stimulus.runnerType = 'memory'` |
| Per-user fact storage (MemoryStore interface) | ✅ | Interface exists |
| Learnings store (file-based, per-session) | ✅ | `FileLearningsStore` for session-level learnings |
| **Persistent memory backend** | ❌ | Only `InMemoryMemoryStore` exists. Facts are lost when process restarts. No file, SQLite, or Postgres backend. |
| **Memory retrieval / injection** | ❌ | Facts are extracted but not automatically retrieved and injected as context for future conversations. The loop is broken. |
| **Cross-session memory** | ❌ | Each `Interaction` creates a fresh `InMemoryMemoryStore`. No sharing between sessions or conversations. |
| **Memory search / relevance** | ❌ | No semantic search over stored facts. No "retrieve the 5 most relevant facts for this conversation." |

## 9. Session Understanding & Knowledge Extraction

One of the most developed areas — a full pipeline for understanding what happened in conversations and extracting reusable knowledge.

### Session Persistence & Structure

| Feature | Status | Notes |
|---------|--------|-------|
| JSONL transcript persistence | ✅ | Append-only, per-session |
| Session metadata (provider, model, type, agent) | ✅ | |
| Conversation beats (user turn + tools + response) | ✅ | `messagesToBeats()` groups messages into logical turns |
| External session reading (Claude Code, Cursor) | ✅ | `ClaudeCodeAdapter`, `CursorAdapter` — reads their JSONL history |
| Transcript resume on restart | ✅ | Reload last N message pairs when process restarts |
| Segmented transcripts | ✅ | Compaction creates frozen segments + live segment |

### Session Analysis (LLM-powered)

| Feature | Status | Notes |
|---------|--------|-------|
| Session analysis via LLM | ✅ | Extracts: topics, tags, key learnings, summary, solution type, code languages, tools used, success indicators |
| Analysis index (per-project) | ✅ | `SessionAnalysisIndex` — cached analysis results, incremental re-indexing |
| Session search (keyword + field filters) | ✅ | Filter by tags, topic, tool, solutionType, branch, success |
| Cross-project search | ✅ | Discover + search across all Claude Code/Cursor project directories |

### Session Digest (Deep Understanding)

| Feature | Status | Notes |
|---------|--------|-------|
| Session digester | ✅ | Full pipeline: compaction → analysis → fact extraction → beat analysis → phase detection |
| Beat-by-beat breakdown | ✅ | Per-beat: userRequest, toolsUsed, outcome, narrative, keyFacts |
| Phase detection | ✅ | Groups beats into conversation phases with themes |
| Digest segments (compacted) | ✅ | Through-line + key facts per segment |
| Overall summary generation | ✅ | Merged summary across all segments |
| Structured fact extraction | ✅ | Typed facts from digest pipeline |
| Session metrics | ✅ | Message count, segment count, tool call count, estimated cost, duration |
| Digest index (master, cross-project) | ✅ | `DigestIndex` with lightweight entries for browsing |

### Learnings System (Persistent Knowledge)

| Feature | Status | Notes |
|---------|--------|-------|
| FileLearningsStore | ✅ | Append-only JSONL per kind, per session |
| Learning kinds | ✅ | `facts`, `playbooks`, `preferences`, `open_loops`, `mistakes` |
| Learning provenance tracking | ✅ | Links back to session, channel, compaction run |
| Context merge (inject learnings into new sessions) | ✅ | `buildHabitatIntrospectionContextMessages()` — prepends compaction summaries + serialized learnings |
| Compaction events | ✅ | `CompactionEventV1` — marker in transcript when compaction occurs |
| Session-level learnings CLI | ✅ | `sessions digest` subcommands |

### Gaps

| Feature | Status | Notes |
|---------|--------|-------|
| **Cross-session learning injection** | 🔶 | `buildHabitatIntrospectionContextMessages()` can inject learnings from the *same session's* learnings store, but there's no automatic "pull relevant learnings from *all* past sessions" into a new conversation. |
| **Semantic search over learnings** | ❌ | Learnings are stored but can only be loaded in bulk, not searched by relevance. No embedding-based retrieval. |
| **Cross-platform session continuity** | ❌ | Can't continue a Discord conversation on Telegram or web. Sessions are channel-scoped. |
| **Multi-instance session safety** | ❌ | Sessions assume single-process, local disk. No distributed locks. Multiple workers writing to the same session would corrupt it. |
| **Automatic digest on session end** | ❌ | Digest is manual (`sessions digest`). Not triggered automatically when a conversation ends. |
| **Learning deduplication / consolidation** | ❌ | Learnings accumulate forever. No merging of duplicate facts, no periodic consolidation. |

## 10. Context Management

Track context size and compact long conversations.

| Feature | Status | Notes |
|---------|--------|-------|
| Context compaction | ✅ | Pluggable `CompactionStrategy` interface |
| Token estimation | ✅ | `estimateContextSize()` |
| Compaction segment detection | ✅ | `getCompactionSegment()` — find which messages to compact |
| Strategy registry | ✅ | `registerCompactionStrategy()` / `getCompactionStrategy()` |

---

# Part IV — The Agent Platform

## 11. Habitat — Agent Container

The top-level system. Manages work directory, config, sessions, tools, agents, and secrets.

| Feature | Status | Notes |
|---------|--------|-------|
| Work directory with config.json | ✅ | |
| Agent secrets (secrets.json, 0600 perms) | ✅ | Plain JSON, no encryption at rest |
| Tool registration via ToolSet interface | ✅ | 10 standard tool sets registered by default |
| Work-dir tools (TOOL.md + handler files) | ✅ | |
| Skills from directory or Git repos | ✅ | |
| Self-modify tools (create/remove/reload tools at runtime) | ✅ | |
| Stimulus from work dir files (STIMULUS.md, README, CLAUDE.md) | ✅ | |
| Memory files loading into stimulus context | ✅ | `memoryFiles` config with journal support |
| Sub-agents (managed projects with agent CRUD) | ✅ | |
| Agent discovery (MCP health monitoring) | ✅ | |
| Onboarding wizard | ✅ | |
| Gaia HTTP server (JSON API + chat) | ✅ | Sessions, beats, commands, chat endpoints |
| Session management (create, list, resume, metadata) | ✅ | Per-type (CLI, Discord, Telegram, web, API) |
| Interaction factory | ✅ | `createInteraction()` with auto-session and transcript persistence |
| Ephemeral agent interactions | ✅ | `createAgentInteraction()` for diagnosis/monitor agents |
| Work dir file management | ✅ | `readWorkDirFile()`, `writeWorkDirFile()`, state files |

### Habitat Tool Sets

| Tool Set | Tools | Notes |
|----------|-------|-------|
| File operations | read_file, write_file, list_directory, ripgrep | Sandboxed to allowed roots |
| Time | current_time | |
| URL operations | wget, markify, parse_feed | |
| Agent management | list/add/update/remove agents | |
| Session management | list/show/messages/stats/inspect/read_file, learnings, transcript compact | |
| External interactions | Read Claude Code/Cursor history | |
| Agent runner | agent_clone, agent_logs, agent_status, agent_ask, bridge_diagnose, bridge_monitor | |
| Secrets | set/remove/list secrets | |
| Search | Web search via Tavily | Needs TAVILY_API_KEY |
| Self-modify | create/remove/reload tools and skills at runtime | |
| Discord routing | Channel → agent binding tools | |

### Habitat Bridge (Containerized Sub-Agents)

| Feature | Status | Notes |
|---------|--------|-------|
| BridgeAgent (containerized execution via Dagger) | ✅ | |
| BridgeSupervisor (lifecycle management) | ✅ | |
| MCP SDK server/client (StreamableHTTP transport) | ✅ | |
| Go MCP server implementation | ✅ | Alternative server for bridges |
| LLM-driven diagnosis agent | ✅ | Read-only project inspection and provisioning detection |
| LLM-driven monitor agent | ✅ | Container health monitoring |
| Persistent logging | ✅ | |
| Secret injection into containers | ✅ | |
| Port pool management | ✅ | Auto-assigned MCP ports |
| Bridge state persistence | ✅ | `BridgeState` saved/loaded per agent |

### Habitat Gaps

| Feature | Status | Notes |
|---------|--------|-------|
| **Per-user credentials on Habitat** | ❌ | mcp-serve has per-user upstream tokens, but core Habitat only has agent-level secrets. Discord user can't store their own Twitter tokens on the habitat. |
| **Stimulus sharing between habitats** | ❌ | No way to export/import a stimulus config. Agent A can't adopt agent B's personality or tool config. |
| **Secrets encryption at rest** | ❌ | secrets.json is plaintext. Fine for local dev, not for hosted prod. |
| **Secret scoping (global / habitat / user)** | ❌ | All secrets are habitat-scoped. No user-level or global-level. |
| **Config validation / `habitat doctor`** | ❌ | No schema validation, env var checks, or diagnostic command. |

## 12. MCP (Model Context Protocol)

Full MCP implementation on both client and server sides, plus a library for building hosted multi-user MCP servers.

| Feature | Status | Notes |
|---------|--------|-------|
| Remote MCP client with OAuth PKCE | ✅ | `RemoteMcpClient` with file-backed token storage at `~/.umwelten/mcp-auth/` |
| MCP client (custom protocol) | ✅ | Low-level `MCPClient` for stdio/HTTP transports |
| MCP server (expose umwelten as tool provider) | ✅ | |
| MCP → Stimulus bridge | ✅ | Load MCP tools into a Stimulus, convert MCP tools to Vercel AI SDK tools |
| `mcp chat` CLI (connect + REPL or one-shot) | ✅ | With `--logout` for credential reset |
| `mcp connect` and `mcp test-tool` CLI | ✅ | |
| **mcp-serve library** | ✅ | Generic "upstream OAuth → hosted MCP server" toolkit |
| `NeonStore` for Postgres persistence | ✅ | |
| `UpstreamOAuthProvider` interface | ✅ | Implement for any OAuth service |
| `McpToolRegistrar` for per-user tool registration | ✅ | |
| Oura Ring MCP example | ✅ | Rebuilt on mcp-serve library |
| Twitter MCP example | ✅ | 12 tools, per-user Twitter OAuth |
| **Per-tool authorization / scopes** | ❌ | MCP auth is all-or-nothing. No per-tool read/write permissions, no "this user can read but not post." |
| **Audit logs** | ❌ | No record of who called what tool, when, with whose credentials. |
| **Admin surface for hosted MCPs** | ❌ | No way to list users, revoke auth, inspect usage, or rotate credentials without DB access. |
| **Per-user quotas / rate limits / billing** | ❌ | Cost tracking exists per model call, but no per-user or per-client metering on the MCP server. |
| **Token revocation endpoint** | ❌ | MCP tokens can't be explicitly revoked by the user. |
| **Skill → hosted MCP packaging flow** | ❌ | mcp-serve is a library you code against. Missing: skill manifest format, declare required auth/scopes, publish/deploy workflow. |

## 13. Multi-Platform Interfaces

Agents accessible from multiple surfaces through a unified ChannelBridge routing layer.

| Feature | Status | Notes |
|---------|--------|-------|
| CLI REPL | ✅ | |
| Discord adapter | ✅ | Ambient mode, threads, slash commands, attachment handling |
| Telegram adapter | ✅ | Media storage, message logging |
| Web interface (Gaia server) | ✅ | JSON API + chat endpoint |
| TUI (React Ink) | ✅ | |
| ChannelBridge (unified adapter layer) | ✅ | All platforms share one bridge |
| Unified routing (routing.json → agent binding) | ✅ | Channel → agent with runtime mode selection |
| Unified slash commands across platforms | ✅ | /switch, /status, /reload-routing, etc. |
| Claude SDK pass-through (claude-sdk runtime) | ✅ | |
| Transcript resume on restart | ✅ | |
| **Gaia web server authentication** | ❌ | Anyone who can reach the server can use it. No auth, no sessions, no user identity. |
| **Consistent multimodal output** | 🔶 | Input attachments work (images, files). Output is text-only across all adapters — no image/audio generation or rich formatting. |
| **Platform capability negotiation** | ❌ | Bridge doesn't know what each platform supports (message length, embeds, reactions, etc.) |

## 14. Identity & Access Control

Current identity model is functional but minimal.

| Feature | Status | Notes |
|---------|--------|-------|
| userId field on Interaction | ✅ | Forwarded to OpenRouter/Anthropic for analytics |
| Per-user memory (MemoryStore keyed by userId) | ✅ | But only in-memory (see Memory section) |
| MCP OAuth for user identity | ✅ | In mcp-serve layer |
| **Unified user identity across channels** | ❌ | No account model. Discord user alice#1234 ≠ Telegram user @alice ≠ MCP user. Same person, three identities. No way to link them. |
| **User account management** | ❌ | No signup, login, profile, linked accounts. |
| **Per-user credential store on Habitat** | ❌ | mcp-serve has `upstream_tokens` in Postgres, but core Habitat has no `getUserSecret(userId, service)`. Discord user can't have their own API keys. |
| **Role-based access control** | ❌ | No admin vs user vs readonly roles. |
| **Data lifecycle / privacy controls** | ❌ | No delete-my-data, no transcript retention rules, no export-my-data, no redaction. |

## 15. Background & Automation

The least developed area. Habitats can only react to incoming chat messages.

| Feature | Status | Notes |
|---------|--------|-------|
| **Webhook / event ingestion** | ❌ | Habitat can only react to chat messages. No HTTP webhook handler, no event bus, no "when X happens, do Y." |
| **Scheduled tasks / cron** | ❌ | No way to say "every morning, summarize my Twitter feed" or "check Oura sleep data at 8am." |
| **Background job runtime** | ❌ | No job queue, retries, idempotency, or failure handling. |
| **Inter-habitat communication** | 🔶 | Sub-agents exist, bridge delegates via MCP. But no direct tool-to-tool calls between habitats, no pub/sub. |

---

# Part V — Developer Experience

## 16. URL & HTML Utilities

Low-level utilities consumed by the tool layer.

| Feature | Status | Notes |
|---------|--------|-------|
| URL fetching with limits | ✅ | `fetchUrl()` with timeout and size limits |
| HTML → Markdown (Turndown) | ✅ | `fromHtmlBuiltIn()` |
| HTML → Markdown (Markify service) | ✅ | `fromHtmlViaMarkify()` — optional external service |
| URL → Markdown pipeline | ✅ | `urlToMarkdown()` — fetch + convert |
| RSS/Atom feed parsing | ✅ | `parseFeed()` |

## 17. Reporting

Unified report rendering used by tool tests and evaluation suite reports.

| Feature | Status | Notes |
|---------|--------|-------|
| Unified Reporter class | ✅ | `Reporter` with `fromToolTest()`, `toConsole()`, `toMarkdown()`, `toHtml()`, `toJson()` |
| Console renderer | ✅ | Formatted terminal output |
| Markdown renderer | ✅ | Structured markdown reports |
| HTML renderer | ✅ | |
| JSON renderer | ✅ | |
| Report types | ✅ | `tool-test`, `code-generation`, `evaluation`, `batch`, `suite` |
| Narrative reports (prose writeup) | ✅ | Full methodology + analysis + cost/speed breakdown for eval combines |
| Report adapters | ✅ | Adapt different result types to unified `Report` format |

## 18. CLI

Commander-based CLI providing the primary developer interface.

| Feature | Status | Notes |
|---------|--------|-------|
| `models` — list/search across providers | ✅ | `--search`, `--provider`, `--json` |
| `run` — one-shot prompt | ✅ | |
| `chat` — interactive REPL | ✅ | |
| `eval` — evaluation suite | ✅ | `run`, `report`, `list`, `combine` subcommands |
| `sessions` — session management | ✅ | `list`, `index`, `search`, `browse`, `digest` |
| `habitat` — agent REPL + interfaces | ✅ | Launches REPL, telegram, discord, web |
| `mcp` — remote MCP client | ✅ | `chat`, `connect`, `test-tool` |
| `telegram` — standalone Telegram bot | ✅ | |
| `tools` — list available tools | ✅ | |
| Common options | ✅ | `--provider`, `--model`, `--temperature`, etc. shared across commands |

## 19. Developer Experience

Documentation, tooling, and developer workflow support.

| Feature | Status | Notes |
|---------|--------|-------|
| CLAUDE.md (maintainer module map) | ✅ | |
| LLM.txt (agent-friendly summary) | ✅ | |
| VitePress documentation site | ✅ | |
| Examples (evals, oura-mcp, twitter-mcp, habitat-minimal) | ✅ | |
| mise.toml tasks | ✅ | |
| **Hot-reload of tools/skills** | 🔶 | `self-modify` tools exist (create/remove/reload). But no automatic watch-mode, and reload can be inconsistent across long-running adapters. |
| **Skill versioning / compatibility** | ❌ | Skills from Git have no version constraints, no migration, no "requires umwelten >=0.5". |
| **Skill manifest format** | ❌ | SKILL.md is human-readable but not machine-parseable. No declarative way to say "this skill needs these env vars, these OAuth scopes, these tools." |
| **MCP server smoke/integration tests** | ❌ | No test harness for verifying a hosted MCP server works end-to-end (OAuth flow, tool calls, token refresh). |
| **Safety / approval model for dangerous tools** | ❌ | No dangerous-tool classification, no approval hooks, no outbound network restrictions, no filesystem boundaries beyond `allowedRoots`. |
| **Observability dashboard** | ❌ | Cost data exists in pieces but no unified view, no alerts, no per-user usage breakdown. |

## 20. Examples

| Example | Status | Notes |
|---------|--------|-------|
| `examples/evals/` | ✅ | EvalSuite examples: reasoning (LLM judge), instruction (deterministic), car-wash |
| `examples/model-showdown/` | ✅ | 5-dimension eval suite + combine + reports |
| `examples/oura-mcp/` | ✅ | Multi-user Oura Ring MCP server (mcp-serve + Neon + fly.io) |
| `examples/twitter-mcp/` | ✅ | Multi-user Twitter MCP server (mcp-serve + Neon + fly.io) |
| `examples/habitat-minimal/` | ✅ | Smallest Habitat work-dir layout |
| `examples/jeeves-bot/` | ✅ | Discord/Telegram bot example |
| `examples/mcp-chat/` | ✅ | PairwiseRanker + MCP tool-use responses |
| `examples/memorization/` | ✅ | Memory extraction demo |
| `examples/provider-comparison/` | ✅ | Multi-provider comparison |
| `examples/schemas/` | ✅ | Structured output examples |
| `examples/gaia-ui/` | ✅ | Gaia web interface |

---

## Priority Gaps for the Vision

The "turn any skill into a hosted MCP with per-user access control" vision is partially realized with `mcp-serve`. The critical remaining gaps are:

### Tier 1 — Enables the multi-user agent platform
1. **Unified user identity** — same person across Discord, Telegram, MCP, web
2. **Per-user credential store on Habitat** — `habitat.getUserSecret(userId, 'twitter')`
3. **Persistent memory backend** — facts survive restarts, shared across sessions
4. **Memory retrieval loop** — extract → store → retrieve → inject as context

### Tier 2 — Enables production hosting
5. **Gaia web auth** — at minimum, API key or session-based auth
6. **Audit logs** — who called what, when, with whose credentials
7. **Per-user quotas / metering** — track and cap usage per user
8. **Secrets encryption** — at rest, with rotation support

### Tier 3 — Enables the skill marketplace
9. **Skill manifest format** — machine-readable declaration of auth, scopes, env vars, tools
10. **Stimulus portability** — export/import agent personality and tool config
11. **Skill versioning** — semver, compatibility constraints, migration
12. **Packaging + deploy workflow** — `umwelten publish` → hosted MCP with OAuth

### Tier 4 — Enables autonomous agents
13. **Scheduled tasks / cron** — agents that act on their own schedule
14. **Webhook ingestion** — agents that react to external events
15. **Background job runtime** — queues, retries, failure handling
