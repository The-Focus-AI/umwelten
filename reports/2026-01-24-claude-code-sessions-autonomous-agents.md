---
title: "Claude Code Sessions & Autonomous Agents: Claude Agent SDK"
date: 2026-01-24
topic: claude-code-autonomous-agents
recommendation: Claude Agent SDK
version_researched: 0.2.12 (TypeScript), 0.8.1 (Python)
use_when:
  - Building autonomous AI agents that need to read files, run commands, and edit code
  - Automating development workflows in CI/CD pipelines
  - Creating multi-turn agents that maintain context across sessions
  - Orchestrating multiple specialized subagents for complex tasks
  - Need programmatic control over Claude Code's capabilities
avoid_when:
  - Simple one-shot API calls without tool execution (use Anthropic Client SDK)
  - Tasks requiring only conversational AI without autonomous actions
  - Environments where you cannot install Claude Code runtime
  - Highly sensitive production systems without proper isolation
project_context:
  language: TypeScript, Python
  relevant_dependencies: ["@anthropic-ai/claude-agent-sdk", "claude-agent-sdk"]
---

## Summary

The Claude Agent SDK (formerly Claude Code SDK) is Anthropic's official library for building autonomous AI agents that can read files, run commands, search the web, and edit code programmatically[1]. The SDK provides the same tools, agent loop, and context management that power Claude Code, available in both Python and TypeScript[2]. The TypeScript package (`@anthropic-ai/claude-agent-sdk`) is at version 0.2.12, while the Python package (`claude-agent-sdk`) is actively maintained on GitHub[3][4].

Session management is a core feature that allows conversations to persist and resume across multiple interactions. Sessions are stored per project directory, with the full message history, tool usage, and context restored when resuming[5]. The SDK supports session forking for exploring different approaches from the same starting point, and provides both CLI flags (`--continue`, `--resume`) and programmatic APIs for session control[6].

For autonomous execution, the SDK offers multiple permission modes: `acceptEdits` for auto-approving file operations, `bypassPermissions` for fully unattended execution (with explicit opt-in via `allow_dangerously_skip_permissions`), and `default` mode with custom approval callbacks[7]. Hooks provide interception points for security controls, logging, and custom logic at key execution stages[8].

## Philosophy & Mental Model

The Claude Agent SDK embodies an "agent loop" architecture where Claude autonomously decides which tools to use, executes them, observes results, and iterates until the task is complete[2]. This differs fundamentally from the Anthropic Client SDK where you implement the tool loop yourself.

**Key Mental Model:**
```
Prompt → Agent Loop → [Tool Decision → Tool Execution → Observation] → Result
                      ↑_________________________________↓
```

The SDK handles orchestration (tool execution, context management, retries) while you consume a stream of messages. Each message represents Claude's reasoning, a tool call, a tool result, or the final outcome[9].

**Sessions as Conversation State:** Sessions persist the full conversation history including all tool calls and their results. When you resume a session, Claude has complete context of what was done previously, enabling multi-turn workflows that span hours or days[5].

**Permission Modes as Trust Levels:** Think of permission modes as graduated trust levels:
- `default`: Human in the loop for everything
- `acceptEdits`: Trust file operations, ask for other actions
- `bypassPermissions`: Full autonomy (dangerous, requires explicit opt-in)[7]

## Setup

### Install Claude Code Runtime

The SDK uses Claude Code as its runtime. Install it first:

```bash
# macOS/Linux/WSL
curl -fsSL https://claude.ai/install.sh | bash

# Homebrew
brew install --cask claude-code

# Windows
winget install Anthropic.ClaudeCode
```

After installation, run `claude` to authenticate[9].

### Install the SDK

```bash
# TypeScript
npm install @anthropic-ai/claude-agent-sdk

# Python (with uv)
uv add claude-agent-sdk

# Python (with pip)
pip install claude-agent-sdk
```

### Set API Key

```bash
export ANTHROPIC_API_KEY=your-api-key
```

Or create a `.env` file. The SDK also supports Amazon Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`), Google Vertex AI (`CLAUDE_CODE_USE_VERTEX=1`), and Microsoft Foundry (`CLAUDE_CODE_USE_FOUNDRY=1`)[2].

## Core Usage Patterns

### Pattern 1: Basic Autonomous Agent

Run an agent that reads, analyzes, and edits code autonomously:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Find and fix the bug in auth.py",
  options: {
    allowedTools: ["Read", "Edit", "Bash"],
    permissionMode: "acceptEdits"
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

async def main():
    async for message in query(
        prompt="Find and fix the bug in auth.py",
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Edit", "Bash"],
            permission_mode="acceptEdits"
        )
    ):
        if hasattr(message, "result"):
            print(message.result)

asyncio.run(main())
```

### Pattern 2: Session Resumption

Capture session IDs to resume conversations with full context:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

let sessionId: string | undefined;

// First query: capture session ID from init message
for await (const message of query({
  prompt: "Read the authentication module",
  options: { allowedTools: ["Read", "Glob"] }
})) {
  if (message.type === "system" && message.subtype === "init") {
    sessionId = message.session_id;
  }
}

// Resume with full context
for await (const message of query({
  prompt: "Now find all places that call it",
  options: { resume: sessionId }
})) {
  if ("result" in message) console.log(message.result);
}
```

```python
from claude_agent_sdk import query, ClaudeAgentOptions

session_id = None

async for message in query(
    prompt="Read the authentication module",
    options=ClaudeAgentOptions(allowed_tools=["Read", "Glob"])
):
    if hasattr(message, 'subtype') and message.subtype == 'init':
        session_id = message.session_id

# Resume with full context
async for message in query(
    prompt="Now find all places that call it",
    options=ClaudeAgentOptions(resume=session_id)
):
    if hasattr(message, "result"):
        print(message.result)
```

### Pattern 3: Session Forking

Fork sessions to explore different approaches without modifying the original:

```typescript
// Fork to try a different approach
const forkedResponse = query({
  prompt: "Redesign this as GraphQL instead",
  options: {
    resume: sessionId,
    forkSession: true,  // Creates new session ID
    model: "claude-sonnet-4-5"
  }
});
```

### Pattern 4: CLI Headless Mode

Run Claude programmatically from the command line for CI/CD:

```bash
# Basic non-interactive execution
claude -p "Find and fix the bug in auth.py" --allowedTools "Read,Edit,Bash"

# Get structured JSON output
claude -p "Summarize this project" --output-format json

# Continue most recent conversation
claude -p "Show our progress" --continue

# Resume specific session
session_id=$(claude -p "Start review" --output-format json | jq -r '.session_id')
claude -p "Continue review" --resume "$session_id"
```

### Pattern 5: Hooks for Security and Logging

Intercept tool execution for validation, blocking, or logging:

```typescript
import { query, HookCallback } from "@anthropic-ai/claude-agent-sdk";

const protectEnvFiles: HookCallback = async (input, toolUseID, { signal }) => {
  const filePath = (input as any).tool_input?.file_path as string;
  if (filePath?.endsWith('.env')) {
    return {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: 'deny',
        permissionDecisionReason: 'Cannot modify .env files'
      }
    };
  }
  return {};
};

for await (const message of query({
  prompt: "Update configuration",
  options: {
    hooks: {
      PreToolUse: [{ matcher: 'Write|Edit', hooks: [protectEnvFiles] }]
    }
  }
})) {
  console.log(message);
}
```

```python
from claude_agent_sdk import query, ClaudeAgentOptions, HookMatcher

async def protect_env_files(input_data, tool_use_id, context):
    file_path = input_data['tool_input'].get('file_path', '')
    if file_path.endswith('.env'):
        return {
            'hookSpecificOutput': {
                'hookEventName': input_data['hook_event_name'],
                'permissionDecision': 'deny',
                'permissionDecisionReason': 'Cannot modify .env files'
            }
        }
    return {}

async for message in query(
    prompt="Update configuration",
    options=ClaudeAgentOptions(
        hooks={
            'PreToolUse': [HookMatcher(matcher='Write|Edit', hooks=[protect_env_files])]
        }
    )
):
    print(message)
```

### Pattern 6: Subagents for Parallel Work

Spawn specialized agents for focused subtasks:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Use the code-reviewer agent to review this codebase",
  options: {
    allowedTools: ["Read", "Glob", "Grep", "Task"],
    agents: {
      "code-reviewer": {
        description: "Expert code reviewer for quality and security reviews.",
        prompt: "Analyze code quality and suggest improvements.",
        tools: ["Read", "Glob", "Grep"]
      }
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

### Pattern 7: MCP Integration

Connect external systems via Model Context Protocol:

```typescript
for await (const message of query({
  prompt: "Open example.com and describe what you see",
  options: {
    mcpServers: {
      playwright: { command: "npx", args: ["@playwright/mcp@latest"] }
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

## Anti-Patterns & Pitfalls

### Don't: Use bypassPermissions Without Isolation

```typescript
// DANGEROUS - Claude has full system access
for await (const message of query({
  prompt: "Refactor the entire codebase",
  options: {
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true  // Required opt-in
  }
})) { ... }
```

**Why it's wrong:** This grants Claude unrestricted access to your filesystem and can execute any command. Research found 22.2% of public Claude configurations grant `Bash(rm:*)` permission, enabling permanent file deletion[10]. Prompt injection attacks can exploit these permissions[11].

### Instead: Use acceptEdits with Hooks

```typescript
for await (const message of query({
  prompt: "Refactor the entire codebase",
  options: {
    permissionMode: "acceptEdits",
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [validateCommands] },
        { matcher: 'Write|Edit', hooks: [blockSensitivePaths] }
      ]
    }
  }
})) { ... }
```

### Don't: Ignore Session IDs in Multi-Turn Workflows

```typescript
// BAD - loses context between calls
await query({ prompt: "Read auth.py" });
await query({ prompt: "Find bugs in that file" }); // "that file" has no reference
```

**Why it's wrong:** Each `query()` call starts a fresh session. Claude won't know what "that file" refers to.

### Instead: Capture and Resume Sessions

```typescript
let sessionId: string;
for await (const msg of query({ prompt: "Read auth.py" })) {
  if (msg.type === "system" && msg.subtype === "init") sessionId = msg.session_id;
}
for await (const msg of query({ prompt: "Find bugs in that file", options: { resume: sessionId } })) {
  console.log(msg);
}
```

### Don't: Run YOLO Mode in Production

```bash
# DANGEROUS - no safety checks
claude -p "Deploy to production" --dangerously-skip-permissions
```

**Why it's wrong:** The flag name includes "dangerously" for a reason. Users have reported Claude deleting config files, modifying system directories, and performing unintended bulk operations[12].

### Instead: Use Isolated Containers + Version Control

```bash
# Run in Docker with limited scope
docker run --rm -v $(pwd):/workspace claude-code \
  -p "Refactor utils.py" --allowedTools "Read,Edit,Glob"
```

Always ensure `git reset --hard` can undo anything Claude does[12].

### Don't: Overload Context with Large Prompts

```typescript
// BAD - may hit context limits on complex codebases
await query({ prompt: "Analyze every file in this monorepo and generate a comprehensive report" });
```

**Why it's wrong:** Large context windows still have limits. Complex tasks can trigger automatic compaction, losing detail.

### Instead: Use Subagents for Parallel Analysis

```typescript
// Good - delegate to specialized subagents
await query({
  prompt: "Coordinate analysis of src/, tests/, and docs/ directories",
  options: {
    allowedTools: ["Task"],
    agents: {
      "src-analyzer": { tools: ["Read", "Glob"], prompt: "Analyze src/" },
      "test-analyzer": { tools: ["Read", "Glob"], prompt: "Analyze tests/" },
      "doc-analyzer": { tools: ["Read", "Glob"], prompt: "Analyze docs/" }
    }
  }
});
```

## Why This Choice

### Decision Criteria

| Criterion | Weight | How Claude Agent SDK Scored |
|-----------|--------|----------------------------|
| Built-in Tool Execution | High | Excellent - Read, Write, Edit, Bash, Glob, Grep, WebSearch built-in |
| Session Management | High | Excellent - Full resume, fork, and CLI integration |
| Permission Control | High | Excellent - Granular hooks, multiple modes, callback-based approval |
| TypeScript/Python Support | Medium | Excellent - First-party support for both |
| CI/CD Integration | Medium | Excellent - Official GitHub Action, headless mode |
| Multi-Agent Orchestration | Medium | Good - Subagent support, though community frameworks extend further |
| Learning Curve | Low | Moderate - Requires understanding agent loop paradigm |

### Key Factors

- **Tool Execution Built-In:** Unlike the Anthropic Client SDK where you implement tool execution, the Agent SDK handles it. This is the primary differentiator[2].

- **Session Persistence:** Sessions store the complete conversation state, enabling workflows that span multiple interactions or even days[5].

- **Production-Ready Patterns:** Hooks, permission modes, and subagents provide patterns for production deployment with appropriate safety controls[7][8].

## Alternatives Considered

### Anthropic Client SDK

- **What it is:** Direct API access for sending prompts and implementing tool execution yourself[2]
- **Why not chosen:** Requires you to build the tool loop, handle retries, manage context
- **Choose this instead when:**
  - You need custom tool implementations not covered by built-in tools
  - You want minimal dependencies
  - You're building non-agentic applications
- **Key tradeoff:** Full control vs. implementation effort

### Claude Code CLI (Interactive)

- **What it is:** Interactive terminal interface for Claude Code
- **Why not chosen:** Not programmatically controllable, requires human interaction
- **Choose this instead when:**
  - Daily development and exploration
  - One-off tasks
  - Learning Claude Code capabilities
- **Key tradeoff:** Human oversight vs. automation capability

### Community Multi-Agent Frameworks

- **What it is:** Frameworks like Claude-Flow, oh-my-claudecode that extend multi-agent capabilities[13][14]
- **Why not chosen:** Not officially supported, additional complexity
- **Choose this instead when:**
  - You need 20+ specialized agents
  - You want pre-built agent libraries
  - You're building complex orchestration systems
- **Key tradeoff:** More agents vs. maintenance burden

### LangChain/LangGraph with Claude

- **What it is:** General-purpose agent frameworks that can use Claude as the LLM
- **Why not chosen:** Additional abstraction layer, not Claude-optimized
- **Choose this instead when:**
  - You need to swap between different LLMs
  - You have existing LangChain infrastructure
- **Key tradeoff:** Flexibility vs. Claude-specific optimizations

## Caveats & Limitations

- **Claude Code Runtime Required:** The SDK uses Claude Code as its runtime. It must be installed separately, and authentication flows can be challenging in headless/CI environments[15].

- **Permission Inheritance in Subagents:** When using `bypassPermissions`, all subagents inherit this mode and it cannot be overridden. Subagents may have less constrained behavior, granting them full autonomous access[7].

- **Hook Availability Differs by SDK:** `SessionStart`, `SessionEnd`, and `Notification` hooks are TypeScript-only. Python SDK does not support these events[8].

- **Context Window Limits:** While sessions persist history, extremely long sessions may trigger automatic compaction. Use `PreCompact` hooks to archive transcripts if needed[8].

- **Cost Considerations:** Autonomous agents can make many API calls. Token usage scales with task complexity and tool iterations. Use `max_turns` to limit iterations[9].

- **Prompt Injection Risks:** When `bypassPermissions` is enabled, the agent can be manipulated by malicious content in files it reads. Always use in isolated environments[11].

## Appendix: Data Formats

### CLI Output Formats

**`--output-format json`** returns a single JSON object with the final result:

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 2432,
  "duration_api_ms": 2355,
  "num_turns": 1,
  "result": "4",
  "session_id": "4211ceae-859e-424c-ad77-085b978c5859",
  "total_cost_usd": 0.136,
  "usage": {
    "input_tokens": 3,
    "cache_creation_input_tokens": 21802,
    "cache_read_input_tokens": 0,
    "output_tokens": 5
  },
  "modelUsage": { ... },
  "permission_denials": [],
  "uuid": "16aa8f78-adbb-487d-93e3-02ec8332a704"
}
```

**`--output-format stream-json --verbose`** streams newline-delimited JSON (JSONL) in real-time:

```json
{"type":"system","subtype":"init","session_id":"5b50d626-...","tools":["Task","Bash","Read",...]}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello..."}]}}
{"type":"result","subtype":"success","result":"Hello!","session_id":"5b50d626-..."}
```

Extract text from stream-json with jq:
```bash
claude -p "task" --output-format stream-json --verbose | \
  jq -j 'select(.type == "assistant") | .message.content[]?.text // empty'
```

### Session Storage Format (~/.claude)

Sessions are stored in `~/.claude/projects/` with paths encoded as hyphen-separated:
- `/Users/wschenk/projects/myapp` → `-Users-wschenk-projects-myapp/`

Each session is a **JSONL file** (one JSON object per line) named by UUID:
```
~/.claude/projects/-Users-wschenk-projects-myapp/
  └── fb071297-cf86-4ff8-b0c7-3079fc8ffd9c.jsonl
```

**Session Transcript Structure:**

```json
// User message
{
  "type": "user",
  "parentUuid": "previous-message-uuid",
  "uuid": "da1854ce-0695-44c2-ab44-db501f3f9aa2",
  "sessionId": "fb071297-cf86-4ff8-b0c7-3079fc8ffd9c",
  "cwd": "/Users/wschenk/The-Focus-AI/umwelten",
  "gitBranch": "main",
  "version": "2.1.17",
  "timestamp": "2026-01-24T08:55:38.289Z",
  "message": {
    "role": "user",
    "content": "Find bugs in auth.py"
  }
}

// Assistant message with tool use
{
  "type": "assistant",
  "parentUuid": "da1854ce-...",
  "uuid": "8d6fdc14-2499-47a1-bc8e-5f2e42544dc9",
  "sessionId": "fb071297-cf86-4ff8-b0c7-3079fc8ffd9c",
  "timestamp": "2026-01-24T08:55:45.460Z",
  "message": {
    "model": "claude-opus-4-5-20251101",
    "id": "msg_01TRSV6ZumXa45DGoaeVQTcX",
    "role": "assistant",
    "content": [
      {"type": "text", "text": "I'll analyze auth.py..."},
      {"type": "tool_use", "id": "toolu_01EX...", "name": "Read", "input": {"file_path": "auth.py"}}
    ],
    "usage": {
      "input_tokens": 10,
      "output_tokens": 3,
      "cache_creation_input_tokens": 23678
    }
  }
}

// File history snapshot (for rollback)
{
  "type": "file-history-snapshot",
  "messageId": "a21fef14-...",
  "snapshot": {
    "trackedFileBackups": {},
    "timestamp": "2026-01-17T16:56:27.318Z"
  }
}
```

**Key fields in session transcripts:**
- `type`: `user`, `assistant`, `tool`, `file-history-snapshot`
- `parentUuid`: Links to previous message (forms conversation tree)
- `sessionId`: UUID of the session
- `uuid`: Unique ID for this message
- `isSidechain`: Whether this is a branched conversation
- `message.content`: Array of text blocks and tool_use blocks

### Programmatically Reading Sessions (TypeScript)

```typescript
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Types matching Claude Code's session transcript format
interface SessionMessage {
  type: 'user' | 'assistant' | 'tool' | 'file-history-snapshot';
  parentUuid: string | null;
  uuid: string;
  sessionId: string;
  cwd: string;
  gitBranch?: string;
  version: string;
  timestamp: string;
  isSidechain?: boolean;
  message?: {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
    model?: string;
    id?: string;
    usage?: TokenUsage;
  };
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Encode a project path to Claude's directory format
 * /Users/foo/bar → -Users-foo-bar
 */
function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, '-');
}

/**
 * Get the Claude projects directory for a given project path
 */
function getProjectDir(projectPath: string): string {
  const encoded = encodeProjectPath(projectPath);
  return join(homedir(), '.claude', 'projects', encoded);
}

/**
 * List all session IDs for a project
 */
export function listSessions(projectPath: string): string[] {
  const projectDir = getProjectDir(projectPath);
  if (!existsSync(projectDir)) return [];

  return readdirSync(projectDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.replace('.jsonl', ''));
}

/**
 * Read all messages from a session transcript
 */
export function readSession(sessionId: string, projectPath: string): SessionMessage[] {
  const projectDir = getProjectDir(projectPath);
  const transcriptPath = join(projectDir, `${sessionId}.jsonl`);

  if (!existsSync(transcriptPath)) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const content = readFileSync(transcriptPath, 'utf-8');
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as SessionMessage);
}

/**
 * Get session metadata (first user message, timestamps, etc.)
 */
export function getSessionMetadata(sessionId: string, projectPath: string) {
  const messages = readSession(sessionId, projectPath);
  const userMessages = messages.filter(m => m.type === 'user' && m.message);
  const assistantMessages = messages.filter(m => m.type === 'assistant');

  return {
    sessionId,
    messageCount: messages.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
    firstTimestamp: messages[0]?.timestamp,
    lastTimestamp: messages[messages.length - 1]?.timestamp,
    gitBranch: messages[0]?.gitBranch,
    cwd: messages[0]?.cwd,
    // Extract first user prompt for preview
    preview: userMessages[0]?.message?.content?.toString().slice(0, 100),
  };
}

/**
 * Calculate token usage across a session
 */
export function getSessionTokenUsage(sessionId: string, projectPath: string) {
  const messages = readSession(sessionId, projectPath);
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;

  for (const msg of messages) {
    if (msg.type === 'assistant' && msg.message?.usage) {
      totalInput += msg.message.usage.input_tokens || 0;
      totalOutput += msg.message.usage.output_tokens || 0;
      totalCacheCreation += msg.message.usage.cache_creation_input_tokens || 0;
      totalCacheRead += msg.message.usage.cache_read_input_tokens || 0;
    }
  }

  return { totalInput, totalOutput, totalCacheCreation, totalCacheRead };
}

// Example usage
const sessions = listSessions('/Users/wschenk/The-Focus-AI/umwelten');
for (const sessionId of sessions.slice(0, 5)) {
  const meta = getSessionMetadata(sessionId, '/Users/wschenk/The-Focus-AI/umwelten');
  console.log(`Session ${sessionId}: ${meta.userMessageCount} user messages`);
  console.log(`  Preview: ${meta.preview}...`);
}
```

### Related Directories

| Directory | Purpose |
|-----------|---------|
| `~/.claude/projects/` | Session transcripts (JSONL) |
| `~/.claude/history.jsonl` | Input history (like shell history) |
| `~/.claude/file-history/` | File backups for rollback |
| `~/.claude/session-env/` | Environment snapshots per session |
| `~/.claude/todos/` | Todo lists per session |
| `~/.claude/plans/` | Plan mode documents |

### Community Tools for Transcripts

- [claude-code-transcripts](https://github.com/simonw/claude-code-transcripts) - Simon Willison's tool for publishing transcripts[21]
- [claude-JSONL-browser](https://github.com/withLinda/claude-JSONL-browser) - Web UI for browsing logs[22]
- [claude-code-log](https://pypi.org/project/claude-code-log/) - Python CLI to convert JSONL to HTML[23]

## Appendix: Integration with umwelten

### Claude Agent Provider for umwelten

Create a new provider that wraps the Claude Agent SDK, following umwelten's provider pattern:

```typescript
// src/providers/claude-agent.ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ModelDetails, ModelRoute } from '../cognition/types.js';

// Message types from Claude Agent SDK stream
interface AgentMessage {
  type: 'system' | 'assistant' | 'result';
  subtype?: 'init' | 'success' | 'error';
  session_id?: string;
  message?: {
    role: string;
    content: ContentBlock[];
    usage?: { input_tokens: number; output_tokens: number };
  };
  result?: string;
  total_cost_usd?: number;
  usage?: TokenUsage;
}

interface ContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ClaudeAgentOptions {
  allowedTools?: string[];
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
  systemPrompt?: string;
  resume?: string;        // Session ID to resume
  forkSession?: boolean;  // Fork instead of continue
  maxTurns?: number;
}

/**
 * Run a prompt through Claude Agent SDK and collect the result
 */
export async function runClaudeAgent(
  prompt: string,
  options: ClaudeAgentOptions = {}
): Promise<{
  result: string;
  sessionId: string;
  usage: TokenUsage;
  cost: number;
  messages: AgentMessage[];
}> {
  const messages: AgentMessage[] = [];
  let sessionId = '';
  let result = '';
  let totalUsage: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let cost = 0;

  for await (const message of query({
    prompt,
    options: {
      allowedTools: options.allowedTools ?? ['Read', 'Glob', 'Grep'],
      permissionMode: options.permissionMode ?? 'acceptEdits',
      systemPrompt: options.systemPrompt,
      resume: options.resume,
      forkSession: options.forkSession,
      maxTurns: options.maxTurns,
    },
  })) {
    messages.push(message as AgentMessage);

    if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id ?? '';
    }

    if (message.type === 'result') {
      result = message.result ?? '';
      cost = message.total_cost_usd ?? 0;
      if (message.usage) {
        totalUsage = {
          input_tokens: message.usage.input_tokens,
          output_tokens: message.usage.output_tokens,
          cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
        };
      }
    }
  }

  return { result, sessionId, usage: totalUsage, cost, messages };
}

/**
 * Stream messages from Claude Agent SDK
 */
export async function* streamClaudeAgent(
  prompt: string,
  options: ClaudeAgentOptions = {}
): AsyncGenerator<AgentMessage> {
  for await (const message of query({
    prompt,
    options: {
      allowedTools: options.allowedTools ?? ['Read', 'Glob', 'Grep'],
      permissionMode: options.permissionMode ?? 'acceptEdits',
      systemPrompt: options.systemPrompt,
      resume: options.resume,
      forkSession: options.forkSession,
      maxTurns: options.maxTurns,
    },
  })) {
    yield message as AgentMessage;
  }
}

/**
 * Get available Claude models (the SDK uses Claude Code's auth)
 */
export function getClaudeAgentModels(): ModelDetails[] {
  return [
    {
      name: 'claude-sonnet-4-5',
      provider: 'claude-agent',
      description: 'Claude Sonnet 4.5 via Agent SDK',
      contextLength: 200000,
      costs: { promptTokens: 3.0, completionTokens: 15.0 },
    },
    {
      name: 'claude-opus-4-5',
      provider: 'claude-agent',
      description: 'Claude Opus 4.5 via Agent SDK',
      contextLength: 200000,
      costs: { promptTokens: 15.0, completionTokens: 75.0 },
    },
    {
      name: 'claude-haiku-4-5',
      provider: 'claude-agent',
      description: 'Claude Haiku 4.5 via Agent SDK (fast, cheap)',
      contextLength: 200000,
      costs: { promptTokens: 0.25, completionTokens: 1.25 },
    },
  ];
}
```

### Using with Evaluation Runner

Integrate with umwelten's evaluation system:

```typescript
// src/evaluation/claude-agent-runner.ts
import { EvaluationRunner } from './runner.js';
import { ModelDetails, ModelResponse } from '../cognition/types.js';
import { runClaudeAgent, ClaudeAgentOptions } from '../providers/claude-agent.js';

export class ClaudeAgentEvaluationRunner extends EvaluationRunner {
  private options: ClaudeAgentOptions;
  private sessionId?: string; // Track session for multi-turn evals

  constructor(evaluationId: string, options: ClaudeAgentOptions = {}) {
    super(evaluationId);
    this.options = options;
  }

  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    const startTime = new Date();

    // Use session resumption for multi-turn evaluations
    const agentOptions: ClaudeAgentOptions = {
      ...this.options,
      resume: this.sessionId,
    };

    const { result, sessionId, usage, cost, messages } = await runClaudeAgent(
      this.stimulus.getPrompt(),
      agentOptions
    );

    // Store session ID for subsequent calls
    this.sessionId = sessionId;

    const endTime = new Date();

    return {
      content: result,
      metadata: {
        startTime,
        endTime,
        tokenUsage: {
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens,
        },
        provider: 'claude-agent',
        model: details.name,
        cost: {
          promptCost: cost * 0.3, // Approximate split
          completionCost: cost * 0.7,
          totalCost: cost,
        },
      },
    };
  }

  // Get the session ID for later resumption or analysis
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  // Fork the current session to try different approaches
  async forkSession(): Promise<string | undefined> {
    if (!this.sessionId) return undefined;

    // Run a no-op to create a fork
    const { sessionId } = await runClaudeAgent('Continue', {
      ...this.options,
      resume: this.sessionId,
      forkSession: true,
    });

    return sessionId;
  }
}
```

### CLI Integration

Add a command to the CLI for running Claude Agent evaluations:

```typescript
// In src/cli/cli.ts - add to existing commands

program
  .command('agent')
  .description('Run prompts through Claude Agent SDK')
  .argument('<prompt>', 'The prompt to run')
  .option('-t, --tools <tools>', 'Comma-separated tools to allow', 'Read,Glob,Grep')
  .option('-r, --resume <sessionId>', 'Resume a previous session')
  .option('-f, --fork', 'Fork the session instead of continuing')
  .option('--accept-edits', 'Auto-approve file edits')
  .option('--max-turns <n>', 'Maximum agent turns', parseInt)
  .option('--json', 'Output as JSON')
  .action(async (prompt, options) => {
    const { runClaudeAgent, streamClaudeAgent } = await import('../providers/claude-agent.js');

    const agentOptions = {
      allowedTools: options.tools.split(','),
      permissionMode: options.acceptEdits ? 'acceptEdits' : 'default',
      resume: options.resume,
      forkSession: options.fork,
      maxTurns: options.maxTurns,
    };

    if (options.json) {
      const result = await runClaudeAgent(prompt, agentOptions);
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Stream output for interactive use
      for await (const message of streamClaudeAgent(prompt, agentOptions)) {
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text) {
              process.stdout.write(block.text);
            } else if (block.type === 'tool_use') {
              console.log(`\n[Tool: ${block.name}]`);
            }
          }
        }
        if (message.type === 'result') {
          console.log(`\n\nSession: ${message.session_id}`);
          console.log(`Cost: $${message.total_cost_usd?.toFixed(4)}`);
        }
      }
    }
  });
```

### Session Analyzer Utility

Add a utility for analyzing Claude Code sessions:

```typescript
// src/cli/sessions.ts
import { program } from 'commander';
import { listSessions, getSessionMetadata, getSessionTokenUsage, readSession } from '../providers/claude-sessions.js';

program
  .command('sessions')
  .description('Analyze Claude Code sessions')
  .argument('[project]', 'Project path', process.cwd())
  .option('-l, --list', 'List all sessions')
  .option('-s, --session <id>', 'Show details for a session')
  .option('--tokens', 'Show token usage')
  .option('--messages', 'Show all messages')
  .option('--json', 'Output as JSON')
  .action(async (project, options) => {
    if (options.list) {
      const sessions = listSessions(project);
      for (const sessionId of sessions) {
        const meta = getSessionMetadata(sessionId, project);
        console.log(`${sessionId}`);
        console.log(`  Created: ${meta.firstTimestamp}`);
        console.log(`  Messages: ${meta.messageCount} (${meta.userMessageCount} user)`);
        console.log(`  Preview: ${meta.preview?.slice(0, 60)}...`);
        console.log();
      }
    }

    if (options.session) {
      const meta = getSessionMetadata(options.session, project);

      if (options.json) {
        console.log(JSON.stringify(meta, null, 2));
      } else {
        console.log(`Session: ${options.session}`);
        console.log(`Branch: ${meta.gitBranch || 'none'}`);
        console.log(`Directory: ${meta.cwd}`);
        console.log(`Messages: ${meta.messageCount}`);
        console.log(`First: ${meta.firstTimestamp}`);
        console.log(`Last: ${meta.lastTimestamp}`);
      }

      if (options.tokens) {
        const usage = getSessionTokenUsage(options.session, project);
        console.log(`\nToken Usage:`);
        console.log(`  Input: ${usage.totalInput.toLocaleString()}`);
        console.log(`  Output: ${usage.totalOutput.toLocaleString()}`);
        console.log(`  Cache Creation: ${usage.totalCacheCreation.toLocaleString()}`);
        console.log(`  Cache Read: ${usage.totalCacheRead.toLocaleString()}`);
      }

      if (options.messages) {
        const messages = readSession(options.session, project);
        for (const msg of messages) {
          if (msg.type === 'user' || msg.type === 'assistant') {
            console.log(`\n[${msg.type.toUpperCase()}] ${msg.timestamp}`);
            const content = msg.message?.content;
            if (typeof content === 'string') {
              console.log(content.slice(0, 200));
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text') console.log(block.text?.slice(0, 200));
                if (block.type === 'tool_use') console.log(`[Tool: ${block.name}]`);
              }
            }
          }
        }
      }
    }
  });
```

## References

[1] [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview) - Official overview of SDK capabilities and architecture

[2] [Building agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk) - Anthropic engineering blog on SDK design philosophy

[3] [@anthropic-ai/claude-agent-sdk - npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) - TypeScript SDK package, version 0.2.12

[4] [GitHub - anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python) - Python SDK repository

[5] [Session Management - Claude Docs](https://platform.claude.com/docs/en/agent-sdk/sessions) - Session resumption and forking documentation

[6] [Common workflows - Claude Code Docs](https://code.claude.com/docs/en/common-workflows) - CLI session flags and patterns

[7] [Configure permissions - Claude Docs](https://platform.claude.com/docs/en/agent-sdk/permissions) - Permission modes and approval callbacks

[8] [Intercept and control agent behavior with hooks](https://platform.claude.com/docs/en/agent-sdk/hooks) - Complete hooks reference

[9] [Quickstart - Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/quickstart) - Getting started guide with setup and examples

[10] [YOLO Mode: Hidden Risks in Claude Code Permissions](https://www.upguard.com/blog/yolo-mode-hidden-risks-in-claude-code-permissions) - Security analysis of public Claude configurations

[11] [Living dangerously with Claude](https://simonwillison.net/2025/Oct/22/living-dangerously-with-claude/) - Simon Willison on prompt injection risks

[12] [Claude Code dangerously-skip-permissions: Safe Usage Guide](https://www.ksred.com/claude-code-dangerously-skip-permissions-when-to-use-it-and-when-you-absolutely-shouldnt/) - Best practices for YOLO mode

[13] [GitHub - ruvnet/claude-flow](https://github.com/ruvnet/claude-flow) - Multi-agent orchestration framework

[14] [GitHub - Yeachan-Heo/oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) - 28-agent orchestration system

[15] [feat(docs, auth): Document Headless/Remote Authentication - GitHub Issue](https://github.com/anthropics/claude-code/issues/7100) - Authentication challenges in CI/CD

[16] [Run Claude Code programmatically](https://code.claude.com/docs/en/headless) - Headless mode and CLI documentation

[17] [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions) - CI/CD integration guide

[18] [Create custom subagents](https://code.claude.com/docs/en/sub-agents) - Subagent configuration and patterns

[19] [Claude Agent SDK Tutorial - DataCamp](https://www.datacamp.com/tutorial/how-to-use-claude-agent-sdk) - Hands-on tutorial with examples

[20] [Claude Code Session Management - Steve Kinney](https://stevekinney.com/courses/ai-development/claude-code-session-management) - Session management patterns and best practices

[21] [GitHub - simonw/claude-code-transcripts](https://github.com/simonw/claude-code-transcripts) - Tools for publishing Claude Code session transcripts

[22] [GitHub - withLinda/claude-JSONL-browser](https://github.com/withLinda/claude-JSONL-browser) - Web-based JSONL log browser with markdown export

[23] [claude-code-log - PyPI](https://pypi.org/project/claude-code-log/) - Python CLI for converting JSONL transcripts to HTML

[24] [How to Extract Text from Claude Code JSON Stream Output](https://www.ytyng.com/en/blog/claude-stream-json-jq/) - Using jq with stream-json format

[25] [What is --output-format in Claude Code](https://claudelog.com/faqs/what-is-output-format-in-claude-code/) - Output format options documentation
