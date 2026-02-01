import React, { useState, useEffect } from 'react';
import { Box, Text, useFocus, useInput } from 'ink';
import type { NormalizedMessage, NormalizedSessionEntry } from '../../../sessions/normalized-types.js';
import { loadSessionMessages } from './browser-data.js';

const ONE_LINE_MAX = 70;

function truncate(s: string, max: number): string {
  if (!s) return '';
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : one.slice(0, max - 3) + '...';
}

function roleLabel(role: string): string {
  switch (role) {
    case 'user':
      return 'You';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'System';
    case 'tool':
      return 'Tool';
    default:
      return role;
  }
}

function roleColor(role: string): 'cyan' | 'green' | 'yellow' | 'magenta' {
  switch (role) {
    case 'user':
      return 'cyan';
    case 'assistant':
      return 'green';
    case 'system':
      return 'yellow';
    case 'tool':
      return 'magenta';
    default:
      return 'green';
  }
}

function timeStr(msg: NormalizedMessage): string {
  if (!msg.timestamp) return '';
  try {
    return new Date(msg.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function firstLine(msg: NormalizedMessage): string {
  if (msg.tool) return `[${msg.tool.name}]`;
  return truncate(msg.content || '', ONE_LINE_MAX);
}

export interface ChatDetailViewProps {
  projectPath: string;
  sessionEntry: NormalizedSessionEntry;
  onBack: () => void;
  /** Called when user presses 'o' to open and exit (e.g. print CLI command). */
  onOpenAndExit?: () => void;
}

export function ChatDetailView({
  projectPath,
  sessionEntry,
  onBack,
  onOpenAndExit,
}: ChatDetailViewProps): React.ReactElement {
  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadSessionMessages(projectPath, sessionEntry)
      .then(list => {
        if (!cancelled) {
          setMessages(list);
          setSelectedIndex(0);
          setExpandedIds(new Set());
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, sessionEntry.id]);

  useFocus({ autoFocus: true });
  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    const lower = input.toLowerCase();
    if (lower === 'b') {
      onBack();
      return;
    }
    if (lower === 'o') {
      onOpenAndExit?.();
      return;
    }
    if (key.return) {
      const msg = messages[selectedIndex];
      if (msg) {
        setExpandedIds(prev => {
          const next = new Set(prev);
          if (next.has(msg.id)) next.delete(msg.id);
          else next.add(msg.id);
          return next;
        });
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIndex(i => (i <= 0 ? messages.length - 1 : i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(i => (i >= messages.length - 1 ? 0 : i + 1));
      return;
    }
  });

  if (loading) {
    return (
      <Box paddingY={1}>
        <Text color="cyan">Loading chat…</Text>
      </Box>
    );
  }

  const visibleStart = Math.max(0, Math.min(selectedIndex - 3, messages.length - 10));
  const visibleEnd = Math.min(messages.length, visibleStart + 12);
  const visible = messages.slice(visibleStart, visibleEnd);
  const firstPrompt = truncate(sessionEntry.firstPrompt ?? '', 60);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Chat</Text>
        <Text color="gray"> · </Text>
        <Text color="white">{firstPrompt}</Text>
        <Text color="gray"> · </Text>
        <Text color="gray">Esc</Text>
        <Text color="gray"> back</Text>
      </Box>

      <Box flexDirection="column">
        {visible.map((msg, i) => {
          const idx = visibleStart + i;
          const isSelected = idx === selectedIndex;
          const isExpanded = expandedIds.has(msg.id);
          const color = roleColor(msg.role);
          const time = timeStr(msg);
          const line = firstLine(msg);

          return (
            <Box key={msg.id} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color="gray">{time.padEnd(8)}</Text>
                <Text bold color={color}>
                  {isSelected ? '▶ ' : '  '}[{roleLabel(msg.role)}]
                </Text>
                <Text color={isSelected ? 'white' : 'gray'}> {line}</Text>
              </Box>
              {isExpanded && (
                <Box flexDirection="column" marginLeft={2} marginTop={1}>
                  <Text wrap="wrap">{msg.content || '(no content)'}</Text>
                  {msg.tool && (
                    <Box flexDirection="column" marginTop={1}>
                      <Text color="magenta" bold>
                        Tool: {msg.tool.name}
                      </Text>
                      {msg.tool.output != null && (
                        <Text wrap="wrap" color="gray">
                          {msg.tool.output.length > 400
                            ? msg.tool.output.slice(0, 400) + '…'
                            : msg.tool.output}
                        </Text>
                      )}
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">
          <Text color="cyan">↑/↓</Text> move · <Text color="cyan">Enter</Text> expand · <Text color="gray">Esc</Text> back · <Text color="cyan">o</Text> open & exit
        </Text>
      </Box>
    </Box>
  );
}
