import React from 'react';
import { Box, Text } from 'ink';
import type { BrowserSession } from './browser-data.js';

const ONE_LINE_MAX = 80;

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

/** One line: date/time + summary (or first prompt). */
export function SessionCard({ session, isSelected }: SessionCardProps): React.ReactElement {
  const { session: s, analysis } = session;
  const dateStr = formatDate(s.modified ?? s.created ?? '');
  const summary =
    analysis?.analysis?.summary?.trim() ||
    s.firstPrompt?.trim() ||
    analysis?.metadata?.firstPrompt?.trim() ||
    '(no summary)';
  const line = truncate(summary.replace(/\s+/g, ' '), ONE_LINE_MAX);
  const color = isSelected ? 'cyan' : 'white';

  return (
    <Box>
      <Text color="gray">{dateStr.padEnd(12)}</Text>
      <Text bold color={color}>
        {isSelected ? '▶ ' : '  '}
      </Text>
      <Text color={color}>{line}</Text>
    </Box>
  );
}
