/**
 * Exploration browser TUI component.
 *
 * Mirrors BrowseApp but renders Exploration-oriented entries with
 * source badges, member counts, and pi-specific metadata
 * (branches, compactions, labels).
 */
import type React from 'react';
import { useState, useMemo } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type {
  ExplorationBrowserEntry,
  FilterState,
  DateWindow,
  StatusFilter,
  SourceFilter,
} from '@umwelten/sessions/introspection/browse.js';
import { applyExploreFilter } from '@umwelten/sessions/introspection/browse.js';
import type { SessionDigest } from '@umwelten/core/interaction/analysis/analysis-types.js';

export type ExploreBrowseIntent =
  | { kind: 'none' }
  | { kind: 'detail'; entry: ExplorationBrowserEntry }
  | { kind: 'transcript'; entry: ExplorationBrowserEntry }
  | { kind: 'digest'; entry: ExplorationBrowserEntry }
  | { kind: 'beats'; entry: ExplorationBrowserEntry };

export interface ExploreBrowseAppProps {
  projectPath: string;
  targetPath: string;
  entries: ExplorationBrowserEntry[];
  runCount: number;
  /** Called when the TUI is about to exit. */
  onExit: (intent: ExploreBrowseIntent) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────

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
    case '24h': return '7d';
    case '7d': return '30d';
    case '30d': return 'all';
    case 'all': return '24h';
  }
}

function cycleStatus(cur: StatusFilter): StatusFilter {
  const order: StatusFilter[] = ['all', 'unanalyzed', 'pending', 'decided', 'fresh'];
  return order[(order.indexOf(cur) + 1) % order.length];
}

function cycleSource(cur: SourceFilter): SourceFilter {
  const order: SourceFilter[] = ['all', 'claude-code', 'habitat', 'pi'];
  return order[(order.indexOf(cur) + 1) % order.length];
}

function sourceChar(source: string): string {
  switch (source) {
    case 'pi': return 'P';
    case 'claude-code': return 'C';
    case 'cursor': return 'R';
    case 'habitat': return 'H';
    default: return '?';
  }
}

function statusBadge(e: ExplorationBrowserEntry): { label: string; color: string } {
  const pending = e.analyzedIn.reduce((s, a) => s + a.tally.pending, 0);
  if (pending > 0) return { label: `${pending} pend`, color: 'yellow' };
  if (e.modifiedSinceAnalysis) return { label: 'changed', color: 'yellow' };
  if (e.everAnalyzed && e.digest) return { label: 'done', color: 'green' };
  if (e.digest) return { label: 'digest', color: 'cyan' };
  if (e.everAnalyzed) return { label: 'reviewed', color: 'green' };
  return { label: 'new', color: 'gray' };
}

function formatPiMetadata(e: ExplorationBrowserEntry): string {
  const sd = e.sourceSession.sourceData;
  if (!sd) return '';
  const parts: string[] = [];
  const branches = sd['branchCount'] as number | undefined;
  const compactions = sd['compactionCount'] as number | undefined;
  const labels = sd['labels'] as Record<string, string> | undefined;
  const displayName = sd['displayName'] as string | undefined;
  if (displayName) parts.push(`name:${displayName}`);
  if (branches && branches > 0) parts.push(`${branches}br`);
  if (compactions && compactions > 0) parts.push(`${compactions}cmp`);
  if (labels) {
    const labelCount = Object.keys(labels).length;
    if (labelCount > 0) parts.push(`${labelCount}lb`);
  }
  return parts.length > 0 ? parts.join(' ') : '';
}

// ── Component ───────────────────────────────────────────────────────────

export function ExploreBrowseApp({
  projectPath,
  targetPath,
  entries,
  runCount,
  onExit,
}: ExploreBrowseAppProps): React.ReactElement {
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

  const filtered = useMemo(() => applyExploreFilter(entries, filter), [entries, filter]);
  const bounded = cursor >= filtered.length ? Math.max(0, filtered.length - 1) : cursor;
  const current = filtered[bounded];

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
    } else if (input === 'k' || key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (input === 'g') {
      setCursor(0);
    } else if (input === 'G') {
      setCursor(filtered.length - 1);
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
      setFilter((f) => ({ ...f, query: '' }));
      setQuery('');
    } else if (input === '1') {
      setFilter((f) => ({ ...f, date: '24h' }));
    } else if (input === '2') {
      setFilter((f) => ({ ...f, date: '7d' }));
    } else if (input === '3') {
      setFilter((f) => ({ ...f, date: '30d' }));
    } else if (input === '4') {
      setFilter((f) => ({ ...f, date: 'all' }));
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
    }
  });

  const mainHeight = Math.max(10, rows - 8);
  const listHeight = Math.max(8, mainHeight - 2);

  let effectiveWindowTop = windowTop;
  const maxTop = Math.max(0, filtered.length - listHeight);
  if (effectiveWindowTop > maxTop) effectiveWindowTop = maxTop;
  if (bounded < effectiveWindowTop) effectiveWindowTop = bounded;
  else if (bounded >= effectiveWindowTop + listHeight) effectiveWindowTop = bounded - listHeight + 1;
  if (effectiveWindowTop !== windowTop) {
    queueMicrotask(() => setWindowTop(effectiveWindowTop));
  }
  const windowSlice = filtered.slice(effectiveWindowTop, effectiveWindowTop + listHeight);

  return (
    <Box flexDirection="column" height={rows}>
      {/* Header */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text bold>Explorations  </Text>
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

      {/* Main split */}
      <Box height={mainHeight}>
        {/* List */}
        <Box flexDirection="column" width={72} flexShrink={0} height={mainHeight} borderStyle="single" borderColor="gray" paddingX={1}>
          {filtered.length === 0 && <Text dimColor>No explorations match.</Text>}
          {windowSlice.map((e, i) => {
            const globalIdx = effectiveWindowTop + i;
            const selected = globalIdx === bounded;
            const badge = statusBadge(e);
            const prefix = selected ? '▶' : ' ';
            const ageStr = ago(e.modifiedMs).padStart(4);
            const srcChar = sourceChar(e.sourceSession.source);
            const idStr = e.sourceSession.id.slice(0, 10).padEnd(10);
            const promptRaw = e.exploration.name.replace(/\s+/g, ' ').trim();
            const prompt = promptRaw.length > 24 ? promptRaw.slice(0, 22).trimEnd() + '..' : promptRaw;
            const piMeta = formatPiMetadata(e);
            const piStr = piMeta ? ` ${piMeta}` : '';
            const line = `${prefix} ${ageStr.padEnd(4)} ${srcChar} ${idStr} ${prompt.padEnd(24)} ${badge.label.padEnd(8)}${piStr}`;
            return (
              <Box key={e.sourceSession.id}>
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

        {/* Detail pane */}
        <Box flexDirection="column" flexGrow={1} height={mainHeight} borderStyle="single" borderColor="gray" paddingX={1}>
          {current ? (
            <>
              {/* Header */}
              <Box>
                <Text bold>{current.exploration.name.slice(0, 40)}</Text>
                <Text dimColor>
                  {`  · ${current.sourceSession.source} · ${current.sourceSession.messageCount} msgs`}
                </Text>
                {current.digest && (
                  <>
                    <Text dimColor>{'  · '}</Text>
                    <Text color="magenta">{`[${current.digest.analysis.solutionType}]`}</Text>
                  </>
                )}
              </Box>
              <Box>
                <Text dimColor>{`modified ${current.sourceSession.modified} (${ago(current.modifiedMs)} ago)`}</Text>
              </Box>

              {/* Source session membership */}
              <Box marginTop={1}>
                <Text bold>Source Session</Text>
              </Box>
              <Box>
                <Text dimColor>id: </Text>
                <Text>{current.sourceSession.id}</Text>
              </Box>
              <Box>
                <Text dimColor>source: </Text>
                <Text>{current.sourceSession.source}</Text>
              </Box>

              {/* Pi-specific metadata */}
              {current.sourceSession.source === 'pi' && renderPiMetadata(current)}

              {/* Digest summary, if present */}
              {current.digest ? (
                renderDigestBody(current.digest, current.analyzedIn)
              ) : (
                renderNoDigestBody(current)
              )}
            </>
          ) : (
            <Text dimColor>(no exploration selected)</Text>
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
            <Text color="cyan">s</Text>
            <Text dimColor> source · </Text>
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

// ── Pi metadata renderer ────────────────────────────────────────────────

function renderPiMetadata(entry: ExplorationBrowserEntry): React.ReactElement | null {
  const sd = entry.sourceSession.sourceData;
  if (!sd) return null;

  const parts: React.ReactElement[] = [];
  let idx = 0;

  const displayName = sd['displayName'] as string | undefined;
  if (displayName) {
    parts.push(<Box key={idx++}><Text dimColor>name: </Text><Text color="green">{displayName}</Text></Box>);
  }

  const branches = sd['branchCount'] as number | undefined;
  if (branches && branches > 0) {
    parts.push(<Box key={idx++}><Text dimColor>branches: </Text><Text color="yellow">{branches}</Text></Box>);
  }

  const compactions = sd['compactionCount'] as number | undefined;
  if (compactions && compactions > 0) {
    parts.push(<Box key={idx++}><Text dimColor>compactions: </Text><Text color="yellow">{compactions}</Text></Box>);
  }

  const labels = sd['labels'] as Record<string, string> | undefined;
  if (labels) {
    const entries = Object.entries(labels);
    if (entries.length > 0) {
      parts.push(
        <Box key={idx++} flexDirection="column">
          <Text dimColor>labels:</Text>
          {entries.slice(0, 5).map(([target, label]) => (
            <Text key={target} dimColor>{`  ${target.slice(0, 8)} → ${label}`}</Text>
          ))}
          {entries.length > 5 && <Text dimColor>{`  (+${entries.length - 5} more)`}</Text>}
        </Box>
      );
    }
  }

  if (parts.length === 0) return null;
  return <Box marginTop={1} flexDirection="column">{parts}</Box>;
}

// ── Detail pane renderers ───────────────────────────────────────────────

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function renderDigestBody(
  digest: SessionDigest,
  analyzedIn: ExplorationBrowserEntry['analyzedIn'],
): React.ReactElement {
  const a = digest.analysis;
  const tags = a.tags.slice(0, 6);
  const topics = a.topics.slice(0, 4);
  const beatsCount = digest.beats?.length ?? 0;
  const phasesCount = digest.phases?.length ?? 0;
  const factsCount = digest.extractedFacts?.length ?? 0;
  const duration = digest.metrics?.duration ? formatDuration(digest.metrics.duration) : null;

  const summary = digest.overallSummary.replace(/\s+/g, ' ').trim();
  const summaryCap = 360;
  const summaryShort = summary.length > summaryCap ? summary.slice(0, summaryCap) + '…' : summary;

  const keyLearnings = (a.keyLearnings ?? '').replace(/\s+/g, ' ').trim();
  const keyLearningsCap = 260;
  const keyLearningsShort = keyLearnings.length > keyLearningsCap ? keyLearnings.slice(0, keyLearningsCap) + '…' : keyLearnings;

  return (
    <>
      <Box marginTop={1}><Text bold>Summary</Text></Box>
      <Box><Text>{summaryShort}</Text></Box>
      {keyLearningsShort && (
        <>
          <Box marginTop={1}><Text bold>Key learning</Text></Box>
          <Box><Text>{keyLearningsShort}</Text></Box>
        </>
      )}
      {(topics.length > 0 || tags.length > 0) && (
        <>
          <Box marginTop={1}>
            {topics.length > 0 && (
              <><Text dimColor>topics: </Text><Text color="cyan">{topics.join(' · ')}</Text></>
            )}
          </Box>
          {tags.length > 0 && (
            <Box><Text dimColor>tags: </Text><Text color="blue">{tags.join(' · ')}</Text></Box>
          )}
        </>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          {[beatsCount > 0 ? `${beatsCount} beats` : null,
            phasesCount > 0 ? `${phasesCount} phases` : null,
            factsCount > 0 ? `${factsCount} facts` : null,
            a.toolsUsed.length > 0 ? `${a.toolsUsed.length} tools` : null,
            duration ? duration : null,
            digest.metrics?.estimatedCost ? `$${digest.metrics.estimatedCost.toFixed(3)}` : null,
          ].filter(Boolean).join('  ·  ')}
        </Text>
      </Box>
      {digest.phases && digest.phases.length > 0 && (
        <>
          <Box marginTop={1}><Text bold>Phases</Text></Box>
          {digest.phases.slice(0, 4).map((p, i) => (
            <Box key={i}>
              <Text color="green">{`[${p.name}] `}</Text>
              <Text dimColor>{`beats ${p.beatRange[0]}-${p.beatRange[1]}  `}</Text>
              <Text>{(p.description ?? '').slice(0, 64)}</Text>
            </Box>
          ))}
        </>
      )}
      {analyzedIn.length > 0 && (
        <>
          <Box marginTop={1}><Text bold>Introspect runs</Text></Box>
          {analyzedIn.slice(0, 2).map((r) => (
            <Box key={r.runId}>
              <Text dimColor>· </Text>
              <Text color="cyan">{r.runId.slice(0, 16).replace('T', ' ')}</Text>
              <Text dimColor>{`  ${r.tally.total}p: ${r.tally.accepted}a/${r.tally.skipped}s/${r.tally.pending}pend`}</Text>
            </Box>
          ))}
          {analyzedIn.length > 2 && <Text dimColor>{`  (+${analyzedIn.length - 2} more)`}</Text>}
        </>
      )}
    </>
  );
}

function renderNoDigestBody(current: ExplorationBrowserEntry): React.ReactElement {
  const cap = 280;
  const t = current.exploration.name.replace(/\s+/g, ' ').trim();
  const snippet = t.length > cap ? t.slice(0, cap) + '…' : t;

  return (
    <>
      <Box marginTop={1}><Text bold>First prompt</Text></Box>
      <Box><Text>{snippet}</Text></Box>
      <Box marginTop={1}>
        <Text dimColor>No digest yet. Press </Text>
        <Text color="cyan">D</Text>
        <Text dimColor> to analyze.</Text>
      </Box>
      {current.analyzedIn.length > 0 && (
        <>
          <Box marginTop={1}><Text bold>Introspect runs</Text></Box>
          {current.analyzedIn.slice(0, 3).map((r) => (
            <Box key={r.runId}>
              <Text dimColor>· </Text>
              <Text color="cyan">{r.runId.slice(0, 16).replace('T', ' ')}</Text>
              <Text dimColor>{`  ${r.tally.total}p: ${r.tally.accepted}a/${r.tally.skipped}s/${r.tally.pending}pend`}</Text>
            </Box>
          ))}
        </>
      )}
    </>
  );
}
