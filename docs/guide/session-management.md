# Session Management & Search

Umwelten provides powerful tools to manage, analyze, and search through your Claude Code conversation history. This enables you to build a searchable knowledge base of past work, discover patterns, and quickly find solutions you've already implemented.

## Overview

The session management system consists of three main features:

1. **Session Listing & Inspection** - View and explore Claude Code sessions
2. **LLM-Based Indexing** - Automatically extract topics, tags, and key learnings using AI
3. **Intelligent Search** - Find relevant sessions using semantic search and filters

## Quick Start

### List Recent Sessions

```bash
# List all sessions for the current project
pnpm run cli sessions list

# Show details for a specific session
pnpm run cli sessions show abc1234

# Export a session to markdown
pnpm run cli sessions export abc1234 --output session.md
```

### Index Sessions

```bash
# Index all sessions in the current project using Gemini 3 Flash (default)
dotenvx run -- pnpm run cli sessions index

# Index sessions for a different project
dotenvx run -- pnpm run cli sessions index --project /path/to/project

# Force reindex all sessions
dotenvx run -- pnpm run cli sessions index --force

# Use a different model
dotenvx run -- pnpm run cli sessions index --model google:gemini-2.0-flash-exp
```

### Search Sessions

```bash
# Search for sessions about React
dotenvx run -- pnpm run cli sessions search "react hooks"

# Search with filters
dotenvx run -- pnpm run cli sessions search "debugging" \
  --tags typescript,testing \
  --type bug-fix \
  --limit 5

# Get JSON output
dotenvx run -- pnpm run cli sessions search "api" --json
```

### Analyze Patterns

```bash
# View top topics across all sessions
dotenvx run -- pnpm run cli sessions analyze --type topics

# View tool usage statistics
dotenvx run -- pnpm run cli sessions analyze --type tools

# View solution patterns and success rates
dotenvx run -- pnpm run cli sessions analyze --type patterns
```

## Session Listing Commands

### `sessions list`

List all Claude Code sessions for a project.

**Options:**
- `-p, --project <path>` - Project path (defaults to current directory)
- `-l, --limit <n>` - Maximum number of sessions to display (default: 10)
- `-b, --branch <branch>` - Filter by git branch
- `--json` - Output as JSON

**Example:**
```bash
pnpm run cli sessions list --limit 20 --branch main
```

**Output:**
```
Found 27 sessions (showing 10)

┌──────────┬───────────────┬──────────┬────────────┬──────────────────────────────────────┐
│ ID       │ Branch        │ Messages │ Modified   │ First Prompt                         │
├──────────┼───────────────┼──────────┼────────────┼──────────────────────────────────────┤
│ c15a9952 │ main          │ 42       │ 12h ago    │ lets explore how it work on...       │
│ 4f2af089 │ main          │ 22       │ 14h ago    │ run mise exec -- bd ready...         │
└──────────┴───────────────┴──────────┴────────────┴──────────────────────────────────────┘
```

### `sessions show <id>`

Display detailed information about a specific session.

**Options:**
- `-p, --project <path>` - Project path
- `--json` - Output as JSON

**Example:**
```bash
pnpm run cli sessions show c15a9952
```

**Output:**
```
Session: c15a9952-d2d8-417f-bf25-be52fa2431b7

┌─────────────────────────┬──────────────────────────────────────────────┐
│ Project Path            │ /Users/user/project                          │
│ Git Branch              │ main                                         │
│ Created                 │ 12h ago                                      │
│ Duration                │ 4h 0m                                        │
│ Total Messages          │ 42                                           │
│ Input Tokens            │ 164,523                                      │
│ Output Tokens           │ 12,456                                       │
│ Estimated Cost          │ $11.69                                       │
└─────────────────────────┴──────────────────────────────────────────────┘
```

### `sessions export <id>`

Export a session to markdown format.

**Options:**
- `-p, --project <path>` - Project path
- `-o, --output <file>` - Output file path
- `--json` - Export as JSON instead of markdown

**Example:**
```bash
pnpm run cli sessions export c15a9952 --output session.md
```

## Session Indexing

The indexing system uses an LLM (Gemini 3 Flash by default) to analyze conversation transcripts and extract structured metadata.

### `sessions index`

Index sessions using LLM analysis for intelligent search.

**Options:**
- `-p, --project <path>` - Project path (defaults to current directory)
- `-m, --model <model>` - Model for analysis (format: `provider:model`, default: `google:gemini-3-flash-preview`)
- `--force` - Force reindex all sessions (ignore modification times)
- `-b, --batch-size <size>` - Number of sessions to process concurrently (default: 5)
- `-v, --verbose` - Show detailed progress

**Example:**
```bash
# Index with default settings
dotenvx run -- pnpm run cli sessions index

# Index with verbose output
dotenvx run -- pnpm run cli sessions index --verbose

# Force reindex everything
dotenvx run -- pnpm run cli sessions index --force

# Use a different model
dotenvx run -- pnpm run cli sessions index --model google:gemini-2.0-flash-exp
```

**Output:**
```
Indexing Claude Code sessions...
Project: /Users/user/project
Model: google:gemini-3-flash-preview

Discovering sessions to index...
Found 27 total sessions, 12 to index

Processing batch 1/3 (5 sessions)...
  Analyzing abc1234...
  Analyzing def5678...
  Batch 1 complete: 5 analyzed, 0 failed

✓ Indexing complete
  Indexed: 12 sessions
  Skipped: 15 sessions (already indexed)
```

### What Gets Extracted

The indexing process extracts:

1. **Topics** (3-5) - Main subjects discussed (e.g., "React hooks", "API design")
2. **Tags** (5-10) - Searchable keywords (e.g., "typescript", "debugging", "testing")
3. **Key Learnings** (2-3 sentences) - Main insights or solutions discovered
4. **Summary** (1-2 sentences) - Brief description of the conversation
5. **Solution Type** - Type of problem solved (bug-fix, feature, refactor, exploration, question, other)
6. **Code Languages** - Programming languages involved
7. **Tools Used** - Key tools/frameworks/libraries mentioned
8. **Success Indicators** - Was the goal achieved? (yes, partial, no, unclear)
9. **Related Files** - Files that were read or modified

### Storage

Analysis results are stored in:
```
~/.claude/projects/[ENCODED_PROJECT_PATH]/sessions-analysis-index.json
```

The index is incremental - only new or modified sessions are reindexed.

### Cost Estimation

Using Gemini 3 Flash (default model):
- **Cost per session**: ~$0.0003 (assuming 5k tokens)
- **100 sessions**: ~$0.03
- **1000 sessions**: ~$0.30

The system uses batch processing and incremental updates to minimize costs.

## Searching Sessions

### `sessions search [query]`

Search indexed sessions by keywords, tags, topics, or filters.

**Options:**
- `-p, --project <path>` - Project path
- `--tags <tags>` - Filter by tags (comma-separated)
- `--topic <topic>` - Filter by topic
- `--tool <name>` - Filter by tool usage
- `--type <type>` - Filter by solution type (bug-fix, feature, refactor, etc.)
- `--success <indicator>` - Filter by success (yes, partial, no, unclear)
- `--branch <branch>` - Filter by git branch
- `-l, --limit <n>` - Maximum results (default: 10)
- `--json` - Output as JSON

**Example:**
```bash
# Search for sessions about React
dotenvx run -- pnpm run cli sessions search "react hooks"

# Search with multiple filters
dotenvx run -- pnpm run cli sessions search "debugging" \
  --tags typescript,testing \
  --type bug-fix \
  --success yes

# Search for sessions using specific tools
dotenvx run -- pnpm run cli sessions search --tool Dagger --limit 5
```

**Output:**
```
Results (3 found):

1. Session: abc1234 (2 days ago) ⭐ Success
   Branch: feature/user-profile
   Summary: Debugged infinite re-render loop in useEffect hook
   Tags: react, hooks, debugging, useEffect, performance
   Key Learning: Add dependencies to useEffect array to prevent infinite loops.
                  Missing setState dependency caused re-renders.
   Matched: tag (exact), tag, topic, summary, learnings, recent, success (score: 37.8)

2. Session: def5678 (1 week ago) ⭐ Success
   Branch: main
   Summary: Fixed stale closure issue in custom hook
   Tags: react, hooks, debugging, closures, javascript
   Key Learning: Use useCallback with proper dependencies to avoid stale closures
                  in event handlers within custom hooks.
   Matched: tag (exact), topic, summary, success (score: 31.8)
```

### Ranking Algorithm

Search results are ranked by relevance using a weighted scoring system:

- **Exact tag match**: +10 points
- **Partial tag match**: +7 points
- **Topic match**: +5 points
- **Summary/learnings match**: +3 points
- **Tool match**: +2 points
- **First prompt match**: +1 point
- **Recency bonus**: +5 decaying over 30 days
- **Success indicator bonus**: +2 for "yes"

## Pattern Analysis

### `sessions analyze`

Aggregate analysis across all indexed sessions.

**Options:**
- `-p, --project <path>` - Project path
- `--type <type>` - Analysis type: `topics`, `tools`, `patterns`
- `--json` - Output as JSON

#### Topics Analysis

View the most common topics across all sessions:

```bash
dotenvx run -- pnpm run cli sessions analyze --type topics
```

**Output:**
```
Top Topics (20 found):

1. TypeScript (32 sessions)
2. React (18 sessions)
3. Testing (15 sessions)
4. API Design (12 sessions)
5. Debugging (11 sessions)
```

#### Tools Analysis

View tool usage patterns and frequency:

```bash
dotenvx run -- pnpm run cli sessions analyze --type tools
```

**Output:**
```
Tool Usage Analysis (20 tools):

1. Bash - 42 sessions (89.4%)
2. Read - 38 sessions (80.9%)
3. Edit - 35 sessions (74.5%)
4. Dagger - 12 sessions (25.5%)
```

#### Patterns Analysis

View solution types, success rates, and language breakdown:

```bash
dotenvx run -- pnpm run cli sessions analyze --type patterns
```

**Output:**
```
Session Patterns (47 sessions):

Solution Types:
  feature: 32 sessions
  bug-fix: 8 sessions
  refactor: 4 sessions

Success Rates:
  yes: 40 sessions (85.1%)
  partial: 5 sessions (10.6%)
  no: 2 sessions (4.3%)

Languages:
  typescript: 35 sessions
  javascript: 18 sessions
  python: 8 sessions
```

## Use Cases

### Finding Past Solutions

Quickly find how you solved a similar problem before:

```bash
dotenvx run -- pnpm run cli sessions search "infinite loop" --tags react,hooks
```

### Learning Patterns

Identify what tools and approaches work best:

```bash
dotenvx run -- pnpm run cli sessions analyze --type tools
dotenvx run -- pnpm run cli sessions analyze --type patterns
```

### Project Knowledge Base

Build a searchable knowledge base of project work:

```bash
# Index sessions periodically (e.g., via cron)
dotenvx run -- pnpm run cli sessions index

# Search across all work
dotenvx run -- pnpm run cli sessions search "authentication"
```

### Success Analysis

Understand success patterns in your development workflow:

```bash
dotenvx run -- pnpm run cli sessions search --success yes --type feature
```

## Advanced Usage

### Multi-Project Indexing

Index multiple projects:

```bash
#!/bin/bash
PROJECTS=(
  "/Users/user/project1"
  "/Users/user/project2"
  "/Users/user/project3"
)

for project in "${PROJECTS[@]}"; do
  echo "Indexing $project..."
  dotenvx run -- pnpm run cli sessions index --project "$project"
done
```

### Automated Indexing

Set up a cron job to index sessions daily:

```cron
# Run daily at 2 AM
0 2 * * * cd /path/to/umwelten && dotenvx run -- pnpm run cli sessions index
```

### Custom Queries

Combine filters for precise searches:

```bash
# Find successful React features from last month
dotenvx run -- pnpm run cli sessions search "component" \
  --tags react,typescript \
  --type feature \
  --success yes \
  --limit 20
```

## Configuration

### Model Selection

Choose different models for analysis based on your needs:

```bash
# Fast and cheap (default)
--model google:gemini-3-flash-preview

# More capable
--model google:gemini-2.0-flash-exp

# Most capable (expensive)
--model google:gemini-2.0-pro-exp
```

### Batch Size

Adjust concurrent processing for your system:

```bash
# More aggressive (faster, more API load)
--batch-size 10

# Conservative (slower, less API load)
--batch-size 3
```

## Troubleshooting

### Missing API Key

If you see "API key not found":

```bash
# Ensure GOOGLE_GENERATIVE_AI_API_KEY is set
export GOOGLE_GENERATIVE_AI_API_KEY=your_key_here

# Or use dotenvx to load from .env
dotenvx run -- pnpm run cli sessions index
```

### No Sessions Found

If no sessions are listed:

```bash
# Check if Claude sessions exist for the project
ls ~/.claude/projects/-Users-*-your-project-name/

# Verify you're in the correct project directory
pwd
```

### Indexing Failures

If sessions fail to index:

1. Check API key is valid
2. Try with `--verbose` to see detailed errors
3. Reduce `--batch-size` to avoid rate limits
4. Use `--force` to retry failed sessions

### Search Returns No Results

If search returns nothing:

1. First run `sessions index` to create the analysis index
2. Verify index exists: `ls ~/.claude/projects/-Users-*-your-project-name/sessions-analysis-index.json`
3. Try broader search terms or remove filters

## Best Practices

1. **Index Regularly** - Run indexing after significant work sessions
2. **Use Descriptive Tags** - More tags = better searchability
3. **Start Broad** - Begin searches with general terms, then refine with filters
4. **Monitor Costs** - Track API usage if indexing many sessions
5. **Backup Index** - Keep backups of `sessions-analysis-index.json` for large projects

## API Reference

See [CLI API Documentation](/api/cli) for programmatic usage of session management functions.

## See Also

- [Interactive Chat](/guide/interactive-chat) - Using chat features in Umwelten
- [Cost Analysis](/guide/cost-analysis) - Understanding LLM costs
- [Reports & Analysis](/guide/reports) - Generating evaluation reports
