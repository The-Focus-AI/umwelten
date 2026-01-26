# Claude Agent Monitor

A system to browse, analyze, and schedule Claude agent sessions.

## Overview

The Claude Agent Monitor provides tools to:
1. **Browse sessions** - List and inspect Claude sessions for any project
2. **Analyze usage** - Track tokens, costs, and patterns across sessions
3. **Schedule runs** - Automate Claude agent execution on repositories

## Phase 1: Session Browser

### Goal

Navigate to any project directory and explore Claude session history:

```bash
cd /path/to/project
npx umwelten sessions              # List all sessions
npx umwelten sessions show <id>    # View session details
npx umwelten sessions messages <id> # Show conversation
```

### How Claude Stores Sessions

Sessions are stored in `~/.claude/projects/<encoded-path>/`:

```
~/.claude/projects/-Users-wschenk-my-project/
├── sessions-index.json          # Index with metadata
├── abc123.jsonl                 # Full transcript
└── abc123/                      # File backups (optional)
```

Path encoding: `/Users/wschenk/project` becomes `-Users-wschenk-project`

#### sessions-index.json

Contains metadata for all sessions without parsing JSONL:

```json
{
  "version": 1,
  "originalPath": "/Users/wschenk/my-project",
  "entries": [
    {
      "sessionId": "abc123-...",
      "fullPath": "~/.claude/projects/.../abc123.jsonl",
      "firstPrompt": "Help me fix the bug...",
      "messageCount": 19,
      "created": "2026-01-24T08:55:10.874Z",
      "modified": "2026-01-24T09:12:54.076Z",
      "gitBranch": "main",
      "projectPath": "/Users/wschenk/my-project",
      "isSidechain": false
    }
  ]
}
```

#### JSONL Transcript Format

Each line is a JSON object with different types:

| Type | Description |
|------|-------------|
| `user` | User messages with `message.content` |
| `assistant` | Claude responses with `message.content[]`, `message.usage` |
| `progress` | Hook progress events |
| `file-history-snapshot` | File backup snapshots |
| `queue-operation` | Internal queue operations |

Example assistant message with tool use:

```json
{
  "type": "assistant",
  "uuid": "5bceeb1e-...",
  "parentUuid": "50b5a8d8-...",
  "sessionId": "4211ceae-...",
  "timestamp": "2026-01-24T09:09:00.552Z",
  "message": {
    "model": "claude-opus-4-5-20251101",
    "role": "assistant",
    "content": [
      {"type": "text", "text": "I'll read the file..."},
      {"type": "tool_use", "id": "toolu_01...", "name": "Read", "input": {"file_path": "src/main.ts"}}
    ],
    "usage": {
      "input_tokens": 1234,
      "output_tokens": 456,
      "cache_creation_input_tokens": 21802
    }
  }
}
```

### CLI Commands

```bash
# Session browsing
npx umwelten sessions                    # List sessions for current directory
npx umwelten sessions list               # Same as above
npx umwelten sessions show <id>          # Show session details
npx umwelten sessions messages <id>      # Show conversation messages
npx umwelten sessions tools <id>         # Show tool calls in session
npx umwelten sessions stats <id>         # Token usage, cost, duration
npx umwelten sessions export <id>        # Export to markdown/JSON

# Live stream formatting
claude -p "task" --output-format stream-json | npx umwelten sessions format
```

### Data Types

```typescript
// From sessions-index.json
interface SessionIndexEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}

// Parsed from JSONL
interface SessionMessage {
  type: 'user' | 'assistant' | 'progress' | 'file-history-snapshot' | 'queue-operation';
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  sessionId: string;
  cwd: string;
  gitBranch?: string;
  message?: {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
    model?: string;
    usage?: TokenUsage;
  };
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
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
```

### Module Structure

```
src/sessions/
├── index.ts              # Re-exports
├── types.ts              # TypeScript interfaces
├── session-store.ts      # Read sessions-index.json
├── session-parser.ts     # Parse JSONL transcripts
├── session-formatter.ts  # Format for CLI output
└── stream-formatter.ts   # Format live stream-json

src/cli/
├── cli.ts                # Add sessions command
└── sessions.ts           # Session subcommands
```

### Example Output

```
$ npx umwelten sessions

Sessions for /Users/wschenk/The-Focus-AI/umwelten

ID                                   | Date       | Messages | Preview
-------------------------------------|------------|----------|---------------------------
fb071297-cf86-4ff8-b0c7-3079fc8ffd9c | 2026-01-24 | 45       | Help me build a claude...
da1854ce-0695-44c2-ab44-db501f3f9aa2 | 2026-01-23 | 12       | Fix the type errors...

$ npx umwelten sessions show fb071297

Session: fb071297-cf86-4ff8-b0c7-3079fc8ffd9c
Project: /Users/wschenk/The-Focus-AI/umwelten
Branch: main
Started: 2026-01-24 08:55:38
Duration: 2h 15m
Messages: 45 (12 user, 33 assistant)
Tool calls: 127
Tokens: 145,234 in / 23,456 out
Cost: ~$4.23
```

---

## Phase 2: Session Analysis

Add analysis capabilities on top of session browsing.

### CLI Commands

```bash
npx umwelten sessions search <query>       # Search across all sessions
npx umwelten sessions compare <id> <id>    # Compare two sessions
npx umwelten sessions summary              # Stats across all sessions
npx umwelten sessions cost [--since date]  # Cost tracking over time
```

### Features

1. **Search** - Find sessions by prompt content, tool usage, or text
2. **Cost tracking** - Aggregate tokens and costs by day/week/month
3. **Comparison** - Side-by-side session comparison
4. **Pattern extraction** - Identify common tool sequences
5. **Failure detection** - Flag sessions with errors

### Analytics Data

```typescript
interface SessionAnalytics {
  projectPath: string;
  totalSessions: number;
  totalTokens: { input: number; output: number };
  totalCost: number;
  averageSessionDuration: number;
  topTools: { name: string; count: number }[];
  sessionsByDay: Map<string, number>;
}
```

---

## Phase 3: Scheduled Runs (Agent Monitor)

Automate Claude agent execution on repositories.

### Requirements

- Clone repos and run Claude agents on a schedule
- Support sandboxed (Dagger) and host execution modes
- Track runs and their sessions
- Commit changes to feature branches
- Web dashboard for monitoring

### CLI Commands

```bash
# Repository management
npx umwelten monitor repo add <name> <url>
npx umwelten monitor repo list
npx umwelten monitor repo remove <name>

# Task management
npx umwelten monitor task create <repo> <name> --prompt "..."
npx umwelten monitor task list
npx umwelten monitor task enable/disable <id>
npx umwelten monitor task schedule <id> "0 9 * * *"

# Execution
npx umwelten monitor run <task-id>
npx umwelten monitor run --sandbox   # Dagger container
npx umwelten monitor run --host      # Host machine (for setup)

# Monitoring
npx umwelten monitor status
npx umwelten monitor logs <run-id>
npx umwelten monitor serve           # Web dashboard + scheduler

# Session continuation
npx umwelten monitor continue <session-id> <prompt>
```

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent Monitor                            │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────────┐   │
│  │   CLI    │    │Web Server│    │     Scheduler        │   │
│  │ Commands │    │  (Hono)  │    │    (node-cron)       │   │
│  └────┬─────┘    └────┬─────┘    └──────────┬───────────┘   │
│       │               │                      │               │
│       └───────────────┼──────────────────────┘               │
│                       ▼                                      │
│              ┌──────────────┐                               │
│              │ MonitorCore  │                               │
│              └──────┬───────┘                               │
│                     │                                        │
│     ┌───────────────┼───────────────┐                       │
│     ▼               ▼               ▼                        │
│  ┌──────┐    ┌───────────┐    ┌──────────┐                  │
│  │SQLite│    │ClaudeRunner│   │  Dagger  │                  │
│  │  DB  │    │(CLI/-p)    │   │ Sandbox  │                  │
│  └──────┘    └───────────┘    └──────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

### Data Model

```typescript
// Monitored repository
interface MonitoredRepo {
  id: string;
  name: string;
  url: string;
  branch: string;
  envFile?: string;  // .env file for secrets
}

// Task definition
interface MonitorTask {
  id: string;
  repoId: string;
  name: string;
  prompt: string;
  schedule?: string;  // Cron expression
  enabled: boolean;
  timeoutMinutes: number;
  sandboxed: boolean;
  featureBranchPrefix: string;
}

// Execution record
interface MonitorRun {
  id: string;
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  sessionId?: string;  // Claude session for resume
  featureBranch?: string;
  commitSha?: string;
}
```

### Workflow

1. Add repo: `npx umwelten monitor repo add my-app https://github.com/...`
2. Create task: `npx umwelten monitor task create my-app "daily-check" --prompt "Review and fix issues"`
3. Set schedule: `npx umwelten monitor task schedule <id> "0 9 * * *"`
4. Scheduler runs: clones repo, runs Claude, commits to feature branch
5. Review: `npx umwelten sessions show <session-id>` or web dashboard
6. Continue: `npx umwelten monitor continue <session-id> "Also update tests"`

### Isolation Modes

| Mode | Use Case |
|------|----------|
| Host (`--host`) | Initial setup, getting API keys, authentication |
| Sandboxed (`--sandbox`) | Regular automated runs in Dagger container |

### Storage

```
~/.umwelten/monitor/
├── monitor.db           # SQLite database
├── repos/               # Cloned repositories
├── transcripts/         # Session JSONL files
└── logs/                # Application logs
```

### Web Dashboard

- View monitored repos and status
- See recent runs with pass/fail
- Browse session transcripts
- Continue sessions from browser
- Cost and usage charts
