import React, { useState, useMemo } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type {
  SessionBrowserEntry,
  FilterState,
  DateWindow,
  StatusFilter,
  SourceFilter,
} from '@umwelten/evaluation/introspection/browse.js';
import { applyFilter } from '@umwelten/evaluation/introspection/browse.js';
import type { SessionDigest } from '@umwelten/core/interaction/analysis/analysis-types.js';

export type BrowseIntent =
  | { kind: 'none' }
  | { kind: 'detail'; entry: SessionBrowserEntry }
  | { kind: 'transcript'; entry: SessionBrowserEntry }
  | { kind: 'digest'; entry: SessionBrowserEntry }
  | { kind: 'beats'; entry: SessionBrowserEntry };

export interface BrowseAppProps {
  projectPath: string;
  targetPath: string;
  entries: SessionBrowserEntry[];
  runCount: number;
  /** Called when the TUI is about to exit; caller uses this to chain a follow-up action. */
  onExit: (intent: BrowseIntent) => void;
}

function ago(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

function cycleDate(cur: DateWindow): DateWindow {
  switch (cur) {
    case '24h':
      return '7d';
    case '7d':
      return '30d';
    case '30d':
      return 'all';
    case 'all':
      return '24h';
  }
}

function cycleStatus(cur: StatusFilter): StatusFilter {
  const order: StatusFilter[] = ['all', 'unanalyzed', 'pending', 'decided', 'fresh'];
  return order[(order.indexOf(cur) + 1) % order.length];
}

function cycleSource(cur: SourceFilter): SourceFilter {
  const order: SourceFilter[] = ['all', 'claude-code', 'habitat'];
  return order[(order.indexOf(cur) + 1) % order.length];
}

function shortSessionId(id: string): string {
  return id.slice(0, 8);
}

function statusBadge(e: SessionBrowserEntry): { label: string; color: string } {
  // Priority: pending introspect > digested-only > fresh/changed > unreviewed
  const pending = e.analyzedIn.reduce((s, a) => s + a.tally.pending, 0);
  if (pending > 0) return { label: `${pending} pend`, color: 'yellow' };
  if (e.modifiedSinceAnalysis) return { label: 'changed', color: 'yellow' };
  if (e.everAnalyzed && e.digest) return { label: 'done', color: 'green' };
  if (e.digest) return { label: 'digest', color: 'cyan' };
  if (e.everAnalyzed) return { label: 'reviewed', color: 'green' };
  return { label: 'new', color: 'gray' };
}

export function BrowseApp({
  projectPath,
  targetPath,
  entries,
  runCount,
  onExit,
}: BrowseAppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = Math.max(20, (stdout?.rows ?? 30) - 1);

  const [filter, setFilter] = useState<FilterState>({
    date: '30d',
    status: 'all',
    source: 'all',
    query: '',
  });
  const [cursor, setCursor] = useState(0);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  const filtered = useMemo(() => applyFilter(entries, filter), [entries, filter]);
  const bounded = cursor >= filtered.length ? Math.max(0, filtered.length - 1) : cursor;
  const current = filtered[bounded];

  // Edge-scroll window: only scrolls when cursor would go off-screen.
  // Kept in state so it doesn't recompute-and-shift on every render pass.
  const [windowTop, setWindowTop] = useState(0);

  const relTarget = targetPath.startsWith(projectPath + '/')
    ? targetPath.slice(projectPath.length + 1)
    : targetPath;

  useInput((input, key) => {
    if (searching) {
      if (key.return || key.escape) {
        setSearching(false);
        setFilter((f) => ({ ...f, query }));
        return;
      }
      if (key.backspace || key.delete) {
        setQuery((q) => q.slice(0, -1));
        return;
      }
      // Printable characters — Ink treats backspace as a normal input, handled above
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setQuery((q) => q + input);
      }
      return;
    }
    if (input === 'q' || (key.ctrl && input === 'c')) {
      onExit({ kind: 'none' });
      exit();
      return;
    }
    if (input === 'j' || key.downArrow) {
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
      setFlash(null);
    } else if (input === 'k' || key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      setFlash(null);
    } else if (input === 'g') {
      setCursor(0);
    } else if (input === 'G') {
      setCursor(filtered.length - 1);
    } else if (input === '1') {
      setFilter((f) => ({ ...f, date: '24h' }));
    } else if (input === '2') {
      setFilter((f) => ({ ...f, date: '7d' }));
    } else if (input === '3') {
      setFilter((f) => ({ ...f, date: '30d' }));
    } else if (input === '4') {
      setFilter((f) => ({ ...f, date: 'all' }));
    } else if (input === 'd') {
      setFilter((f) => ({ ...f, date: cycleDate(f.date) }));
    } else if (input === 'f') {
      setFilter((f) => ({ ...f, status: cycleStatus(f.status) }));
    } else if (input === 's') {
      setFilter((f) => ({ ...f, source: cycleSource(f.source) }));
    } else if (input === '/') {
      setSearching(true);
      setQuery(filter.query);
    } else if (input === 'x' || key.escape) {
      // clear search
      setFilter((f) => ({ ...f, query: '' }));
      setQuery('');
    } else if (key.return) {
      if (!current) return;
      onExit({ kind: 'detail', entry: current });
      exit();
    } else if (input === 'v') {
      if (!current) return;
      onExit({ kind: 'transcript', entry: current });
      exit();
    } else if (input === 'D') {
      if (!current) return;
      onExit({ kind: 'digest', entry: current });
      exit();
    } else if (input === 'b') {
      if (!current) return;
      onExit({ kind: 'beats', entry: current });
      exit();
    } else if (input === '?') {
      setFlash(
        'j/k nav · 1-4 date · d/s/f cycle date/source/status · / search · enter review · i introspect · v transcript · q quit'
      );
    }
  });

  // Fixed chrome: header(3) + footer(3) + borders on main(2) = 8 lines.
  // Everything else goes to the main split.
  const mainHeight = Math.max(10, rows - 8);
  const listHeight = Math.max(8, mainHeight - 2); // -2 for list's own border

  // Edge-scroll: keep cursor inside [windowTop, windowTop + listHeight).
  // Clamp windowTop if filter change shrunk the list or cursor jumped far.
  let effectiveWindowTop = windowTop;
  const maxTop = Math.max(0, filtered.length - listHeight);
  if (effectiveWindowTop > maxTop) effectiveWindowTop = maxTop;
  if (bounded < effectiveWindowTop) effectiveWindowTop = bounded;
  else if (bounded >= effectiveWindowTop + listHeight)
    effectiveWindowTop = bounded - listHeight + 1;
  // Commit if changed (during render is OK here — React dev warnings are cosmetic in Ink)
  if (effectiveWindowTop !== windowTop) {
    // Schedule for next tick to avoid setState-in-render pitfalls
    queueMicrotask(() => setWindowTop(effectiveWindowTop));
  }
  const windowSlice = filtered.slice(effectiveWindowTop, effectiveWindowTop + listHeight);

  return (
    <Box flexDirection="column" height={rows}>
      {/* Header: filters */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text bold>Sessions  </Text>
        <Text dimColor>
          {`${filtered.length}/${entries.length} shown · target ${relTarget} · ${runCount} run${runCount === 1 ? '' : 's'}  `}
        </Text>
        <Text>
          <Text dimColor>date: </Text>
          <Text color="cyan">{filter.date}</Text>
          <Text dimColor>  source: </Text>
          <Text color="cyan">{filter.source}</Text>
          <Text dimColor>  status: </Text>
          <Text color="cyan">{filter.status}</Text>
          {filter.query !== '' && (
            <>
              <Text dimColor>  q: </Text>
              <Text color="magenta">{`"${filter.query}"`}</Text>
            </>
          )}
        </Text>
      </Box>

      {/* Main split — fixed height so panels don't pulse with content changes */}
      <Box height={mainHeight}>
        {/* List — fixed width + height, does not reflow */}
        <Box flexDirection="column" width={64} flexShrink={0} height={mainHeight} borderStyle="single" borderColor="gray" paddingX={1}>
          {filtered.length === 0 && <Text dimColor>No sessions match.</Text>}
          {windowSlice.map((e, i) => {
            const globalIdx = effectiveWindowTop + i;
            const selected = globalIdx === bounded;
            const badge = statusBadge(e);
            const prefix = selected ? '▶' : ' ';
            const ageStr = ago(e.modifiedMs).padStart(4);
            const srcChar = e.source === 'habitat' ? 'H' : 'C';
            const idStr = shortSessionId(e.id);
            // Fixed-width columns.
            // Prefix(2) + ageStr(5) + src(2) + id(9) + promptCol(24) + badgeCol(11) ≈ 53
            const promptRaw = e.firstPrompt.replace(/\s+/g, ' ').trim();
            const prompt =
              promptRaw.length > 22 ? promptRaw.slice(0, 20).trimEnd() + '..' : promptRaw;
            // Total row width = 2+4+1+1+8+1+22+1+8 = 48 chars. Fits in 60-wide pane
            // (inner = 60 - 2 border - 2 paddingX = 56).
            const line = `${prefix} ${ageStr.padEnd(4)} ${srcChar} ${idStr.padEnd(8)} ${prompt.padEnd(22)} ${badge.label.padEnd(8)}`;
            return (
              <Box key={e.id}>
                <Text
                  color={selected ? 'cyan' : badge.color as 'yellow' | 'green' | 'gray'}
                  bold={selected}
                  dimColor={!selected && e.everAnalyzed && !e.modifiedSinceAnalysis && e.analyzedIn.every((a) => a.tally.pending === 0)}
                >
                  {line}
                </Text>
              </Box>
            );
          })}
        </Box>

        {/* Detail — fixed height; content is bounded so the pane doesn't grow/shrink */}
        <Box flexDirection="column" flexGrow={1} height={mainHeight} borderStyle="single" borderColor="gray" paddingX={1}>
          {current ? (
            <>
              {/* Header: id + source + size + success badge from digest */}
              <Box>
                <Text bold>{shortSessionId(current.id)}</Text>
                <Text dimColor>
                  {`  · ${current.source} · ${current.messageCount} msgs · ${current.gitBranch ?? '-'}`}
                </Text>
                {current.digest && (
                  <>
                    <Text dimColor>{'  · '}</Text>
                    {renderSuccessBadge(current.digest.analysis.successIndicators)}
                    <Text dimColor>{' '}</Text>
                    <Text color="magenta">{`[${current.digest.analysis.solutionType}]`}</Text>
                  </>
                )}
              </Box>
              <Box>
                <Text dimColor>{`modified ${current.modifiedISO} (${ago(current.modifiedMs)} ago)`}</Text>
              </Box>

              {/* Digest summary, if present, takes precedence over raw first-prompt */}
              {current.digest ? (
                renderDigestBody(current.digest, current.analyzedIn, flash)
              ) : (
                renderNoDigestBody(current, flash)
              )}
            </>
          ) : (
            <Text dimColor>(no session selected)</Text>
          )}
        </Box>
      </Box>

      {/* Footer */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        {searching ? (
          <>
            <Text color="magenta">search: </Text>
            <Text>{query}</Text>
            <Text dimColor>  (enter commit · esc cancel)</Text>
          </>
        ) : (
          <>
            <Text dimColor>j/k · </Text>
            <Text color="cyan">1-4</Text>
            <Text dimColor> date · </Text>
            <Text color="cyan">enter</Text>
            <Text dimColor> detail · </Text>
            <Text color="cyan">D</Text>
            <Text dimColor> digest · </Text>
            <Text color="cyan">b</Text>
            <Text dimColor> beats · </Text>
            <Text color="cyan">v</Text>
            <Text dimColor> transcript · </Text>
            <Text color="cyan">q</Text>
            <Text dimColor> quit</Text>
          </>
        )}
      </Box>
    </Box>
  );
}

// ─── Detail pane renderers ──────────────────────────────────────────────────

function renderSuccessBadge(indicator: string): React.ReactElement {
  const map: Record<string, { label: string; color: string }> = {
    yes: { label: '✓ success', color: 'green' },
    partial: { label: '◐ partial', color: 'yellow' },
    no: { label: '✗ failed', color: 'red' },
    unclear: { label: '? unclear', color: 'gray' },
  };
  const v = map[indicator] ?? { label: indicator, color: 'gray' };
  return <Text color={v.color as 'green' | 'yellow' | 'red' | 'gray'}>{v.label}</Text>;
}

function renderDigestBody(
  digest: SessionDigest,
  analyzedIn: SessionBrowserEntry['analyzedIn'],
  flash: string | null
): React.ReactElement {
  const a = digest.analysis;
  const tags = a.tags.slice(0, 6);
  const topics = a.topics.slice(0, 4);
  const beatsCount = digest.beats?.length ?? 0;
  const phasesCount = digest.phases?.length ?? 0;
  const factsCount = digest.extractedFacts?.length ?? 0;
  const duration = digest.metrics?.duration
    ? formatDuration(digest.metrics.duration)
    : null;

  // Trim the summary so it doesn't blow up the pane
  const summary = digest.overallSummary.replace(/\s+/g, ' ').trim();
  const summaryCap = 360;
  const summaryShort =
    summary.length > summaryCap ? summary.slice(0, summaryCap) + '…' : summary;

  const keyLearnings = (a.keyLearnings ?? '').replace(/\s+/g, ' ').trim();
  const keyLearningsCap = 260;
  const keyLearningsShort =
    keyLearnings.length > keyLearningsCap
      ? keyLearnings.slice(0, keyLearningsCap) + '…'
      : keyLearnings;

  return (
    <>
      <Box marginTop={1}>
        <Text bold>Summary</Text>
      </Box>
      <Box>
        <Text>{summaryShort}</Text>
      </Box>

      {keyLearningsShort && (
        <>
          <Box marginTop={1}>
            <Text bold>Key learning</Text>
          </Box>
          <Box>
            <Text>{keyLearningsShort}</Text>
          </Box>
        </>
      )}

      {(topics.length > 0 || tags.length > 0) && (
        <>
          <Box marginTop={1}>
            {topics.length > 0 && (
              <>
                <Text dimColor>topics: </Text>
                <Text color="cyan">{topics.join(' · ')}</Text>
              </>
            )}
          </Box>
          {tags.length > 0 && (
            <Box>
              <Text dimColor>tags: </Text>
              <Text color="blue">{tags.join(' · ')}</Text>
            </Box>
          )}
        </>
      )}

      {/* Counts line — beats / phases / facts / tools / cost */}
      <Box marginTop={1}>
        <Text dimColor>
          {[
            beatsCount > 0 ? `${beatsCount} beats` : null,
            phasesCount > 0 ? `${phasesCount} phases` : null,
            factsCount > 0 ? `${factsCount} facts` : null,
            a.toolsUsed.length > 0 ? `${a.toolsUsed.length} tools` : null,
            duration ? duration : null,
            digest.metrics?.estimatedCost
              ? `$${digest.metrics.estimatedCost.toFixed(3)}`
              : null,
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>
      </Box>

      {/* Phases: compact, one per line */}
      {digest.phases && digest.phases.length > 0 && (
        <>
          <Box marginTop={1}>
            <Text bold>Phases</Text>
          </Box>
          {digest.phases.slice(0, 4).map((p, i) => (
            <Box key={i}>
              <Text color="green">{`[${p.name}] `}</Text>
              <Text dimColor>{`beats ${p.beatRange[0]}-${p.beatRange[1]}  `}</Text>
              <Text>{(p.description ?? '').slice(0, 64)}</Text>
            </Box>
          ))}
        </>
      )}

      {/* Introspect runs, if any */}
      {analyzedIn.length > 0 && (
        <>
          <Box marginTop={1}>
            <Text bold>Introspect runs</Text>
          </Box>
          {analyzedIn.slice(0, 2).map((r) => (
            <Box key={r.runId}>
              <Text dimColor>· </Text>
              <Text color="cyan">{r.runId.slice(0, 16).replace('T', ' ')}</Text>
              <Text dimColor>
                {`  ${r.tally.total}p: ${r.tally.accepted}a/${r.tally.skipped}s/${r.tally.pending}pend`}
              </Text>
            </Box>
          ))}
          {analyzedIn.length > 2 && (
            <Text dimColor>{`  (+${analyzedIn.length - 2} more)`}</Text>
          )}
        </>
      )}

      {flash && (
        <Box marginTop={1}>
          <Text color="yellow">{flash}</Text>
        </Box>
      )}
    </>
  );
}

function renderNoDigestBody(
  current: SessionBrowserEntry,
  flash: string | null
): React.ReactElement {
  const cap = 280;
  const t = current.firstPrompt.replace(/\s+/g, ' ').trim();
  const snippet = t.length > cap ? t.slice(0, cap) + '…' : t;

  return (
    <>
      <Box marginTop={1}>
        <Text bold>First prompt</Text>
      </Box>
      <Box>
        <Text>{snippet}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>No digest yet. Press </Text>
        <Text color="cyan">D</Text>
        <Text dimColor> to extract topics, tags, summary, phases, and facts.</Text>
      </Box>
      <Box marginTop={1}>
        <Text bold>Introspect runs</Text>
      </Box>
      {current.analyzedIn.length === 0 ? (
        <Text dimColor>No runs yet. Press i to introspect just this session.</Text>
      ) : (
        current.analyzedIn.slice(0, 3).map((r) => (
          <Box key={r.runId}>
            <Text dimColor>· </Text>
            <Text color="cyan">{r.runId.slice(0, 16).replace('T', ' ')}</Text>
            <Text dimColor>
              {`  ${r.tally.total}p: ${r.tally.accepted}a/${r.tally.skipped}s/${r.tally.pending}pend`}
            </Text>
          </Box>
        ))
      )}
      {flash && (
        <Box marginTop={1}>
          <Text color="yellow">{flash}</Text>
        </Box>
      )}
    </>
  );
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
