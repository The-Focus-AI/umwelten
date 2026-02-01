import React from 'react';
import { Box, Text, useFocus, useInput } from 'ink';
import { MessageList } from './MessageList.js';
import {
  SessionSidebar,
  type SessionSidebarItem,
} from './SessionSidebar.js';
import type { NormalizedMessage } from '../../../sessions/normalized-types.js';

export type ActivePane = 'messages' | 'sessions';

export interface ChatViewProps {
  messages: NormalizedMessage[];
  sidebarItems: SessionSidebarItem[];
  selectedSessionId: string | null;
  hideTools: boolean;
  hideToolResults: boolean;
  showOnlyUserAssistant: boolean;
  latestActivity?: string;
  onSelectSession: (id: string) => void;
  onToggleHideTools?: () => void;
  onToggleHideToolResults?: () => void;
  onToggleShowOnlyUserAssistant?: () => void;
}

export function ChatView({
  messages,
  sidebarItems,
  selectedSessionId,
  hideTools,
  hideToolResults,
  showOnlyUserAssistant,
  latestActivity,
  onSelectSession,
  onToggleHideTools,
  onToggleHideToolResults,
  onToggleShowOnlyUserAssistant,
}: ChatViewProps): React.ReactElement {
  const [activePane, setActivePane] = React.useState<ActivePane>('messages');
  const [sidebarIndex, setSidebarIndex] = React.useState(0);

  React.useEffect(() => {
    const idx = sidebarItems.findIndex(i => i.id === selectedSessionId);
    if (idx >= 0) setSidebarIndex(idx);
  }, [selectedSessionId, sidebarItems]);

  return (
    <FocusableRoot
      activePane={activePane}
      setActivePane={setActivePane}
      sidebarIndex={sidebarIndex}
      setSidebarIndex={setSidebarIndex}
      sidebarItems={sidebarItems}
      onSelectSession={onSelectSession}
      onToggleHideTools={onToggleHideTools}
      onToggleHideToolResults={onToggleHideToolResults}
      onToggleShowOnlyUserAssistant={onToggleShowOnlyUserAssistant}
    >
      <Box flexDirection="row" height="100%">
        <MessagesPane
          isActive={activePane === 'messages'}
          messages={messages}
          hideTools={hideTools}
          hideToolResults={hideToolResults}
          showOnlyUserAssistant={showOnlyUserAssistant}
          latestActivity={latestActivity}
        />
        <SessionsPane
          isActive={activePane === 'sessions'}
          sidebarItems={sidebarItems}
          selectedSessionId={selectedSessionId}
        />
      </Box>
    </FocusableRoot>
  );
}

function FocusableRoot({
  children,
  activePane,
  setActivePane,
  sidebarIndex,
  setSidebarIndex,
  sidebarItems,
  onSelectSession,
  onToggleHideTools,
  onToggleHideToolResults,
  onToggleShowOnlyUserAssistant,
}: {
  children: React.ReactNode;
  activePane: ActivePane;
  setActivePane: React.Dispatch<React.SetStateAction<ActivePane>>;
  sidebarIndex: number;
  setSidebarIndex: React.Dispatch<React.SetStateAction<number>>;
  sidebarItems: SessionSidebarItem[];
  onSelectSession: (id: string) => void;
  onToggleHideTools?: () => void;
  onToggleHideToolResults?: () => void;
  onToggleShowOnlyUserAssistant?: () => void;
}): React.ReactElement {
  useFocus({ autoFocus: true });
  useInput((input, key) => {
    if (key.tab) {
      setActivePane(p => (p === 'messages' ? 'sessions' : 'messages'));
      return;
    }
    if (activePane === 'sessions') {
      if (key.upArrow && sidebarIndex > 0) {
        setSidebarIndex(i => i - 1);
        const item = sidebarItems[sidebarIndex - 1];
        if (item && item.id !== '_loading') onSelectSession(item.id);
      } else if (key.downArrow && sidebarIndex < sidebarItems.length - 1) {
        setSidebarIndex(i => i + 1);
        const item = sidebarItems[sidebarIndex + 1];
        if (item && item.id !== '_loading') onSelectSession(item.id);
      } else if (key.return && sidebarItems[sidebarIndex]?.id !== '_loading') {
        onSelectSession(sidebarItems[sidebarIndex].id);
      }
      return;
    }
    const lower = input.toLowerCase();
    if (lower === 'h') onToggleHideTools?.();
    if (lower === 'r') onToggleHideToolResults?.();
    if (lower === 'u') onToggleShowOnlyUserAssistant?.();
  });
  return <>{children}</>;
}

function MessagesPane({
  isActive,
  messages,
  hideTools,
  hideToolResults,
  showOnlyUserAssistant,
  latestActivity,
}: {
  isActive: boolean;
  messages: NormalizedMessage[];
  hideTools: boolean;
  hideToolResults: boolean;
  showOnlyUserAssistant: boolean;
  latestActivity?: string;
}): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle={isActive ? 'bold' : 'single'}
      borderColor={isActive ? 'cyan' : 'gray'}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text dimColor>
          [Tab] switch pane · [↑/↓] select session · h/r/u: filters
        </Text>
      </Box>
      <MessageList
        messages={messages}
        hideTools={hideTools}
        hideToolResults={hideToolResults}
        showOnlyUserAssistant={showOnlyUserAssistant}
        latestActivity={latestActivity}
      />
    </Box>
  );
}

function SessionsPane({
  isActive,
  sidebarItems,
  selectedSessionId,
}: {
  isActive: boolean;
  sidebarItems: SessionSidebarItem[];
  selectedSessionId: string | null;
}): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle={isActive ? 'bold' : 'single'}
      borderColor={isActive ? 'cyan' : 'gray'}
    >
      <SessionSidebar
        items={sidebarItems}
        selectedId={selectedSessionId}
      />
    </Box>
  );
}
