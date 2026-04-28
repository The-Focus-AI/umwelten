import { useEffect, useState } from 'react';

interface Session {
  sessionId: string;
  type: string;
  lastUsed: string;
  firstPrompt: string;
  messageCount: number;
}

export function ThreadList({
  activeThreadId,
  onSelect,
}: {
  activeThreadId: string;
  onSelect: (id: string) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);

  async function refresh() {
    try {
      const r = await fetch('/api/sessions');
      const j = await r.json();
      setSessions(j.sessions ?? []);
    } catch {
      setSessions([]);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  const webSessions = sessions.filter((s) => s.type === 'web');

  return (
    <ul className="thread-list">
      {webSessions.length === 0 && (
        <li className="thread-empty">No previous chats</li>
      )}
      {webSessions.map((s) => {
        // Strip the "web-" prefix so thread ids match what the server
        // stores (web-{uuid} → {uuid}).
        const id = s.sessionId.replace(/^web-/, '');
        const active = id === activeThreadId;
        return (
          <li
            key={s.sessionId}
            className={`thread ${active ? 'thread-active' : ''}`}
            onClick={() => onSelect(id)}
          >
            <div className="thread-prompt">{s.firstPrompt || '(empty)'}</div>
            <div className="thread-meta">
              {s.messageCount} msg · {timeAgo(s.lastUsed)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
