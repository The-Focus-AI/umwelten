# Habitat Testing Guide

This guide covers how to test the Habitat system end-to-end, from automated unit tests to manual verification of agent runner workflows.

## Automated Tests

### Running the test suite

```bash
# All habitat tests (42 tests across 2 suites)
pnpm test:run src/habitat/

# Agent runner tools only (16 tests)
pnpm test:run src/habitat/tools/agent-runner-tools.test.ts

# Watch mode (re-runs on change)
npx vitest src/habitat/
```

### What the automated tests cover

The `agent-runner-tools.test.ts` suite creates a temporary directory structure, a mock `AgentRunnerToolsContext`, and exercises each tool:

| Test | Tool | What it verifies |
|------|------|-----------------|
| Reject existing agent | `agent_clone` | Returns `AGENT_EXISTS` error when agent ID is already registered |
| ID derivation | `agent_clone` | Derives `id` from `name` (lowercased, hyphenated) when `id` is omitted |
| Unknown agent (logs) | `agent_logs` | Returns `AGENT_NOT_FOUND` for unregistered agent |
| No log patterns | `agent_logs` | Returns `NO_LOG_PATTERNS` when agent has no `logPatterns` configured |
| Read plain logs | `agent_logs` | Reads `.log` files matching `logs/*.log` pattern, returns lines |
| Read JSONL logs | `agent_logs` | Reads `.jsonl` files, parses each line as JSON |
| Filter log lines | `agent_logs` | Filters lines containing a given string (e.g. `"ERROR"`) |
| Tail log lines | `agent_logs` | Returns only the last N lines from a log file |
| Unknown agent (status) | `agent_status` | Returns `AGENT_NOT_FOUND` |
| Basic status | `agent_status` | Returns agent id, name, projectPath, commands |
| Status file reading | `agent_status` | Reads `statusFile` content when configured |
| Missing status file | `agent_status` | Returns `{ error: "File not found" }` gracefully |
| Recent log listing | `agent_status` | Lists log files with mtime and size from `logPatterns` |
| Unknown agent (ask) | `agent_ask` | Returns `AGENT_NOT_FOUND` |
| Delegate to agent | `agent_ask` | Calls `HabitatAgent.ask()` and returns the response |
| Agent ask error | `agent_ask` | Catches errors from `HabitatAgent.ask()` and returns `AGENT_ASK_FAILED` |

### Writing new tests

Follow the pattern in the existing test file. The key mock:

```typescript
import { createAgentRunnerTools, type AgentRunnerToolsContext } from './agent-runner-tools.js';

const ctx: AgentRunnerToolsContext = {
  getWorkDir: () => workDir,
  getAgent: (id) => agents.find(a => a.id === id || a.name === id),
  addAgent: async (agent) => { agents.push(agent); },
  getOrCreateHabitatAgent: async () => mockHabitatAgent,
};

const tools = createAgentRunnerTools(ctx);

// Call tools like:
const result = await tools.agent_logs.execute(
  { agentId: 'test-agent', tail: 50 },
  { messages: [], toolCallId: 'test' }
);
```

## Manual Testing Setup

### Prerequisites

1. **Environment variables** — Copy and edit the example env file:

   ```bash
   cp examples/jeeves-bot/env.example examples/jeeves-bot/.env
   ```

   Required variables:
   | Variable | Purpose |
   |----------|---------|
   | `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini API key (for default model) |
   | `JEEVES_WORK_DIR` | Path to Jeeves work directory (e.g. `~/.jeeves`) |
   | `JEEVES_SESSIONS_DIR` | Path to sessions directory (e.g. `~/.jeeves-sessions`) |

   Optional variables:
   | Variable | Purpose |
   |----------|---------|
   | `TAVILY_API_KEY` | For the `search` tool |
   | `TELEGRAM_BOT_TOKEN` | For Telegram bot mode |
   | `DAGGER_SESSION_PORT` / `DAGGER_SESSION_TOKEN` | For Dagger-based `run_bash` tool |

2. **Work directory** — The Habitat auto-creates its work directory on first run, but you can pre-create it:

   ```bash
   mkdir -p ~/.jeeves
   ```

3. **A test project** — You need a git project to register as an agent. Either:
   - Use an existing project on disk (e.g. `../twitter-feed`)
   - Or clone a fresh one during testing (the `agent_clone` tool does this)

### Initializing Jeeves

```bash
# Run the CLI — it will onboard on first launch if needed
pnpm --filter jeeves-bot run cli

# Or explicitly onboard
pnpm --filter jeeves-bot run cli -- --onboard
```

This creates:
- `~/.jeeves/config.json` — Habitat configuration
- `~/.jeeves/STIMULUS.md` — System prompt (from JEEVES_PROMPT.md template)
- `~/.jeeves/AGENT.md` — Agent context

## Manual Test Procedures

### Test 1: Habitat Creation and Initialization

**Goal**: Verify that `Habitat.create()` initializes correctly with all tool sets.

**Steps**:

```bash
# Start the CLI and check that it boots without errors
pnpm --filter jeeves-bot run cli
```

**Verify**:
- [ ] No errors on startup
- [ ] Work directory exists at `$JEEVES_WORK_DIR` or `~/.jeeves`
- [ ] `config.json` exists in the work directory
- [ ] Greeting/prompt appears

**Programmatic verification** (in a test script):

```typescript
import { Habitat } from '../../src/habitat/index.js';

const habitat = await Habitat.create({
  envPrefix: 'JEEVES',
  defaultWorkDirName: '.jeeves',
  defaultSessionsDirName: '.jeeves-sessions',
});

// Verify tools are registered
const tools = habitat.getTools();
console.log('Registered tools:', Object.keys(tools));

// Should include: read_file, write_file, list_directory, ripgrep,
//   current_time, wget, markify, parse_feed,
//   agents_list, agents_add, agents_update, agents_remove,
//   session_list, session_show, session_messages, session_stats,
//   session_inspect, session_read_file,
//   external_interactions_list, external_interactions_show,
//   external_interactions_messages, external_interactions_stats,
//   agent_clone, agent_logs, agent_status, agent_ask
```

### Test 2: agent_clone — Clone and Register a Project

**Goal**: Clone a git repo and register it as a managed agent.

**Steps**:

```
> Clone the twitter-feed project from git@github.com:org/twitter-feed.git
```

Or with a public test repo:

```
> Clone https://github.com/octocat/Hello-World.git as "Hello World"
```

**Verify**:
- [ ] Repo is cloned to `~/.jeeves/repos/hello-world/`
- [ ] `config.json` has a new entry in `agents[]`
- [ ] Agent entry has correct `id`, `name`, `projectPath`, `gitRemote`
- [ ] Running `agent_clone` again with the same ID returns `AGENT_EXISTS`

**Check the config**:
```bash
cat ~/.jeeves/config.json | jq '.agents'
```

### Test 3: agent_status — Health Check

**Goal**: Verify status reporting works with and without optional config.

**Steps**:

1. **Basic status** (no logPatterns, no statusFile):
   ```
   > What's the status of hello-world?
   ```
   Expected: Returns id, name, projectPath. No statusFile or recentLogs sections.

2. **With status file** — Create a status file in the project:
   ```bash
   echo "# Status\nAll systems operational\nLast sync: 2024-01-15 10:30" > ~/.jeeves/repos/hello-world/status.md
   ```
   Then update the agent config to include `statusFile: "status.md"`:
   ```
   > Update hello-world agent to use status.md as its status file
   ```
   ```
   > What's the status of hello-world?
   ```
   Expected: Returns `statusFile.content` with the status markdown.

3. **With log patterns** — Create some test logs:
   ```bash
   mkdir -p ~/.jeeves/repos/hello-world/logs
   echo -e "INFO: started\nERROR: something failed\nINFO: retrying\nINFO: done" > ~/.jeeves/repos/hello-world/logs/app.log
   echo '{"event":"sync","status":"ok","ts":"2024-01-15T10:00:00Z"}' > ~/.jeeves/repos/hello-world/logs/events.jsonl
   echo '{"event":"sync","status":"error","ts":"2024-01-15T11:00:00Z"}' >> ~/.jeeves/repos/hello-world/logs/events.jsonl
   ```
   Update agent config with logPatterns:
   ```
   > Update hello-world agent log patterns to include logs/*.log (plain) and logs/*.jsonl (jsonl)
   ```
   ```
   > What's the status of hello-world?
   ```
   Expected: `recentLogs` array lists both files with mtime and size.

### Test 4: agent_logs — Read Log Files

**Goal**: Verify log reading with patterns, tailing, and filtering.

**Prerequisite**: Test 3 created the test log files.

**Steps**:

1. **Read all logs (default tail=50)**:
   ```
   > Show me the logs for hello-world
   ```
   Expected: Returns lines from the most recent matching file for each pattern.

2. **Filter by string**:
   ```
   > Show me ERROR lines from hello-world logs
   ```
   Expected: Only lines containing "ERROR" are returned.

3. **Tail with limit**:
   ```
   > Show the last 2 lines from hello-world logs
   ```
   Expected: Only the last 2 lines from each log file.

4. **Override pattern**:
   ```
   > Show hello-world logs matching "logs/*.jsonl"
   ```
   Expected: Only JSONL log files are returned.

5. **JSONL parsing**:
   Check that JSONL lines are parsed as JSON (compact, single-line format).

6. **No log patterns configured** — Test with an agent that has no `logPatterns`:
   Expected: Returns `NO_LOG_PATTERNS` error with a helpful message.

### Test 5: agent_ask — Delegate to Sub-Agent

**Goal**: Verify that `agent_ask` creates a HabitatAgent, sends a message, and returns a response.

**Steps**:

1. **First ask (creates sub-agent)**:
   ```
   > Ask hello-world: "What is this project? Read the README and tell me."
   ```
   Expected:
   - [ ] Sub-agent is created (first call takes longer)
   - [ ] Sub-agent reads the project's README.md using tools
   - [ ] Response describes the project
   - [ ] Session directory exists at `~/.jeeves-sessions/habitat-agent-hello-world/`
   - [ ] Transcript JSONL is written

2. **Second ask (reuses sub-agent)**:
   ```
   > Ask hello-world: "What did you tell me earlier about this project?"
   ```
   Expected:
   - [ ] Sub-agent remembers the previous conversation
   - [ ] Response references the earlier analysis
   - [ ] No new HabitatAgent creation (cached)

3. **Error handling**:
   ```
   > Ask nonexistent-agent: "hello"
   ```
   Expected: Returns `AGENT_NOT_FOUND` error.

### Test 6: buildAgentStimulus — Stimulus Construction

**Goal**: Verify that the stimulus correctly reads project files.

**Steps**:

Create a project with various files:

```bash
PROJECT=/tmp/test-stimulus-project
mkdir -p $PROJECT/.claude/commands
echo "# My Project\nA test project for validation." > $PROJECT/README.md
echo "Always use TypeScript strict mode." > $PROJECT/CLAUDE.md
echo '{"name":"test-project","description":"A test","scripts":{"test":"vitest"}}' > $PROJECT/package.json
echo '{"permissions":{"allow":["read"]}}' > $PROJECT/.claude/settings.json
echo "Run all tests" > $PROJECT/.claude/commands/test.md
```

**Programmatic test**:

```typescript
import { buildAgentStimulus } from '../../src/habitat/habitat-agent.js';

const stimulus = await buildAgentStimulus(
  {
    id: 'test-project',
    name: 'Test Project',
    projectPath: '/tmp/test-stimulus-project',
    commands: { test: 'pnpm test' },
    logPatterns: [{ pattern: 'logs/*.log', format: 'plain' }],
  },
  habitat
);

const prompt = stimulus.getPrompt();
console.log(prompt);
```

**Verify the stimulus contains**:
- [ ] Content from `CLAUDE.md` ("Always use TypeScript strict mode")
- [ ] Content from `README.md` ("My Project", "A test project")
- [ ] Package.json metadata (name, description, scripts, dependencies)
- [ ] `.claude/settings.json` content
- [ ] Available Claude commands (lists "test")
- [ ] Configured commands (`test: pnpm test`)
- [ ] Log patterns (`logs/*.log (plain)`)
- [ ] Role: `"habitat agent for Test Project"`
- [ ] Instructions about using tools with `agentId="test-project"`

### Test 7: Persistent Sessions

**Goal**: Verify that HabitatAgent sessions persist across habitat restarts.

**Steps**:

1. **Create a habitat and ask a question**:
   ```
   > Ask hello-world: "The secret word is 'banana'. Remember it."
   ```
   Verify response acknowledges the secret word.

2. **Restart the CLI** (exit and re-run):
   ```bash
   # Exit the CLI (Ctrl+C or /exit)
   pnpm --filter jeeves-bot run cli
   ```

3. **Ask about the secret word**:
   ```
   > Ask hello-world: "What was the secret word I told you?"
   ```

   Expected:
   - [ ] Sub-agent recalls "banana" from the previous session
   - [ ] Transcript JSONL at `~/.jeeves-sessions/habitat-agent-hello-world/transcript.jsonl` contains both conversations

4. **Inspect the session files**:
   ```bash
   ls -la ~/.jeeves-sessions/habitat-agent-hello-world/
   # Should contain: meta.json, transcript.jsonl

   wc -l ~/.jeeves-sessions/habitat-agent-hello-world/transcript.jsonl
   # Should show multiple lines (one per message)
   ```

### Test 8: Glob Pattern Matching

**Goal**: Verify the custom glob implementation in `agent-runner-tools.ts`.

**Steps**:

Create a nested log structure:

```bash
PROJECT=~/.jeeves/repos/hello-world
mkdir -p $PROJECT/logs/2024/01
mkdir -p $PROJECT/logs/2024/02
echo "jan log" > $PROJECT/logs/2024/01/app.log
echo "feb log" > $PROJECT/logs/2024/02/app.log
echo "root log" > $PROJECT/logs/app.log
echo "debug" > $PROJECT/logs/debug.txt
```

Test patterns:

| Pattern | Expected matches |
|---------|-----------------|
| `logs/*.log` | `logs/app.log` only |
| `logs/**/*.log` | `logs/app.log`, `logs/2024/01/app.log`, `logs/2024/02/app.log` |
| `logs/*.txt` | `logs/debug.txt` |
| `logs/2024/01/*.log` | `logs/2024/01/app.log` |
| `**/*.log` | All `.log` files recursively |
| `logs/nonexistent/*.log` | No matches (no error) |

Update the agent's `logPatterns` to use each pattern and run `agent_logs` to verify.

### Test 9: Tool Set Registration

**Goal**: Verify that `agentRunnerToolSet` is included in `standardToolSets`.

**Steps**:

```typescript
import { standardToolSets } from '../../src/habitat/tool-sets.js';

const names = standardToolSets.map(ts => ts.name);
console.log('Standard tool sets:', names);
```

**Verify**:
- [ ] List includes: `file-operations`, `time`, `url-operations`, `agent-management`, `session-management`, `external-interactions`, `agent-runner`
- [ ] `agent-runner` is present

```typescript
import { Habitat } from '../../src/habitat/index.js';

const habitat = await Habitat.create({ skipSkills: true, skipWorkDirTools: true });
const tools = habitat.getTools();

// Verify agent runner tools are registered
console.log('agent_clone:', 'agent_clone' in tools);
console.log('agent_logs:', 'agent_logs' in tools);
console.log('agent_status:', 'agent_status' in tools);
console.log('agent_ask:', 'agent_ask' in tools);
```

### Test 10: End-to-End Workflow

**Goal**: Run the full onboarding → monitoring → diagnosis workflow.

**Steps**:

1. **Start fresh**:
   ```bash
   # Back up and remove existing config
   cp ~/.jeeves/config.json ~/.jeeves/config.json.bak
   # Or start with a fresh work dir
   ```

2. **Clone a project**:
   ```
   > Clone https://github.com/your-org/your-project.git as "My Project"
   ```

3. **Explore the project**:
   ```
   > Ask my-project: "Explore this project thoroughly. What does it do? What are the main files? What env vars and dependencies does it need?"
   ```

4. **Update config based on exploration**:
   ```
   > Update my-project: add log patterns for logs/*.jsonl (jsonl) and logs/*.log (plain), set status file to status.md
   ```

5. **Check status**:
   ```
   > What's the status of my-project?
   ```

6. **Read logs**:
   ```
   > Show me the last 20 lines of my-project logs
   ```

7. **Ask a follow-up** (tests persistent memory):
   ```
   > Ask my-project: "Based on what you know about this project, what are the most important things to monitor?"
   ```

**Verify the full flow**:
- [ ] Clone succeeded
- [ ] Agent registered in config.json
- [ ] Sub-agent explored the project using tools
- [ ] Config updated with logPatterns and statusFile
- [ ] Status check returned relevant info
- [ ] Logs were readable
- [ ] Follow-up question used persistent memory from the exploration

## Troubleshooting

### Common issues

| Problem | Cause | Fix |
|---------|-------|-----|
| `No model details provided` | Missing API key | Set `GOOGLE_GENERATIVE_AI_API_KEY` in `.env` |
| `agent_clone` timeout | Slow network or large repo | Increase timeout or clone manually |
| `AGENT_NOT_FOUND` | Wrong agent ID or name | Check `config.json` agents array, use exact `id` value |
| `NO_LOG_PATTERNS` | Agent has no `logPatterns` in config | Add `logPatterns` to the agent entry |
| Empty `agent_logs` result | No files match the pattern | Check that log files exist at the expected paths |
| `agent_ask` hangs | Model API issue | Check API key, rate limits; try a different model |
| Session not persisting | Sessions dir permission | Check `$JEEVES_SESSIONS_DIR` is writable |

### Inspecting internal state

```bash
# View habitat config
cat ~/.jeeves/config.json | jq .

# List sessions
ls ~/.jeeves-sessions/

# View a session transcript
cat ~/.jeeves-sessions/habitat-agent-hello-world/transcript.jsonl | head -5

# View session metadata
cat ~/.jeeves-sessions/habitat-agent-hello-world/meta.json | jq .

# Check what tools are in a tool set
# (use the verify-skills-load script)
pnpm --filter jeeves-bot run verify-skills
```

### Debug logging

To see what the sub-agent is doing during `agent_ask`, you can inspect the transcript after each call:

```bash
# Watch transcript updates in real-time
tail -f ~/.jeeves-sessions/habitat-agent-hello-world/transcript.jsonl
```

## Test Data Cleanup

After testing, clean up test data:

```bash
# Remove test repos
rm -rf ~/.jeeves/repos/hello-world

# Remove test sessions
rm -rf ~/.jeeves-sessions/habitat-agent-hello-world

# Remove test log files (if created in existing project)
rm -rf /tmp/test-stimulus-project

# Restore original config (if backed up)
cp ~/.jeeves/config.json.bak ~/.jeeves/config.json
```
