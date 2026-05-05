/**
 * WebAdapter — the HTTP channel adapter.
 *
 * Peer to DiscordAdapter and TelegramAdapter. Receives useChat-style
 * POST /api/chat requests, forwards them to ChannelBridge, and translates
 * bridge events into the Vercel AI SDK UI Message Stream Protocol so the
 * frontend's useChat hook can consume them directly.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ChannelBridge } from '../bridge/channel-bridge.js';
import type { UserContext } from './types.js';
import { UiMessageStream } from './ui-stream.js';

// ── useChat request shape ───────────────────────────────────────────
//
// @ai-sdk/react v5 posts:
//   { id, messages: UIMessage[], trigger?, ... }
// where messages[].parts is an array of {type:'text', text} / tool parts.
// We only need the *last user message* to feed into ChannelBridge, since
// the bridge maintains its own Interaction history (keyed by channelKey).

interface UiMessagePart {
  type: string;
  text?: string;
  [k: string]: unknown;
}
interface UiMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  parts?: UiMessagePart[];
  content?: string;
}
interface ChatRequestBody {
  id?: string;
  messages?: UiMessage[];
  /** Optional habitat-specific override — thread id to route into. */
  threadId?: string;
}

function extractLastUserText(messages: UiMessage[] | undefined): string {
  if (!messages?.length) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string' && m.content.trim()) return m.content;
    if (Array.isArray(m.parts)) {
      const text = m.parts
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('');
      if (text.trim()) return text;
    }
  }
  return '';
}

function readBody(req: IncomingMessage): Promise<ChatRequestBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// ── WebAdapter ───────────────────────────────────────────────────────

export class WebAdapter {
  constructor(private bridge: ChannelBridge) {}

  /**
   * Handle POST /api/chat. Streams the AI SDK UI Message Stream Protocol.
   * The caller is responsible for authentication and passing a UserContext.
   */
  async handleChat(
    req: IncomingMessage,
    res: ServerResponse,
    user: UserContext,
  ): Promise<void> {
    let body: ChatRequestBody;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const text = extractLastUserText(body.messages);
    if (!text) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No user message in request' }));
      return;
    }

    // Thread id → channel key. If the client didn't pass one, mint a fresh id
    // so each chat starts a new session. (Clients can pass `id` via useChat's
    // initial id for continuity, or `threadId` for explicit routing.)
    const threadId = body.threadId ?? body.id ?? randomUUID();
    const channelKey = `web:${threadId}`;

    const stream = new UiMessageStream(res);
    stream.start();

    // Track tool calls so we can pair tool-input-available with tool-output-available
    // when the bridge only gives us names (not call ids) via onToolResult.
    const toolCallIds = new Map<string, string>(); // toolName -> last callId

    await this.bridge.handleMessage(
      { channelKey, text, userId: user.userId },
      {
        onText: (delta) => stream.textDelta(delta),
        onReasoning: (delta) => stream.reasoningDelta(delta),
        onToolCall: (name, input) => {
          const callId = randomUUID();
          toolCallIds.set(name, callId);
          stream.toolCall(callId, name, input);
        },
        onToolResult: (name, output, isError) => {
          const callId = toolCallIds.get(name) ?? randomUUID();
          stream.toolResult(callId, output, isError);
        },
        onDone: () => {
          stream.finish();
        },
        onError: (err) => {
          stream.abort(err);
        },
      },
    );
  }
}
