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
  it('normalizes assistant tool-call parts (args->input, experimental_providerMetadata->providerOptions)', () => {
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

  // --- Multi-turn tool-call tests ---

  it('multi-turn: streaming tool-call + tool-result + follow-up user message', () => {
    // Simulates what streamText produces: assistant with tool-call, tool result, assistant text, then another user turn
    const messages: CoreMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What files are in the project?' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tc_1',
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
            toolCallId: 'tc_1',
            toolName: 'list_directory',
            output: { type: 'text' as const, value: 'README.md\npackage.json\nsrc/' },
          },
        ],
      } as unknown as CoreMessage,
      { role: 'assistant', content: 'I found README.md, package.json, and a src/ directory.' },
      { role: 'user', content: 'Now read the README.' },
    ];
    const normalized = normalizeViaRunner(messages);
    const parsed = messagesArraySchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
  });

  it('legacy args field: normalization converts args to input', () => {
    // makeResult() used to write `args` instead of `input` — verify normalization fixes it
    const messages: CoreMessage[] = [
      { role: 'system', content: 'Helper.' },
      { role: 'user', content: 'Read the config.' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'legacy_1',
            toolName: 'read_file',
            args: { path: 'config.json' },  // legacy field
          },
        ],
      } as unknown as CoreMessage,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'legacy_1',
            toolName: 'read_file',
            output: { type: 'json' as const, value: { name: 'test' } },
          },
        ],
      } as unknown as CoreMessage,
      { role: 'user', content: 'What is the name field?' },
    ];
    const normalized = normalizeViaRunner(messages);
    const parsed = messagesArraySchema.safeParse(normalized);
    expect(parsed.success).toBe(true);

    // Verify the tool-call part has `input` not `args`
    const assistantMsg = normalized[2];
    const tcPart = (assistantMsg.content as any[])[0];
    expect(tcPart.input).toEqual({ path: 'config.json' });
    expect(tcPart.args).toBeUndefined();
  });

  it('multiple tool-call rounds in sequence', () => {
    // Two complete tool-call rounds followed by another user message
    const messages: CoreMessage[] = [
      { role: 'system', content: 'Helper.' },
      { role: 'user', content: 'List agents then show details of the first.' },
      // Round 1: list
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'r1', toolName: 'list_agents', input: {} },
        ],
      } as unknown as CoreMessage,
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'r1', toolName: 'list_agents', output: { type: 'json' as const, value: [{ id: 'agent-1' }] } },
        ],
      } as unknown as CoreMessage,
      // Round 2: details
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'r2', toolName: 'show_agent', input: { id: 'agent-1' } },
        ],
      } as unknown as CoreMessage,
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'r2', toolName: 'show_agent', output: { type: 'json' as const, value: { id: 'agent-1', name: 'Test' } } },
        ],
      } as unknown as CoreMessage,
      { role: 'assistant', content: 'Agent agent-1 is named Test.' },
      { role: 'user', content: 'Delete it.' },
    ];
    const normalized = normalizeViaRunner(messages);
    const parsed = messagesArraySchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
  });

  it('output edge case: undefined/null output is normalized to empty text', () => {
    const messages: CoreMessage[] = [
      { role: 'user', content: 'Do something.' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'e1', toolName: 'noop', input: {} },
        ],
      } as unknown as CoreMessage,
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'e1', toolName: 'noop', output: undefined },
        ],
      } as unknown as CoreMessage,
    ];
    const normalized = normalizeViaRunner(messages);
    const parsed = messagesArraySchema.safeParse(normalized);
    expect(parsed.success).toBe(true);

    const toolMsg = normalized[2];
    const resultPart = (toolMsg.content as any[])[0];
    expect(resultPart.output).toEqual({ type: 'text', value: '' });
  });

  it('output edge case: raw string output is wrapped in text format', () => {
    const messages: CoreMessage[] = [
      { role: 'user', content: 'Search.' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 's1', toolName: 'search', input: { q: 'test' } },
        ],
      } as unknown as CoreMessage,
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 's1', toolName: 'search', output: 'Found 3 results' },
        ],
      } as unknown as CoreMessage,
    ];
    const normalized = normalizeViaRunner(messages);
    const parsed = messagesArraySchema.safeParse(normalized);
    expect(parsed.success).toBe(true);

    const toolMsg = normalized[2];
    const resultPart = (toolMsg.content as any[])[0];
    expect(resultPart.output).toEqual({ type: 'text', value: 'Found 3 results' });
  });

  it('output edge case: raw object without type/value is wrapped in json format', () => {
    const messages: CoreMessage[] = [
      { role: 'user', content: 'Get data.' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'o1', toolName: 'fetch', input: {} },
        ],
      } as unknown as CoreMessage,
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'o1', toolName: 'fetch', output: { status: 200, data: [1, 2, 3] } },
        ],
      } as unknown as CoreMessage,
    ];
    const normalized = normalizeViaRunner(messages);
    const parsed = messagesArraySchema.safeParse(normalized);
    expect(parsed.success).toBe(true);

    const toolMsg = normalized[2];
    const resultPart = (toolMsg.content as any[])[0];
    expect(resultPart.output).toEqual({ type: 'json', value: { status: 200, data: [1, 2, 3] } });
  });

  it('makeResult-style messages with args + experimental_providerMetadata validate after normalization', () => {
    // Simulates messages as they would be written by makeResult() before the fix,
    // with the legacy `args` field and Google thought_signature metadata
    const messages: CoreMessage[] = [
      { role: 'system', content: 'You are a habitat agent.' },
      { role: 'user', content: 'Clone the repo.' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'mk_1',
            toolName: 'agent_clone',
            args: { gitUrl: 'https://github.com/test/repo.git', name: 'test-repo' },
            experimental_providerMetadata: {
              google: { thought_signature: 'sig_abc123' },
            },
          },
        ],
      } as unknown as CoreMessage,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'mk_1',
            toolName: 'agent_clone',
            output: { type: 'json' as const, value: { cloned: true, agent: { id: 'test-repo' } } },
            experimental_providerMetadata: {},
          },
        ],
      } as unknown as CoreMessage,
      { role: 'assistant', content: 'The repo has been cloned.' },
      { role: 'user', content: 'Now run it.' },
    ];
    const normalized = normalizeViaRunner(messages);
    const parsed = messagesArraySchema.safeParse(normalized);
    expect(parsed.success).toBe(true);

    // Verify legacy fields were converted
    const tcPart = (normalized[2].content as any[])[0];
    expect(tcPart.input).toEqual({ gitUrl: 'https://github.com/test/repo.git', name: 'test-repo' });
    expect(tcPart.args).toBeUndefined();
    expect(tcPart.providerOptions).toBeDefined();
    expect(tcPart.providerOptions.google.thought_signature).toBe('sig_abc123');
    expect(tcPart.experimental_providerMetadata).toBeUndefined();
  });

  it('output edge case: undefined values inside output.value are stripped (SDK rejects undefined in JsonValue)', () => {
    // This is the exact crash case: agents_list returns objects with optional fields that are undefined
    const messages: CoreMessage[] = [
      { role: 'user', content: 'What agents exist?' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'al1', toolName: 'agents_list', input: {} },
        ],
      } as unknown as CoreMessage,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result', toolCallId: 'al1', toolName: 'agents_list',
            output: {
              type: 'json' as const,
              value: {
                agents: [{
                  id: 'trmnl-image-agent',
                  name: 'trmnl-image-agent',
                  projectPath: '/Users/test/habitats/repos/trmnl-image-agent',
                  gitRemote: 'https://github.com/test/trmnl-image-agent',
                  secretsRefs: undefined,
                  commands: undefined,
                }],
                count: 1,
              },
            },
          },
        ],
      } as unknown as CoreMessage,
      { role: 'assistant', content: 'You have one agent: trmnl-image-agent.' },
      { role: 'user', content: 'Run it please.' },
    ];
    const normalized = normalizeViaRunner(messages);
    const parsed = messagesArraySchema.safeParse(normalized);
    expect(parsed.success).toBe(true);

    // Verify undefined fields were stripped
    const toolMsg = normalized[2];
    const resultPart = (toolMsg.content as any[])[0];
    const agent = resultPart.output.value.agents[0];
    expect(agent.id).toBe('trmnl-image-agent');
    expect('secretsRefs' in agent).toBe(false);
    expect('commands' in agent).toBe(false);
  });
});
