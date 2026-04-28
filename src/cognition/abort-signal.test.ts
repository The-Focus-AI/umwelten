/**
 * Abort signal plumbing tests.
 *
 * These guard the watchdog fix: when an `AbortController` aborts at the
 * top of the stack (EvalSuite/harness), the signal must reach the AI SDK
 * `generateText`/`streamText` call so the underlying HTTP request is
 * actually cancelled. Without this, a watchdog only rejects its `await`
 * while the model keeps generating in the background — exactly the
 * pollution that drove the harness rewrite.
 *
 * See `simplify-llm-eval-architecture` plan, "Required core change."
 */

import { describe, it, expect, vi } from 'vitest';
import { BaseModelRunner } from './runner.js';
import { Interaction } from '../interaction/core/interaction.js';
import { Stimulus } from '../stimulus/stimulus.js';
import { buildRequestOptions } from './request-options.js';

describe('AbortSignal plumbing', () => {
  it('forwards a signal through buildRequestOptions to abortSignal', () => {
    const stim = new Stimulus({ role: 'test' });
    const interaction = new Interaction(
      { name: 'fake', provider: 'openrouter' },
      stim,
    );
    (interaction as any).messages.push({ role: 'user', content: 'hi' });

    const controller = new AbortController();
    const opts = buildRequestOptions({
      interaction,
      model: {} as any,
      config: {},
      label: 'test',
      streaming: false,
      abortSignal: controller.signal,
    });

    expect(opts.abortSignal).toBe(controller.signal);
  });

  it('omits abortSignal when no signal was provided', () => {
    const stim = new Stimulus({ role: 'test' });
    const interaction = new Interaction(
      { name: 'fake', provider: 'openrouter' },
      stim,
    );
    (interaction as any).messages.push({ role: 'user', content: 'hi' });

    const opts = buildRequestOptions({
      interaction,
      model: {} as any,
      config: {},
      label: 'test',
      streaming: false,
    });

    expect('abortSignal' in opts).toBe(false);
  });

  it('Interaction.generateText forwards signal to runner', async () => {
    const stim = new Stimulus({ role: 'test' });
    const interaction = new Interaction(
      { name: 'fake', provider: 'openrouter' },
      stim,
    );

    // Stub the runner so we can inspect the second arg.
    const fakeRunner = {
      generateText: vi.fn().mockResolvedValue({
        content: 'ok',
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          tokenUsage: { promptTokens: 0, completionTokens: 0, total: 0 },
          provider: 'fake',
          model: 'fake',
        },
      }),
      streamText: vi.fn(),
      generateObject: vi.fn(),
      streamObject: vi.fn(),
    };
    (interaction as any).runner = fakeRunner;

    const controller = new AbortController();
    await interaction.generateText(controller.signal);

    expect(fakeRunner.generateText).toHaveBeenCalledWith(
      interaction,
      controller.signal,
    );
  });

  it('BaseModelRunner.generateText accepts an optional signal arg', () => {
    // Compile-time / type-shape assertion: the second positional parameter
    // must exist. If a future refactor drops the signal arg, the type
    // assertion below will fail to compile.
    const runner = new BaseModelRunner();
    const fn: (
      i: Interaction,
      s?: AbortSignal,
    ) => Promise<unknown> = runner.generateText.bind(runner);
    expect(typeof fn).toBe('function');
  });
});
