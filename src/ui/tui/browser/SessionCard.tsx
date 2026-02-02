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
}

/** Fallback summary from indexer when session had no analyzable content; don't prefer it over firstPrompt. */
const EMPTY_ANALYSIS_SUMMARY = 'Session with no analyzable conversation content.';

/** Two lines per session with space below: date + summary line 1, optional line 2 (topics/tools or more summary). */
export function SessionCard({ session, isSelected }: SessionCardProps): React.ReactElement {
  const { session: s, analysis } = session;
  const dateStr = formatDate(s.modified ?? s.created ?? '');
  const rawSummary = analysis?.analysis?.summary?.trim();
  const isEmptyFallback = rawSummary === EMPTY_ANALYSIS_SUMMARY;
  const summary =
    (rawSummary && !isEmptyFallback ? rawSummary : null) ||
    s.firstPrompt?.trim() ||
    analysis?.metadata?.firstPrompt?.trim() ||
    (isEmptyFallback ? '(empty or not analyzable)' : '(no summary)');
  const oneLine = summary.replace(/\s+/g, ' ').trim();
  const color = isSelected ? 'cyan' : 'white';
  const line1 = truncate(oneLine, LINE_MAX);
  const topics = analysis?.analysis?.topics ?? [];
  const toolsUsed = analysis?.analysis?.toolsUsed ?? [];
  const line2 =
    topics.length > 0 || toolsUsed.length > 0
      ? [topics.slice(0, 3).join(', '), toolsUsed.slice(0, 3).join(', ')].filter(Boolean).join(' · ')
      : oneLine.length > LINE_MAX
        ? truncate(oneLine.slice(LINE_MAX - 3), LINE_MAX)
        : '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="gray">{dateStr.padEnd(12)}</Text>
        <Text bold color={color}>
          {isSelected ? '▶ ' : '  '}
        </Text>
        <Text color={color}>{line1}</Text>
      </Box>
      {line2 ? (
        <Box>
          <Text color="gray">{' '.repeat(12)}</Text>
          <Text color="gray">  </Text>
          <Text color="gray">{truncate(line2, LINE_MAX)}</Text>
        </Box>
      ) : (
        <Box><Text> </Text></Box>
      )}
    </Box>
  );
}
