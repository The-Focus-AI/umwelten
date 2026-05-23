---
title: Building a Command-Center Dashboard TUI in React Ink
date: 2026-05-23
topic: ink-dashboard-tui-patterns
audience: umwelten engineers (issue #64)
---

## Executive Summary

Opinionated recommendations for the new dashboard view:

- **Roll our own table** out of `<Box>` rows + a small `Column` helper. `ink-table` (maticzav/ink-table) is essentially abandoned and lacks per-cell color/badge/ANSI control we need. `@oclif/table` is heavier than warranted and is geared at one-shot print, not live updates.
- **Keep state in a single `useReducer`** with entries stored as a `Map<id, Entry>` (or array indexed by id-lookup) so progress events do atomic `UPDATE_ENTRY` patches. Avoid `useState` + array clone on every tick — that's what causes flicker and dropped frames.
- **Memoize each `Row`** (`React.memo` + stable `key={id}`). Ink does full-tree reconciliation on every render; memo'd rows skip work when their entry reference is unchanged.
- **Do not use `<Static>` for the rows table.** `<Static>` is append-only and explicitly cannot update already-rendered items — the whole point of our dashboard is in-place row updates. `<Static>` is the right tool for the *log/event tail* below the table, not for the table itself.
- **Throttle stream updates to ~5–10 Hz** (one batched dispatch every 100–200ms). Ink redraws the whole frame on every state change; one update per progress event will flicker on tmux and slow terminals.
- **Modal = conditional render + `useInput({ isActive })`**. Suspend the dashboard's `useInput` when overlay is open; the overlay owns input. `position="absolute"` works but is fiddly in Ink's Yoga layout and not needed for a centered confirmation.
- **One top-level `useInput` per "mode"**, gated by `isActive`. Don't use `useFocus`/`useFocusManager` for our case — focus traversal is for forms, not for a single-cursor list dashboard.
- **Status bar = its own memoized component** reading only `currentItem`. Keeps the bottom line from forcing the table to re-diff.
- **Test in iTerm2 / Kitty / Windows Terminal, not tmux** during dev. tmux has weak double-buffering and exaggerates flicker that real users won't see.

---

## 1. Table Rendering: Manual `<Box>` vs `ink-table` vs Custom Columns

Three real options, ranked for our case:

**Option A — Manual `<Box flexDirection="row">` rows with a `Column` helper (RECOMMENDED).** Ink uses Yoga for flexbox, so `width={N}` on each cell gives reliable fixed-width alignment. You pad/truncate strings yourself (a 5-line `pad(s, w)` util). This gives you full ANSI control: source badge with `<Text color="cyan" inverse>`, status dot color from entry state, truncation with a trailing `…`. Every dashboard cited below (Claude Code's UI, ivanleo's coding CLI, Twilio's conference CLI) ended up here.

**Option B — `ink-table` (maticzav/ink-table).** Renders a bordered ASCII table from an array of objects. Pros: zero work. Cons: (i) the repo is effectively unmaintained, (ii) you lose per-cell formatting — you can't make one cell a colored badge while another is a number, (iii) it re-renders the whole table on any data change because cells are just stringified, which is exactly the flicker pattern we want to avoid. Skip.

**Option C — `@oclif/table`.** Better feature set (column widths, alignment, truncation modes) but designed for `printTable()` one-shot use in oclif commands, not for sub-second live updates inside an Ink tree. Wrong tool.

Tradeoff summary: rolling our own is 60 lines of code, gives us memoizable per-cell components, and matches what every production Ink TUI does. The ecosystem table packages optimize for "pretty print once," not "30 rows updating live."

## 2. Streaming Row Updates Without Flicker

Two architectural rules, both well-attested in Ink issues and post-mortems:

**Rule 1: keep entries id-keyed and patch them in place.** A `useReducer` with state shape `{ byId: Record<string, Entry>, order: string[] }` lets a `PATCH_ENTRY` action do `{ ...state, byId: { ...state.byId, [id]: { ...state.byId[id], ...patch } } }`. Only the object for that one id gets a new reference, so a memoized `Row` for every *other* id bails out of re-render. This is the same pattern ivanleo describes for streaming Claude responses: don't replace the whole array, replace just the changing item ([ivanleo](https://ivanleo.com/blog/migrating-to-react-ink)).

**Rule 2: throttle/coalesce progress events.** Ink reconciles and *fully redraws the terminal* on every render — `log-update` erases all previous lines and writes the new frame. The flicker analysis at [test-ink-flickering](https://github.com/atxtechbro/test-ink-flickering/blob/main/INK-ANALYSIS.md) shows even a timer ticking at 100ms is noticeable on tmux. Buffer LLM-extraction progress events and `dispatch` at most every 100–200ms. A trivial pattern: keep a `pendingPatches: Map<id, Partial<Entry>>` in a ref, and flush via `setInterval(flush, 150)`.

`useReducer` is the right choice over `useState` here because (a) progress events come from many sources (one per row in flight), (b) the reducer makes batching trivial (`FLUSH_PATCHES` action), and (c) it keeps update logic in one place where it's testable. Avoid putting per-row state inside the `Row` component — lift it so the parent owns the source of truth.

## 3. Modal / Overlay Rendering

Two idiomatic Ink approaches:

**Approach A — Conditional swap (RECOMMENDED).** When `overlay !== null`, render `<Overlay …/>` *instead of* the dashboard body, or render it as the last child of the root `<Box>` so it appears below the table. Simple, predictable, no Yoga surprises. The Ink readme and `developerlife.com` ([reference](https://developerlife.com/2021/11/25/ink-v3-advanced-ui-components/)) both use this pattern for dialogs.

**Approach B — `<Box position="absolute" top={…} left={…}>`.** Works since Ink 3 (Yoga supports absolute positioning), but absolute boxes don't reserve space in the flex layout, so the dashboard underneath keeps re-rendering and you can get cell bleed-through if widths aren't pinned. Only worth it if you genuinely want the table visible behind the modal.

For "confirm before launching expensive work," Approach A is plenty: a centered bordered `<Box borderStyle="round">` with the prompt and `[Y]es / [N]o` hints. Keep the rest of the tree mounted (don't unmount the table — preserves scroll position and per-row memoization) by rendering both and gating with `display`-style logic, or unmount/remount if simplicity matters more than 50ms of remount cost.

## 4. Input Handling and Focus

Ink's `useInput(handler, { isActive })` is the whole API you need ([source](https://github.com/vadimdemedes/ink/blob/master/src/hooks/use-input.ts)). Pattern:

```ts
// In Dashboard
useInput(handleDashboardKeys, { isActive: overlay === null && !searchMode });

// In Overlay
useInput(handleOverlayKeys, { isActive: overlay !== null });

// In SearchInput (ink-text-input or custom)
useInput((_, key) => { if (key.escape) exitSearch(); }, { isActive: searchMode });
```

The `isActive` flag is the canonical way to scope input by mode. Multiple `useInput` hooks can coexist; deactivated ones are no-ops. This avoids the React-DOM-style focus-trap acrobatics — Ink doesn't need them for a single-cursor dashboard.

`useFocus` / `useFocusManager` exist but are designed for form-like multi-field traversal (tab between inputs). Overkill and confusing for an arrow-key list. Skip them.

Escape-from-search semantics: when in search input, `Esc` exits search mode and returns focus (logically) to the table. Cleanest implementation: `searchMode` state at the dashboard level, the search `<TextInput>` only renders when true, its `useInput` handles `Esc`, and the dashboard's `useInput` is gated `isActive: !searchMode && overlay === null`.

## 5. Performance Pitfalls With ~30 Live Rows

What goes wrong, and what to do:

- **Full-tree redraw on every state change.** Documented at [test-ink-flickering](https://github.com/atxtechbro/test-ink-flickering/blob/main/INK-ANALYSIS.md). Mitigation: throttle dispatch (see §2), memoize rows, keep the tree shallow.
- **Array `.map` with new objects every render.** Causes every memoized child to see new props and re-render anyway. Mitigation: never construct new entry objects unless that entry actually changed; reducer should return the *same* entry reference on no-op patches.
- **Wide rows + small terminals = wrapping = visible flicker.** Pin total width with `<Box width={process.stdout.columns}>` and truncate cells defensively.
- **Don't `console.log` from event handlers.** Ink's renderer competes with stdout writes; you'll see corruption. Use the umwelten logger to a file, or write into a debug pane.
- **Ink 3 doubled render perf vs Ink 2** ([Ink 3 post](https://vadimdemedes.com/posts/ink-3)). We're on Ink 3+; assume the floor is fine, but the ceiling is still "one redraw per state change," so coalesce.
- **`<Static>` is for append-only logs.** It's almost 2× faster than regular rendering because items render once and are never re-touched ([Ink 3](https://vadimdemedes.com/posts/ink-3)). Use it for the *event tail* below the table (recently completed extractions, errors), not the table itself.

## 6. Real-World Ink Dashboards to Crib From

- **Claude Code's UI** — large production Ink app. Discussed in [zenn.dev: Rich CLIs with React Ink](https://zenn.dev/mizchi/articles/react-ink-renderer-for-ai-age?locale=en). Manual table layouts, conditional overlay panes, single-mode input gating.
- **ivanleo's coding CLI** — small, readable, and the [post-mortem](https://ivanleo.com/blog/migrating-to-react-ink) covers exactly the streaming-update flicker problem we'll hit.
- **gerred's Agentic Systems writeup** — [Reactive UI with Ink and Yoga](https://gerred.github.io/building-an-agentic-system/ink-yoga-reactive-ui.html). Good on flexbox/Yoga gotchas and on why the reactive model matters.
- **Twilio conference CLI** — [build writeup](https://www.twilio.com/en-us/blog/developers/building-conference-cli-in-react). Conventional dashboard layout, conditional views, modest input handling.
- **Ink test renderer** in `vadimdemedes/ink` itself — `npm ink-testing-library` lets us snapshot-test the table renderer in unit tests (we'll want this for tasks #4–#6).

## Decisions for This PR

1. **Table**: roll our own. New file `src/ui/tui/dashboard/Row.tsx` exports a `React.memo`'d row built from `<Box flexDirection="row">` + a small `Cell` helper that pads/truncates to a fixed width. Status dot, source badge, topic, counts, relative time are five `<Cell>`s with explicit `width` props summing to `process.stdout.columns - 2`.
2. **State**: `useReducer` in `Dashboard.tsx`. Shape: `{ byId: Record<string, Entry>, order: string[], selectedId: string | null, overlay: Overlay | null, searchMode: boolean, currentItem: string | null }`. Actions: `LOAD`, `PATCH_ENTRY(id, partial)`, `SELECT(id)`, `OPEN_OVERLAY(kind, payload)`, `CLOSE_OVERLAY`, `ENTER_SEARCH`, `EXIT_SEARCH`, `SET_CURRENT_ITEM`.
3. **Streaming**: a `useProgressStream(dispatch)` hook subscribes to LLM-extraction events, buffers patches in a `useRef<Map>`, and flushes via `setInterval` at 150ms. Tests assert no more than one dispatch per 150ms window even under 50 events/sec input.
4. **Overlay**: conditional render at the bottom of the dashboard tree. `Overlay` component owns its own `useInput` with `isActive: overlay !== null`. Dashboard `useInput` gated `isActive: overlay === null && !searchMode`. No `position="absolute"`.
5. **Keys**: one big `switch` in the dashboard handler for `↑/↓`, `Enter`, `D`, `v`, `b`, `R`, `P`, `/`, `q`. `/` sets `searchMode=true`; the search input owns `Esc` and `Enter`.
6. **Status bar**: `<StatusBar currentItem={state.currentItem} />`, memoized on `currentItem` only.
7. **Event log under table**: optional `<Static>` of completed extractions; bounded to last N via slicing the items prop.
8. **Testing**: use `ink-testing-library` for snapshot tests of rendered frames; dispatch synthetic progress events and assert (a) only the patched row's text changed, (b) overlay open suspends dashboard keys, (c) escape from search restores them.

## References

- [vadimdemedes/ink (readme + source)](https://github.com/vadimdemedes/ink)
- [Ink `useInput` source](https://github.com/vadimdemedes/ink/blob/master/src/hooks/use-input.ts)
- [Ink 3 release notes — performance + Static](https://vadimdemedes.com/posts/ink-3)
- [Ink advanced components reference (developerlife)](https://developerlife.com/2021/11/25/ink-v3-advanced-ui-components/)
- [Ink flicker root-cause analysis](https://github.com/atxtechbro/test-ink-flickering/blob/main/INK-ANALYSIS.md)
- [Ink issue #359 — flicker on long views](https://github.com/vadimdemedes/ink/issues/359)
- [ivanleo — migrating to React Ink (streaming lessons)](https://ivanleo.com/blog/migrating-to-react-ink)
- [Rich CLIs with React Ink (zenn.dev / mizchi)](https://zenn.dev/mizchi/articles/react-ink-renderer-for-ai-age?locale=en)
- [Reactive UI with Ink and Yoga (gerred)](https://gerred.github.io/building-an-agentic-system/ink-yoga-reactive-ui.html)
- [Twilio — conference CLI in Ink](https://www.twilio.com/en-us/blog/developers/building-conference-cli-in-react)
- [Building Reactive CLIs with Ink (dev.to)](https://dev.to/skirianov/building-reactive-clis-with-ink-react-cli-library-4jpa)
- [Modal and dialog systems in Ink (studyraid)](https://app.studyraid.com/en/read/11921/379944/modal-and-dialog-systems)
- [ink-table (maticzav)](https://github.com/maticzav/ink-table)
- [@oclif/table](https://www.npmjs.com/package/@oclif/table)
