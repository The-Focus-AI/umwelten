import React, { useState } from 'react';
import { Box, Text } from 'ink';

export interface ToolCallDetailsProps {
  tool: {
    name: string;
    input?: Record<string, unknown>;
    output?: string;
    duration?: number;
    isError?: boolean;
  };
}

export function ToolCallDetails({ tool }: ToolCallDetailsProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <Box flexDirection="column" marginLeft={2} marginTop={1}>
      <Box>
        <Text color={tool.isError ? 'red' : 'magenta'} bold>
          {expanded ? '▼' : '▶'} {tool.name}
        </Text>
        {tool.duration != null && (
          <Text dimColor> ({tool.duration}ms)</Text>
        )}
      </Box>

      {expanded && (
        <Box flexDirection="column" marginLeft={2} borderStyle="single" borderColor="gray">
          {tool.input != null && Object.keys(tool.input).length > 0 && (
            <Box flexDirection="column">
              <Text bold>Input:</Text>
              <Text wrap="wrap">{JSON.stringify(tool.input, null, 2)}</Text>
            </Box>
          )}
          {tool.output != null && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Output:</Text>
              <Text
                wrap="wrap"
                color={tool.isError ? 'red' : undefined}
              >
                {tool.output.length > 500 ? `${tool.output.slice(0, 500)}...` : tool.output}
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
