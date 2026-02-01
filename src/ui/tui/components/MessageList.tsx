import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { NormalizedMessage } from '../../../sessions/normalized-types.js';
import { Message } from './Message.js';

export interface MessageListProps {
  messages: NormalizedMessage[];
  /** Hide tool (role === 'tool') messages. */
  hideTools?: boolean;
  /** Hide tool result content (show tool calls only as summary). */
  hideToolResults?: boolean;
  /** Show only user and assistant text (no tool messages). */
  showOnlyUserAssistant?: boolean;
  /** Latest activity summary (e.g. last tool name). */
  latestActivity?: string;
}

function filterMessages(
  messages: NormalizedMessage[],
  hideTools: boolean,
  hideToolResults: boolean,
  showOnlyUserAssistant: boolean
): NormalizedMessage[] {
  if (showOnlyUserAssistant) {
    return messages.filter(m => m.role === 'user' || (m.role === 'assistant' && !m.tool));
  }
  if (hideTools) return messages.filter(m => m.role !== 'tool');
  if (hideToolResults) {
    return messages.map(m => {
      if (m.role === 'tool' && m.tool?.output) {
        return { ...m, tool: { ...m.tool, output: '(hidden)' } };
      }
      return m;
    });
  }
  return messages;
}

export function MessageList({
  messages,
  hideTools = false,
  hideToolResults = false,
  showOnlyUserAssistant = false,
  latestActivity,
}: MessageListProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;
  const availableHeight = Math.max(8, terminalHeight - 6);
  const visibleCount = Math.floor(availableHeight / 3);

  const filtered = useMemo(
    () => filterMessages(messages, hideTools, hideToolResults, showOnlyUserAssistant),
    [messages, hideTools, hideToolResults, showOnlyUserAssistant]
  );

  const visibleMessages = useMemo(() => {
    const start = Math.max(0, filtered.length - visibleCount);
    return filtered.slice(start);
  }, [filtered, visibleCount]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {latestActivity && (
        <Box marginBottom={1}>
          <Text dimColor>Latest: {latestActivity}</Text>
        </Box>
      )}
      {visibleMessages.map(msg => (
        <Message key={msg.id} message={msg} />
      ))}
      {filtered.length > visibleCount && (
        <Text dimColor>
          Showing {visibleMessages.length} of {filtered.length} messages
        </Text>
      )}
    </Box>
  );
}
