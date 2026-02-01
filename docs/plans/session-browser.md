# Detailed Session Browser Plan

## Goal

A **session browser** as the main way to explore sessions: search, see first messages, and see what the index knows (summary, key learnings, topics, tools, success). Opening full message detail can be a **separate step** (different command or window), not the same TUI pane.

## Data Sources

- **Session list** (adapters): `discoverSessions(projectPath)` → `NormalizedSessionEntry[]` with `id`, `firstPrompt`, `sourceId`, `created`, `modified`, `messageCount`.
- **Analysis index** (when present): `readAnalysisIndex(projectPath)` → `SessionAnalysisIndex` with `entries: SessionAnalysisEntry[]`. Each entry has:
  - `sessionId` (raw ID, e.g. UUID)
  - `metadata`: `firstPrompt`, `created`, `messageCount`, `toolCallCount`, `estimatedCost`, `gitBranch`
  - `analysis`: `summary`, `keyLearnings`, `topics[]`, `tags[]`, `toolsUsed[]`, `solutionType`, `successIndicators`, `codeLanguages[]`, `relatedFiles[]`
- **Search**: `searchSessions(query, SearchOptions)` returns `ScoredSearchResult[]` (entry + score + matchedFields). Requires analysis index. Filters: tags, topic, tool, solutionType, successIndicator, branch.

Match analysis entries to normalized list by: `entry.sessionId` matches `normalizedEntry.sourceId` or `normalizedEntry.id` (e.g. `claude-code:${entry.sessionId}`).

## Browser Behavior

1. **Load data**
   - Session list from adapters (always).
   - Analysis index when present (`hasAnalysisIndex(projectPath)`). If missing, show sessions with first prompt only and prompt "Run sessions index to see summary and search."
   - Merge: for each session entry, attach analysis entry when `sessionId`/sourceId matches.

2. **Search**
   - When analysis index exists: run `searchSessions(query, options)` with optional text query and filters (tags, topic, tool, type, success, branch). Limit e.g. 50.
   - When no index: filter session list by substring on `firstPrompt` only (simple client-side filter).

3. **Display per session (row or card)**
   - First message: `firstPrompt` (or analysis `metadata.firstPrompt`) truncated, e.g. 80 chars.
   - When analysis present:
     - Summary (1 line)
     - Key learnings (1–2 lines, truncated)
     - Topics (comma-separated)
     - Tools used (comma-separated)
     - Solution type + success indicator (badge: Success / Partial / Failed / Unclear)
   - When no analysis: first prompt + "Not indexed" or "Run sessions index".

4. **Interaction**
   - Search/filter at top (single line or filters).
   - List: scroll with ↑/↓, select one. Enter or "Open detail": **leave browser** and open detail elsewhere (e.g. `sessions show &lt;id&gt;` in same terminal, or `sessions tui --session &lt;id&gt;` in new terminal, or copy session ID to clipboard). No requirement to show full messages in the same window.

5. **Detail view (separate)**
   - Keep current behavior: `sessions show &lt;id&gt;`, or `sessions tui --session &lt;id&gt;` for TUI message list. No change to browser scope; browser only needs to produce a session ID for "open in detail".

## Implementation Outline

### Option A: TUI browser (recommended)

- **Entry**: `umwelten sessions browse` or make TUI default view the browser (replace current sidebar list with this).
- **Layout**: Full-screen TUI. Top: search line (e.g. "Search: [____]" or filter chips). Below: scrollable list of session cards; each card shows first message, summary, learnings, topics, tools, success.
- **State**: query string, selected index, list of merged items (session + analysis or session only).
- **Keys**: type to search, ↑/↓ select, Enter open detail (e.g. exit with message "Run: umwelten sessions show &lt;id&gt;" or spawn `sessions tui --session &lt;id&gt;`), Tab or / to focus search.
- **Data**: On load, fetch session list (adapters) and analysis index (if any). Merge by sessionId/sourceId. Apply search/filters to get displayed list.

### Option B: CLI-only browser

- **Entry**: `umwelten sessions browse` with optional `--search`, `--limit`; output formatted text (or use Ink for one interactive screen).
- Simpler but less interactive; Option A gives better UX.

### Suggested file layout (Option A)

- `src/ui/tui/browser/` or under `src/ui/tui/`:
  - **BrowserView.tsx**: Top-level browser UI (search bar + session list).
  - **SessionCard.tsx**: One row/card (first message, summary, learnings, topics, tools, success).
  - **browser-state.ts** or hooks: load sessions + analysis index, merge, search/filter, selected index.
- Reuse: `searchSessions`, `readAnalysisIndex`, `hasAnalysisIndex` from sessions; adapter `discoverSessions`.
- **CLI**: `sessions browse` → run TUI that renders BrowserView only (no message detail pane). Or `sessions tui` default = browser, and "open detail" runs `sessions tui --session &lt;id&gt;` in background/new terminal.

### Merge logic (session list + analysis)

- Normalized list: `id` = `claude-code:uuid` or `cursor:...`. Analysis: `sessionId` = raw UUID (Claude) or adapter-specific ID.
- For Claude: `analysisEntry.sessionId` === `normalizedEntry.sourceId` (both UUID).
- For Cursor: match by adapter-specific id; cursor adapter uses workspace hash + composer id.
- Build map: `analysisBySessionId[entry.sessionId] = entry`. For each normalized entry, lookup `analysisBySessionId[normalizedEntry.sourceId]` or by stripping `claude-code:` prefix from `normalizedEntry.id`.

## Out of scope (for later)

- In-browser full message view (user said detail doesn’t need to be same window).
- Editing or re-indexing from the browser.

## Summary

1. **Focus**: Detailed session browser with search, first messages, and index data (summary, learnings, topics, tools, success).
2. **Detail view**: Separate (e.g. `sessions show &lt;id&gt;` or `sessions tui --session &lt;id&gt;`); browser only needs to hand off session ID.
3. **Data**: Adapter session list + analysis index when present; merge by sessionId/sourceId; reuse `searchSessions` and filters.
4. **UI**: TUI browser screen (search + scrollable session cards) with Enter to "open in detail" (external command or new window).

## Implemented (2026-01-30)

- **`src/ui/tui/browser/browser-data.ts`**: `loadBrowserData()`, `searchBrowserSessions()`, `BrowserSession` type.
- **`src/ui/tui/browser/SessionCard.tsx`**: First message, summary, learnings, topics, tools, solution type, success; "Not indexed" when no analysis.
- **`src/ui/tui/browser/BrowserView.tsx`**: Search (type to filter), ↑/↓ select, Enter exits and calls `onSelectSession(id)`; uses `useApp().exit()`.
- **`src/ui/tui/browser/index.tsx`**: `runBrowserTui({ projectPath, onSelectSession })` returns selected session ID when user presses Enter.
- **CLI**: `umwelten sessions browse [-p project]`; after exit prints "To view full session: umwelten sessions show &lt;id&gt;" when a session was selected.
