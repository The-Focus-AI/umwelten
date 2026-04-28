/**
 * WebAdapter bridge-parity test.
 *
 * Proves that a POST /api/chat payload → ChannelBridge events → AI SDK UI
 * Message Stream Protocol frames on the wire. No real models involved — we
 * stub the bridge and drive its event callbacks directly.
 */

import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { WebAdapter } from './WebAdapter.js';
import type { ChannelBridge } from '../bridge/channel-bridge.js';

interface Frame {
  type: string;
  [k: string]: unknown;
}

function collectFrames(body: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') {
      frames.push({ type: '__DONE__' });
      continue;
    }
    try {
      frames.push(JSON.parse(payload));
    } catch {
      // skip malformed
    }
  }
  return frames;
}

function fakeReqRes(body: unknown) {
  // Request: a PassThrough so WebAdapter.readBody's 'data'/'end' wiring works.
  const req = new PassThrough() as unknown as import('node:http').IncomingMessage & {
    headers: Record<string, string>;
  };
  (req as any).headers = {};

  // Response: a plain object — we don't need stream back-pressure, we just
  // need write/writeHead/end to accumulate bytes we can inspect.
  const chunks: string[] = [];
  let statusCode = 0;
  const headers: Record<string, string> = {};
  let headersSent = false;
  let ended = false;
  let endResolve: (() => void) | null = null;
  const endedPromise = new Promise<void>((r) => (endResolve = r));

  const res = {
    writeHead(code: number, h: Record<string, string>) {
      statusCode = code;
      Object.assign(headers, h);
      headersSent = true;
    },
    write(chunk: string | Buffer) {
      if (ended) return;
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
    },
    end(chunk?: string | Buffer) {
      if (chunk != null) this.write(chunk);
      ended = true;
      endResolve?.();
    },
    get headersSent() {
      return headersSent;
    },
    get writableEnded() {
      return ended;
    },
  } as unknown as import('node:http').ServerResponse;

  setImmediate(() => {
    if (body !== undefined) {
      (req as unknown as PassThrough).write(JSON.stringify(body));
    }
    (req as unknown as PassThrough).end();
  });

  const getBody = async () => {
    await endedPromise;
    return chunks.join('');
  };

  return { req, res, headers: () => headers, getStatus: () => statusCode, getBody };
}

// Build a bridge whose handleMessage we fully control: receives the event
// handlers, then drives them in a scripted sequence.
function makeScriptedBridge(
  script: (events: import('../bridge/types.js').BridgeEventHandlers) => void | Promise<void>,
): ChannelBridge {
  const handleMessage = vi.fn(
    async (
      _msg: import('../bridge/types.js').ChannelMessage,
      events: import('../bridge/types.js').BridgeEventHandlers,
    ) => {
      await script(events);
    },
  );
  return { handleMessage } as unknown as ChannelBridge;
}

describe('WebAdapter.handleChat — AI SDK UI Message Stream Protocol', () => {
  it('emits start → text-start → text-delta → text-end → finish → [DONE]', async () => {
    const bridge = makeScriptedBridge(async (events) => {
      events.onText?.('Hello');
      events.onText?.(', world');
      events.onText?.('!');
      await events.onDone({
        content: 'Hello, world!',
        sessionId: 'web-test-1',
        channelKey: 'web:test-1',
      });
    });
    const adapter = new WebAdapter(bridge);

    const { req, res, headers, getBody } = fakeReqRes({
      id: 'test-1',
      threadId: 'test-1',
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ],
    });
    await adapter.handleChat(req, res, { userId: 'alice', provider: 'dev' });
    const body = await getBody();
    const frames = collectFrames(body);

    expect(headers()['x-vercel-ai-ui-message-stream']).toBe('v1');
    expect(headers()['Content-Type']).toMatch(/text\/event-stream/);

    const types = frames.map((f) => f.type);
    expect(types).toEqual([
      'start',
      'text-start',
      'text-delta',
      'text-delta',
      'text-delta',
      'text-end',
      'finish',
      '__DONE__',
    ]);
    const deltas = frames.filter((f) => f.type === 'text-delta').map((f) => f.delta);
    expect(deltas).toEqual(['Hello', ', world', '!']);
  });

  it('emits tool-input-available and tool-output-available for tool calls', async () => {
    const bridge = makeScriptedBridge(async (events) => {
      events.onToolCall?.('current_time', { tz: 'UTC' });
      events.onToolResult?.('current_time', '{"iso":"2026-04-20"}', false);
      events.onText?.('The time is 2026-04-20.');
      await events.onDone({
        content: 'The time is 2026-04-20.',
        sessionId: 'web-test-tool',
        channelKey: 'web:tool',
      });
    });
    const adapter = new WebAdapter(bridge);

    const { req, res, getBody } = fakeReqRes({
      id: 'tool-1',
      threadId: 'tool-1',
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'what time' }] },
      ],
    });
    await adapter.handleChat(req, res, { userId: 'alice', provider: 'dev' });
    const frames = collectFrames(await getBody());

    const toolInput = frames.find((f) => f.type === 'tool-input-available');
    expect(toolInput).toBeDefined();
    expect(toolInput?.toolName).toBe('current_time');
    expect(toolInput?.input).toEqual({ tz: 'UTC' });

    const toolOutput = frames.find((f) => f.type === 'tool-output-available');
    expect(toolOutput).toBeDefined();
    expect(toolOutput?.toolCallId).toBe(toolInput?.toolCallId);

    // Must still include text + finish after the tool cycle
    expect(frames.some((f) => f.type === 'text-start')).toBe(true);
    expect(frames.some((f) => f.type === 'finish')).toBe(true);
  });

  it('emits error + [DONE] when the bridge reports onError', async () => {
    const bridge = makeScriptedBridge(async (events) => {
      events.onError?.('model blew up');
    });
    const adapter = new WebAdapter(bridge);

    const { req, res, getBody } = fakeReqRes({
      id: 'err',
      threadId: 'err',
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'x' }] },
      ],
    });
    await adapter.handleChat(req, res, { userId: 'alice', provider: 'dev' });
    const frames = collectFrames(await getBody());

    const err = frames.find((f) => f.type === 'error');
    expect(err?.errorText).toBe('model blew up');
    expect(frames.at(-1)?.type).toBe('__DONE__');
  });

  it('rejects requests with no user message', async () => {
    const bridge = makeScriptedBridge(async () => {
      /* should not be called */
    });
    const adapter = new WebAdapter(bridge);

    const { req, res, getStatus, getBody } = fakeReqRes({
      id: 'empty',
      threadId: 'empty',
      messages: [],
    });
    await adapter.handleChat(req, res, { userId: 'alice', provider: 'dev' });
    expect(getStatus()).toBe(400);
    const body = await getBody();
    expect(body).toContain('No user message');
  });

  it('passes userId through to the bridge', async () => {
    let seenUserId: string | undefined;
    const handleMessage = vi.fn(async (msg: any, events: any) => {
      seenUserId = msg.userId;
      await events.onDone({
        content: '',
        sessionId: 's',
        channelKey: msg.channelKey,
      });
    });
    const bridge = { handleMessage } as unknown as ChannelBridge;
    const adapter = new WebAdapter(bridge);

    const { req, res, getBody } = fakeReqRes({
      id: 't',
      threadId: 't',
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ],
    });
    await adapter.handleChat(req, res, {
      userId: 'alice-42',
      provider: 'dev',
    });
    await getBody();
    expect(seenUserId).toBe('alice-42');
  });
});
