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
import type { ChannelAttachment } from '../bridge/types.js';
import { MAX_IMAGES, MAX_TOTAL_IMAGE_BYTES, parseImageDataUrl } from '@umwelten/substrate/images.js';

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

function extractLastUserMessage(messages: UiMessage[] | undefined) {
  const message = Array.isArray(messages) ? [...messages].reverse().find((m) => m?.role === 'user') : undefined;
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const text = typeof message?.content === 'string' ? message.content
    : parts.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('');
  const files = parts.filter((p) => p?.type === 'file');
  if (files.length > MAX_IMAGES) throw new Error(`Attach at most ${MAX_IMAGES} images.`);
  let total = 0;
  const attachments: ChannelAttachment[] = files.map((p) => {
    const image = parseImageDataUrl(p.url);
    total += image.size;
    if (p.mediaType !== image.mediaType) throw new Error('Image media type does not match its data.');
    return {
      filename: typeof p.filename === 'string' ? p.filename.slice(0, 255) : 'image',
      mimeType: image.mediaType,
      url: p.url as string,
    };
  });
  if (total > MAX_TOTAL_IMAGE_BYTES) throw new Error('Images must total 10 MiB or less.');
  if (!text.trim() && !attachments.length) throw new Error('No user message in request');
  return { text, attachments };
}

class BodyTooLarge extends Error {}

// Includes base64 expansion plus a bounded allowance for text/JSON metadata.
const MAX_CHAT_BODY_BYTES = Math.ceil(MAX_TOTAL_IMAGE_BYTES / 3) * 4 + 1024 * 1024;

function readBody(req: IncomingMessage): Promise<ChatRequestBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on('data', (c: Buffer) => {
      bytes += c.length;
      if (bytes > MAX_CHAT_BODY_BYTES) {
        chunks.length = 0;
        reject(new BodyTooLarge('Chat request is too large.'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (bytes > MAX_CHAT_BODY_BYTES) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        const body = raw ? JSON.parse(raw) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
        resolve(body);
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
    } catch (err) {
      res.writeHead(err instanceof BodyTooLarge ? 413 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof BodyTooLarge ? err.message : 'Invalid JSON body' }));
      return;
    }

    let message: ReturnType<typeof extractLastUserMessage>;
    try {
      message = extractLastUserMessage(body.messages);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Invalid user message' }));
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
      { channelKey, ...message, userId: user.userId },
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
