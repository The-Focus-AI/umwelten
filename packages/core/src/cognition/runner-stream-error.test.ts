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
