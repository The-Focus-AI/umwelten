import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useStdout } from 'ink';
import { ChatView } from './components/ChatView.js';
import type { SessionSidebarItem } from './components/SessionSidebar.js';
import type { NormalizedMessage } from '../../interaction/types/normalized-types.js';
import type { NormalizedSessionEntry, NormalizedSession } from '../../interaction/types/normalized-types.js';
import { sessionEntryToSidebarItem } from './components/SessionSidebar.js';
import { readSessionFile } from './file-session.js';

export type TUIViewMode = 'overview' | 'live' | 'file' | 'session';

export interface AppProps {
  projectPath: string;
  /** When set, stdin is stream-json (live session). */
  hasStdin: boolean;
  /** When set, open this file and optionally watch. */
  filePath?: string;
  /** When set, open this session by ID. */
  sessionId?: string;
  /** Initial session list (can be empty; loadInitialSessions populates in background). */
  initialSessions: NormalizedSessionEntry[];
  /** Load sessions in background (called on mount so UI shows immediately). */
  loadInitialSessions?: () => Promise<NormalizedSessionEntry[]>;
  /** Callback when we need to load a session by ID (adapter.getSession). */
  onLoadSession: (sessionId: string) => Promise<NormalizedSession | null>;
  /** Callback to start file read (and optional watch). */
  onStartFile?: (filePath: string, callbacks: {
    onMessages: (messages: NormalizedMessage[]) => void;
    onLiveness?: (liveness: 'reading' | 'writing' | 'ended') => void;
  }) => void;
}

export function App({
  projectPath,
  hasStdin,
  filePath,
  sessionId: initialSessionId,
  initialSessions,
  loadInitialSessions,
  onLoadSession,
  onStartFile,
}: AppProps): React.ReactElement {
  const { stdout } = useStdout();
  const height = Math.max(12, (stdout?.rows ?? 24) - 1);

  const [sessionsList, setSessionsList] = useState<NormalizedSessionEntry[]>(initialSessions);
  const [sessionsLoading, setSessionsLoading] = useState(Boolean(loadInitialSessions));
  const [liveMessages, setLiveMessages] = useState<NormalizedMessage[]>([]);
  const [fileMessages, setFileMessages] = useState<NormalizedMessage[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    initialSessionId ?? (hasStdin ? 'live' : filePath ? 'file' : initialSessions[0]?.id ?? null)
  );
  const [loadedSession, setLoadedSession] = useState<NormalizedSession | null>(null);
  const [liveLiveness, setLiveLiveness] = useState<'alive' | 'stale' | 'ended'>('ended');
  const [fileLiveness, setFileLiveness] = useState<'reading' | 'writing' | 'ended'>('ended');
  const [hideTools, setHideTools] = useState(false);
  const [hideToolResults, setHideToolResults] = useState(false);
  const [showOnlyUserAssistant, setShowOnlyUserAssistant] = useState(false);
  const [latestActivity, setLatestActivity] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!loadInitialSessions) return;
    let cancelled = false;
    loadInitialSessions()
      .then(sessions => {
        if (!cancelled) {
          setSessionsList(sessions);
          setSessionsLoading(false);
          if (sessions.length > 0) {
            setSelectedSessionId(prev => (prev == null || prev === '_loading' ? sessions[0].id : prev));
          }
        }
      })
      .catch(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadInitialSessions]);

  const sidebarItems: SessionSidebarItem[] = React.useMemo(() => {
    const items: SessionSidebarItem[] = [];
    if (hasStdin) {
      items.push({ id: 'live', label: 'Live', type: 'live', liveness: liveLiveness });
    }
    if (filePath) {
      items.push({ id: 'file', label: 'File', type: 'file', liveness: fileLiveness });
    }
    if (sessionsLoading) {
      items.push({ id: '_loading', label: 'Loading...', type: 'session' });
    } else {
      items.push(...sessionsList.map(sessionEntryToSidebarItem));
    }
    return items;
  }, [hasStdin, filePath, sessionsList, sessionsLoading, liveLiveness, fileLiveness]);

  const displayMessages: NormalizedMessage[] = React.useMemo(() => {
    if (selectedSessionId === 'live') return liveMessages;
    if (selectedSessionId === 'file') return fileMessages;
    if (selectedSessionId && loadedSession?.id === selectedSessionId) return loadedSession.messages;
    return [];
  }, [selectedSessionId, liveMessages, fileMessages, loadedSession]);

  useEffect(() => {
    if (!hasStdin) return;
    const { createInterface } = require('node:readline');
    const { stdin } = require('node:process');
    const rl = createInterface({ input: stdin, crlfDelay: Infinity });
    const messageIndex = { count: 0 };
    const { streamLineToEvent } = require('./stream-to-normalized.js');
    let lastReceived = 0;
    const staleTimer = setInterval(() => {
      if (lastReceived && Date.now() - lastReceived > 5000) setLiveLiveness('stale');
    }, 1000);
    const onLine = (line: string) => {
      if (!line.trim()) return;
      lastReceived = Date.now();
      setLiveLiveness('alive');
      try {
        const raw = JSON.parse(line);
        const event = streamLineToEvent(raw, messageIndex);
        if (event?.type === 'message') {
          setLiveMessages(prev => [...prev, ...event.messages]);
          const last = event.messages[event.messages.length - 1];
          if (last?.role === 'tool' && last.tool?.name) {
            setLatestActivity(`Tool: ${last.tool.name}`);
          } else if (last?.content) {
            setLatestActivity(last.content.slice(0, 50) + (last.content.length > 50 ? '…' : ''));
          }
        }
      } catch {
        // ignore parse errors
      }
    };
    rl.on('line', onLine);
    rl.on('close', () => {
      setLiveLiveness('ended');
      clearInterval(staleTimer);
    });
    return () => {
      rl.removeListener('line', onLine);
      clearInterval(staleTimer);
    };
  }, [hasStdin]);

  useEffect(() => {
    if (!filePath) return;
    const callbacks = {
      onMessages: (msgs: NormalizedMessage[]) => setFileMessages(prev => [...prev, ...msgs]),
      onLiveness: setFileLiveness,
    };
    if (onStartFile) {
      setFileMessages([]);
      onStartFile(filePath, callbacks);
    } else {
      setFileMessages([]);
      readSessionFile(filePath, callbacks, { watch: true }).catch(() => {
        setFileLiveness('ended');
      });
    }
  }, [filePath, onStartFile]);

  useEffect(() => {
    if (
      selectedSessionId &&
      selectedSessionId !== 'live' &&
      selectedSessionId !== 'file' &&
      selectedSessionId !== '_loading'
    ) {
      onLoadSession(selectedSessionId).then(session => {
        if (session) setLoadedSession(session);
      });
    }
  }, [selectedSessionId, onLoadSession]);

  useEffect(() => {
    if (initialSessionId) {
      setSelectedSessionId(initialSessionId);
      onLoadSession(initialSessionId).then(session => {
        if (session) setLoadedSession(session);
      });
    }
  }, [initialSessionId, onLoadSession]);

  const handleToggleHideTools = useCallback(() => setHideTools(prev => !prev), []);
  const handleToggleHideToolResults = useCallback(() => setHideToolResults(prev => !prev), []);
  const handleToggleShowOnlyUserAssistant = useCallback(() => setShowOnlyUserAssistant(prev => !prev), []);

  if (sidebarItems.length === 0 && !filePath && !hasStdin) {
    return (
      <Box flexDirection="column" height={height} padding={1}>
        <Text bold>Session TUI</Text>
        <Text dimColor>No sessions found for project: {projectPath}</Text>
        <Text dimColor>Run with a file, session ID, or pipe stream-json.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={height}>
      <ChatView
        messages={displayMessages}
        sidebarItems={sidebarItems}
        selectedSessionId={selectedSessionId}
        hideTools={hideTools}
        hideToolResults={hideToolResults}
        showOnlyUserAssistant={showOnlyUserAssistant}
        latestActivity={latestActivity}
        onSelectSession={setSelectedSessionId}
        onToggleHideTools={handleToggleHideTools}
        onToggleHideToolResults={handleToggleHideToolResults}
        onToggleShowOnlyUserAssistant={handleToggleShowOnlyUserAssistant}
      />
    </Box>
  );
}
