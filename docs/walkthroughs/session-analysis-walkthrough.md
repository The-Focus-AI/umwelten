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

This shows:
- Session IDs (you only need the first 8 characters to reference them)
- Git branch
- Number of messages
- When last modified
- First prompt (helps remember what the session was about)

## Step 2: Inspect a Specific Session

To see details about a specific session:

```bash
pnpm run cli sessions show <session-id> --project /path/to/your/project
```

This displays:
- Full metadata (created time, duration, message count)
- Token usage (input/output tokens)
- Estimated cost
- Tools used

## Step 3: Index Sessions with LLM Analysis

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

## Step 4: Search Your Work

Once indexed, you can search semantically:

```bash
# Find sessions about a specific topic
dotenvx run -- pnpm run cli sessions search "authentication" --project /path/to/your/project

# Filter by tags
dotenvx run -- pnpm run cli sessions search "debugging" --tags typescript,testing --project /path/to/your/project

# Find successful solutions
dotenvx run -- pnpm run cli sessions search --success yes --type feature --project /path/to/your/project
```

Search results show:
- Session ID and when it happened
- Summary of what was done
- Tags extracted by the LLM
- Key learnings
- Success indicator
- Relevance score

## Step 5: Analyze Patterns

Discover trends across all your work:

```bash
# What topics have you worked on most?
dotenvx run -- pnpm run cli sessions analyze --type topics --project /path/to/your/project

# What tools/frameworks are you using?
dotenvx run -- pnpm run cli sessions analyze --type tools --project /path/to/your/project

# What types of work are you doing? (features, bug fixes, etc.)
dotenvx run -- pnpm run cli sessions analyze --type patterns --project /path/to/your/project
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
| `sessions show <id>` | Show session details |
| `sessions index` | Build searchable index with LLM |
| `sessions search [query]` | Search indexed sessions |
| `sessions analyze` | Aggregate pattern analysis |
| `sessions export <id>` | Export session to markdown |

See the [Session Management Guide](../guide/session-management.md) for complete documentation.
