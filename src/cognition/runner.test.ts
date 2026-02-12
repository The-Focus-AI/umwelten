/**
 * Runner tests: ModelMessage normalization and validation.
 * Ensures messages after a tool round pass AI SDK standardizePrompt (ModelMessage[]).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { CoreMessage } from 'ai';
import { modelMessageSchema } from 'ai';
import { BaseModelRunner } from './runner.js';
import { Interaction } from '../interaction/core/interaction.js';
import { Stimulus } from '../stimulus/stimulus.js';

const messagesArraySchema = z.array(modelMessageSchema);

function normalizeViaRunner(messages: CoreMessage[]): CoreMessage[] {
  const runner = new BaseModelRunner();
  return (runner as unknown as { normalizeToModelMessages(m: CoreMessage[]): CoreMessage[] }).normalizeToModelMessages(messages);
}

describe('Runner ModelMessage normalization', () => {
  it('normalizes assistant tool-call parts (args→input, experimental_providerMetadata→providerOptions)', () => {
    const messages: CoreMessage[] = [
      { role: 'system', content: 'You are a helper.' },
      { role: 'user', content: 'Use the tool.' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'read_file',
            args: { path: 'foo.txt' },
            experimental_providerMetadata: { google: { thought_signature: 'abc' } },
          },
        ],
      } as unknown as CoreMessage,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'read_file',
            output: { type: 'text' as const, value: 'file content' },
            experimental_providerMetadata: {},
          },
        ],
      } as unknown as CoreMessage,
      { role: 'user', content: 'Thanks.' },
    ];
    const normalized = normalizeViaRunner(messages);
    const parsed = messagesArraySchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    const assistant = normalized[2];
    expect(assistant.role).toBe('assistant');
    const part = (assistant.content as Array<{ type: string; input?: unknown; args?: unknown; providerOptions?: unknown }>)[0];
    expect(part.type).toBe('tool-call');
    expect(part.input).toEqual({ path: 'foo.txt' });
    expect((part as { providerOptions?: unknown }).providerOptions).toBeDefined();
    expect((part as { args?: unknown }).args).toBeUndefined();
  });

  it('produces messages that pass ModelMessage[] validation (tool round then follow-up)', () => {
    const messages: CoreMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'List my agents.' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'id1',
            toolName: 'list_directory',
            input: { path: '.' },
          },
        ],
      } as unknown as CoreMessage,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'id1',
            toolName: 'list_directory',
            output: { type: 'text' as const, value: 'config.json' },
          },
        ],
      } as unknown as CoreMessage,
      { role: 'user', content: 'Can you create a new agent?' },
    ];
    const normalized = normalizeViaRunner(messages);
    const parsed = messagesArraySchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
  });

  it('produces valid messages when tool-result output is json or error-text', () => {
    const messages: CoreMessage[] = [
      { role: 'system', content: 'Helper.' },
      { role: 'user', content: 'Run tool.' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 't1', input: {} }],
      } as unknown as CoreMessage,
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'c1', toolName: 't1', output: { type: 'json' as const, value: { ok: true } } },
        ],
      } as unknown as CoreMessage,
    ];
    const normalized = normalizeViaRunner(messages);
    const parsed = messagesArraySchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
  });
});
