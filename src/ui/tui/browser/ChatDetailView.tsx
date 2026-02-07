import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useFocus, useInput } from 'ink';
import type { NormalizedMessage, NormalizedSessionEntry } from '../../../interaction/types/normalized-types.js';
import { messagesToBeats, formatBeatToolSummary, type ConversationBeat } from '../../../interaction/analysis/conversation-beats.js';
import type { BrowserSession } from './browser-data.js';
import { loadSessionMessages } from './browser-data.js';

const USER_PREVIEW_MAX = 70;
const ASSISTANT_PREVIEW_MAX = 70;
const MESSAGE_LINE_MAX = 72;
const SUMMARY_LINES = 3;
const LEARNINGS_LINES = 4;

/** Indexer fallback when session had no analyzable content; don't show as real summary/learnings. */
const EMPTY_ANALYSIS_SUMMARY = 'Session with no analyzable conversation content.';
const EMPTY_ANALYSIS_LEARNINGS = 'No user/assistant text to analyze.';

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

type DetailRow =
  | { type: 'beat'; beat: ConversationBeat; beatIndex: number }
  | { type: 'message'; message: NormalizedMessage; beatIndex: number };

function firstLine(msg: NormalizedMessage): string {
  if (msg.tool) return `[${msg.tool.name}]`;
  return truncate(msg.content || '', MESSAGE_LINE_MAX);
}

export interface ChatDetailViewProps {
  projectPath: string;
  /** Full browser session (session + analysis) for summary/learnings. */
  browserSession: BrowserSession;
  onBack: () => void;
  onOpenAndExit?: () => void;
}

export function ChatDetailView({
  projectPath,
  browserSession,
  onBack,
  onOpenAndExit,
}: ChatDetailViewProps): React.ReactElement {
  const { session: sessionEntry, analysis } = browserSession;
  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedBeats, setExpandedBeats] = useState<Set<number>>(new Set());
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);

  const beats = useMemo(() => messagesToBeats(messages), [messages]);

  const rows: DetailRow[] = useMemo(() => {
    const out: DetailRow[] = [];
    beats.forEach((beat, i) => {
      out.push({ type: 'beat', beat, beatIndex: i });
      if (expandedBeats.has(i)) {
        beat.messages.forEach(msg => {
          out.push({ type: 'message', message: msg, beatIndex: i });
        });
      }
    });
    return out;
  }, [beats, expandedBeats]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadSessionMessages(projectPath, sessionEntry)
      .then(list => {
        if (!cancelled) {
          setMessages(list);
          setExpandedBeats(new Set());
          setExpandedMessageIds(new Set());
          setSelectedRowIndex(0);
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
      const row = rows[selectedRowIndex];
      if (row?.type === 'beat') {
        setExpandedBeats(prev => {
          const next = new Set(prev);
          if (next.has(row.beatIndex)) next.delete(row.beatIndex);
          else next.add(row.beatIndex);
          return next;
        });
        return;
      }
      if (row?.type === 'message') {
        setExpandedMessageIds(prev => {
          const next = new Set(prev);
          const id = row.message.id;
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        return;
      }
      return;
    }
    if (input === ' ') {
      const row = rows[selectedRowIndex];
      if (row?.type === 'beat') {
        setExpandedBeats(prev => {
          const next = new Set(prev);
          if (next.has(row.beatIndex)) next.delete(row.beatIndex);
          else next.add(row.beatIndex);
          return next;
        });
      }
      return;
    }
    if (key.upArrow) {
      setSelectedRowIndex(i => (i <= 0 ? rows.length - 1 : i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedRowIndex(i => (i >= rows.length - 1 ? 0 : i + 1));
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

  const rawSummary = analysis?.analysis?.summary ?? '';
  const rawLearnings = analysis?.analysis?.keyLearnings ?? '';
  const isEmptyFallback =
    rawSummary.trim() === EMPTY_ANALYSIS_SUMMARY ||
    rawLearnings.trim() === EMPTY_ANALYSIS_LEARNINGS;
  const summary = isEmptyFallback ? '' : rawSummary;
  const keyLearnings = isEmptyFallback ? '' : rawLearnings;
  const summaryLines = summary ? summary.split(/\n/).slice(0, SUMMARY_LINES) : [];
  const learningsLines = keyLearnings ? keyLearnings.split(/\n/).slice(0, LEARNINGS_LINES) : [];

  const visibleStart =
    rows.length === 0 ? 0 : Math.max(0, Math.min(selectedRowIndex - 2, rows.length - 10));
  const visibleEnd = Math.min(rows.length, visibleStart + 14);
  const visibleRows = rows.slice(visibleStart, visibleEnd);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Chat</Text>
        <Text color="gray"> · </Text>
        <Text color="white">{truncate(sessionEntry.firstPrompt ?? '', 50)}</Text>
        <Text color="gray"> · </Text>
        <Text color="gray">Esc</Text>
        <Text color="gray"> back</Text>
      </Box>

      {/* Summary & Learnings (when indexed) */}
      {analysis && (summaryLines.length > 0 || learningsLines.length > 0) && (
        <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="blue" paddingX={1} paddingY={1}>
          {summaryLines.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text color="blue" bold>Summary</Text>
              <Text color="white"> {summaryLines.join(' ')}</Text>
            </Box>
          )}
          {learningsLines.length > 0 && (
            <Box flexDirection="column">
              <Text color="magenta" bold>Learnings</Text>
              <Text color="gray"> {learningsLines.join(' ')}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Beats (and messages when expanded) */}
      <Box flexDirection="column">
        {rows.length === 0 ? (
          <Text color="gray">No conversation beats (no user messages).</Text>
        ) : null}
        {visibleRows.map((row, i) => {
          const globalIndex = visibleStart + i;
          const isSelected = globalIndex === selectedRowIndex;
          const color = isSelected ? 'cyan' : 'white';

          if (row.type === 'beat') {
            const { beat, beatIndex } = row;
            const toolSummary = formatBeatToolSummary(beat.toolCount, beat.toolDurationMs);
            const isExpanded = expandedBeats.has(beatIndex);
            return (
              <Box key={`beat-${beatIndex}`} flexDirection="column" marginBottom={isExpanded ? 0 : 1}>
                <Box>
                  <Text bold color={color}>{isSelected ? '▶ ' : '  '}</Text>
                  <Text color="cyan">You: </Text>
                  <Text color={color}>{truncate(beat.userPreview, USER_PREVIEW_MAX)}</Text>
                </Box>
                <Box>
                  <Text color="gray">    </Text>
                  {toolSummary ? (
                    <Text color="yellow"> {toolSummary}</Text>
                  ) : null}
                  {beat.assistantPreview ? (
                    <>
                      <Text color="gray"> → </Text>
                      <Text color="green">{truncate(beat.assistantPreview, ASSISTANT_PREVIEW_MAX)}</Text>
                    </>
                  ) : null}
                </Box>
                <Box>
                  <Text color="gray">    </Text>
                  <Text color="gray" italic>
                    {isExpanded ? '▼' : '▶'} Space to {isExpanded ? 'collapse' : 'expand'}
                  </Text>
                </Box>
              </Box>
            );
          }

          const { message, beatIndex } = row;
          const isMsgExpanded = expandedMessageIds.has(message.id);
          const indent = '      ';
          return (
            <Box key={message.id} flexDirection="column" marginLeft={2} marginBottom={1}>
              <Box>
                <Text color="gray">{indent}</Text>
                <Text bold color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '▶ ' : '  '}</Text>
                <Text color={roleColor(message.role)}>[{roleLabel(message.role)}]</Text>
                <Text color={isSelected ? 'white' : 'gray'}> {firstLine(message)}</Text>
              </Box>
              {isMsgExpanded && (
                <Box flexDirection="column" marginLeft={4} marginTop={1}>
                  <Text wrap="wrap">{message.content || '(no content)'}</Text>
                  {message.tool && (
                    <Box flexDirection="column" marginTop={1}>
                      <Text color="magenta" bold>Tool: {message.tool.name}</Text>
                      {message.tool.output != null && (
                        <Text wrap="wrap" color="gray">
                          {message.tool.output.length > 400
                            ? message.tool.output.slice(0, 400) + '…'
                            : message.tool.output}
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

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">
          <Text color="cyan">↑/↓</Text> move · <Text color="cyan">Space</Text> expand/collapse beat · <Text color="cyan">Enter</Text> expand message · <Text color="gray">Esc</Text> back · <Text color="cyan">o</Text> open & exit
        </Text>
      </Box>
    </Box>
  );
}
