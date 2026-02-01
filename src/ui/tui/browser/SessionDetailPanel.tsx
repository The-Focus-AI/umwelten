import React from 'react';
import { Box, Text } from 'ink';
import type { BrowserSession } from './browser-data.js';

const SUMMARY_MAX = 120;
const LEARNINGS_MAX = 100;

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 3) + '...';
}

function successColor(indicator: string): 'green' | 'yellow' | 'red' | 'gray' {
  switch (indicator) {
    case 'yes':
      return 'green';
    case 'partial':
      return 'yellow';
    case 'no':
      return 'red';
    default:
      return 'gray';
  }
}

function successLabel(indicator: string): string {
  switch (indicator) {
    case 'yes':
      return 'Success';
    case 'partial':
      return 'Partial';
    case 'no':
      return 'Failed';
    default:
      return 'Unclear';
  }
}

export interface SessionDetailPanelProps {
  session: BrowserSession;
}

export function SessionDetailPanel({ session }: SessionDetailPanelProps): React.ReactElement {
  const { session: s, analysis } = session;
  const firstPrompt = s.firstPrompt ?? analysis?.metadata?.firstPrompt ?? '';
  const summary = analysis?.analysis?.summary ?? '';
  const keyLearnings = analysis?.analysis?.keyLearnings ?? '';
  const topics = analysis?.analysis?.topics ?? [];
  const toolsUsed = analysis?.analysis?.toolsUsed ?? [];
  const solutionType = analysis?.analysis?.solutionType ?? '';
  const success = analysis?.analysis?.successIndicators ?? 'unclear';

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text color="blue" bold>Prompt: </Text>
        <Text color="white">{truncate(firstPrompt, 100)}</Text>
      </Box>
      {analysis ? (
        <>
          {summary && (
            <Box marginBottom={1}>
              <Text color="blue" bold>Summary: </Text>
              <Text color="white">{truncate(summary, SUMMARY_MAX)}</Text>
            </Box>
          )}
          {keyLearnings && (
            <Box marginBottom={1}>
              <Text color="magenta" bold>Learnings: </Text>
              <Text color="gray">{truncate(keyLearnings.replace(/\n/g, ' '), LEARNINGS_MAX)}</Text>
            </Box>
          )}
          {(topics.length > 0 || toolsUsed.length > 0) && (
            <Box marginBottom={1}>
              <Text color="yellow" bold>Topics: </Text>
              <Text color="gray">{topics.slice(0, 4).join(', ')}</Text>
              {toolsUsed.length > 0 && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="yellow" bold>Tools: </Text>
                  <Text color="gray">{toolsUsed.slice(0, 4).join(', ')}</Text>
                </>
              )}
            </Box>
          )}
          <Box>
            <Text color="gray">{solutionType ? `${solutionType} · ` : ''}</Text>
            <Text bold color={successColor(success)}>{successLabel(success)}</Text>
          </Box>
        </>
      ) : (
        <Text color="yellow">Not indexed — index updates in background or press [i]</Text>
      )}
    </Box>
  );
}
