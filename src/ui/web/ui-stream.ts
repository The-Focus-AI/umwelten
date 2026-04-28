/**
 * AI SDK UI Message Stream Protocol emitter.
 *
 * Writes events in the exact format @ai-sdk/react's useChat consumes:
 *   - SSE framing: `data: {json}\n\n`
 *   - Terminator: `data: [DONE]\n\n`
 *   - Required header: x-vercel-ai-ui-message-stream: v1
 *
 * Event shapes we emit:
 *   { type: 'start', messageId }
 *   { type: 'text-start', id }
 *   { type: 'text-delta', id, delta }
 *   { type: 'text-end', id }
 *   { type: 'tool-input-available', toolCallId, toolName, input }
 *   { type: 'tool-output-available', toolCallId, output }
 *   { type: 'finish' }
 *
 * Reference: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
 */

import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

export class UiMessageStream {
  private res: ServerResponse;
  private messageId: string;
  private textId: string | null = null;
  private closed = false;

  constructor(res: ServerResponse, messageId?: string) {
    this.res = res;
    this.messageId = messageId ?? randomUUID();
  }

  /** Write the response headers and start event. Call once, before any deltas. */
  start(extraHeaders?: Record<string, string>): void {
    if (this.res.headersSent) return;
    this.res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'x-vercel-ai-ui-message-stream': 'v1',
      ...(extraHeaders ?? {}),
    });
    this.emit({ type: 'start', messageId: this.messageId });
  }

  /** Append a text delta. Opens a text block on first call. */
  textDelta(delta: string): void {
    if (this.closed || !delta) return;
    if (this.textId === null) {
      this.textId = randomUUID();
      this.emit({ type: 'text-start', id: this.textId });
    }
    this.emit({ type: 'text-delta', id: this.textId, delta });
  }

  /** Emit a fully-assembled tool call. */
  toolCall(toolCallId: string, toolName: string, input: unknown): void {
    if (this.closed) return;
    // Close any open text block first so tool cards render between text segments.
    this.endTextBlock();
    this.emit({
      type: 'tool-input-available',
      toolCallId,
      toolName,
      input,
    });
  }

  /** Emit a tool call's output. */
  toolResult(toolCallId: string, output: unknown, isError = false): void {
    if (this.closed) return;
    this.emit({
      type: 'tool-output-available',
      toolCallId,
      output,
      ...(isError ? { errorText: String(output) } : {}),
    });
  }

  /** Emit an error (non-fatal; the stream can continue). */
  errorText(text: string): void {
    if (this.closed) return;
    this.emit({ type: 'error', errorText: text });
  }

  /** Close the stream: finish event + [DONE] terminator. */
  finish(): void {
    if (this.closed) return;
    this.endTextBlock();
    this.emit({ type: 'finish' });
    this.res.write('data: [DONE]\n\n');
    this.res.end();
    this.closed = true;
  }

  /** Abort the stream abruptly (e.g. server error after headers sent). */
  abort(message: string): void {
    if (this.closed) return;
    this.errorText(message);
    this.res.write('data: [DONE]\n\n');
    this.res.end();
    this.closed = true;
  }

  private endTextBlock(): void {
    if (this.textId !== null) {
      this.emit({ type: 'text-end', id: this.textId });
      this.textId = null;
    }
  }

  private emit(payload: unknown): void {
    if (this.res.writableEnded) return;
    this.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}
