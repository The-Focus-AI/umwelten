# Session Analysis Walkthrough

This walkthrough demonstrates how to use the session management tools to understand what work has been done in a Claude Code project.

## Scenario

You have a project where you've been working with Claude Code for a while, and you want to:
- See what sessions exist
- Understand the topics you've worked on
- Find specific solutions you implemented
- Analyze patterns in your work

## Step 1: List Sessions

First, let's see what Claude Code sessions exist for a project:

```bash
pnpm run cli sessions list --project /path/to/your/project
```

**Example Output:**

```
Found 44 sessions (showing 10)

┌──────────┬───────────────┬──────────┬────────────┬──────────────────────────────────────────────────┐
│ ID       │ Branch        │ Messages │ Modified   │ First Prompt                                     │
├──────────┼───────────────┼──────────┼────────────┼──────────────────────────────────────────────────┤
│ 2c0e713c │ main          │ 20       │ 3h ago     │ update the image and push it to the display, th… │
├──────────┼───────────────┼──────────┼────────────┼──────────────────────────────────────────────────┤
│ e13f3f1c │ main          │ 24       │ 9h ago     │ update the image and push it to the display, th… │
├──────────┼───────────────┼──────────┼────────────┼──────────────────────────────────────────────────┤
│ 46db647f │ main          │ 44       │ 9h ago     │ what urls are you posting the latest images to   │
├──────────┼───────────────┼──────────┼────────────┼──────────────────────────────────────────────────┤
│ 439ed4b0 │ main          │ 17       │ 16h ago    │ update the image and push it to the display, th… │
└──────────┴───────────────┴──────────┴────────────┴──────────────────────────────────────────────────┘

Tip: Use "sessions show <id>" to view session details
```

This shows:
- Session IDs (you only need the first 8 characters to reference them)
- Git branch
- Number of messages
- When last modified
- First prompt (helps remember what the session was about)

## Step 2: Inspect a Specific Session

To see details about a specific session:

```bash
pnpm run cli sessions show 2c0e713c --project /path/to/your/project
```

**Example Output:**

```
Session: 2c0e713c-f9c4-4f5c-9942-08a3d106b42d

┌─────────────────────────┬──────────────────────────────────────────────────┐
│ Project Path            │ /Users/user/trmnl-image-agent                    │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ Git Branch              │ main                                             │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ Created                 │ 3h ago                                           │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ Duration                │ 4m 30s                                           │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ Total Messages          │ 20                                               │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ Tool Calls              │ 35                                               │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ Input Tokens            │ 209                                              │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ Output Tokens           │ 331                                              │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ Cache Read Tokens       │ 1,900,864                                        │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ Estimated Cost          │ $0.8986                                          │
└─────────────────────────┴──────────────────────────────────────────────────┘

First Prompt:
update the image and push it to the display, then update the readme and commit

Tip: Use "sessions messages <id>" to view the conversation
```

This displays:
- Full metadata (created time, duration, message count)
- Token usage (input/output tokens, cache hits)
- Estimated cost
- Tools used
- First prompt

## Step 3: View the Conversation

To see the actual messages exchanged in a session:

```bash
pnpm run cli sessions messages 2c0e713c --project /path/to/your/project
```

**Example Output:**

```
Session: 2c0e713c-f9c4-4f5c-9942-08a3d106b42d
Showing 8 message(s)

[3h ago] User:
update the image and push it to the display, then update the readme and commit

[3h ago] Assistant:
I'll help you update the image, push it to the display, and then update the README
and commit the changes. Let me start by checking the current state of the project.

  ↳ Read (file_path: /Users/user/project/README.md)
  ↳ Bash (command: ls -la images/, description: List current images)

[3h ago] User:
looks good, but the colors are off

[3h ago] Assistant:
I see, the colors aren't displaying correctly. Let me regenerate the image with
the proper color palette for the e-ink display...

  ↳ Bash (command: convert input.png -colors 2 -depth 1 output.png, description: Convert to 1-bit)
```

Tool calls are displayed inline with messages, showing:
- Tool name in magenta with arrow prefix (↳)
- Key input parameters in parentheses

**Options for viewing messages:**

```bash
# Show only user messages
pnpm run cli sessions messages 2c0e713c --user-only

# Show only assistant responses
pnpm run cli sessions messages 2c0e713c --assistant-only

# Show the last 5 messages
pnpm run cli sessions messages 2c0e713c --limit 5

# Get full JSON output (includes raw content)
pnpm run cli sessions messages 2c0e713c --json
```

## Step 4: View Tool Calls

To see what tools were used in a session:

```bash
pnpm run cli sessions tools 2c0e713c --project /path/to/your/project
```

**Example Output:**

```
Session: 2c0e713c-f9c4-4f5c-9942-08a3d106b42d
Found 35 tool call(s)

┌────────────┬──────────────────┬──────────────────────────────────────────────────────────────────────┐
│ Time       │ Tool             │ Input                                                                │
├────────────┼──────────────────┼──────────────────────────────────────────────────────────────────────┤
│ 3h ago     │ Read             │ file_path: /Users/user/project/README.md                             │
├────────────┼──────────────────┼──────────────────────────────────────────────────────────────────────┤
│ 3h ago     │ Bash             │ command: convert input.png -colors 2 -depth 1 output.png             │
├────────────┼──────────────────┼──────────────────────────────────────────────────────────────────────┤
│ 3h ago     │ Edit             │ file_path: /Users/user/project/README.md                             │
│            │                  │ old_string: ## Installation...                                       │
└────────────┴──────────────────┴──────────────────────────────────────────────────────────────────────┘
```

**Filter by specific tool:**

```bash
# Show only Bash commands
pnpm run cli sessions tools 2c0e713c --tool Bash

# Show only file edits
pnpm run cli sessions tools 2c0e713c --tool Edit
```

## Step 5: Index Sessions with LLM Analysis

Now the powerful part - use an LLM to analyze all your sessions and extract structured metadata:

```bash
dotenvx run -- pnpm run cli sessions index --project /path/to/your/project
```

This will:
- Process each session using Gemini 3 Flash (fast and cheap)
- Extract topics, tags, key learnings, solution types
- Build a searchable index
- Only process new/modified sessions (incremental)

Cost: ~$0.03 per 100 sessions

## Step 6: Search Your Work

Once indexed, you can search semantically:

```bash
# Find sessions about a specific topic
dotenvx run -- pnpm run cli sessions search "authentication" --project /path/to/your/project

# Filter by tags
dotenvx run -- pnpm run cli sessions search "debugging" --tags typescript,testing --project /path/to/your/project

# Find successful solutions
dotenvx run -- pnpm run cli sessions search --success yes --type feature --project /path/to/your/project
```

**Example Output:**

```
Results (3 found):

1. Session: 439ed4b0-bbf7-415b-9e5d-69da5cc098bc (today) ⭐ Success
   Branch: main
   Summary: Automated the process of fetching weather and ski conditions, generating a
            custom dashboard image via Gemini, optimizing it for TRMNL e-ink displays,
            and updating the project repository.
   Tags: nano-banana, gemini-api, trmnl, e-ink, image-optimization, automation,
         weather-data, git
   Key Learning: Programmatic image generation can be integrated into workflows using
                 CLI tools like nano-banana with Gemini models. E-ink displays like
                 TRMNL require specific image optimizations, such as 1-bit conversion
                 and strict file size limits (under 90KB), to function correctly.
   Matched: topic, summary, learnings, prompt, recent, success (score: 18.9)

2. Session: 47f88803-ee72-4e86-9438-ed4845dafc3f (today) ⭐ Success
   Branch: main
   Summary: The assistant generated a custom weather and ski dashboard image, uploaded
            it to two TRMNL hardware displays, and synchronized the changes to a GitHub
            repository.
   Tags: TRMNL, image-processing, weather-api, automation, git, dashboard,
         shell-scripting, ski-conditions
   Key Learning: TRMNL displays require 1-bit images with a strict file size limit
                 (90KB) for successful uploads. Parallel data fetching for weather and
                 mountain conditions optimizes the dashboard generation workflow.
   Matched: topic, summary, learnings, prompt, recent, success (score: 18.8)

3. Session: 312123a0-b90a-42a0-994f-fe2dccb16a05 (1 day ago) ⭐ Success
   Branch: main
   Summary: The assistant automated the update of a TRMNL dashboard by fetching weather
            and ski data, generating a themed image, and pushing the results to both
            hardware displays and a Git repository.
   Tags: trmnl, gemini, nano-banana, chrome-driver, e-ink, image-processing, git,
         weather-api
   Key Learning: Successfully orchestrated a multi-step workflow combining web scraping
                 (chrome-driver), AI image generation (nano-banana/Gemini), and hardware
                 deployment (TRMNL). Learned to process images into 1-bit black and
                 white format at 800x480 resolution to meet e-ink display constraints.
   Matched: topic, summary, learnings, prompt, recent, success (score: 18.8)
```

Each search result shows:
- Session ID and when it happened
- Git branch
- Summary of what was done
- Tags extracted by the LLM
- Key learnings (the valuable insights!)
- What matched your search
- Relevance score

## Step 7: Analyze Patterns

Discover trends across all your work:

```bash
# What topics have you worked on most?
dotenvx run -- pnpm run cli sessions analyze --type topics --project /path/to/your/project

# What tools/frameworks are you using?
dotenvx run -- pnpm run cli sessions analyze --type tools --project /path/to/your/project

# What types of work are you doing? (features, bug fixes, etc.)
dotenvx run -- pnpm run cli sessions analyze --type patterns --project /path/to/your/project
```

**Example Topics Output:**

```
Top Topics (20 found):

1. TRMNL display integration (11 sessions)
2. Git workflow automation (6 sessions)
3. Secret management (5 sessions)
4. Environment variable management (5 sessions)
5. Weather and ski data integration (4 sessions)
6. Prompt engineering (4 sessions)
7. Dashboard image generation (3 sessions)
8. TRMNL integration (3 sessions)
9. 1Password integration (3 sessions)
10. AI image generation (2 sessions)
```

**Example Tools Output:**

```
Tool Usage Analysis (20 tools):

1. TRMNL - 30 sessions (71.4%)
2. nano-banana - 13 sessions (31.0%)
3. Git - 10 sessions (23.8%)
4. 1Password - 7 sessions (16.7%)
5. ImageMagick - 6 sessions (14.3%)
6. Gemini API - 6 sessions (14.3%)
7. chrome-driver - 5 sessions (11.9%)
8. Weather API - 3 sessions (7.1%)
```

**Example Patterns Output:**

```
Session Patterns (42 sessions):

Solution Types:
  feature: 32 sessions
  bug-fix: 3 sessions
  question: 3 sessions
  exploration: 2 sessions
  refactor: 2 sessions

Success Rates:
  yes: 40 sessions (95.2%)
  partial: 5 sessions (10.6%)
  no: 2 sessions (4.8%)

Languages:
  markdown: 20 sessions
  bash: 19 sessions
  shell: 9 sessions
  yaml: 6 sessions
  python: 2 sessions
```

## Real-World Use Cases

### Finding Past Solutions

"How did I solve that React infinite loop issue last month?"

```bash
dotenvx run -- pnpm run cli sessions search "infinite loop" --tags react --project /path/to/your/project
```

### Understanding Project Focus

"What have I been working on most in this project?"

```bash
dotenvx run -- pnpm run cli sessions analyze --type topics --project /path/to/your/project
```

### Success Analysis

"What approaches have worked best?"

```bash
dotenvx run -- pnpm run cli sessions search --success yes --limit 20 --project /path/to/your/project
```

## Tips

1. **Index Regularly** - Run `sessions index` after significant work sessions to keep your knowledge base current

2. **Use Partial IDs** - Session IDs are UUIDs, but you only need the first 8 characters:
   - Full: `c15a9952-d2d8-417f-bf25-be52fa2431b7`
   - Short: `c15a9952`

3. **Combine Filters** - Mix search terms with filters for precise results:
   ```bash
   dotenvx run -- pnpm run cli sessions search "performance" \
     --tags typescript,optimization \
     --success yes \
     --type feature
   ```

4. **Export Sessions** - Save important sessions as markdown for documentation:
   ```bash
   pnpm run cli sessions export <session-id> --output solution.md --project /path/to/your/project
   ```

## Next Steps

- Set up a weekly cron job to index sessions automatically
- Build a dashboard using the JSON output (`--json` flag)
- Create a knowledge base of your best solutions
- Track learning patterns over time

## Command Reference

| Command | Purpose |
|---------|---------|
| `sessions list` | List all sessions |
| `sessions show <id>` | Show session metadata (tokens, cost, duration) |
| `sessions messages <id>` | View conversation messages |
| `sessions tools <id>` | View tool calls made during session |
| `sessions stats <id>` | Show detailed token usage and cost breakdown |
| `sessions index` | Build searchable index with LLM |
| `sessions search [query]` | Search indexed sessions |
| `sessions analyze` | Aggregate pattern analysis |
| `sessions export <id>` | Export session to markdown/JSON |

See the [Session Management Guide](../guide/session-management.md) for complete documentation.
