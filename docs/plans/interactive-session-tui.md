# Interactive Session TUI Plan (Revised)

## Goal

- **Stream from an active session**: Live stdin (`claude -p "..." --output-format stream-json | umwelten sessions tui`) or a **file** that may be streaming (e.g. tail -f or a session file being written).
- **Liveness**: Show when the live stream is "alive" (receiving data) vs "ended" vs "stale".
- **Switch between sessions**: Sidebar lists Live (if applicable), open file/session, plus saved sessions; user selects what to view.
- **Default (nothing)**: Show an **overview** of all sessions—run indexing and searching so the TUI is the place to browse and search sessions; this view can be refined (index/search behavior).
- **Live session UX**: **Filter/hide messages** (e.g. hide tool results, hide tool calls) so you can monitor what’s going on and see the latest without clutter.

---

## Input Modes (CLI)

| Invocation | Behavior |
|------------|----------|
| `umwelten sessions tui` | **Overview**: Index + search over all sessions for the project. No single session open; show session list/search. |
| `umwelten sessions tui --file <path>` or `umwelten sessions tui <file.jsonl>` | **File**: Open that session JSONL file. Can be static or watched for appends (streaming file). |
| `umwelten sessions tui --session <id>` or `umwelten sessions tui <sessionId>` | **Session ID**: Resolve in normal sessions directory (adapters / sessions index) and load that session. |
| `claude -p "..." --output-format stream-json \| umwelten sessions tui` | **Live**: Stdin is stream-json; show as "Live" session with liveness indicator. |

- **Project**: `-p, --project <path>` (default: cwd) for where to find sessions index and adapters.
- **Overlap**: If both stdin is piped and `--file`/`--session` is passed, Live (stdin) can be the primary stream and file/session can still appear in the sidebar for switching.

---

## Overview Mode (nothing passed)

- Run **indexing** (reuse `sessions index` logic) so the project has an up-to-date sessions index.
- **Search** over indexed sessions (reuse `sessions search` / session-search).
- TUI shows a **session list + search UI**: browse sessions, filter by branch/source, search by content. User can select one to open (same as "session ID" load). This is the default home view when no file/session/live is specified; the indexing and search behavior here can be refined (e.g. what gets indexed, what search exposes).

---

## Live Session: Filter and Hide Messages

- **Filter/hide options** (in-TUI toggles or persisted prefs) so the user can:
  - **Hide tool results**: Don’t show tool_result blocks (or show collapsed/summary only).
  - **Hide tool calls**: Don’t show tool_use blocks (or show collapsed/summary only).
  - **Show only user/assistant text**: Minimal view—only user messages and assistant text, no tools.
- **Monitor latest**: Auto-scroll to bottom so the "latest" is always visible; optional "latest activity" line (e.g. last tool name, last message preview) for at-a-glance monitoring when the full log is filtered or long.

---

## Architecture (unchanged high-level)

- Single process: Ink TUI + optional stdin reader or file watcher.
- **State**: Current "view" = overview | live | file | session(id). For live/file, messages stream or are appended; for session(id), load once via adapter. Sidebar reflects: Live (if stdin), open file (if any), plus list of sessions (from index/search in overview mode or from discoverSessions when a session is open).
- **Liveness**: Only for live (stdin) or optionally for a watched file (e.g. "writing..." when file is being appended). For session ID or static file, no liveness.

---

## Implementation Outline (additions / edits)

### 1. CLI entry point

- **`umwelten sessions tui [fileOrSessionId?]`** with options:
  - `-p, --project <path>` (default: cwd).
  - `--file <path>`: treat argument as file path (or positional `fileOrSessionId` as file if it contains a path separator or ends in `.jsonl`).
  - `--session <id>`: treat as session ID (or positional as session ID when not a file).
  - No file/session and no stdin → **overview mode** (index + search UI).
  - Stdin piped → attach **Live** stream.
  - File path → open that file (optionally **watch** for appends to support "streaming file").
  - Session ID → load via adapter from sessions directory.

### 2. Overview mode

- On startup in overview mode: ensure project is indexed (call into session-indexer / sessions index logic); then show session list from index + search (reuse session-search). UI: list of sessions, search box, filters (branch, source). Selecting a session opens it (same as opening by session ID). Indexing and search behavior can be refined (e.g. what gets indexed, what search exposes).

### 3. File mode

- **Open file**: Read JSONL from path; parse and display like a loaded session. Optional **watch**: use `fs.watch` or poll mtime/size and re-read tail or append new lines so a file that’s being written (e.g. by another process) appears "streaming" in the TUI. Liveness for file: "Writing..." when recent appends detected, "Ended" when file hasn’t changed for N seconds.

### 4. Live session filters (in-TUI)

- State: `hideToolResults`, `hideToolCalls`, `showOnlyUserAssistant` (or similar). When rendering messages in the main pane, skip or collapse tool_result / tool_use per these flags. Persist in session or local prefs if desired. "Latest" line or auto-scroll to bottom so user can monitor the latest activity without scrolling.

### 5. Rest of implementation

- Stream-json → normalized, Ink layout (ChatView, SessionSidebar, MessageList, StaticMessageLog, Message, ToolCallDetails), liveness display, loading saved session by ID—as in the original plan. Add file reader/watcher and overview (index + search) as above.

---

## Suggested file layout (additions)

- `src/ui/tui/file-session.ts` – read JSONL file, optional watch for appends; emit messages + liveness.
- `src/ui/tui/overview-state.ts` or integrate into app – index + search for project; expose session list and selected session for opening.
- Filter state: part of ChatView or a small context (hideToolResults, hideToolCalls, showOnlyUserAssistant) used by MessageList / Message when rendering.

---

## Summary of changes from original plan

1. **Input modes**: Explicit **file**, **session ID**, and **nothing (overview)** in addition to live stdin.
2. **Overview mode**: Default when nothing passed; run indexing and search; TUI is the place to browse/search sessions; behavior can be refined.
3. **File mode**: Pass a file path; open that session file; optionally watch for appends so it can act like a streaming session.
4. **Live session filters**: In-TUI options to hide tool results, hide tool calls, show only user/assistant; keep "monitor latest" (auto-scroll, optional latest-activity line).
