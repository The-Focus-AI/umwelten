import React from 'react';
import { Box, Text } from 'ink';
import type { BrowserSession } from './browser-data.js';

const SUMMARY_MAX = 200;
const LEARNINGS_MAX = 220;
const PROMPT_MAX = 120;

/** Indexer fallback when session had no analyzable content; don't show as real summary/learnings. */
const EMPTY_ANALYSIS_SUMMARY = 'Session with no analyzable conversation content.';
const EMPTY_ANALYSIS_LEARNINGS = 'No user/assistant text to analyze.';

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

  const summaryDisplay =
    summary && summary.trim() !== EMPTY_ANALYSIS_SUMMARY
      ? summary.replace(/\n/g, ' ').trim()
      : '';
  const learningsDisplay =
    keyLearnings && keyLearnings.trim() !== EMPTY_ANALYSIS_LEARNINGS
      ? keyLearnings.replace(/\n/g, ' ').trim()
      : '';

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text color="blue" bold>Prompt: </Text>
        <Text color="white">{truncate(firstPrompt, PROMPT_MAX)}</Text>
      </Box>
      {analysis ? (
        <>
          {summaryDisplay ? (
            <Box marginBottom={1} flexDirection="column">
              <Text color="blue" bold>Summary</Text>
              <Text color="white" wrap="wrap">{truncate(summaryDisplay, SUMMARY_MAX)}</Text>
            </Box>
          ) : analysis.analysis?.summary?.trim() === EMPTY_ANALYSIS_SUMMARY ? (
            <Box marginBottom={1}>
              <Text color="gray">Empty or not analyzable — no user/assistant text when indexed.</Text>
            </Box>
          ) : null}
          {learningsDisplay && (
            <Box marginBottom={1} flexDirection="column">
              <Text color="magenta" bold>Learnings</Text>
              <Text color="gray" wrap="wrap">{truncate(learningsDisplay, LEARNINGS_MAX)}</Text>
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
