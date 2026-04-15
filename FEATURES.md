# Features — What Works, What's Partial, What's Missing

Status key: ✅ Implemented · 🔶 Partial / local-dev only · ❌ Missing

---

## 1. Habitat — Agent Container

| Feature | Status | Notes |
|---------|--------|-------|
| Work directory with config.json | ✅ | |
| Agent secrets (secrets.json, 0600 perms) | ✅ | Plain JSON, no encryption at rest |
| Tool registration via ToolSet interface | ✅ | |
| Work-dir tools (TOOL.md + handler files) | ✅ | |
| Skills from directory or Git repos | ✅ | |
| Self-modify tools (create/remove tools at runtime) | ✅ | |
| Stimulus from work dir files (STIMULUS.md, README, etc.) | ✅ | |
| Sub-agents (managed projects with agent CRUD) | ✅ | |
| Bridge system (Dagger containers for sub-agents) | ✅ | |
| Agent discovery (MCP health monitoring) | ✅ | |
| Onboarding wizard | ✅ | |
| **Per-user credentials on Habitat** | ❌ | mcp-serve has per-user upstream tokens, but core Habitat only has agent-level secrets. Discord user can't store their own Twitter tokens on the habitat. |
| **Stimulus sharing between habitats** | ❌ | No way to export/import a stimulus config. Agent A can't adopt agent B's personality or tool config. |
| **Secrets encryption at rest** | ❌ | secrets.json is plaintext. Fine for local dev, not for hosted prod. |
| **Secret scoping (global / habitat / user)** | ❌ | All secrets are habitat-scoped. No user-level or global-level. |
| **Config validation / `habitat doctor`** | ❌ | No schema validation, env var checks, or diagnostic command. |

## 2. Multi-Platform Interfaces

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

## 3. MCP (Model Context Protocol)

| Feature | Status | Notes |
|---------|--------|-------|
| Remote MCP client with OAuth PKCE | ✅ | `RemoteMcpClient` with file-backed token storage |
| `mcp chat` CLI (connect + REPL or one-shot) | ✅ | |
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

## 4. Identity & Access Control

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

## 5. Memory

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

## 6. Session Understanding & Knowledge Extraction

This is one of the most developed areas — a full pipeline for understanding what happened in conversations and extracting reusable knowledge.

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

### Context Management

| Feature | Status | Notes |
|---------|--------|-------|
| Context compaction | ✅ | Pluggable `CompactionStrategy` interface |
| Token estimation | ✅ | `estimateContextSize()` |
| Compaction segment detection | ✅ | `getCompactionSegment()` — find which messages to compact |
| Strategy registry | ✅ | `registerCompactionStrategy()` / `getCompactionStrategy()` |

### Gaps

| Feature | Status | Notes |
|---------|--------|-------|
| **Cross-session learning injection** | 🔶 | `buildHabitatIntrospectionContextMessages()` can inject learnings from the *same session's* learnings store, but there's no automatic "pull relevant learnings from *all* past sessions" into a new conversation. |
| **Semantic search over learnings** | ❌ | Learnings are stored but can only be loaded in bulk, not searched by relevance. No embedding-based retrieval. |
| **Cross-platform session continuity** | ❌ | Can't continue a Discord conversation on Telegram or web. Sessions are channel-scoped. |
| **Multi-instance session safety** | ❌ | Sessions assume single-process, local disk. No distributed locks. Multiple workers writing to the same session would corrupt it. |
| **Automatic digest on session end** | ❌ | Digest is manual (`sessions digest`). Not triggered automatically when a conversation ends. |
| **Learning deduplication / consolidation** | ❌ | Learnings accumulate forever. No merging of duplicate facts, no periodic consolidation. |

## 7. Model & Provider Support

| Feature | Status | Notes |
|---------|--------|-------|
| 9 providers (Google, OpenRouter, Ollama, LM Studio, GitHub, DeepInfra, Together AI, Fireworks, MiniMax) | ✅ | |
| Model discovery and search | ✅ | |
| Cost tracking (per-call, per-session) | ✅ | |
| Rate limiting (per-model) | ✅ | |
| Per-user cost tracking (forwarded to providers) | ✅ | OpenRouter + Anthropic |
| Native thinking (Gemini) | ✅ | |
| Tool calling | ✅ | |
| Structured output (Zod schemas) | ✅ | |
| Streaming | ✅ | |
| **Observability dashboard** | ❌ | Cost data exists in pieces but no unified view, no alerts, no per-user usage breakdown. |
| **Model fallback / retry across providers** | ❌ | If a provider is down, no automatic fallback to another. |
| **Spend caps / budget limits** | ❌ | Can track costs but can't enforce limits. |

## 8. Evaluation

| Feature | Status | Notes |
|---------|--------|-------|
| EvalSuite (declarative eval runner) | ✅ | VerifyTask + JudgeTask |
| PairwiseRanker (Elo via LLM judge) | ✅ | Swiss tournament + round-robin |
| Suite combine (multi-dimension leaderboard) | ✅ | |
| Result caching (response + score) | ✅ | |
| Multiple report formats (console, md, json, narrative) | ✅ | |
| Dagger-based code execution for evals | ✅ | |
| CLI commands (eval run, eval report, eval combine) | ✅ | |
| **Tool/skill contract tests** | ❌ | Evaluations test LLM responses, but no first-class framework for testing tool implementations, MCP server endpoints, or OAuth flows. |

## 9. Background & Automation

| Feature | Status | Notes |
|---------|--------|-------|
| **Webhook / event ingestion** | ❌ | Habitat can only react to chat messages. No HTTP webhook handler, no event bus, no "when X happens, do Y." |
| **Scheduled tasks / cron** | ❌ | No way to say "every morning, summarize my Twitter feed" or "check Oura sleep data at 8am." |
| **Background job runtime** | ❌ | No job queue, retries, idempotency, or failure handling. |
| **Inter-habitat communication** | 🔶 | Sub-agents exist, bridge delegates via MCP. But no direct tool-to-tool calls between habitats, no pub/sub. |

## 10. Developer Experience

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
