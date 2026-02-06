import React from 'react';
import { Box, Text } from 'ink';
import type { BrowserSession } from './browser-data.js';

const LINE_MAX = 85;

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 3) + '...';
}

/** Format ISO date string as "Jan 30 14:32" */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const mon = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    const h = d.getHours();
    const m = d.getMinutes();
    return `${mon} ${day} ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export interface SessionCardProps {
  session: BrowserSession;
  isSelected: boolean;
  /** One-line layout for narrow column. */
  compact?: boolean;
  summaryMaxWidth?: number;
  /** Two-line layout for top-half list: prompt line + stats (msg, tools, cost, files). */
  listMode?: boolean;
  /** Max chars for prompt when listMode (full width). */
  promptMaxWidth?: number;
}

/** Fallback summary from indexer when session had no analyzable content; don't prefer it over firstPrompt. */
const EMPTY_ANALYSIS_SUMMARY = 'Session with no analyzable conversation content.';

/** Show source as short label (cursor / claude / etc.). */
function sourceLabel(source: string): string {
  if (source === 'claude-code') return 'claude';
  if (source === 'cursor') return 'cursor';
  return source;
}

/** One line when compact; two lines when listMode; else 3 rows. */
export function SessionCard({
  session,
  isSelected,
  compact,
  summaryMaxWidth = 30,
  listMode,
  promptMaxWidth = 78,
}: SessionCardProps): React.ReactElement {
  const { session: s, analysis } = session;
  const dateStr = formatDate(s.modified ?? s.created ?? '');
  const source = sourceLabel(s.source ?? 'unknown');
  const rawSummary = analysis?.analysis?.summary?.trim();
  const isEmptyFallback = rawSummary === EMPTY_ANALYSIS_SUMMARY;
  const summary =
    (rawSummary && !isEmptyFallback ? rawSummary : null) ||
    s.firstPrompt?.trim() ||
    analysis?.metadata?.firstPrompt?.trim() ||
    (isEmptyFallback ? '(empty or not analyzable)' : '(no summary)');
  const oneLine = summary.replace(/\s+/g, ' ').trim();
  const color = isSelected ? 'cyan' : 'white';
  const msgCount = analysis?.metadata?.messageCount ?? s.messageCount ?? 0;
  const toolCount = analysis?.metadata?.toolCallCount ?? s.metrics?.toolCalls;
  const cost = analysis?.metadata?.estimatedCost ?? s.metrics?.estimatedCost;
  const relatedFiles = analysis?.analysis?.relatedFiles ?? [];
  const filesCount = relatedFiles.length;
  const hasStats = msgCount > 0 || (toolCount != null && toolCount > 0);
  const statsSuffix = hasStats ? `  ${msgCount} msg${(toolCount ?? 0) > 0 ? ` · ${toolCount} tools` : ''}` : '';

  if (listMode) {
    const promptTrunc = truncate(oneLine, promptMaxWidth);
    const statsParts: string[] = [];
    statsParts.push(msgCount > 0 ? `${msgCount} msg` : '— msg');
    statsParts.push((toolCount ?? 0) > 0 ? `${toolCount} tools` : '— tools');
    statsParts.push(cost != null && cost > 0 ? `$${cost.toFixed(2)}` : '—');
    statsParts.push(filesCount > 0 ? `${filesCount} files` : '0 files');
    const statsLine = statsParts.join(' · ');
    return (
      <Box flexDirection="column" marginBottom={0}>
        <Box>
          <Text color="gray">{dateStr.padEnd(12)}</Text>
          <Text color="cyan">[{source}]</Text>
          <Text bold color={color}>{isSelected ? ' ▶ ' : '    '}</Text>
          <Text color={color}>{promptTrunc}</Text>
        </Box>
        <Box>
          <Text color="gray">{' '.repeat(14)}</Text>
          <Text color="gray">{statsLine}</Text>
        </Box>
      </Box>
    );
  }

  if (compact) {
    const summaryTrunc = truncate(oneLine, summaryMaxWidth);
    return (
      <Box marginBottom={0}>
        <Text color="gray">{dateStr.padEnd(12)}</Text>
        <Text color="cyan">[{source}]</Text>
        <Text bold color={color}>{isSelected ? ' ▶ ' : '    '}</Text>
        <Text color={color}>{summaryTrunc}</Text>
        {statsSuffix ? <Text color="gray">{statsSuffix}</Text> : null}
      </Box>
    );
  }

  const line1 = truncate(oneLine, LINE_MAX);
  const topics = analysis?.analysis?.topics ?? [];
  const toolsUsed = analysis?.analysis?.toolsUsed ?? [];
  const line2 =
    topics.length > 0 || toolsUsed.length > 0
      ? [topics.slice(0, 3).join(', '), toolsUsed.slice(0, 3).join(', ')].filter(Boolean).join(' · ')
      : oneLine.length > LINE_MAX
        ? truncate(oneLine.slice(LINE_MAX - 3), LINE_MAX)
        : '';

  const hasStatsFull = msgCount > 0 || (toolCount != null && toolCount > 0) || (cost != null && cost > 0);
  const statsParts: string[] = hasStatsFull ? [`${msgCount} msg`] : [];
  if (toolCount != null && toolCount > 0) statsParts.push(`${toolCount} tools`);
  if (cost != null && cost > 0) statsParts.push(`$${cost.toFixed(2)}`);
  const statsLine = statsParts.length > 0 ? statsParts.join(' · ') : '—';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="gray">{dateStr.padEnd(12)}</Text>
        <Text bold color={color}>
          {isSelected ? '▶ ' : '  '}
        </Text>
        <Text color={color}>{line1}</Text>
      </Box>
      <Box>
        <Text color="cyan">{`[${source}]`.padEnd(12)}</Text>
        <Text color="gray">  </Text>
        {line2 ? (
          <Text color="gray">{truncate(line2, LINE_MAX)}</Text>
        ) : (
          <Text> </Text>
        )}
      </Box>
      <Box>
        <Text color="gray">{' '.repeat(12)}</Text>
        <Text color="gray">  </Text>
        <Text color="gray">{statsLine}</Text>
      </Box>
    </Box>
  );
}
