import { useEffect, useState } from 'react';
import { ChatView } from './components/ChatView';
import { ThreadList } from './components/ThreadList';

interface Me {
  userId: string;
  displayName?: string;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then(setMe).catch(() => setMe(null));
  }, []);

  // Keyed by threadId so switching threads remounts useChat with a fresh state.
  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1>umwelten</h1>
          <div className="me">{me?.displayName ?? me?.userId ?? '…'}</div>
        </header>
        <button
          className="new-thread"
          onClick={() => setThreadId(crypto.randomUUID())}
        >
          + new chat
        </button>
        <ThreadList activeThreadId={threadId} onSelect={setThreadId} />
      </aside>
      <main className="chat-main">
        <ChatContainer key={threadId} threadId={threadId} />
      </main>
    </div>
  );
}

function ChatContainer({ threadId }: { threadId: string }) {
  return <ChatView threadId={threadId} />;
}
