# Habitat Agents

A **HabitatAgent** is a sub-agent that manages a specific project on behalf of the main [Habitat](./habitat.md). It combines a **Stimulus** (built from the project's own files) with a **persistent Interaction** (its own session with memory). This lets the main agent delegate project-specific questions to a sub-agent that understands that project's codebase, logs, and configuration.

::: tip Two Agent Types
Umwelten has **two** agent systems for different use cases:

- **HabitatAgent** (this guide): Local sub-agents for projects on the host filesystem
- **BridgeAgent**: Remote agents that run inside Dagger containers with auto-provisioning

Use HabitatAgents for local project management. Use [Bridge Agents](./habitat.md#habitat-bridge-system-experimental) for remote repositories requiring containerized execution.
:::

## Concepts

### How it fits the Habitat model

A [Habitat](./habitat.md) is the top-level container for everything an agent needs. The Habitat system works like this:

1. `loadStimulusOptionsFromWorkDir()` reads STIMULUS.md + AGENT.md + memory files to build a Stimulus
2. `Habitat.createInteraction()` creates an Interaction with that Stimulus + tools + persistent session
3. The Interaction can reason, use tools, and persists its transcript

A HabitatAgent follows the same pattern, but the Stimulus is built from the **managed project's** directory (its README, CLAUDE.md, package.json, etc.) instead of from the Habitat's own work directory. The tools are the same tools the habitat has, scoped via `agentId`.

```
Habitat (~/habitats)
  ├── Stimulus (from ~/habitats/STIMULUS.md)
  ├── Tools (read_file, ripgrep, search, run_bash, agents_*, ...)
  ├── Interaction (habitat's own conversation)
  │
  └── HabitatAgents (per managed project)
       ├── twitter-feed
       │   ├── Stimulus (built from twitter-feed's project files)
       │   ├── Tools (same tools, scoped to agentId="twitter-feed")
       │   └── Interaction (persistent session)
       ├── newsletter-feed
       │   └── ...
       └── trmnl-image
           └── ...
```

### What a HabitatAgent knows

When a HabitatAgent is created, `buildAgentStimulus()` reads from the agent's `projectPath`:

| File                       | What it provides                         |
| -------------------------- | ---------------------------------------- |
| `CLAUDE.md`                | Project-specific AI instructions         |
| `README.md`                | Project overview and documentation       |
| `package.json`             | Name, description, scripts, dependencies |
| `.claude/settings.json`    | Claude Code settings                     |
| `.claude/commands/`        | Available Claude commands                |
| Agent config `commands`    | Configured run/test/deploy commands      |
| Agent config `logPatterns` | Where to find log files                  |

This context is combined into a Stimulus with role `"habitat agent for {name}"` and instructions about using tools with the correct `agentId`.

### Persistent memory

Each HabitatAgent gets a dedicated session (`habitat-agent-{agentId}`) that persists across restarts. The transcript is written to disk, so the agent remembers what it learned in previous conversations. When you ask it to explore a project, it retains that knowledge for future questions.

## Tools

Four tools are available for working with managed agents. These are registered automatically as part of the standard tool sets.

### agent_clone

Clone a git repository and register it as a managed agent.

```
agent_clone(gitUrl, name, id?)
```

- Clones the repo into `{workDir}/repos/{id}/`
- Registers the agent via `habitat.addAgent()`
- Derives `id` from `name` if not provided (lowercased, hyphenated)

**Example:**

```
agent_clone({
  gitUrl: "git@github.com:org/twitter-feed.git",
  name: "Twitter Feed"
})
// → clones to ~/habitats/repos/twitter-feed, registers agent
```

### agent_logs

Read log files from a managed agent project.

```
agent_logs(agentId, pattern?, tail?, filter?)
```

- Uses `logPatterns` from the agent's config to find log files
- Finds matching files, reads the most recent by modification time
- Supports `tail` (default: 50 lines from end) and `filter` (string match)
- Parses JSONL files when format is `jsonl`

**Example:**

```
agent_logs({
  agentId: "twitter-feed",
  tail: 100,
  filter: "ERROR"
})
// → returns last 100 lines containing "ERROR" from the most recent log
```

### agent_status

Quick health check for a managed agent.

```
agent_status(agentId)
```

Returns:

- Agent identity (id, name, projectPath)
- Status file content (if `statusFile` is configured)
- Recent log files with timestamps and sizes
- Available commands
- Secret references

**Example:**

```
agent_status({ agentId: "twitter-feed" })
// → { id, name, statusFile: { content: "..." }, recentLogs: [...], commands: {...} }
```

### agent_ask

Delegate a question to a HabitatAgent sub-agent. The agent has persistent memory and uses tools to explore its project.

```
agent_ask(agentId, message)
```

- Gets or creates the HabitatAgent for this agent
- Sends the message to the sub-agent's Interaction
- The sub-agent uses tools (read_file, ripgrep, list_directory, etc.) with its agentId
- Returns the text response

**Example:**

```
agent_ask({
  agentId: "twitter-feed",
  message: "Explore this project. What env vars does it need? Where are the logs?"
})
// → sub-agent reads README, CLAUDE.md, package.json, runs ripgrep for process.env, etc.
```

## Workflows

### Onboarding a new project

```
User: "Add twitter-feed from git@github.com:org/twitter-feed.git"

1. agent_clone(gitUrl, name="twitter-feed")
   → clones to repos/twitter-feed, registers agent

2. agent_ask(agentId="twitter-feed",
     "Explore this project. Read README, CLAUDE.md, package.json, .env.example.
      What env vars does it need? What commands can I run? Where are the logs?")
   → sub-agent reads project files, returns structured analysis

3. agents_update(id="twitter-feed", commands={...}, logPatterns=[...])
   → update agent config with discovered info
```

### Monitoring

```
User: "What happened with twitter-feed today?"

1. agent_ask(agentId="twitter-feed",
     "Check the recent logs and status file. What happened today?")
   → sub-agent (remembers project structure from onboarding) reads logs/status
   → "3 syncs, 147 tweets, 2 rate limit warnings"
```

### Diagnosing issues

```
User: "Newsletter sync is failing, fix it"

1. agent_ask(agentId="newsletter-feed",
     "Sync is failing. Check logs, find the error, diagnose and suggest a fix.")
   → sub-agent reads recent logs, sees auth error
   → reads auth flow source code
   → "Gmail OAuth token expired. Run: npx tsx scripts/auth.ts"
```

## Configuration

### Agent entry with log patterns and status file

Add these fields to an agent entry in `config.json` to enable `agent_logs` and `agent_status`:

```json
{
  "agents": [
    {
      "id": "twitter-feed",
      "name": "Twitter Feed",
      "projectPath": "/path/to/twitter-feed",
      "gitRemote": "git@github.com:org/twitter-feed.git",
      "commands": {
        "run": "pnpm start",
        "sync": "pnpm run sync"
      },
      "logPatterns": [
        { "pattern": "logs/*.jsonl", "format": "jsonl" },
        { "pattern": "logs/*.log", "format": "plain" }
      ],
      "statusFile": "status.md",
      "secrets": ["TWITTER_API_KEY", "TWITTER_API_SECRET"]
    }
  ]
}
```

### Log patterns

Each `LogPattern` has:

| Field     | Type                   | Description                                                                 |
| --------- | ---------------------- | --------------------------------------------------------------------------- |
| `pattern` | `string`               | Glob pattern relative to project root (e.g. `"logs/*.jsonl"`, `"**/*.log"`) |
| `format`  | `"jsonl"` \| `"plain"` | How to parse the log file. JSONL files are parsed line-by-line as JSON.     |

The glob supports `*` (any characters), `?` (single character), and `**` (recursive directory matching).

## Programmatic usage

### Creating a HabitatAgent directly

```typescript
import { Habitat, HabitatAgent } from 'umwelten/habitat';

const habitat = await Habitat.create({ ... });

// Register an agent
await habitat.addAgent({
  id: 'my-project',
  name: 'My Project',
  projectPath: '/path/to/project',
});

// Create the sub-agent
const agent = await habitat.getOrCreateHabitatAgent('my-project');

// Ask it questions
const response = await agent.ask('What does this project do?');
console.log(response);
```

### Building a stimulus from a project

```typescript
import { buildAgentStimulus } from "umwelten/habitat";

const stimulus = await buildAgentStimulus(agentEntry, habitat);
console.log(stimulus.getPrompt()); // see the full system prompt
```

## Architecture

### Key files

| File                                      | Purpose                                                        |
| ----------------------------------------- | -------------------------------------------------------------- |
| `src/habitat/habitat-agent.ts`            | `buildAgentStimulus()` and `HabitatAgent` class                |
| `src/habitat/tools/agent-runner-tools.ts` | `agent_clone`, `agent_logs`, `agent_status`, `agent_ask` tools |
| `src/habitat/habitat.ts`                  | `getOrCreateHabitatAgent()` — lazy creation and caching        |
| `src/habitat/tool-sets.ts`                | `agentRunnerToolSet` — registered in standard tool sets        |
| `src/habitat/types.ts`                    | `AgentEntry` with `logPatterns`, `statusFile` fields           |

### How agent_ask works internally

```
agent_ask("twitter-feed", "check the logs")
  │
  ├─ habitat.getOrCreateHabitatAgent("twitter-feed")
  │    ├─ buildAgentStimulus(agent, habitat)
  │    │    ├─ reads CLAUDE.md, README.md, package.json from agent.projectPath
  │    │    ├─ creates Stimulus with project-specific context
  │    │    └─ registers habitat's tools into the stimulus
  │    │
  │    └─ habitat.createInteraction({ sessionId: "habitat-agent-twitter-feed" })
  │         ├─ creates/resumes persistent session
  │         ├─ wires transcript persistence
  │         └─ sets the agent-specific stimulus
  │
  └─ habitatAgent.ask("check the logs")
       ├─ adds user message to interaction
       ├─ calls generateText() — model reasons and uses tools
       │    ├─ agent_logs(agentId="twitter-feed", ...)
       │    ├─ read_file(path="...", agentId="twitter-feed")
       │    └─ ...
       ├─ persists transcript to disk
       └─ returns text response
```

Sub-agents are cached in a `Map<string, HabitatAgent>` on the Habitat instance. The same sub-agent is reused across multiple `agent_ask` calls, preserving conversation context.

## Related

- [Habitat](./habitat.md) — The top-level container that manages agents, tools, and interfaces
- [Habitat Setup Walkthrough](../walkthroughs/habitat-setup-walkthrough.md) — Step-by-step guide to setting up a habitat with sub-agents
- [Jeeves Bot](./jeeves-bot.md) — Example of a Habitat-based agent
- [Stimulus System](../architecture/stimulus-system.md) — How Stimulus objects work
- [Session Management](./session-management.md) — How sessions and transcripts are persisted
