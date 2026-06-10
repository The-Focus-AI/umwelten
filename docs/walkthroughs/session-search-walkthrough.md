# Session Search Walkthrough

`umwelten search` is system-wide full-content search across every Source Session
on disk — every Claude Code conversation you've had, in any project, searchable
by what was actually said. It shells out to [ripgrep](https://github.com/BurntSushi/ripgrep)
for the scan (see [ADR 0002](../adr/0002-session-search-shells-out-to-ripgrep.md)),
so cold searches over gigabytes of session history come back in under a second
with no index to build or maintain.

```
type query ──▶ debounced rg scan ──▶ hit list + preview
                                          │ Enter
                                          ▼
                          Exploration Browser dashboard
                            (digest, beats, transcript)
                                          │ q
                                          ▼
                          back to your results, same row
```

## Prerequisites

- Node.js 20+, pnpm, the repo installed (`pnpm install`)
- **ripgrep on PATH** — `brew install ripgrep` (macOS), `apt install ripgrep`
  (Debian/Ubuntu). If `rg` is missing, `umwelten search` prints install
  instructions and exits before anything else happens.
- Claude Code sessions under `~/.claude/projects` (the v1 search root)

**Time required:** 5 minutes

## Quick orientation

| Command                            | What you get                                    |
| ---------------------------------- | ----------------------------------------------- |
| `umwelten search`                  | empty TUI, type to search                       |
| `umwelten search "query"`          | TUI pre-populated, scan already running         |
| `umwelten search "query" --json`   | structured `SessionHit[]` JSON, no TUI          |
| `umwelten search "query" --no-tui` | flat rows for `grep`/`less` piping, no TUI      |
| `--case-sensitive`                 | exact-case match (default is case-insensitive)  |

## Step 1: Search interactively

```bash
dotenvx run -- pnpm run cli search "rate limit"
```

The two-pane TUI opens with your query pre-populated and the scan already
running: matching messages in the top pane (newest first, one row per hit —
timestamp, project, role, snippet), the full matched message in the lower
preview pane.

Keys:

| Key          | Action                                            |
| ------------ | ------------------------------------------------- |
| type         | edit the query — results re-scan live (debounced) |
| `↑` / `↓`    | move through hits                                 |
| `Enter`      | open the hit in the Exploration Browser dashboard |
| `Esc` / `Ctrl+C` | exit                                          |

Note that `q` is just a letter here — queries contain `q`s. Esc is how you leave.

## Step 2: Open a hit, then bounce back

Press `Enter` on a hit. The search TUI hands the terminal to the **Exploration
Browser dashboard**, scoped to that hit's project with the session pre-selected
— from there you can view the digest, run beats, or open the full transcript
(see the dashboard keys in `umwelten browse`).

Press `q` in the dashboard and you're **back in your search results** — same
query, same hit list, same highlighted row, no re-scan. The round trip repeats
as many times as you like: search once, explore many. `Ctrl+C` in the dashboard
is the hard exit.

## Step 3: Pipe it

For scripting, two stdout modes that never mount a TUI (both require a query):

```bash
# Human-readable rows: timestamp · project · role · snippet
dotenvx run -- pnpm run cli search "rate limit" --no-tui | less

# Count hits per project
dotenvx run -- pnpm run cli search "rate limit" --no-tui | cut -d'·' -f2 | sort | uniq -c

# Full structured hits for programmatic use
dotenvx run -- pnpm run cli search "rate limit" --json | jq '.[].projectName'
```

`--no-tui` is presentation, `--json` is structure: the JSON form carries every
`SessionHit` field (`projectPath`, `sessionId`, `filePath`, `fullMessageContent`,
…) for downstream tooling.

## How it relates to the rest of the system

Search is the fast path into the [knowledge pipeline](./knowledge-pipeline-walkthrough.md):
find the conversation where a decision happened, open it in the dashboard, and
digest or reflect on it from there. The search layer itself lives in
`@umwelten/core/interaction/search/` (scanner → hit parser → noise filters),
and the same noise filtering the Claude Code adapter uses keeps tool spam and
sidechain sessions out of your results.
