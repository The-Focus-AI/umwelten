import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useRef, useEffect } from 'react';
import { ToolCallCard } from './ToolCallCard';

export function ChatView({ threadId }: { threadId: string }) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error } = useChat({
    id: threadId,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { threadId },
    }),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput('');
  };

  return (
    <div className="chat">
      <div className="messages">
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-role">{m.role}</div>
            <div className="msg-body">
              {m.parts.map((part, i) => {
                if (part.type === 'text') {
                  return (
                    <div key={i} className="text-part">
                      {part.text}
                    </div>
                  );
                }
                if (part.type.startsWith('tool-')) {
                  // @ts-expect-error — narrowed at runtime
                  return <ToolCallCard key={i} part={part} />;
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {status === 'submitted' && <div className="msg msg-pending">…</div>}
        {error && <div className="msg msg-error">Error: {String(error)}</div>}
        <div ref={bottomRef} />
      </div>
      <form className="composer" onSubmit={onSubmit}>
        <input
          autoFocus
          placeholder="Type a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={status === 'streaming' || status === 'submitted'}
        />
        <button type="submit" disabled={!input.trim() || status === 'streaming'}>
          Send
        </button>
      </form>
    </div>
  );
}
