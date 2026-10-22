/**
 * Runner streamText error surfacing.
 *
 * Regression test for the bug where a provider/tool failure surfaced on the
 * AI SDK stream as an `error` event was swallowed by the fullStream consumer,
 * so the runner later threw the opaque "No output generated. Check the stream
 * for errors." instead of the real cause — masking it from every caller
 * (including, over A2A, the habitats room).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

const streamTextMock = vi.hoisted(() => vi.fn());

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamText: streamTextMock };
});

import { BaseModelRunner } from './runner.js';
import { Interaction } from '../interaction/core/interaction.js';
import { Stimulus } from '../stimulus/stimulus.js';
import { MockLanguageModelV3 } from 'ai/test';
import { buildRequestOptions } from './request-options.js';

function makeInteraction() {
  return new Interaction(
    {
      provider: 'minimax',
      name: 'MiniMax-M2.5',
      costs: { promptTokens: 0.3, completionTokens: 1.2 },
    },
    new Stimulus({ role: 'assistant' }),
  );
}

async function* fullStreamOf(events: unknown[]) {
  for (const e of events) yield e;
}

afterEach(() => {
  vi.restoreAllMocks();
  streamTextMock.mockReset();
});

describe('Runner streamText error surfacing', () => {
  it('preserves failed tool results alongside successful parallel calls for the next turn', async () => {
    const runner = new BaseModelRunner();
    const interaction = makeInteraction();
    interaction.addMessage({ role: 'user', content: 'Inspect the repository.' });
    vi.spyOn(runner, 'startUp').mockResolvedValue({
      startTime: new Date(),
      modelIdString: 'minimax/MiniMax-M2.5',
    } as any);
    vi.spyOn(runner, 'makeStreamOptions').mockResolvedValue({} as any);
    streamTextMock.mockReturnValue({
      fullStream: fullStreamOf([
        { type: 'tool-call', toolCallId: 'read', toolName: 'bash', input: { command: 'cat README.md' } },
        { type: 'tool-call', toolCallId: 'update', toolName: 'bash', input: { command: 'git pull' } },
        { type: 'tool-result', toolCallId: 'read', toolName: 'bash', output: 'Reading...', preliminary: true },
        { type: 'tool-result', toolCallId: 'read', toolName: 'bash', output: 'Repository documentation' },
        { type: 'tool-error', toolCallId: 'update', toolName: 'bash', error: new Error('Permission denied') },
        { type: 'text-delta', text: 'The update failed.' },
      ]),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
    });

    await runner.streamText(interaction);
    interaction.addMessage({ role: 'user', content: 'What failed?' });
    const results = interaction.getMessages()
      .filter((message) => message.role === 'tool')
      .flatMap((message) => message.content);
    expect(results).toEqual([
      { type: 'tool-result', toolCallId: 'read', toolName: 'bash', output: { type: 'text', value: 'Repository documentation' } },
      { type: 'tool-result', toolCallId: 'update', toolName: 'bash', output: { type: 'error-text', value: 'Permission denied' } },
    ]);

    // Exercise real SDK prompt validation on the next turn, not just its schema.
    const { generateText } = await vi.importActual<typeof import('ai')>('ai');
    const options = buildRequestOptions({
      interaction,
      model: new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'Git pull was denied.' }],
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          warnings: [],
        }),
      }),
      config: {}, label: 'follow-up', streaming: false,
    });
    const followUp = await generateText(options as Parameters<typeof generateText>[0]);
    expect(followUp.text).toBe('Git pull was denied.');
  });

  it('throws the real stream error, not the opaque "No output generated"', async () => {
    const runner = new BaseModelRunner();
    const interaction = makeInteraction();

    // Bypass provider/model resolution and request building so the test
    // exercises only the fullStream consumption + error handling.
    vi.spyOn(runner, 'startUp').mockResolvedValue({
      startTime: new Date('2026-01-01T00:00:00.000Z'),
      modelIdString: 'minimax/MiniMax-M2.5',
    } as any);
    vi.spyOn(runner, 'makeStreamOptions').mockResolvedValue({} as any);

    const realError = new Error('twitter tool failed: 429 rate limited');
    streamTextMock.mockReturnValue({
      fullStream: fullStreamOf([{ type: 'error', error: realError }]),
      // Reading `.text` after a stream error throws the opaque AI SDK message.
      // The fix must short-circuit (throw the real error) before this is read.
      get text() {
        return Promise.reject(
          new Error('No output generated. Check the stream for errors.'),
        );
      },
      usage: Promise.resolve({}),
    });

    let caught: unknown;
    try {
      await runner.streamText(interaction);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('twitter tool failed: 429 rate limited');
    expect(message).not.toContain('No output generated');
  });
});
