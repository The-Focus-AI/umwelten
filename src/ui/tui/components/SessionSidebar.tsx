import React from 'react';
import { Box, Text } from 'ink';
import type { NormalizedSessionEntry } from '../../../interaction/types/normalized-types.js';

export type LiveLiveness = 'alive' | 'stale' | 'ended';
export type FileLiveness = 'reading' | 'writing' | 'ended';

export interface SessionSidebarItem {
  id: string;
  label: string;
  type: 'live' | 'file' | 'session';
  liveness?: LiveLiveness | FileLiveness;
  firstPrompt?: string;
}

export interface SessionSidebarProps {
  items: SessionSidebarItem[];
  selectedId: string | null;
  onSelect?: (id: string) => void;
}

function shortId(id: string): string {
  if (id === 'live' || id === 'file') return id;
  const part = id.split(':').pop() ?? id;
  return part.slice(0, 8);
}

export function SessionSidebar({
  items,
  selectedId,
}: SessionSidebarProps): React.ReactElement {
  return (
    <Box flexDirection="column" width={28} borderStyle="single" borderColor="gray" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Sessions</Text>
      </Box>
      {items.map(item => {
        const isSelected = item.id === selectedId;
        const livenessLabel =
          item.type === 'live' && item.liveness
            ? ` (${item.liveness})`
            : item.type === 'file' && item.liveness
              ? ` (${item.liveness})`
              : '';
        return (
          <Box key={item.id}>
            <Text bold={isSelected} color={isSelected ? 'cyan' : undefined}>
              {isSelected ? '▶ ' : '  '}
              {item.type === 'live' ? 'Live' : item.type === 'file' ? 'File' : shortId(item.id)}
              {livenessLabel}
            </Text>
          </Box>
        );
      })}
      {items.length === 0 && (
        <Text dimColor>No sessions</Text>
      )}
    </Box>
  );
}

export function sessionEntryToSidebarItem(entry: NormalizedSessionEntry): SessionSidebarItem {
  return {
    id: entry.id,
    label: entry.firstPrompt?.slice(0, 30) ?? entry.sourceId.slice(0, 8),
    type: 'session',
    firstPrompt: entry.firstPrompt,
  };
}
