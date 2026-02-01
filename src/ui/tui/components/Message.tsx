import React from 'react';
import { Box, Text } from 'ink';
import type { NormalizedMessage } from '../../../sessions/normalized-types.js';
import { ToolCallDetails } from './ToolCallDetails.js';

const roleColors = {
  user: 'cyan',
  assistant: 'green',
  system: 'yellow',
  tool: 'magenta',
} as const;

const roleLabels = {
  user: 'You',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
} as const;

export interface MessageProps {
  message: NormalizedMessage;
}

export function Message({ message }: MessageProps): React.ReactElement {
  const color = roleColors[message.role];
  const label = roleLabels[message.role];

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color={color}>
          [{label}]
        </Text>
        {message.timestamp && (
          <Text dimColor> {new Date(message.timestamp).toLocaleTimeString()}</Text>
        )}
      </Box>
      <Box marginLeft={2}>
        <Text wrap="wrap">{message.content}</Text>
      </Box>
      {message.tool && (
        <ToolCallDetails
          tool={{
            name: message.tool.name,
            input: message.tool.input,
            output: message.tool.output,
            duration: message.tool.duration,
            isError: message.tool.isError,
          }}
        />
      )}
    </Box>
  );
}
