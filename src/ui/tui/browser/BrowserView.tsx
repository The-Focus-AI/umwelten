import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp, useFocus, useInput } from 'ink';
import { SessionCard } from './SessionCard.js';
import { SessionDetailPanel } from './SessionDetailPanel.js';
import { ChatDetailView } from './ChatDetailView.js';
import type { BrowserSession } from './browser-data.js';
import { loadBrowserData, searchBrowserSessions, runBrowserIndex } from './browser-data.js';

export interface BrowserViewProps {
  projectPath: string;
  onSelectSession: (sessionId: string) => void;
}

type ViewMode = 'browse' | 'chat';

export function BrowserView({ projectPath, onSelectSession }: BrowserViewProps): React.ReactElement {
  const [viewMode, setViewMode] = useState<ViewMode>('browse');
  const [selectedSession, setSelectedSession] = useState<BrowserSession | null>(null);
  const [initialSessions, setInitialSessions] = useState<BrowserSession[]>([]);
  const [searchResults, setSearchResults] = useState<BrowserSession[] | null>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasIndex, setHasIndex] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexStatus, setIndexStatus] = useState<string | null>(null);
  const [backgroundIndexing, setBackgroundIndexing] = useState(false);

  const sessions = query.trim() ? (searchResults ?? []) : initialSessions;

  const queryRef = useRef(query);
  queryRef.current = query;

  const refreshData = React.useCallback(() => {
    loadBrowserData(projectPath).then(({ sessions: list, hasIndex: hi }) => {
      setInitialSessions(list.slice(0, 50));
      setHasIndex(hi);
      setSearchResults(null);
      const q = queryRef.current.trim();
      if (q) {
        searchBrowserSessions(projectPath, q, { limit: 50 }).then(setSearchResults);
      }
    });
  }, [projectPath]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadBrowserData(projectPath)
      .then(({ sessions: list, hasIndex: hi }) => {
        if (!cancelled) {
          setInitialSessions(list.slice(0, 50));
          setHasIndex(hi);
          setSearchResults(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  // Background index on load: update index as you browse; refresh when done
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    setBackgroundIndexing(true);
    runBrowserIndex(projectPath, { force: false })
      .then(({ indexed, skipped, failed }) => {
        if (!cancelled) {
          refreshData();
          if (indexed > 0 || failed > 0) {
            setIndexStatus(
              indexed > 0
                ? `Index updated: +${indexed}${skipped > 0 ? `, ${skipped} unchanged` : ''}`
                : failed > 0
                  ? `${failed} failed`
                  : null
            );
            setTimeout(() => setIndexStatus(null), 4000);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setIndexStatus(null);
      })
      .finally(() => {
        if (!cancelled) setBackgroundIndexing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, loading, refreshData]);

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null);
      setSelectedIndex(0);
      return;
    }
    let cancelled = false;
    searchBrowserSessions(projectPath, query, { limit: 50 }).then(list => {
      if (!cancelled) {
        setSearchResults(list);
        setSelectedIndex(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath, query]);

  const { exit } = useApp();
  useFocus({ autoFocus: true });
  useInput((input, key) => {
    if (viewMode === 'chat') return;
    if (indexing) return;
    if (key.backspace || key.delete) {
      setQuery(q => q.slice(0, -1));
      return;
    }
    if (key.return) {
      const selected = sessions[selectedIndex];
      if (selected) {
        setSelectedSession(selected);
        setViewMode('chat');
      }
      return;
    }
    if (input) {
      const lower = input.toLowerCase();
      if (lower === 'o') {
        const selected = sessions[selectedIndex];
        if (selected) {
          onSelectSession(selected.session.id);
          exit();
        }
        return;
      }
    }
    if (key.upArrow) {
      setSelectedIndex(i => (i <= 0 ? sessions.length - 1 : i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(i => (i >= sessions.length - 1 ? 0 : i + 1));
      return;
    }
    const lower = input.toLowerCase();
    if (lower === 'i') {
      setIndexing(true);
      setIndexStatus('Indexing sessions...');
      runBrowserIndex(projectPath, { force: false })
        .then(({ indexed, skipped, failed }) => {
          setIndexStatus(null);
          refreshData();
          setIndexStatus(`Indexed ${indexed}, skipped ${skipped}${failed > 0 ? `, ${failed} failed` : ''}`);
          setTimeout(() => setIndexStatus(null), 3000);
        })
        .catch(err => {
          setIndexStatus(err instanceof Error ? err.message : 'Index failed');
          setTimeout(() => setIndexStatus(null), 3000);
        })
        .finally(() => setIndexing(false));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery(q => q + input);
    }
  });

  if (loading) {
    return (
      <Box paddingY={1}>
        <Text color="cyan">Loading sessions…</Text>
      </Box>
    );
  }

  if (viewMode === 'chat' && selectedSession) {
    return (
      <ChatDetailView
        projectPath={projectPath}
        sessionEntry={selectedSession.session}
        onBack={() => {
          setViewMode('browse');
          setSelectedSession(null);
        }}
        onOpenAndExit={() => {
          onSelectSession(selectedSession.session.id);
          exit();
        }}
      />
    );
  }

  const visibleStart = Math.max(0, Math.min(selectedIndex - 4, sessions.length - 8));
  const visibleEnd = Math.min(sessions.length, visibleStart + 12);
  const visible = sessions.slice(visibleStart, visibleEnd);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* One line: title, index status, search */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Sessions</Text>
        <Text color="gray"> ({sessions.length}) · </Text>
        {hasIndex ? (
          <Text color="green">indexed</Text>
        ) : (
          <Text color="yellow">not indexed</Text>
        )}
        {indexing && <Text color="gray"> · </Text>}
        {indexing && <Text color="yellow">Indexing…</Text>}
        {backgroundIndexing && !indexing && <Text color="gray"> · </Text>}
        {backgroundIndexing && !indexing && <Text color="blue">updating…</Text>}
        {indexStatus && (
          <>
            <Text color="gray"> · </Text>
            <Text color="green">{indexStatus}</Text>
          </>
        )}
        <Text color="gray"> · Search: </Text>
        <Text color="white">{query || '(type to filter)'}</Text>
      </Box>

      {/* List — one line per session */}
      <Box flexDirection="column">
        {visible.map((session, i) => (
          <SessionCard
            key={session.session.id}
            session={session}
            isSelected={visibleStart + i === selectedIndex}
          />
        ))}
      </Box>

      {/* Bottom panel: detail for selected session */}
      {sessions[selectedIndex] && (
        <Box marginTop={1} flexDirection="column">
          <SessionDetailPanel session={sessions[selectedIndex]} />
        </Box>
      )}

      {/* Footer: hints + open command */}
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          <Text color="cyan">↑/↓</Text> select · <Text color="cyan">Enter</Text> chat · <Text color="cyan">o</Text> open & exit · type to search · <Text color="yellow">i</Text> index
        </Text>
        {sessions[selectedIndex] && (
          <Text color="gray">  → umwelten sessions show {sessions[selectedIndex].session.id}</Text>
        )}
      </Box>
    </Box>
  );
}
