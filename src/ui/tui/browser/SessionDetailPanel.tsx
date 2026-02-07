import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import { messagesToBeats, formatBeatToolSummary, type ConversationBeat } from '../../../interaction/analysis/conversation-beats.js';
import type { NormalizedMessage } from '../../../interaction/types/normalized-types.js';
import type { BrowserSession } from './browser-data.js';
import { loadSessionMessages } from './browser-data.js';

const SUMMARY_MAX = 200;
const LEARNINGS_MAX = 220;
const PROMPT_MAX = 120;

/** Indexer fallback when session had no analyzable content; don't show as real summary/learnings. */
const EMPTY_ANALYSIS_SUMMARY = 'Session with no analyzable conversation content.';
const EMPTY_ANALYSIS_LEARNINGS = 'No user/assistant text to analyze.';


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

const BEAT_PREVIEW_MAX = 50;

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 3) + '...';
}

export interface SessionDetailPanelProps {
  projectPath: string;
  session: BrowserSession;
  /** Tighter layout for two-column browse (right column). */
  compact?: boolean;
}

const COMPACT_PROMPT_MAX = 500;
const COMPACT_BEAT_PREVIEW = 60;
const COMPACT_SUMMARY_MAX = 200;

export function SessionDetailPanel({ projectPath, session, compact }: SessionDetailPanelProps): React.ReactElement {
  const { session: s, analysis } = session;
  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMessagesLoading(true);
    loadSessionMessages(projectPath, s)
      .then(list => {
        if (!cancelled) setMessages(list);
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, s.id]);

  const beats = useMemo(() => messagesToBeats(messages), [messages]);
  const firstBeats = beats.slice(0, compact ? 2 : 3);

  const firstPrompt = s.firstPrompt ?? analysis?.metadata?.firstPrompt ?? '';
  const summary = analysis?.analysis?.summary ?? '';
  const keyLearnings = analysis?.analysis?.keyLearnings ?? '';
  const topics = analysis?.analysis?.topics ?? [];
  const toolsUsed = analysis?.analysis?.toolsUsed ?? [];
  const relatedFiles = analysis?.analysis?.relatedFiles ?? [];
  const solutionType = analysis?.analysis?.solutionType ?? '';
  const success = analysis?.analysis?.successIndicators ?? 'unclear';

  const msgCountFromAnalysis = analysis?.metadata?.messageCount ?? s.messageCount ?? 0;
  const toolCallCountFromAnalysis =
    analysis?.metadata?.toolCallCount ?? s.metrics?.toolCalls ?? 0;
  const loadedMsgCount =
    messages.length > 0
      ? messages.filter(m => m.role === 'user' || m.role === 'assistant').length
      : 0;
  const loadedToolCount =
    messages.length > 0 ? messages.filter(m => m.role === 'tool').length : 0;
  const msgCount = loadedMsgCount > 0 ? loadedMsgCount : msgCountFromAnalysis;
  const toolCallCount =
    toolCallCountFromAnalysis > 0 ? toolCallCountFromAnalysis : loadedToolCount;
  const hasKnownStats = msgCount > 0 || toolCallCount > 0;
  const estimatedCost =
    analysis?.metadata?.estimatedCost ?? s.metrics?.estimatedCost;

  const summaryDisplay =
    summary && summary.trim() !== EMPTY_ANALYSIS_SUMMARY
      ? summary.replace(/\n/g, ' ').trim()
      : '';
  const learningsDisplay =
    keyLearnings && keyLearnings.trim() !== EMPTY_ANALYSIS_LEARNINGS
      ? keyLearnings.replace(/\n/g, ' ').trim()
      : '';

  const sourceLabel =
    s.source === 'claude-code' ? 'claude' : s.source === 'cursor' ? 'cursor' : s.source ?? '—';
  const promptMax = compact ? COMPACT_PROMPT_MAX : PROMPT_MAX;
  const beatPreviewMax = compact ? COMPACT_BEAT_PREVIEW : BEAT_PREVIEW_MAX;
  const summaryMax = compact ? COMPACT_SUMMARY_MAX : SUMMARY_MAX;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} paddingY={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text color="blue" bold>Source: </Text>
        <Text color="gray"> {sourceLabel}</Text>
      </Box>
      <Box marginBottom={1} flexDirection="column">
        <Text color="blue" bold>Prompt: </Text>
        <Text color="white" wrap="wrap">{firstPrompt || '—'}</Text>
      </Box>
      <Box marginBottom={1} flexDirection="column">
        <Text color="blue" bold>Stats: </Text>
        <Text color="gray">
          {hasKnownStats
            ? `${msgCount} msg · ${toolCallCount} tools${estimatedCost != null && estimatedCost > 0 ? ` · $${estimatedCost.toFixed(2)}` : ''}`
            : firstPrompt
              ? '— (load messages for count)'
              : '0 msg · 0 tools'}
        </Text>
      </Box>
      {!messagesLoading && beats.length > 0 && (
        <Box marginBottom={1} flexDirection="column">
          <Text color="blue" bold>Beats: </Text>
          <Text color="gray">{beats.length} turn(s)</Text>
          {firstBeats.map((beat: ConversationBeat, i: number) => {
            const toolSummary = formatBeatToolSummary(beat.toolCount, beat.toolDurationMs);
            return (
              <Box key={i} marginTop={compact ? 0 : 1}>
                <Text color="cyan">  {i + 1}. </Text>
                <Text color="gray">{truncate(beat.userPreview, beatPreviewMax)}</Text>
                {toolSummary ? (
                  <Text color="yellow"> {toolSummary}</Text>
                ) : null}
                {beat.assistantPreview ? (
                  <Text color="green"> → {truncate(beat.assistantPreview, beatPreviewMax)}</Text>
                ) : null}
              </Box>
            );
          })}
        </Box>
      )}
      {analysis ? (
        <>
          {summaryDisplay ? (
            <Box marginBottom={1} flexDirection="column">
              <Text color="blue" bold>Summary</Text>
              <Text color="white" wrap="wrap">{truncate(summaryDisplay, summaryMax)}</Text>
            </Box>
          ) : analysis.analysis?.summary?.trim() === EMPTY_ANALYSIS_SUMMARY ? (
            <Box marginBottom={1} flexDirection="column">
              <Text color="gray">Summary: Not indexed (see Prompt above).</Text>
            </Box>
          ) : null}
          {!compact && learningsDisplay && (
            <Box marginBottom={1} flexDirection="column">
              <Text color="magenta" bold>Learnings</Text>
              <Text color="gray" wrap="wrap">{truncate(learningsDisplay, LEARNINGS_MAX)}</Text>
            </Box>
          )}
          {(topics.length > 0 || toolsUsed.length > 0) && (
            <Box marginBottom={1}>
              <Text color="yellow" bold>Topics: </Text>
              <Text color="gray">{topics.slice(0, compact ? 2 : 4).join(', ')}</Text>
              {toolsUsed.length > 0 && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="yellow" bold>Tools: </Text>
                  <Text color="gray">{toolsUsed.slice(0, compact ? 2 : 4).join(', ')}</Text>
                </>
              )}
            </Box>
          )}
          {relatedFiles.length > 0 && (
            <Box marginBottom={1} flexDirection="column">
              <Text color="yellow" bold>Files / source edited: </Text>
              <Text color="gray" wrap="wrap">{relatedFiles.slice(0, 8).join(', ')}{relatedFiles.length > 8 ? '…' : ''}</Text>
            </Box>
          )}
          {!compact && (
            <Box>
              <Text color="gray">{solutionType ? `${solutionType} · ` : ''}</Text>
              <Text bold color={successColor(success)}>{successLabel(success)}</Text>
            </Box>
          )}
        </>
      ) : (
        <Text color="yellow">Not indexed — press [i]</Text>
      )}
    </Box>
  );
}
